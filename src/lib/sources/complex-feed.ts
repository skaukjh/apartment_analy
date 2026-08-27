/**
 * 단지별 소식 수집 — 블로그 · 카페 · 기사를 최신순으로 모은다.
 *
 * 지역 단위(community.ts, news.ts)가 아니라 **단지 이름 하나**를 축으로 모은다.
 * "내가 지켜보는 단지 목록"을 넣으면 단지마다 세 갈래 소식을 최신순으로 돌려준다.
 *
 * 원칙은 기존 수집기와 같다.
 *  - 네이버 검색 API 가 주는 제목·요약·링크까지만 쓴다. 본문 크롤링은 하지 않는다 (약관 준수).
 *  - 분양 홍보·중개 광고 글은 걸러낸다.
 *  - 개인 글은 수치 판단이 아니라 분위기 참고용이다.
 */

import type { NewsItem } from '@/lib/types';
import { naverSearchRaw, searchNews, stripTags } from './news';
import { isAd } from './community';

/** 단지 소식 한 건 */
export interface ComplexFeedItem {
  kind: 'blog' | 'cafe' | 'news';
  title: string;
  summary: string;
  url: string;
  /** 블로거명 · 카페명 · 언론사 도메인 */
  source: string;
  /** 작성일 (YYYY-MM-DD). 카페 글은 네이버가 날짜를 주지 않아 비어 있다 */
  postedAt?: string;
  /** 기사에만 있는 분류·톤 — 목록에서 호재/악재를 구분해 보여주는 데 쓴다 */
  category?: NewsItem['category'];
  tone?: NewsItem['tone'];
}

/** 한 단지의 수집 결과 */
export interface ComplexFeed {
  /** 사용자가 입력한 단지명 */
  name: string;
  /** 실제로 네이버에 보낸 검색어 */
  query: string;
  blogs: ComplexFeedItem[];
  cafes: ComplexFeedItem[];
  news: ComplexFeedItem[];
  /** 세 갈래 중 실패한 것들의 사유 */
  errors: string[];
}

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

/** 한 번에 처리할 단지 수 상한 — 단지당 3회 호출이라 무제한이면 쿼터가 순식간에 마른다 */
export const MAX_COMPLEX_NAMES = 10;
/** 갈래당 반환 건수 기본값 */
export const DEFAULT_PER_KIND = 10;

function parseBlogDate(yyyymmdd: string): string | undefined {
  if (!/^\d{8}$/.test(yyyymmdd)) return undefined;
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
}

/** 비교용 정규화 — 공백·괄호·중점 차이로 놓치는 걸 막는다 */
function normalize(s: string): string {
  return s.replace(/[\s()（）·・.,·'"]/g, '').toLowerCase();
}

/**
 * 검색어가 글에 실제로 등장하는지.
 *
 * 네이버는 검색어를 토큰으로 쪼개 매칭하기 때문에 "잠실엘스"로 찾으면
 * 엘스가 한 글자도 안 나오는 "잠실 아파트 시황" 같은 글도 섞여 온다.
 * 공백을 지운 뒤 제목·요약에 검색어가 통째로 들어있는지로 한 번 더 거른다.
 */
function mentionsQuery(item: { title: string; summary: string }, query: string): boolean {
  const q = normalize(query);
  if (!q) return true;
  return normalize(`${item.title} ${item.summary}`).includes(q);
}

/**
 * 관련도 필터를 적용하되, 다 걸러지면 원본을 돌려준다.
 *
 * "래미안원베일리" 처럼 사람들이 줄여 부르는 이름(원베일리)만 쓰는 단지는
 * 통째 포함 조건에 하나도 안 걸린다. 그럴 때 빈 목록을 보여주는 것보다
 * 네이버가 준 순서 그대로 보여주는 편이 낫다.
 */
function preferRelevant<T extends { title: string; summary: string }>(
  items: T[],
  query: string,
): T[] {
  const hit = items.filter((it) => mentionsQuery(it, query));
  return hit.length > 0 ? hit : items;
}

/** URL 기준 중복 제거 */
function dedupe<T extends { url: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((it) => {
    if (!it.url || seen.has(it.url)) return false;
    seen.add(it.url);
    return true;
  });
}

async function fetchBlogs(query: string, limit: number): Promise<ComplexFeedItem[]> {
  // 광고·중복·비관련 글이 빠질 것을 감안해 넉넉히 받아온다
  const raw = await naverSearchRaw<NaverBlogItem>('blog', query, Math.min(50, limit * 3), 'date');
  const items = raw
    .map(
      (it) =>
        ({
          kind: 'blog',
          title: stripTags(it.title),
          summary: stripTags(it.description),
          url: it.link,
          source: stripTags(it.bloggername ?? '블로그'),
          postedAt: parseBlogDate(it.postdate),
        }) satisfies ComplexFeedItem,
    )
    .filter((p) => !isAd(p.title, p.summary));

  return dedupe(preferRelevant(items, query))
    .sort((a, b) => (b.postedAt ?? '').localeCompare(a.postedAt ?? ''))
    .slice(0, limit);
}

async function fetchCafes(query: string, limit: number): Promise<ComplexFeedItem[]> {
  const raw = await naverSearchRaw<NaverCafeItem>(
    'cafearticle',
    query,
    Math.min(50, limit * 3),
    'date',
  );
  const items = raw
    .map(
      (it) =>
        ({
          kind: 'cafe',
          title: stripTags(it.title),
          summary: stripTags(it.description),
          url: it.link,
          source: stripTags(it.cafename ?? '카페'),
        }) satisfies ComplexFeedItem,
    )
    .filter((p) => !isAd(p.title, p.summary));

  /* 카페 글은 네이버가 작성일을 주지 않는다. 정렬은 API 의 date 정렬 순서를
     그대로 믿고, 화면에도 날짜를 지어내 적지 않는다. */
  return dedupe(preferRelevant(items, query)).slice(0, limit);
}

async function fetchArticles(query: string, limit: number): Promise<ComplexFeedItem[]> {
  const raw = await searchNews(query, Math.min(50, limit * 3));
  const items = raw.map(
    (n) =>
      ({
        kind: 'news',
        title: n.title,
        summary: n.summary,
        url: n.url,
        source: n.source,
        postedAt: n.publishedAt.slice(0, 10),
        category: n.category,
        tone: n.tone,
      }) satisfies ComplexFeedItem,
  );

  return dedupe(preferRelevant(items, query))
    .sort((a, b) => (b.postedAt ?? '').localeCompare(a.postedAt ?? ''))
    .slice(0, limit);
}

/** 단지 하나의 블로그·카페·기사를 최신순으로 모은다 */
export async function fetchComplexFeed(
  name: string,
  perKind = DEFAULT_PER_KIND,
): Promise<ComplexFeed> {
  const query = name.trim();
  const errors: string[] = [];
  const limit = Math.min(30, Math.max(1, Math.round(perKind)));

  const [blogs, cafes, news] = await Promise.all([
    fetchBlogs(query, limit).catch((e: Error) => {
      errors.push(`블로그: ${e.message}`);
      return [] as ComplexFeedItem[];
    }),
    fetchCafes(query, limit).catch((e: Error) => {
      errors.push(`카페: ${e.message}`);
      return [] as ComplexFeedItem[];
    }),
    fetchArticles(query, limit).catch((e: Error) => {
      errors.push(`기사: ${e.message}`);
      return [] as ComplexFeedItem[];
    }),
  ]);

  return { name: query, query, blogs, cafes, news, errors };
}

/**
 * 단지 목록을 한 번에 조회한다.
 *
 * 단지마다 3회씩 호출되므로 단지는 순차로 돌린다 — 10개를 동시에 던지면
 * 네이버 쪽 초당 호출 제한에 걸려 통째로 실패한다.
 */
export async function fetchComplexFeeds(
  names: string[],
  perKind = DEFAULT_PER_KIND,
): Promise<ComplexFeed[]> {
  const seen = new Set<string>();
  const targets = names
    .map((n) => n.trim())
    .filter((n) => {
      const key = normalize(n);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_COMPLEX_NAMES);

  const feeds: ComplexFeed[] = [];
  for (const name of targets) {
    feeds.push(await fetchComplexFeed(name, perKind));
  }
  return feeds;
}
