import { buildDashboardCached } from '@/lib/pipeline/dashboard';
import { getSessionUser } from '@/lib/auth/server';
import { loadSentimentNote } from '@/lib/ai/sentiment-note';
import { AutoRefresh } from '@/components/auto-refresh';
import { SpreadMap } from '@/components/dashboard/spread-map';
import { SentimentSection } from '@/components/dashboard/sentiment-section';
import { SentimentNoteCard } from '@/components/dashboard/sentiment-note-card';
import { ExtremesSection } from '@/components/dashboard/extremes-section';
import { MacroSection } from '@/components/dashboard/macro-section';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * 시장 동향 — 지역별 확산 지도, 과열 지표, 신고가, 거시 지수.
 * "지금 시장이 어떤 상태인가"를 보는 페이지다. 내 아파트 기준 정보는 홈에 있다.
 */
export default async function MarketPage() {
  const sessionUser = await getSessionUser();
  const userId = sessionUser?.id ?? 'default';
  const data = await buildDashboardCached(userId);
  const sentimentNote = await loadSentimentNote().catch(() => null);

  return (
    <div className="mx-auto max-w-[1600px] space-y-6 px-4 py-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">시장 동향</h1>
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-muted-foreground text-sm">
            지역별 실거래 지수·확산 흐름·과열 지표 — 국토교통부 실거래가 · 한국부동산원 · 한국은행
            ECOS 기반
          </p>
          <AutoRefresh generatedAt={data.generatedAt} />
        </div>
      </div>

      {/* 지역별 흐름 — 이 페이지의 본론 */}
      <SpreadMap rebound={data.rebound} kakaoJsKey={process.env.NEXT_PUBLIC_KAKAO_JS_KEY} />

      {/* 과열·심리와 신고가는 지도의 해석을 돕는 짝이다 */}
      <div className="grid gap-6 xl:grid-cols-2">
        <SentimentSection sentiment={data.sentiment} />
        <SentimentNoteCard note={sentimentNote} />
        <ExtremesSection extremes={data.extremes} />
      </div>

      {/* 거시 지수 — 시장 배경 */}
      <MacroSection macro={data.macro} />
    </div>
  );
}
