import { configIdForRequest } from '@/lib/auth/server';
import Link from 'next/link';
import { buildDashboardCached } from '@/lib/pipeline/dashboard';
import { buildBriefing } from '@/lib/kakao/briefing';
import { hasOpenAI } from '@/lib/ai/client';
import { HEAT_META } from '@/lib/analysis/market-signals';
import { formatEok, formatPct } from '@/lib/format';
import { SectionCard, Stat } from '@/components/ui-bits';
import { AiOutlookPanel } from './today-client';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * 오늘의 요약.
 *
 * 카카오톡으로 가는 브리핑과 같은 내용을 웹에서 전부 보여준다.
 * 카톡은 200자 제한이라 요약만 가고, 여기가 그 "전체 보기" 목적지다.
 */
export default async function TodayPage() {
  const data = await buildDashboardCached(await configIdForRequest());
  const briefing = buildBriefing(data);
  const heat = HEAT_META[data.sentiment.heatLevel];
  const topGap = data.gaps[0];

  return (
    <div className="mx-auto max-w-[1100px] px-4 py-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{briefing.title}</h1>
          <p className="text-muted-foreground text-sm">{briefing.headline}</p>
        </div>
        <Link
          href="/"
          className="hover:bg-secondary/60 rounded-md border px-3 py-1.5 text-sm transition-colors"
        >
          대시보드로
        </Link>
      </div>

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Stat
          label="최소 갈아타기 갭"
          value={topGap ? formatEok(topGap.gap) : '—'}
          sub={topGap ? `${topGap.holdingName} → ${topGap.targetName}` : '보유·목표를 등록하세요'}
        />
        <Stat
          label="시장 과열도"
          value={`${data.sentiment.heatScore}/100`}
          sub={heat?.label ?? ''}
        />
        <Stat
          label="신고가 비중"
          value={formatPct(data.sentiment.newHighRatio, 1)}
          sub={`거래량 전년비 ${formatPct(data.sentiment.volumeYoy, 1)}`}
        />
      </div>

      <div className="mb-6">
        <SectionCard
          title="AI 요약 · 전망"
          description="공식 발표와 정책, 커뮤니티 글을 읽고 보유·목표 아파트 기준으로 정리합니다. 투자 자문이 아닙니다."
        >
          <AiOutlookPanel enabled={hasOpenAI()} />
        </SectionCard>
      </div>

      <SectionCard title="오늘의 브리핑 전문" description="카카오톡으로 발송되는 내용입니다.">
        <div className="space-y-5">
          {briefing.sections.map((s) => (
            <div key={s.heading}>
              <h3 className="mb-1.5 text-sm font-semibold">{s.heading}</h3>
              <ul className="space-y-1">
                {s.lines.map((l, i) => (
                  <li key={i} className="text-muted-foreground text-sm">
                    · {l}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </SectionCard>
    </div>
  );
}
