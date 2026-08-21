/**
 * OpenAI 클라이언트 및 공통 시스템 프롬프트.
 *
 * 설계 원칙: 모델이 부동산 수치를 "기억"에서 꺼내 쓰면 반드시 틀린다.
 * 그래서 컨텍스트에 담긴 값만 쓰도록 강하게 제약하고, 없는 정보는 없다고 말하게 한다.
 */

import OpenAI from 'openai';

export function openaiKey(): string | undefined {
  const v = process.env.OPENAI_API_KEY?.trim();
  return v && v.length > 0 ? v : undefined;
}

export function hasOpenAI(): boolean {
  return Boolean(openaiKey());
}

// gpt-5-mini: 4.1-mini 후속. 같은 급 비용에 요약·정리 품질이 좋아 기본값으로 쓴다.
// 주의: gpt-5 계열은 temperature 지정을 지원하지 않는다 (기본 1 고정) — 실측 확인.
export const OPENAI_MODEL = process.env.OPENAI_MODEL?.trim() || 'gpt-5-mini';

const cached = new Map<string, OpenAI>();

/**
 * OpenAI 클라이언트.
 * @param apiKey 개인 키(BYOK). 생략하면 환경변수(운영자 키)를 쓴다.
 *               일반 회원의 AI 기능은 각자 자기 키로만 동작한다 — 운영 비용 통제.
 */
export function getOpenAI(apiKey?: string): OpenAI {
  const key = apiKey?.trim() || openaiKey();
  if (!key) throw new Error('OPENAI_API_KEY 가 설정되지 않았습니다.');
  let c = cached.get(key);
  if (!c) {
    c = new OpenAI({ apiKey: key });
    cached.set(key, c);
  }
  return c;
}

export const SYSTEM_PROMPT = `당신은 한국 부동산 시장을 분석하는 조력자입니다. 사용자는 실거주 목적의 갈아타기 또는 첫 주택 매수를 검토하고 있습니다.

절대 규칙:
1. 아래 [컨텍스트]에 있는 수치만 사용하세요. 시세·금리·세율·규제 현황을 당신의 사전 지식에서 꺼내 쓰지 마세요. 학습 데이터의 부동산 수치는 이미 낡았습니다.
2. 컨텍스트에 없는 정보를 물으면 "그 정보는 확보되지 않았습니다"라고 말하고, 어디서 확인할 수 있는지 알려주세요.
3. "확보하지 못한 정보" 섹션에 적힌 항목은 절대 추측해서 채우지 마세요.
4. 세금·대출 계산값은 추정치임을 밝히고, 실제 실행 전 은행·세무 상담이 필요하다고 안내하세요.
5. 특정 단지를 "사라/사지 마라"로 단정하지 마세요. 판단 근거와 리스크를 제시하고 결정은 사용자에게 맡기세요.
6. 투자 자문이 아니라 정보 정리임을 전제로 답하세요.

문체: 한국어. 간결하고 구체적으로. 숫자를 인용할 때는 기준 시점을 함께 적으세요. 불필요한 서론 없이 본론부터.`;
