/**
 * 뉴스 수집 — 네이버 검색 API (뉴스)
 *
 * 신청: https://developers.naver.com/apps/#/register (검색 API)
 * 문서: https://developers.naver.com/docs/serviceapi/search/news/news.md
 *
 * 네이버 부동산(land.naver.com)은 공식 오픈 API가 없고 스크래핑은 이용약관 위반이므로
 * 시세는 국토교통부 실거래가를, 동향·호재는 뉴스 검색 API를 사용한다.
 */

import { env } from '@/lib/env';
import type { NewsItem, WatchRegion } from '@/lib/types';
import { SOURCE_TTL } from '@/lib/refresh-policy';

interface NaverNewsItem {
  title: string;
  originallink: string;
  link: string;
  description: string;
  pubDate: string;
}

/**
 * 네이버 검색 API 공통 호출 — 뉴스/블로그/카페가 같은 자격증명·형식을 쓴다.
 * community.ts 등 다른 어댑터에서 재사용한다.
 */
export async function naverSearchRaw<T>(
  endpoint: 'news' | 'blog' | 'cafearticle',
  query: string,
  display = 20,
  sort: 'sim' | 'date' = 'date',
): Promise<T[]> {
  const id = env.naverClientId;
  const secret = env.naverClientSecret;
  if (!id || !secret) throw new Error('NAVER_CLIENT_ID / NAVER_CLIENT_SECRET 이 설정되지 않았습니다.');

  const url =
    `https://openapi.naver.com/v1/search/${endpoint}.json` +
    `?query=${encodeURIComponent(query)}&display=${display}&sort=${sort}`;
  const res = await fetch(url, {
    headers: { 'X-Naver-Client-Id': id, 'X-Naver-Client-Secret': secret },
    next: { revalidate: SOURCE_TTL.news },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`네이버 ${endpoint} 검색 HTTP ${res.status} ${body.slice(0, 200)}`);
  }

  const json = (await res.json()) as { items?: T[] };
  return json.items ?? [];
}

export function stripTags(s: string): string {
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** 제목·본문 키워드로 카테고리 분류 */
function classify(text: string): NewsItem['category'] {
  if (/(GTX|지하철|전철|노선|역세권|철도|고속도로|IC|버스|트램|개통)/.test(text))
    return 'transport';
  if (/(재건축|재개발|정비사업|리모델링|신도시|택지|개발계획|지구지정|도시계획)/.test(text))
    return 'development';
  if (/(대출|규제|LTV|DSR|금리|세제|취득세|양도세|보유세|종부세|정부|국토부|대책)/.test(text))
    return 'policy';
  if (/(분양|입주|공급|청약|물량|착공|인허가)/.test(text)) return 'supply';
  if (/(시세|거래량|매매가|전세가|호가|신고가|하락|상승|반등)/.test(text)) return 'market';
  return 'etc';
}

/** 간단 감성 판정 */
function tone(text: string): NewsItem['tone'] {
  const pos = (text.match(/(상승|반등|신고가|확정|착공|개통|승인|호재|완화|인하|급등|훈풍)/g) ?? [])
    .length;
  const neg = (text.match(/(하락|급락|미분양|취소|무산|지연|규제|인상|폭락|한파|역전세)/g) ?? [])
    .length;
  if (pos > neg) return 'positive';
  if (neg > pos) return 'negative';
  return 'neutral';
}

function parsePubDate(raw: string): string {
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

export async function searchNews(query: string, display = 20): Promise<NewsItem[]> {
  const items = await naverSearchRaw<NaverNewsItem>('news', query, display, 'date');
  return items.map((it) => {
    const title = stripTags(it.title);
    const summary = stripTags(it.description);
    const text = `${title} ${summary}`;
    const link = it.originallink || it.link;
    return {
      title,
      summary,
      url: link,
      source: hostOf(link) || '네이버뉴스',
      publishedAt: parsePubDate(it.pubDate),
      category: classify(text),
      tone: tone(text),
    } satisfies NewsItem;
  });
}

/** 관심 지역별 뉴스 수집 — 지역명 + 사용자 키워드 조합 */
export async function fetchRegionNews(
  regions: WatchRegion[],
  perRegion = 10,
): Promise<{ items: NewsItem[]; errors: string[] }> {
  const errors: string[] = [];
  const items: NewsItem[] = [];

  for (const region of regions) {
    const queries =
      region.keywords.length > 0
        ? region.keywords.map((k) => `${region.name} ${k}`)
        : [`${region.name} 아파트`, `${region.name} 재개발 재건축 GTX`];

    for (const q of queries.slice(0, 3)) {
      try {
        const found = await searchNews(q, perRegion);
        items.push(...found.map((n) => ({ ...n, regionId: region.id })));
      } catch (e) {
        errors.push(`${region.name} "${q}": ${(e as Error).message}`);
      }
    }
  }

  // URL 기준 중복 제거 후 최신순
  const seen = new Set<string>();
  const deduped = items
    .filter((n) => {
      if (seen.has(n.url)) return false;
      seen.add(n.url);
      return true;
    })
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));

  return { items: deduped, errors };
}

/** 시장 전반 뉴스 (브리핑 헤드라인용) */
export async function fetchMarketNews(): Promise<{ items: NewsItem[]; errors: string[] }> {
  const queries = [
    '아파트 매매가격 동향',
    '부동산 대책 규제',
    '기준금리 주택담보대출',
    '아파트 거래량 매수심리',
  ];
  const errors: string[] = [];
  const items: NewsItem[] = [];

  const settled = await Promise.allSettled(queries.map((q) => searchNews(q, 10)));
  settled.forEach((r, i) => {
    if (r.status === 'fulfilled') items.push(...r.value);
    else errors.push(`"${queries[i]}": ${String(r.reason?.message ?? r.reason)}`);
  });

  const seen = new Set<string>();
  return {
    items: items
      .filter((n) => (seen.has(n.url) ? false : (seen.add(n.url), true)))
      .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
      .slice(0, 30),
    errors,
  };
}
