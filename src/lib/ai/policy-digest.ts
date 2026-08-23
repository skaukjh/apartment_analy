/**
 * 최신 부동산 정책 요약 (AI).
 *
 * 공식 발표(정부 도메인)와 정책 기사를 모아 "지금 확정된 것 / 추진 중인 것"을
 * 구분해 정리한다. 정책은 모든 사용자에게 같으므로 전역 1건만 만든다.
 *
 * 비용 원칙은 AI 시장 요약과 같다:
 *  - 입력(promptHash)이 그대로면 OpenAI 를 부르지 않는다.
 *  - 새 자료가 기준(공식 1건+ 또는 기사 10건+)에 못 미치면 이전 요약을 재사용하고
 *    refreshedAt(자료 점검 시각)만 갱신한다 — generatedAt 은 본문을 새로 만든 시각.
 */

import { createHash } from 'node:crypto';
import { REGULATION_AS_OF } from '@/lib/analysis/regulation';
import { POLICY_RULES } from '@/lib/analysis/policy-basis';
import { getOpenAI, hasOpenAI, OPENAI_MODEL, SYSTEM_PROMPT } from '@/lib/ai/client';
import { fetchOfficialPress } from '@/lib/sources/gov';
import { searchNews } from '@/lib/sources/news';
import { getAdminClient } from '@/lib/store/supabase';
import type { NewsItem } from '@/lib/types';
import type { OutlookSource, TokenUsage } from '@/lib/ai/market-outlook';

/**
 * 코드에 하드코딩된 정책 규칙(대출 한도·세율·규제지역)을 갱신해야 할 수 있다는 신호.
 * 자동으로 코드를 바꾸지는 않는다 — 관리자가 발표를 확인하고 반영한다.
 */
export interface PolicyUpdateAlert {
  /** POLICY_RULES 의 key */
  ruleKey: string;
  ruleLabel: string;
  /** 코드에 반영된 기준 (대책명·일자) */
  codeBasis: string;
  /** 규칙이 구현된 파일 */
  file: string;
  /** 감지된 발표·기사 */
  title: string;
  url: string;
  publishedAt?: string;
  official: boolean;
  /** 확인(숨김) 처리용 안정 식별자 — ruleKey+url 해시 */
  id: string;
}

export interface PolicyDigest {
  /** 마크다운 본문 */
  markdown: string;
  promptHash?: string;
  usage?: TokenUsage;
  sources: OutlookSource[];
  model: string;
  /** 본문을 실제로 생성한 시각 */
  generatedAt: string;
  /** 마지막으로 새 자료를 점검한 시각 — 캐시 신선도는 이 값 기준 */
  refreshedAt?: string;
  /**
   * 규제지역 지정·해제 발표 감지.
   * 앱의 규제 테이블(regulation.ts)은 수동 관리라, 정부 발표가 감지되면
   * "테이블이 낡았을 수 있다"는 경고를 화면에 띄우는 용도다.
   * 자동으로 테이블을 바꾸지는 않는다 — 오탐으로 세금 계산이 틀어지는 게 더 위험하다.
   * @deprecated updateAlerts 로 일반화됨 — 이전 캐시 호환용으로만 남긴다.
   */
  regulationAlert?: { title: string; url: string; publishedAt?: string };
  /** 코드 기준(대출 한도·세율·규제지역) 갱신 필요 신호 — 규칙별 최대 1건 */
  updateAlerts?: PolicyUpdateAlert[];
}

const KIND = 'policy-digest';

/** 정책은 천천히 바뀐다 — 캐시 24시간, 자료 점검은 크론이 매시간 */
export const POLICY_TTL_MS = 24 * 60 * 60 * 1000;

interface CacheEnvelope {
  kind: typeof KIND;
  digest: PolicyDigest;
}

let memory: PolicyDigest | null = null;

function isFresh(d: PolicyDigest): boolean {
  const t = Date.parse(d.refreshedAt ?? d.generatedAt);
  return Number.isFinite(t) && Date.now() - t < POLICY_TTL_MS;
}

/** 최근 요약 — 신선도 무시 (중복 생성 판단용) */
export async function loadLatestPolicyDigest(): Promise<PolicyDigest | null> {
  if (memory) return memory;
  const client = getAdminClient();
  if (!client) return null;

  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data } = await client
    .from('dashboard_snapshot')
    .select('payload')
    .gte('captured_at', since)
    .eq('payload->>kind', KIND)
    .order('captured_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const p = (data?.payload ?? null) as CacheEnvelope | null;
  return p?.digest ?? null;
}

/** 유효기간 안의 요약. 없으면 null */
export async function loadCachedPolicyDigest(): Promise<PolicyDigest | null> {
  if (memory && isFresh(memory)) return memory;
  const latest = await loadLatestPolicyDigest();
  if (latest && isFresh(latest)) {
    memory = latest;
    return latest;
  }
  return null;
}

export async function savePolicyDigest(digest: PolicyDigest): Promise<void> {
  memory = digest;
  const client = getAdminClient();
  if (!client) return;

  const envelope: CacheEnvelope = { kind: KIND, digest };
  const { error } = await client
    .from('dashboard_snapshot')
    .insert({ captured_at: digest.refreshedAt ?? digest.generatedAt, payload: envelope });
  if (error) console.error('[ai] 정책 요약 캐시 저장 실패:', error.message);
}

function toSource(n: NewsItem): OutlookSource {
  return {
    kind: n.official ? 'official' : 'news',
    title: n.title,
    summary: n.summary,
    url: n.url,
    publishedAt: n.publishedAt,
  };
}

/**
 * 정책 요약 생성.
 * 입력·자료가 그대로거나 새 자료가 기준 미달이면 null (호출 절약 — 이전 요약 유지).
 */
export async function buildPolicyDigest(
  options: {
    skipIfPromptHash?: string;
    previousSourceUrls?: string[];
    apiKey?: string;
  } = {},
): Promise<PolicyDigest | null> {
  if (!hasOpenAI() && !options.apiKey) {
    throw new Error('OPENAI_API_KEY 가 설정되지 않았습니다.');
  }

  const [officialRes, policyNews, taxNews, billNews] = await Promise.all([
    fetchOfficialPress().catch(() => ({ items: [] as NewsItem[], errors: [] as string[] })),
    searchNews('부동산 대책 정책 발표', 10).catch(() => [] as NewsItem[]),
    searchNews('부동산 세제 개편', 8).catch(() => [] as NewsItem[]),
    searchNews('국회 부동산 법안 통과', 8).catch(() => [] as NewsItem[]),
  ]);

  const seen = new Set<string>();
  const sources: OutlookSource[] = [
    ...officialRes.items.map(toSource),
    ...[...policyNews, ...taxNews, ...billNews].map(toSource),
  ].filter((s) => (seen.has(s.url) ? false : (seen.add(s.url), true)));

  const official = sources.filter((s) => s.kind === 'official').slice(0, 12);
  const articles = sources.filter((s) => s.kind === 'news').slice(0, 18);
  const selected = [...official, ...articles];

  /* 코드 기준 갱신 필요 신호 — POLICY_RULES 의 규칙별 키워드가 발표에 걸리면
     "코드에 박힌 기준이 낡았을 수 있다"는 관리자 경고를 만든다.
     기본은 공식 발표(정부 도메인)만 본다 — 기사는 오탐이 많다. 예외는 규칙이
     includeNews 를 켠 경우(규제지역 지정·해제처럼 세금 판정에 직결되는 것). */
  const updateAlerts: PolicyUpdateAlert[] = [];
  for (const rule of POLICY_RULES) {
    const hit =
      official.find((s) => rule.pattern.test(`${s.title} ${s.summary}`)) ??
      (rule.includeNews
        ? articles.find((s) => rule.pattern.test(`${s.title} ${s.summary}`))
        : undefined);
    if (!hit) continue;
    updateAlerts.push({
      ruleKey: rule.key,
      ruleLabel: rule.label,
      codeBasis: rule.asOf,
      file: rule.file,
      title: hit.title,
      url: hit.url,
      publishedAt: hit.publishedAt,
      official: hit.kind === 'official',
      id: createHash('sha256').update(`${rule.key}|${hit.url}`).digest('hex').slice(0, 16),
    });
  }

  // 이전 캐시·패널 호환 — 규제지역 신호는 기존 필드에도 채워 둔다
  const regAlert = updateAlerts.find((a) => a.ruleKey === 'regulated-zones');
  const regulationAlert = regAlert
    ? { title: regAlert.title, url: regAlert.url, publishedAt: regAlert.publishedAt }
    : undefined;

  const renderList = (list: OutlookSource[]) =>
    list
      .map(
        (s, i) =>
          `${i + 1}. ${s.kind === 'official' ? '[공식발표]' : '[기사]'} ${s.title}\n   ${s.summary.slice(0, 180)}`,
      )
      .join('\n');

  /* 이 앱이 세금·대출 계산에 실제로 쓰는 현행 기준 — 기사에는 세율·한도 수치가
     잘 안 나와서 "확보되지 않았다"로 비던 마지막 섹션의 근거로 공급한다. */
  const currentRules = `[현행 기준 — 이 앱의 계산 모듈이 쓰는 값, ${REGULATION_AS_OF}]
- 규제지역: 서울 전 지역 + 경기 15곳(과천·광명·성남 수정/중원/분당·수원 장안/팔달/영통·안양 동안·용인 수지/기흥·의왕·하남·구리·화성 동탄) — 조정대상지역·투기과열지구·토지거래허가구역(아파트) 동시 지정
- LTV: 규제지역 50%(생애최초 80%), 비규제 70% · DSR 40%(스트레스 DSR 시행 중)
- 주담대 총액 한도: 규제지역은 주택가격 15억 이하 6억 / 15~25억 4억 / 25억 초과 2억(10.15 대책), 비규제 수도권 일괄 6억
- 취득세: 1주택 1~3%(6억 이하 1%, 9억 초과 3%) + 지방교육세, 85㎡ 이하 농특세 면제 · 조정대상지역 2주택 8%·3주택 12%
- 양도세: 1세대1주택 12억까지 비과세(2년 보유, 조정대상지역 취득분은 2년 거주 필요), 보유 1년 미만 70%·2년 미만 60% 단기세율(지방소득세 10% 별도), 다주택 중과는 한시 배제 중
- 토지거래허가구역 아파트: 실거주 목적만 허가(2년 실거주 의무) — 전세 낀 갭투자 불가`;

  const prompt = `아래 [자료]와 [현행 기준]을 근거로 현재 부동산 정책 상황을 정리하세요. 시세 전망은 쓰지 마세요 — 정책 정리만 합니다.

[규칙]
- [공식발표]는 사실로, [기사]는 보도 인용으로 구분하세요.
- **확정(시행일 있음)과 미확정(발표·추진 중)을 반드시 구분**하세요. 국회 통과 전 법안·개편안은 미확정입니다.
- 자료에 없는 내용을 지어내지 마세요. 날짜가 자료에 있으면 그대로 적으세요.
- 마지막 "대출·세제 현행 기준" 섹션은 [현행 기준]의 수치를 사용해 반드시 채우세요. [자료]에 더 최신 변경이 있으면 그쪽을 우선하고 변경 사실을 명시하세요.

${currentRules}

[자료]
${renderList(selected)}

다음 형식의 한국어 마크다운으로, 각 항목 2~4줄:

## 시행 확정된 정책
무엇이 언제부터 바뀌는지. 시행일 명시. 확정된 게 없으면 "확정된 신규 정책 없음".

## 국회·입법 진행 중
법안·개편안의 현재 단계. **아직 확정이 아님을 명시**.

## 발표·추진 단계
정부가 발표했지만 세부 확정 전인 것.

## 대출·세제 현행 기준 한 줄 요약
지금 당장 적용되는 기준 (스트레스 DSR, 취득세·양도세 등).`;

  const promptHash = createHash('sha256').update(prompt).digest('hex').slice(0, 32);
  if (options.skipIfPromptHash && options.skipIfPromptHash === promptHash) return null;

  /* 새 자료가 충분할 때만 재생성 — 새 공식발표 1건 이상 또는 새 기사 10건 이상 */
  if (options.previousSourceUrls && options.previousSourceUrls.length > 0) {
    const prev = new Set(options.previousSourceUrls);
    const fresh = selected.filter((s) => !prev.has(s.url));
    const newOfficial = fresh.filter((s) => s.kind === 'official').length;
    const newNews = fresh.filter((s) => s.kind === 'news').length;
    if (newOfficial < 1 && newNews < 10) {
      console.log(`[policy] 재생성 보류 — 새 자료 부족 (공식 ${newOfficial}, 기사 ${newNews})`);
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

  const now = new Date().toISOString();
  return {
    markdown,
    regulationAlert,
    updateAlerts,
    promptHash,
    usage: res.usage
      ? {
          input: res.usage.prompt_tokens,
          output: res.usage.completion_tokens,
          total: res.usage.total_tokens,
        }
      : undefined,
    sources: selected,
    model: OPENAI_MODEL,
    generatedAt: now,
    refreshedAt: now,
  };
}
