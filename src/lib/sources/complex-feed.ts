/**
 * 단지별 소식 수집 — 블로그 · 카페 · 기사를 최신순으로 모은다.
 *
 * 지역 단위(community.ts, news.ts)가 아니라 **단지 이름 하나**를 축으로 모은다.
 * "내가 지켜보는 단지 목록"을 넣으면 단지마다 세 갈래 소식을 최신순으로 돌려준다.
 *
 * 원칙은 기존 수집기와 같다.
 *  - 네이버 검색 API 가 주는 제목·요약·링크까지만 쓴다. 본문 크롤링은 하지 않는다 (약관 준수).
 *  - 분양 홍보·중개 광고 글은 걸러낸다.
 *  - 단지 이름이 주소로만 쓰인 생활 정보 글(맛집·인테리어·학원)도 걸러낸다.
 *    이 화면이 보려는 건 재건축 현황·단지 분석·신규 거래뿐이다.
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
  /** 주제 필터로 걸러낸 건수 — 몇 건이 빠졌는지 화면에서 밝히려고 센다 */
  dropped: number;
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

/**
 * 단지 이름이 주소로만 쓰인 생활 정보 글.
 *
 * "잠실엘스"로 검색하면 단지 앞 맛집, 입주 인테리어 견적, 상가 학원 후기가 함께 온다.
 * 단지가 화제가 아니라 위치 표시로 쓰인 글이라 재건축·시세를 보러 온 화면에서는 소음이다.
 */
const OFF_TOPIC_WORDS = [
  // 먹거리
  '맛집',
  '먹방',
  '배달',
  '디저트',
  '베이커리',
  '브런치',
  '술집',
  '이자카야',
  '카페\\s*추천',
  '메뉴',
  // 집 꾸미기 — 단지 리모델링 사업과 헷갈리지 않게 뒤에 붙는 말까지 본다
  '인테리어',
  '리모델링\\s*(견적|업체|비용|시공|공사|후기|추천)',
  '도배',
  '장판',
  '줄눈',
  '입주\\s*청소',
  '포장\\s*이사',
  '이사\\s*업체',
  '커튼',
  '붙박이장',
  '에어컨\\s*설치',
  // 상가·생활 편의
  '학원',
  '과외',
  '어린이집',
  '유치원',
  '치과',
  '한의원',
  '피부과',
  '정형외과',
  '헬스장',
  '필라테스',
  '미용실',
  '네일',
  '애견',
  '강아지',
  '고양이',
  // 잡담·거래글
  '구인',
  '알바',
  '중고',
  '나눔',
  '분실',
  '실종',
];
const OFF_TOPIC_PATTERN = new RegExp(OFF_TOPIC_WORDS.join('|'));

/**
 * 단지 자체가 화제인 글에서 나오는 말.
 *
 * 재건축 현황·단지 분석·신규 거래가 이 화면이 보려는 전부다. 위 소음 목록만으로는
 * 새로 생기는 잡글을 못 따라가므로, 이쪽 말이 하나도 없으면 통과시키지 않는다.
 */
const ON_TOPIC_WORDS = [
  // 정비사업
  '재건축',
  '재개발',
  '정비\\s*사업',
  '조합',
  '안전\\s*진단',
  '시공사',
  '사업\\s*시행',
  '용적률',
  '대지\\s*지분',
  '분담금',
  '이주',
  '철거',
  '착공',
  '준공',
  '리모델링\\s*(사업|조합|추진|동의|총회|가결|확정)',
  // 거래·시세
  '실거래',
  '신고가',
  '신저가',
  '거래량',
  '매매',
  '전세',
  '월세',
  '호가',
  '시세',
  '급매',
  '매물',
  '매수',
  '매도',
  '갭투자',
  '분양',
  '청약',
  '입주권',
  '\\d+\\s*억',
  // 단지 분석
  '단지\\s*분석',
  '아파트\\s*분석',
  '임장',
  '평형',
  '평면',
  '세대수',
  '학군',
  '교통',
  '호재',
  '개발',
  '공급',
  '규제',
  '토지\\s*거래\\s*허가',
  'GTX',
];
const ON_TOPIC_PATTERN = new RegExp(ON_TOPIC_WORDS.join('|'), 'i');

/** 단지 소식으로 볼 글인지 — 생활 정보면 버리고, 단지 이야기가 없어도 버린다 */
function isComplexTopic(item: { title: string; summary: string }): boolean {
  const text = `${item.title} ${item.summary}`;
  if (OFF_TOPIC_PATTERN.test(text)) return false;
  return ON_TOPIC_PATTERN.test(text);
}

/** 갈래 하나의 수집 결과 — 남긴 글과 주제 필터로 버린 건수 */
interface KindResult {
  items: ComplexFeedItem[];
  dropped: number;
}

/**
 * 주제 필터를 적용하고 몇 건을 버렸는지 함께 돌려준다.
 *
 * 여기서는 관련도 필터(preferRelevant)와 달리 폴백하지 않는다. 남는 게 없으면
 * 그 단지에는 최근 단지 소식이 없는 것이고, 맛집 글로 자리를 채우면 화면이 거짓말을 한다.
 */
function keepOnTopic(items: ComplexFeedItem[]): KindResult {
  const kept = items.filter(isComplexTopic);
  return { items: kept, dropped: items.length - kept.length };
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

async function fetchBlogs(query: string, limit: number): Promise<KindResult> {
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

  const { items: onTopic, dropped } = keepOnTopic(dedupe(preferRelevant(items, query)));
  return {
    items: onTopic
      .sort((a, b) => (b.postedAt ?? '').localeCompare(a.postedAt ?? ''))
      .slice(0, limit),
    dropped,
  };
}

async function fetchCafes(query: string, limit: number): Promise<KindResult> {
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
  const { items: onTopic, dropped } = keepOnTopic(dedupe(preferRelevant(items, query)));
  return { items: onTopic.slice(0, limit), dropped };
}

async function fetchArticles(query: string, limit: number): Promise<KindResult> {
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

  const { items: onTopic, dropped } = keepOnTopic(dedupe(preferRelevant(items, query)));
  return {
    items: onTopic
      .sort((a, b) => (b.postedAt ?? '').localeCompare(a.postedAt ?? ''))
      .slice(0, limit),
    dropped,
  };
}

/** 수집 실패 시 자리를 채울 빈 결과 */
const EMPTY_KIND: KindResult = { items: [], dropped: 0 };

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
      return EMPTY_KIND;
    }),
    fetchCafes(query, limit).catch((e: Error) => {
      errors.push(`카페: ${e.message}`);
      return EMPTY_KIND;
    }),
    fetchArticles(query, limit).catch((e: Error) => {
      errors.push(`기사: ${e.message}`);
      return EMPTY_KIND;
    }),
  ]);

  return {
    name: query,
    query,
    blogs: blogs.items,
    cafes: cafes.items,
    news: news.items,
    dropped: blogs.dropped + cafes.dropped + news.dropped,
    errors,
  };
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
