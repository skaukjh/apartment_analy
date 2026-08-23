import { buildDashboardCached } from '@/lib/pipeline/dashboard';
import { getSessionUser, resolveOpenAIKey } from '@/lib/auth/server';
import { catalystCoverageRegions } from '@/lib/analysis/catalysts';
import { AutoRefresh } from '@/components/auto-refresh';
import { PolicyDigestPanel } from '@/components/policy/policy-digest-panel';
import { CatalystSection } from '@/components/dashboard/catalyst-section';
import { NewsSection } from '@/components/dashboard/news-section';
import { CommunitySection, PressSection } from '@/components/dashboard/press-community';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * 정책·뉴스 — 정책 요약, 공식 발표, 관심 지역 호재·악재, 커뮤니티, 일정.
 * "제도와 여론이 어떻게 움직이는가"를 보는 페이지다.
 */
export default async function PolicyPage() {
  const sessionUser = await getSessionUser();
  const userId = sessionUser?.id ?? 'default';
  const data = await buildDashboardCached(userId);
  const canRefreshAi = resolveOpenAIKey(sessionUser, data.config.openaiApiKey).allowed;

  return (
    <div className="mx-auto max-w-[1600px] space-y-6 px-4 py-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">정책 · 뉴스</h1>
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-muted-foreground text-sm">
            정부 발표·입법 동향과 관심 지역 소식 — 정부 부처 · 네이버 뉴스 기반
          </p>
          <AutoRefresh generatedAt={data.generatedAt} />
        </div>
      </div>

      {/* 정책 요약 — 이 페이지의 본론 */}
      <PolicyDigestPanel canRefresh={canRefreshAi} />

      {/* 공식 발표(+주요 일정 탭)와 관련 뉴스 */}
      <div className="grid gap-6 xl:grid-cols-2">
        <PressSection press={data.press} schedule={data.schedule} />
        <NewsSection news={data.news} />
      </div>

      {/* 내 지역에 걸린 호재·악재 */}
      <CatalystSection catalysts={data.catalysts} regions={catalystCoverageRegions(data.config)} />

      {/* 여론 */}
      <CommunitySection posts={data.community} />
    </div>
  );
}
