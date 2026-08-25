import { getSessionUser, resolveOpenAIKey } from '@/lib/auth/server';
import Link from 'next/link';
import { buildDashboardCached } from '@/lib/pipeline/dashboard';
import { buildBriefing } from '@/lib/kakao/briefing';
import { buildBriefingDiff, loadPreviousBriefingSnapshot } from '@/lib/analysis/briefing-diff';
import { hasOpenAI } from '@/lib/ai/client';
import { SectionCard } from '@/components/ui-bits';
import { AiOutlookPanel } from './today-client';
import { DemoNotice } from '@/components/demo-notice';

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

  /* 지난 브리핑 이후 무엇이 달라졌는지 — 이 사용자의 발송 스냅샷과 비교 */
  const prevSnap = await loadPreviousBriefingSnapshot(sessionUser?.id ?? 'default').catch(
    () => null,
  );
  const diff = prevSnap ? buildBriefingDiff(data, prevSnap.snap) : [];
  const prevAt = prevSnap ? new Date(prevSnap.capturedAt) : null;

  return (
    <div className="mx-auto max-w-[1100px] px-4 py-6">
      {sessionUser ? null : (
        <div className="mb-4">
          <DemoNotice />
        </div>
      )}

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

      {prevSnap ? (
        <div className="mb-6">
          <SectionCard
            title="🔄 지난 브리핑 이후 변화"
            description={
              prevAt
                ? `${prevAt.getMonth() + 1}월 ${prevAt.getDate()}일 ${prevAt.getHours()}시 발송분과 비교`
                : undefined
            }
          >
            {diff.length > 0 ? (
              <ul className="space-y-1">
                {diff.map((l, i) => (
                  <li key={i} className="text-sm">
                    · {l}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground text-sm">시세·갭·과열점수 모두 변동 없습니다.</p>
            )}
          </SectionCard>
        </div>
      ) : null}

      <SectionCard
        title="오늘의 브리핑 전문"
        description="카카오톡·텔레그램으로 발송되는 내용입니다."
      >
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
