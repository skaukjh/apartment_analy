/**
 * 정부 부처·공공기관 공식 발표 수집.
 *
 * 두 갈래:
 *  1) 네이버 뉴스 검색으로 부처별 발표 보도를 표적 수집한다 (키만 있으면 항상 동작).
 *     "국토교통부 …", "금융위원회 …" 처럼 발표 주체를 검색어에 박고, 제목/요약에
 *     그 부처명이 실제로 들어간 기사만 남긴다.
 *  2) 부처 보도자료 RSS 를 직접 구독한다 — 정부 사이트 RSS 는 개편으로 주소가 자주
 *     바뀌어 기본값을 박아두지 않고, GOV_RSS_FEEDS 환경변수로 등록한다.
 *     형식: "국토교통부|https://…/rss.xml,금융위원회|https://…/rss"
 *
 * 원문 확인용 공식 출처 바로가기 목록(OFFICIAL_LINKS)도 여기서 관리한다.
 */

import type { NewsItem } from '@/lib/types';
import { searchNews } from './news';
import { SOURCE_TTL } from '@/lib/refresh-policy';

/* ------------------------------------------------------------------ */
/* 공식 출처 바로가기                                                    */
/* ------------------------------------------------------------------ */

export const OFFICIAL_LINKS: Array<{ name: string; url: string; note: string }> = [
  {
    name: '국토교통부 보도자료',
    url: 'https://www.molit.go.kr/USR/NEWS/m_71/lst.jsp',
    note: '부동산 대책·공급 계획 원문',
  },
  {
    name: '금융위원회 보도자료',
    url: 'https://www.fsc.go.kr/no010101',
    note: 'LTV·DSR 등 대출 규제',
  },
  {
    name: '기획재정부 보도자료',
    url: 'https://www.moef.go.kr/nw/nes/nesdta.do',
    note: '부동산 세제 개편',
  },
  {
    name: '한국은행 보도자료',
    url: 'https://www.bok.or.kr/portal/bbs/P0000559/list.do?menuNo=200690',
    note: '기준금리·금융안정보고서',
  },
  {
    name: '통계청 보도자료',
    url: 'https://kostat.go.kr/board.es?mid=a10301010000&bid=203',
    note: 'CPI·인구이동·가계동향',
  },
  {
    name: '한국부동산원 R-ONE',
    url: 'https://www.reb.or.kr/r-one/',
    note: '주간·월간 가격동향 원자료',
  },
  { name: '국토부 실거래가 공개시스템', url: 'https://rt.molit.go.kr', note: '실거래가 원본 조회' },
  { name: '청약홈', url: 'https://www.applyhome.co.kr', note: '청약 일정·경쟁률' },
];

/* ------------------------------------------------------------------ */
/* 1) 뉴스 표적 수집                                                    */
/* ------------------------------------------------------------------ */

/**
 * 공식 발표로 인정할 도메인.
 *
 * "국토교통부"가 제목에 있다고 공식 발표가 아니다 — 그건 언론 보도다.
 * 실제로 일반 경제지 기사가 [공식발표]로 표시되던 문제가 있었다.
 * 정부(.go.kr)와 지정 공공기관 도메인에서 나온 글만 공식으로 표시한다.
 */
const OFFICIAL_HOSTS = ['bok.or.kr', 'reb.or.kr', 'fss.or.kr', 'lh.or.kr', 'applyhome.co.kr'];

export function isOfficialUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return (
      host.endsWith('.go.kr') || OFFICIAL_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))
    );
  } catch {
    return false;
  }
}

/** 발표 주체별 검색어 — 부처명이 제목/요약에 실제로 등장해야 채택한다 */
const AGENCY_QUERIES: Array<{ agency: string; query: string }> = [
  { agency: '국토교통부', query: '국토교통부 부동산 발표' },
  { agency: '금융위원회', query: '금융위원회 가계대출 규제' },
  { agency: '기획재정부', query: '기획재정부 부동산 세제' },
  { agency: '한국은행', query: '한국은행 기준금리 가계부채' },
  { agency: '금융감독원', query: '금융감독원 주택담보대출' },
];

export async function fetchOfficialNews(): Promise<{ items: NewsItem[]; errors: string[] }> {
  const errors: string[] = [];
  const results = await Promise.allSettled(
    AGENCY_QUERIES.map(async ({ agency, query }) => {
      const items = await searchNews(query, 8);
      return (
        items
          .filter((n) => n.title.includes(agency) || n.summary.includes(agency))
          // 언론 보도는 official 이 아니다 — 정부·공공기관 도메인 원문만 공식으로 표시
          .map((n) => ({
            ...n,
            official: isOfficialUrl(n.url),
            agency,
            category: 'policy' as const,
          }))
      );
    }),
  );

  const items: NewsItem[] = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') items.push(...r.value);
    else errors.push(`${AGENCY_QUERIES[i].agency}: ${String(r.reason?.message ?? r.reason)}`);
  });

  const seen = new Set<string>();
  return {
    items: items
      .filter((n) => (seen.has(n.url) ? false : (seen.add(n.url), true)))
      .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)),
    errors,
  };
}

/* ------------------------------------------------------------------ */
/* 2) RSS 구독 (env 설정형)                                             */
/* ------------------------------------------------------------------ */

interface RssFeed {
  name: string;
  url: string;
}

export function configuredRssFeeds(): RssFeed[] {
  const raw = process.env.GOV_RSS_FEEDS?.trim();
  if (!raw) return [];
  return raw
    .split(',')
    .map((chunk) => {
      const [name, url] = chunk.split('|').map((s) => s.trim());
      return name && url?.startsWith('http') ? { name, url } : null;
    })
    .filter((f): f is RssFeed => f !== null);
}

function pickTag(xml: string, tag: string): string | undefined {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  if (!m) return undefined;
  return m[1]
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
}

async function fetchRssFeed(feed: RssFeed): Promise<NewsItem[]> {
  const res = await fetch(feed.url, {
    next: { revalidate: SOURCE_TTL.news },
    headers: { 'User-Agent': 'Mozilla/5.0 (apartment-dashboard)' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const xml = await res.text();
  if (!/<(rss|feed|rdf)/i.test(xml)) throw new Error('RSS/Atom 형식이 아닙니다');

  const items: NewsItem[] = [];
  const re = /<(item|entry)>([\s\S]*?)<\/\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null && items.length < 15) {
    const chunk = m[2];
    const title = pickTag(chunk, 'title');
    const link = pickTag(chunk, 'link') ?? chunk.match(/<link[^>]*href="([^"]+)"/i)?.[1];
    if (!title || !link) continue;
    const pub = pickTag(chunk, 'pubDate') ?? pickTag(chunk, 'updated') ?? pickTag(chunk, 'dc:date');
    const d = pub ? new Date(pub) : new Date();
    items.push({
      title,
      summary: pickTag(chunk, 'description') ?? '',
      url: link,
      source: feed.name,
      publishedAt: Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString(),
      category: 'policy',
      tone: 'neutral',
      official: true,
      agency: feed.name,
    });
  }
  return items;
}

export async function fetchGovRss(): Promise<{ items: NewsItem[]; errors: string[] }> {
  const feeds = configuredRssFeeds();
  if (feeds.length === 0) return { items: [], errors: [] };

  const errors: string[] = [];
  const results = await Promise.allSettled(feeds.map(fetchRssFeed));
  const items: NewsItem[] = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') items.push(...r.value);
    else errors.push(`${feeds[i].name}: ${String(r.reason?.message ?? r.reason)}`);
  });

  return { items, errors };
}

/** 공식 발표 통합 (뉴스 표적 수집 + RSS) */
export async function fetchOfficialPress(): Promise<{ items: NewsItem[]; errors: string[] }> {
  const [news, rss] = await Promise.all([
    fetchOfficialNews().catch((e) => ({ items: [], errors: [(e as Error).message] })),
    fetchGovRss().catch((e) => ({ items: [], errors: [(e as Error).message] })),
  ]);

  const seen = new Set<string>();
  const items = [...rss.items, ...news.items]
    .filter((n) => (seen.has(n.url) ? false : (seen.add(n.url), true)))
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
    .slice(0, 25);

  return { items, errors: [...news.errors, ...rss.errors] };
}
