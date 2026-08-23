import { getSessionUser, resolveOpenAIKey } from '@/lib/auth/server';
import Link from 'next/link';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { buildDashboardCached, summarizeDashboard } from '@/lib/pipeline/dashboard';
import { isConfigEmpty } from '@/lib/store/config';
import { HEAT_META } from '@/lib/analysis/market-signals';
import { regulationOf } from '@/lib/analysis/regulation';
import { calcLoanLimit } from '@/lib/tax/loan-limit';
import { formatEok, formatKrw } from '@/lib/format';
import { Stat } from '@/components/ui-bits';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { GapSection } from '@/components/dashboard/gap-section';
import { AutoRefresh } from '@/components/auto-refresh';
import { AiAdvisor } from '@/components/dashboard/ai-advisor';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * 홈 — 내 갈아타기.
 *
 * "내 보유·목표 아파트 기준으로 지금 어디까지 왔나"만 보여준다.
 * 시장 전반은 /market, 정책·뉴스는 /policy 로 분리했다 —
 * 한 페이지에 패널이 전부 몰려 있어 읽기 어렵다는 피드백에 따른 구조다.
 */
export default async function HomePage() {
  const sessionUser = await getSessionUser();
  const userId = sessionUser?.id ?? 'default';
  const data = await buildDashboardCached(userId);
  const { spread, primaryGap, newHighs, newLows } = summarizeDashboard(data);
  const empty = isConfigEmpty(data.config);
  const heat = HEAT_META[data.sentiment.heatLevel];

  /* 1순위 조합의 실소요를 대출/현금으로 분해 — 아래 갭 카드와 같은 기준 */
  let primarySplit: { byLoan: number; byCash: number } | null = null;
  if (primaryGap) {
    const target = data.config.targets.find((t) => t.id === primaryGap.targetId);
    const holding = data.config.holdings.find((h) => h.id === primaryGap.holdingId);
    if (target) {
      const reg = regulationOf(target.lawdCd);
      const limit = calcLoanLimit({
        price: primaryGap.targetPrice,
        regulated: data.config.household.targetIsRegulated || reg.adjusted,
        metro: reg.metro,
        retainedHouseCount: 0,
        firstTimeBuyer: data.config.household.firstTimeBuyer,
        annualIncome: data.config.household.annualIncome,
        otherDebtAnnualPayment: data.config.household.otherDebtAnnualPayment,
        rate: holding?.loanRate || 4,
      }).limit;
      const byLoan = Math.min(limit, Math.max(0, primaryGap.realCashNeeded));
      primarySplit = { byLoan, byCash: Math.max(0, primaryGap.realCashNeeded - byLoan) };
    }
  }

  return (
    <div className="mx-auto max-w-[1600px] space-y-6 px-4 py-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">내 갈아타기</h1>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-muted-foreground text-sm">
              보유 ↔ 목표 시세 갭과 실소요 자금 — 국토교통부 실거래가 기준
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

      {/* KPI — 시장 요약 수치는 여기서 한눈에, 상세는 시장 동향 페이지에서 */}
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
              ? primarySplit
                ? `대출 ${formatEok(primarySplit.byLoan)} · 내 돈 ${formatEok(primarySplit.byCash)}`
                : `갭 대비 +${formatEok(primaryGap.realCashNeeded - primaryGap.gap)}`
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

      {/* 갭 + 비용 — 이 페이지의 본론 */}
      <GapSection config={data.config} quotes={data.quotes} />

      {/* AI 평가·상담 — 관리자(운영자 키) 또는 개인 키(BYOK) 등록 회원에게만 */}
      {resolveOpenAIKey(sessionUser, data.config.openaiApiKey).allowed ? (
        <AiAdvisor config={data.config} quotes={data.quotes} enabled />
      ) : null}
    </div>
  );
}
