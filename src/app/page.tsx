import { configIdForRequest } from '@/lib/auth/server';
import Link from 'next/link';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { buildDashboard, summarizeDashboard } from '@/lib/pipeline/dashboard';
import { buildBriefing, briefingToText, previewChunks } from '@/lib/kakao/briefing';
import { getConnectionStatus } from '@/lib/kakao/client';
import { isConfigEmpty } from '@/lib/store/config';
import { HEAT_META } from '@/lib/analysis/market-signals';
import { formatEok, formatKrw, formatPct } from '@/lib/format';
import { Stat } from '@/components/ui-bits';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { GapSection } from '@/components/dashboard/gap-section';
import { SpreadMap } from '@/components/dashboard/spread-map';
import { CatalystSection } from '@/components/dashboard/catalyst-section';
import { SentimentSection } from '@/components/dashboard/sentiment-section';
import { ExtremesSection } from '@/components/dashboard/extremes-section';
import { MacroSection } from '@/components/dashboard/macro-section';
import { ScheduleSection } from '@/components/dashboard/schedule-section';
import { NewsSection } from '@/components/dashboard/news-section';
import { SourceStatusSection } from '@/components/dashboard/source-status';
import { BriefingCard } from '@/components/dashboard/briefing-card';
import { AutoRefresh } from '@/components/auto-refresh';
import { AiAdvisor } from '@/components/dashboard/ai-advisor';
import { CommunitySection, PressSection } from '@/components/dashboard/press-community';
import { hasOpenAI } from '@/lib/ai/client';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function DashboardPage() {
  const userId = await configIdForRequest();
  const data = await buildDashboard({ userId });
  const { spread, primaryGap, newHighs, newLows } = summarizeDashboard(data);
  const briefing = buildBriefing(data);
  const kakao = await getConnectionStatus(userId).catch(() => ({ connected: false }));
  const empty = isConfigEmpty(data.config);
  const heat = HEAT_META[data.sentiment.heatLevel];

  return (
    <div className="mx-auto max-w-[1600px] space-y-6 px-4 py-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">부동산 갈아타기 대시보드</h1>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-muted-foreground text-sm">
              국토교통부 실거래가 · 한국은행 ECOS · 한국부동산원 · 네이버 뉴스 기반
            </p>
            <AutoRefresh generatedAt={data.generatedAt} />
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            render={<Link href="/settings" />}
            nativeButton={false}
            variant="outline"
            size="sm"
          >
            설정
          </Button>
          <Button render={<Link href="/simulation" />} nativeButton={false} size="sm">
            갈아타기 시뮬레이션
          </Button>
        </div>
      </div>

      {empty ? (
        <Alert>
          <AlertTriangle className="size-4" />
          <AlertTitle>먼저 내 아파트를 등록하세요</AlertTitle>
          <AlertDescription>
            보유 아파트·목표 아파트·관심 지역을 등록해야 갭 계산, 세금 시뮬레이션, 지역 호재 추적이
            동작합니다.{' '}
            <Link href="/settings" className="underline underline-offset-2">
              설정으로 이동 →
            </Link>
          </AlertDescription>
        </Alert>
      ) : null}

      {data.rebound.length === 0 ? (
        <Alert>
          <RefreshCw className="size-4" />
          <AlertTitle>실거래 데이터가 아직 비어 있습니다</AlertTitle>
          <AlertDescription>
            <code className="bg-muted rounded px-1">
              /api/cron/backfill?secret=&lt;CRON_SECRET&gt;
            </code>{' '}
            를 remaining 이 0이 될 때까지 반복 호출해 과거 실거래를 채운 뒤, 이후에는 매일{' '}
            <code className="bg-muted rounded px-1">/api/cron/refresh</code> 가 증분 갱신합니다.
          </AlertDescription>
        </Alert>
      ) : null}

      {/* KPI */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Stat
          label="현재 시세 갭"
          value={primaryGap ? formatKrw(primaryGap.gap, { compact: true }) : '-'}
          sub={
            primaryGap
              ? `${primaryGap.ratio.toFixed(2)}배 · ${primaryGap.targetName}`
              : '아파트 미등록'
          }
          tone="rise"
        />
        <Stat
          label="세후 실소요 자금"
          value={primaryGap ? formatKrw(primaryGap.realCashNeeded, { compact: true }) : '-'}
          sub={
            primaryGap
              ? `갭 대비 +${formatEok(primaryGap.realCashNeeded - primaryGap.gap)}`
              : '세금·중개비 포함'
          }
        />
        <Stat
          label="시장 과열도"
          value={`${data.sentiment.heatScore} · ${heat.label}`}
          sub={`수급 ${data.sentiment.supplyDemandIndex} · 신고가 ${data.sentiment.newHighRatio.toFixed(1)}%`}
        />
        <Stat
          label="상승 확산률"
          value={`${spread.spreadRate.toFixed(0)}%`}
          sub={`선도 ${spread.leading.length} · 확산 ${spread.spreading.length} · 미반등 ${spread.noRebound.length}`}
        />
        <Stat
          label="신고가 · 신저가"
          value={`${newHighs.length} · ${newLows.length}`}
          sub={
            data.macro.find((m) => m.key === 'base-rate')
              ? `기준금리 ${data.macro.find((m) => m.key === 'base-rate')!.latest}%`
              : '최근 2개월 기준'
          }
        />
      </div>

      {/* ① 갭 + ② 비용 */}
      <GapSection config={data.config} quotes={data.quotes} />

      {/* ③ 확산 지도 */}
      <SpreadMap rebound={data.rebound} kakaoJsKey={process.env.NEXT_PUBLIC_KAKAO_JS_KEY} />

      <div className="grid gap-6 xl:grid-cols-2">
        {/* ⑥ 과열 */}
        <SentimentSection sentiment={data.sentiment} />
        {/* ⑦ 신고가 */}
        <ExtremesSection extremes={data.extremes} />
      </div>

      {/* AI 평가 · 상담 */}
      <AiAdvisor config={data.config} enabled={hasOpenAI()} />

      {/* ④ 호재 */}
      <CatalystSection catalysts={data.catalysts} regions={data.config.watchRegions} />

      {/* 공식 발표 · 커뮤니티 */}
      <div className="grid gap-6 xl:grid-cols-2">
        <PressSection press={data.press} />
        <CommunitySection posts={data.community} />
      </div>

      {/* ⑧ 지수 + 브리핑 */}
      <MacroSection macro={data.macro} sentiment={data.sentiment} />

      <div className="grid gap-6 xl:grid-cols-2">
        <ScheduleSection schedule={data.schedule} />
        <NewsSection news={data.news} />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <BriefingCard
          text={briefingToText(briefing)}
          chunkCount={previewChunks(briefing).length}
          kakaoConnected={kakao.connected}
        />
        <SourceStatusSection sources={data.sourceStatus} generatedAt={data.generatedAt} />
      </div>

      <p className="text-muted-foreground pt-2 text-center text-xs">
        상승 확산률 {formatPct(spread.spreadRate, 0)} 기준 · 분석 대상 {spread.total}개 시군구
      </p>
    </div>
  );
}
