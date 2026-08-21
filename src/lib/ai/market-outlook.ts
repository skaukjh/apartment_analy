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

import { createHash } from 'node:crypto';
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
  /** 카페 글일 때 카페 이름 */
  cafeName?: string;
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
  /**
   * 프롬프트(수치+자료) 해시. 다음 생성 때 이 값이 같으면 입력이 그대로라는
   * 뜻이므로 OpenAI 호출을 건너뛴다 — 같은 입력은 같은 요약이면 충분하다.
   */
  promptHash?: string;
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

/**
 * 광고·홍보 글을 걸러내는 신호.
 * 카페·블로그는 분양 홍보와 중개 광고가 많아 그대로 넣으면 요약이 오염된다.
 */
const SPAM_PATTERNS = [
  /☎|℡|\b01[016-9][-.\s]?\d{3,4}[-.\s]?\d{4}\b/, // 연락처 노출
  /문의\s*(주세요|바랍니다|환영)/,
  /분양\s*(문의|상담|홍보)/,
  /무료\s*(상담|컨설팅)/,
  /카톡\s*(문의|상담)/,
  /초대장|등업|출석체크|가입인사/,
];

/** 부동산 논의가 활발해 신호 대 잡음이 나은 카페 */
const TRUSTED_CAFE_HINTS = [
  '부동산스터디',
  '부동산',
  '재건축',
  '재개발',
  '아파트',
  '분양권',
  '집값',
];

/**
 * 글의 참고 가치를 점수로 매긴다.
 *
 * ── 한계 ─────────────────────────────────────────────────────────
 * 네이버 검색 API 는 title·description·cafename·cafeurl 만 준다.
 * **회원 등급·조회수·추천수·인기글 여부는 제공하지 않는다.**
 * 그래서 "등급 높은 사람 글"을 직접 고를 방법이 없고,
 * 정확도순 정렬 + 아래 신호로 대신한다.
 */
function opinionScore(title: string, summary: string, cafeName: string | undefined): number {
  const text = `${title} ${summary}`;

  // 광고성은 아예 제외
  if (SPAM_PATTERNS.some((re) => re.test(text))) return -1;

  let score = 0;

  // 부동산 전문 카페면 가산
  if (cafeName && TRUSTED_CAFE_HINTS.some((h) => cafeName.includes(h))) score += 3;

  // 구체적인 근거가 있는 글 — 금액·평형·연도 같은 숫자
  if (/\d+\s*(억|만원|㎡|평)/.test(text)) score += 2;
  if (/\d{4}\s*년|\d{1,2}\s*월/.test(text)) score += 1;

  // 시장 판단이 담긴 글
  if (/(전망|분석|정리|후기|실거래|계약|매도|매수)/.test(text)) score += 2;

  // 너무 짧으면 근거가 없다
  if (summary.length >= 80) score += 1;
  if (summary.length < 30) score -= 2;

  return score;
}

/**
 * 블로그·카페 글 수집. 실패해도 전체를 막지 않는다.
 *
 * 정확도순(sim)으로 받아 관련성이 높은 글을 먼저 보고, 광고를 걸러낸 뒤
 * 점수가 높은 순으로 정렬해 돌려준다.
 */
async function fetchOpinions(queries: string[], perQuery = 5): Promise<OutlookSource[]> {
  const scored: Array<{ source: OutlookSource; score: number }> = [];

  /* 네이버는 초당 요청 수를 제한한다(HTTP 429).
     검색어를 늘리고 한꺼번에 병렬로 던졌더니 전부 거부돼 카페 글이 0건이 됐다.
     그래서 순차로 보내고 사이에 간격을 둔다. */
  const GAP_MS = 120;

  for (const endpoint of ['blog', 'cafearticle'] as const) {
    const settled: Array<PromiseSettledResult<NaverDocItem[]>> = [];
    for (const q of queries) {
      try {
        // 'date' 는 최신순이라 잡담까지 딸려온다. 'sim'(정확도)이 참고할 글을 더 잘 준다.
        settled.push({
          status: 'fulfilled',
          value: await naverSearchRaw<NaverDocItem>(endpoint, q, perQuery, 'sim'),
        });
      } catch (e) {
        settled.push({ status: 'rejected', reason: e });
      }
      await new Promise((r) => setTimeout(r, GAP_MS));
    }

    for (const r of settled) {
      if (r.status !== 'fulfilled') {
        // 조용히 버리면 "카페 0건"의 원인을 영영 알 수 없다
        console.error(
          `[outlook] ${endpoint} 검색 실패:`,
          String((r.reason as Error)?.message ?? r.reason),
        );
        continue;
      }
      for (const it of r.value) {
        const title = stripTags(it.title);
        const summary = stripTags(it.description);
        const cafeName = it.cafename ? stripTags(it.cafename) : undefined;
        const score = opinionScore(title, summary, cafeName);
        if (score < 0) continue; // 광고성 제외

        scored.push({
          source: {
            kind: endpoint === 'blog' ? 'blog' : 'cafe',
            title,
            summary,
            url: it.link,
            cafeName,
          },
          score,
        });
      }
    }
  }

  // 중복 제거 후 점수 높은 순
  const seen = new Set<string>();
  return scored
    .sort((a, b) => b.score - a.score)
    .filter(({ source }) => {
      if (seen.has(source.url)) return false;
      seen.add(source.url);
      return true;
    })
    .map(({ source }) => source);
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
export async function buildMarketOutlook(
  data: DashboardData,
  options: {
    /** 직전 생성의 promptHash — 입력이 같으면 null 을 돌려주고 호출을 아낀다 */
    skipIfPromptHash?: string;
    /**
     * 직전 생성이 읽었던 자료 URL 목록.
     * "새 자료가 충분히 쌓였을 때만" 재생성하는 기준에 쓴다 —
     * 뉴스 한두 건 바뀌었다고 매시간 다시 만들면 비용만 나간다.
     */
    previousSourceUrls?: string[];
    /** 개인 키(BYOK) — 생략 시 운영자 환경변수 키 */
    apiKey?: string;
  } = {},
): Promise<MarketOutlook | null> {
  if (!hasOpenAI() && !options.apiKey) {
    throw new Error('OPENAI_API_KEY 가 설정되지 않았습니다.');
  }

  const gaps: string[] = [];

  /* 검색어 구성 — 내 단지가 실제로 언급되는 글을 찾는 게 목적이다.
     시군구만 넣으면 "노원구 아파트" 같은 일반론만 걸리므로
     단지명과 그 동(자양동·잠실동) 단위까지 함께 넣는다. */
  const myComplexes = [...data.config.holdings, ...data.config.targets];

  const complexQueries = myComplexes.flatMap((a) => {
    const qs = [`${a.complexName} 실거래`];
    if (a.dong) qs.push(`${a.dong} ${a.complexName}`);
    return qs;
  });

  const dongQueries = [...new Set(myComplexes.map((a) => a.dong).filter(Boolean))].map(
    (d) => `${d} 재건축 재개발`,
  );

  const places = [
    ...data.config.holdings.map((h) => h.sigungu),
    ...data.config.targets.map((t) => t.sigungu),
    ...data.config.watchRegions.map((w) => w.name),
  ].filter(Boolean);
  const uniquePlaces = [...new Set(places)].slice(0, 3);

  const opinionQueries = [
    ...complexQueries.slice(0, 6),
    ...dongQueries.slice(0, 4),
    ...uniquePlaces.map((p) => `${p} 아파트 시세`),
    '부동산 대책 전망',
  ];

  const [officialRes, policyNews, opinions] = await Promise.all([
    fetchOfficialPress().catch(() => ({ items: [] as NewsItem[], errors: ['공식발표 수집 실패'] })),
    searchNews('부동산 대책 정책 발표', 10).catch(() => [] as NewsItem[]),
    fetchOpinions(opinionQueries).catch((e) => {
      console.error('[outlook] 블로그·카페 수집 실패:', (e as Error).message);
      return [] as OutlookSource[];
    }),
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

[근거 우선순위] — 반드시 지키세요
1순위 [수치]: 국토교통부 실거래가와 한국은행 통계. 사실로 취급합니다.
2순위 [공식발표]: 정부·공공기관 발표. 사실로 취급하되 시행 시기가 확정인지 구분하세요.
3순위 [기사]: 보도 내용. 인용임을 밝히세요.
4순위 [블로그·카페]: **개인 의견입니다. 사실로 옮기지 마세요.**
   호가·시세 주장은 근거로 쓰지 말고, "이런 분위기가 있다" 수준으로만 언급하세요.
   앞 순위와 충돌하면 앞 순위를 따르고, 충돌한다는 사실을 적으세요.

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

  const promptHash = createHash('sha256').update(prompt).digest('hex').slice(0, 32);
  if (options.skipIfPromptHash && options.skipIfPromptHash === promptHash) {
    // 수치도 자료도 그대로 — 새로 물어봐도 같은 답이 나온다
    return null;
  }

  /* 새 자료가 충분할 때만 재생성한다.
     기준(전체 수집 풀 기준, 직전 생성 이후 처음 보는 URL):
       - 새 공식발표(정부·정책) 1건 이상   → 정책 변화는 즉시 반영 가치가 있다
       - 또는 새 일반 기사 20건 이상
       - 또는 새 블로그·카페 글 20건 이상
     미달이면 이전 요약을 그대로 쓴다. */
  if (options.previousSourceUrls && options.previousSourceUrls.length > 0) {
    const seen = new Set(options.previousSourceUrls);
    const fresh = sources.filter((s2) => !seen.has(s2.url));
    const newOfficial = fresh.filter((s2) => s2.kind === 'official').length;
    const newNews = fresh.filter((s2) => s2.kind === 'news').length;
    const newOpinions = fresh.filter((s2) => s2.kind === 'blog' || s2.kind === 'cafe').length;

    const enough = newOfficial >= 1 || newNews >= 20 || newOpinions >= 20;
    if (!enough) {
      console.log(
        `[outlook] 재생성 보류 — 새 자료 부족 (공식 ${newOfficial}, 기사 ${newNews}, 의견 ${newOpinions})`,
      );
      return null;
    }
  }

  const client = getOpenAI(options.apiKey);
  const res = await client.chat.completions.create({
    model: OPENAI_MODEL,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: prompt },
    ],
  });

  const markdown = res.choices[0]?.message?.content?.trim() ?? '';
  if (!markdown) throw new Error('AI 응답이 비어 있습니다.');

  return {
    markdown,
    promptHash,
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
