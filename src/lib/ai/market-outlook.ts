/**
 * AI 시장 요약 · 전망
 *
 * 공식 발표(정부 부처 보도자료)·정책 기사·블로그·카페 글을 읽어 요약하고,
 * 주요 지수와 사용자의 보유/목표 아파트를 기준으로 전망을 정리한다.
 *
 * ── 왜 이렇게 제약을 거는가 ────────────────────────────────────────
 * 모델이 부동산 수치를 사전 지식에서 꺼내면 반드시 낡은 값이 나온다.
 * 그래서 컨텍스트에 담은 값만 쓰게 하고, 블로그·카페는 "개인 의견"으로
 * 명시해 사실과 구분하도록 시킨다. 카페·블로그는 광고와 호가 부풀리기가
 * 섞이므로 그대로 사실처럼 옮기면 위험하다.
 */

import { getOpenAI, hasOpenAI, OPENAI_MODEL, SYSTEM_PROMPT } from '@/lib/ai/client';
import { naverSearchRaw, stripTags, searchNews } from '@/lib/sources/news';
import { fetchOfficialPress } from '@/lib/sources/gov';
import type { DashboardData, NewsItem } from '@/lib/types';
import { formatArea } from '@/lib/format';

export interface OutlookSource {
  kind: 'official' | 'news' | 'blog' | 'cafe';
  title: string;
  summary: string;
  url: string;
  publishedAt?: string;
}

/** 이번 호출이 쓴 토큰 — 비용 추적용 */
export interface TokenUsage {
  input: number;
  output: number;
  total: number;
}

export interface MarketOutlook {
  /** 마크다운 본문 */
  markdown: string;
  /** 토큰 사용량 (모델이 알려준 실측값) */
  usage?: TokenUsage;
  /** 읽은 자료 */
  sources: OutlookSource[];
  /** 모델이 읽지 못한 것 */
  gaps: string[];
  model: string;
  generatedAt: string;
}

interface NaverDocItem {
  title: string;
  description: string;
  link: string;
  bloggername?: string;
  postdate?: string;
  cafename?: string;
}

/** 블로그·카페 글 수집. 실패해도 전체를 막지 않는다. */
async function fetchOpinions(queries: string[], perQuery = 5): Promise<OutlookSource[]> {
  const out: OutlookSource[] = [];

  for (const endpoint of ['blog', 'cafearticle'] as const) {
    const settled = await Promise.allSettled(
      queries.map((q) => naverSearchRaw<NaverDocItem>(endpoint, q, perQuery, 'date')),
    );
    for (const r of settled) {
      if (r.status !== 'fulfilled') continue;
      for (const it of r.value) {
        out.push({
          kind: endpoint === 'blog' ? 'blog' : 'cafe',
          title: stripTags(it.title),
          summary: stripTags(it.description),
          url: it.link,
        });
      }
    }
  }

  // 중복 제거
  const seen = new Set<string>();
  return out.filter((s) => {
    if (seen.has(s.url)) return false;
    seen.add(s.url);
    return true;
  });
}

function newsToSource(n: NewsItem): OutlookSource {
  return {
    kind: n.official ? 'official' : 'news',
    title: n.title,
    summary: n.summary,
    url: n.url,
    publishedAt: n.publishedAt,
  };
}

/** 자료를 프롬프트에 넣을 수 있는 형태로 접는다 */
function renderSources(sources: OutlookSource[], limit: number): string {
  const label: Record<OutlookSource['kind'], string> = {
    official: '[공식발표]',
    news: '[기사]',
    blog: '[블로그·개인의견]',
    cafe: '[카페·개인의견]',
  };
  return sources
    .slice(0, limit)
    .map((s, i) => `${i + 1}. ${label[s.kind]} ${s.title}\n   ${s.summary.slice(0, 200)}`)
    .join('\n');
}

/** 대시보드 수치를 프롬프트용으로 정리 */
function renderNumbers(data: DashboardData): string {
  const lines: string[] = [];

  lines.push('## 주요 지수');
  for (const m of data.macro ?? []) {
    lines.push(
      `- ${m.label}: ${m.latest?.toLocaleString('ko-KR') ?? '?'}${m.unit === '%' ? '%' : ''} (${m.latestPeriod ?? '?'}${
        m.yoy !== undefined ? `, 전년비 ${m.yoy.toFixed(1)}%` : ''
      })`,
    );
  }

  const heatLabel: Record<string, string> = {
    cold: '침체',
    cooling: '둔화',
    neutral: '중립',
    warming: '회복',
    overheated: '과열',
  };

  lines.push('', '## 시장 과열도');
  lines.push(
    `- ${heatLabel[data.sentiment?.heatLevel ?? ''] ?? '?'} · 과열점수 ${data.sentiment?.heatScore ?? '?'}/100`,
    `- 매매수급 ${data.sentiment?.supplyDemandIndex ?? '?'}, 신고가 비중 ${data.sentiment?.newHighRatio ?? '?'}%, 거래량 전년비 ${data.sentiment?.volumeYoy ?? '?'}%`,
  );

  lines.push('', '## 보유 아파트');
  for (const h of data.config.holdings) {
    const q = data.quotes[h.id];
    lines.push(
      `- ${h.complexName} ${formatArea(h.areaM2)} (${h.sigungu} ${h.dong}): 시세 ${
        q?.price ? `${(q.price / 1e8).toFixed(2)}억` : '미확보'
      }, 대출잔액 ${(h.loanBalance / 1e8).toFixed(2)}억`,
    );
  }

  lines.push('', '## 목표 아파트');
  for (const t of data.config.targets) {
    const q = data.quotes[t.id];
    lines.push(
      `- ${t.complexName} ${formatArea(t.areaM2)} (${t.sigungu} ${t.dong}): 시세 ${
        q?.price ? `${(q.price / 1e8).toFixed(2)}억` : '미확보'
      }`,
    );
  }

  lines.push('', '## 갈아타기 갭');
  for (const g of data.gaps ?? []) {
    lines.push(
      `- ${g.holdingName} → ${g.targetName}: 시세갭 ${(g.gap / 1e8).toFixed(2)}억, 실소요 ${(
        g.realCashNeeded / 1e8
      ).toFixed(2)}억`,
    );
  }

  return lines.join('\n');
}

/**
 * 시장 요약·전망을 생성한다.
 *
 * @param data 대시보드 데이터 (수치의 유일한 출처)
 */
export async function buildMarketOutlook(data: DashboardData): Promise<MarketOutlook> {
  if (!hasOpenAI()) {
    throw new Error('OPENAI_API_KEY 가 설정되지 않았습니다.');
  }

  const gaps: string[] = [];

  // 사용자 관심 지역·단지를 검색어에 반영한다
  const places = [
    ...data.config.holdings.map((h) => h.sigungu),
    ...data.config.targets.map((t) => t.sigungu),
    ...data.config.watchRegions.map((w) => w.name),
  ].filter(Boolean);
  const uniquePlaces = [...new Set(places)].slice(0, 4);

  const opinionQueries = [
    ...uniquePlaces.map((p) => `${p} 아파트 시세`),
    '부동산 대책 전망',
    '아파트 갈아타기',
  ];

  const [officialRes, policyNews, opinions] = await Promise.all([
    fetchOfficialPress().catch(() => ({ items: [] as NewsItem[], errors: ['공식발표 수집 실패'] })),
    searchNews('부동산 대책 정책 발표', 10).catch(() => [] as NewsItem[]),
    fetchOpinions(opinionQueries).catch(() => [] as OutlookSource[]),
  ]);

  if (officialRes.items.length === 0) gaps.push('정부 부처 공식 발표를 가져오지 못했습니다.');
  if (policyNews.length === 0) gaps.push('정책 기사를 가져오지 못했습니다.');
  if (opinions.length === 0)
    gaps.push('블로그·카페 글을 가져오지 못했습니다 (NAVER_CLIENT_ID 확인).');

  const sources: OutlookSource[] = [
    ...officialRes.items.map(newsToSource),
    ...policyNews.map(newsToSource),
    ...(data.news ?? []).map(newsToSource),
    ...opinions,
  ];

  // 종류별로 골고루 넣는다. 한쪽이 많다고 다 채우면 균형이 깨진다.
  const pick = (kind: OutlookSource['kind'], n: number) =>
    sources.filter((s) => s.kind === kind).slice(0, n);
  const selected = [
    ...pick('official', 10),
    ...pick('news', 12),
    ...pick('blog', 8),
    ...pick('cafe', 8),
  ];

  const prompt = `아래 [자료]와 [수치]만 근거로 삼아, 사용자의 보유·목표 아파트 관점에서 시장을 정리하세요.

[수치]
${renderNumbers(data)}

[자료]
${renderSources(selected, 40)}

${gaps.length > 0 ? `[확보하지 못한 정보]\n${gaps.map((g) => `- ${g}`).join('\n')}\n` : ''}
다음 형식의 한국어 마크다운으로 답하세요. 각 항목은 3~5줄.

## 전체 현황 한눈에
지금 시장이 어떤 상태인지 3줄로. 과열점수·수급·거래량·확산율을 근거로.

## 경제 상황과 주요 지표
금리·물가·통화량·주담대금리를 엮어 부동산에 어떤 압력으로 작용하는지.

## 정책·국회 동향
정부 발표와 국회 입법 상황. 무엇이 언제부터 바뀌는지, 아직 확정이 아닌 건 확정이 아니라고 쓰세요.

## 전국 아파트값 전망
확산율과 미반등 지역 수를 근거로 전국 흐름. 조건부로 쓰세요.

## 서울 전망
서울 관련 근거가 자료에 있으면 쓰고, 없으면 "서울 단독 근거는 확보되지 않았습니다"라고 명시하세요. 지어내지 마세요.

## 내 보유·목표 아파트 분석
갭과 실소요 자금을 근거로 갈아타기 시점에 영향을 주는 요인. 단정하지 말고 조건부로.

## 커뮤니티 분위기
블로그·카페에서 읽히는 심리. **개인 의견이며 검증되지 않았음을 반드시 명시**하세요. 특정 단지 호가 주장은 사실로 옮기지 마세요.

## 지켜볼 변수
앞으로 판단을 뒤집을 수 있는 것 3가지.`;

  const client = getOpenAI();
  const res = await client.chat.completions.create({
    model: OPENAI_MODEL,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: prompt },
    ],
    temperature: 0.3,
  });

  const markdown = res.choices[0]?.message?.content?.trim() ?? '';
  if (!markdown) throw new Error('AI 응답이 비어 있습니다.');

  return {
    markdown,
    usage: res.usage
      ? {
          input: res.usage.prompt_tokens,
          output: res.usage.completion_tokens,
          total: res.usage.total_tokens,
        }
      : undefined,
    sources: selected,
    gaps,
    model: OPENAI_MODEL,
    generatedAt: new Date().toISOString(),
  };
}
