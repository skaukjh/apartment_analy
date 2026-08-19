/**
 * 블로그·카페 글 수집 — 네이버 검색 API (blog / cafearticle)
 *
 * 원칙:
 *  - 개인 글은 참고용이다. 수치 판단(시세·지표)에는 절대 쓰지 않고 "분위기 읽기"로만 노출한다.
 *  - 카페 본문 크롤링은 하지 않는다. 검색 API 가 주는 제목·요약·링크까지만 사용한다 (약관 준수).
 *  - 연관도(sim) 정렬 상위를 "주요 인기 글"로 따로 분류한다. 네이버 연관도는 조회·반응이
 *    반영된 랭킹이라 완전한 인기순은 아니지만, 공식 API 로 얻을 수 있는 가장 가까운 신호다.
 *  - 분양 홍보·중개 광고 패턴은 걸러낸다.
 */

import type { CommunityPost, WatchRegion } from '@/lib/types';
import { naverSearchRaw, stripTags } from './news';

interface NaverBlogItem {
  title: string;
  link: string;
  description: string;
  bloggername: string;
  postdate: string; // yyyymmdd
}

interface NaverCafeItem {
  title: string;
  link: string;
  description: string;
  cafename: string;
}

/** 광고·홍보 글 판별 — 제목/요약의 전형적 패턴 */
const AD_PATTERN =
  /(분양\s*문의|상담\s*문의|상담\s*환영|모델\s*하우스|견본\s*주택|홍보관|사전\s*예약|프리미엄\s*안내|동\s*호수\s*지정|잔여\s*세대|☎|📞|010[-.\s]?\d{3,4}[-.\s]?\d{4}|공인중개사\s*사무소|매물\s*접수)/;

function isAd(title: string, summary: string): boolean {
  const text = `${title} ${summary}`;
  if (AD_PATTERN.test(text)) return true;
  // "분양"이 과도하게 반복되면 홍보 글일 확률이 높다
  return (text.match(/분양/g) ?? []).length >= 3;
}

function parseBlogDate(yyyymmdd: string): string | undefined {
  if (!/^\d{8}$/.test(yyyymmdd)) return undefined;
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
}

async function searchBlogs(
  query: string,
  display: number,
  sort: 'sim' | 'date',
  popular: boolean,
): Promise<CommunityPost[]> {
  const items = await naverSearchRaw<NaverBlogItem>('blog', query, display, sort);
  return items
    .map((it) => ({
      title: stripTags(it.title),
      summary: stripTags(it.description),
      url: it.link,
      source: stripTags(it.bloggername ?? '블로그'),
      kind: 'blog' as const,
      postedAt: parseBlogDate(it.postdate),
      popular,
    }))
    .filter((p) => !isAd(p.title, p.summary));
}

async function searchCafes(
  query: string,
  display: number,
  sort: 'sim' | 'date',
  popular: boolean,
): Promise<CommunityPost[]> {
  const items = await naverSearchRaw<NaverCafeItem>('cafearticle', query, display, sort);
  return items
    .map((it) => ({
      title: stripTags(it.title),
      summary: stripTags(it.description),
      url: it.link,
      source: stripTags(it.cafename ?? '카페'),
      kind: 'cafe' as const,
      popular,
    }))
    .filter((p) => !isAd(p.title, p.summary));
}

/** 시장 전반 인기 글 검색어 */
const MARKET_QUERIES = [
  '부동산 전망',
  '아파트 갈아타기 고민',
  '아파트 임장 후기',
  '부동산 시장 분위기',
];

/**
 * 관심 지역 + 시장 전반의 블로그·카페 글을 모은다.
 * - 인기 글: 시장 전반 검색어를 연관도(sim) 정렬로
 * - 최신 글: 관심 지역 검색어를 날짜(date) 정렬로
 */
export async function fetchCommunityPosts(
  regions: WatchRegion[],
): Promise<{ posts: CommunityPost[]; errors: string[] }> {
  const errors: string[] = [];
  const tasks: Array<Promise<CommunityPost[]>> = [];

  // 1) 시장 전반 인기 글 (연관도 상위)
  for (const q of MARKET_QUERIES) {
    tasks.push(
      searchBlogs(q, 6, 'sim', true).catch((e) => {
        errors.push(`블로그 "${q}": ${(e as Error).message}`);
        return [];
      }),
    );
    tasks.push(
      searchCafes(q, 6, 'sim', true).catch((e) => {
        errors.push(`카페 "${q}": ${(e as Error).message}`);
        return [];
      }),
    );
  }

  // 2) 관심 지역 최신 글 (지역당 1개 검색어로 호출량 억제)
  for (const region of regions.slice(0, 5)) {
    const q = `${region.name} 아파트`;
    tasks.push(
      searchBlogs(q, 5, 'date', false)
        .then((posts) => posts.map((p) => ({ ...p, regionId: region.id })))
        .catch((e) => {
          errors.push(`블로그 "${q}": ${(e as Error).message}`);
          return [];
        }),
    );
    tasks.push(
      searchCafes(q, 5, 'date', false)
        .then((posts) => posts.map((p) => ({ ...p, regionId: region.id })))
        .catch((e) => {
          errors.push(`카페 "${q}": ${(e as Error).message}`);
          return [];
        }),
    );
  }

  const all = (await Promise.all(tasks)).flat();

  // URL 기준 중복 제거 — 인기 글 판정이 우선 남도록 popular 를 먼저 정렬
  const seen = new Set<string>();
  const posts = [...all]
    .sort((a, b) => Number(b.popular) - Number(a.popular))
    .filter((p) => {
      if (seen.has(p.url)) return false;
      seen.add(p.url);
      return true;
    });

  return { posts, errors };
}
