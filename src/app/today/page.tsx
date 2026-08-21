import { getSessionUser, resolveOpenAIKey } from '@/lib/auth/server';
import Link from 'next/link';
import { buildDashboardCached } from '@/lib/pipeline/dashboard';
import { buildBriefing } from '@/lib/kakao/briefing';
import { hasOpenAI } from '@/lib/ai/client';
import { SectionCard } from '@/components/ui-bits';
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
  const sessionUser = await getSessionUser();
  const data = await buildDashboardCached(sessionUser?.id ?? 'default');
  const ai = resolveOpenAIKey(sessionUser, data.config.openaiApiKey);
  const briefing = buildBriefing(data);

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

      <div className="mb-6">
        <AiOutlookPanel enabled={hasOpenAI() || ai.allowed} canRefresh={ai.allowed} />
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
