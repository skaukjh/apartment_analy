import { ComplexNewsClient } from './complex-news-client';
import { getSessionUser } from '@/lib/auth/server';
import { loadConfig } from '@/lib/store/config';

export const dynamic = 'force-dynamic';

/**
 * 단지 소식 — 지켜보는 단지마다 블로그·카페·기사를 최신순으로 모아 본다.
 *
 * 지역 단위로 흐르는 /policy 와 달리 여기는 **단지 이름**이 축이다.
 * 로그인해 두면 설정에 저장한 보유·목표 단지를 한 번에 넣을 수 있다.
 */
export default async function ComplexNewsPage() {
  const user = await getSessionUser();
  const config = user ? await loadConfig(user.id).catch(() => null) : null;

  // 설정에 저장된 단지명을 "빠른 추가" 후보로 넘긴다 (중복 제거, 보유 → 목표 순)
  const suggestions = [
    ...(config?.holdings ?? []).map((h) => h.complexName),
    ...(config?.targets ?? []).map((t) => t.complexName),
  ].filter((name, i, arr) => Boolean(name) && arr.indexOf(name) === i);

  return (
    <div className="mx-auto max-w-[1600px] space-y-6 px-4 py-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">단지 소식</h1>
        <p className="text-muted-foreground text-sm">
          단지명을 넣으면 그 단지의 블로그·카페 글과 기사를 최신순으로 모읍니다 — 네이버 검색 API
          기반. 재건축 현황·단지 분석·거래 소식만 남기고 맛집·인테리어 같은 생활 정보는 걸러냅니다.
          개인 글은 분위기 참고용이며 수치 판단에는 쓰지 않습니다.
        </p>
      </div>

      <ComplexNewsClient suggestions={suggestions} />
    </div>
  );
}
