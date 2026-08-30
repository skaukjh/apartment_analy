/**
 * 어떤 가격을 어디에 쓸지 정하는 한 곳.
 *
 * ── 원칙 ─────────────────────────────────────────────────────────
 * 갭 계산·세금·시뮬레이션처럼 **돈이 걸린 계산은 실거래가만** 쓴다.
 * 호가는 검증할 방법이 없고 사람마다 다르게 부르는 값이라,
 * 그걸로 계산하면 결과가 그럴듯해 보이지만 근거가 없다.
 *
 * 호가는 "실거래 대비 얼마나 높게 부르고 있나" 같은 **추세 참고용**으로만 쓴다.
 */

import type { PriceQuote } from '@/lib/types';

/**
 * 목표 아파트 대표가로 인정하는 최근 실거래 기간(개월).
 *
 * 갈아탈 집의 가격은 "지금 그 값에 살 수 있는가"가 전부라, 오래된 체결가로 갭을
 * 계산하면 이미 사라진 가격을 목표로 삼게 된다. 그렇다고 너무 짧게 끊으면
 * 거래가 뜸한 평형이 한 달 걸러 후보에서 들락날락해서 6개월로 잡는다.
 * 이 기간에 거래가 없는 단지는 목표 후보에서 자동으로 빠진다.
 */
export const TARGET_FRESHNESS_MONTHS = 6;

/**
 * 호가를 "지금 값"으로 볼 수 있는 기간(일).
 *
 * 호가는 실거래처럼 자동으로 갱신되지 않는다 — 단지별 호가를 주는 공개 API 가
 * 없어 사람이 넣은 값이 그대로 남는다. 그래서 낡았다는 사실만이라도 화면이
 * 말해 줘야 한다. 30일로 잡은 건 이 시장의 호가가 한 달이면 눈에 띄게 움직이고,
 * 그보다 짧게 끊으면 매물 상황이 그대로인데도 경고가 상시로 켜져 있어서다.
 */
export const ASKING_FRESHNESS_DAYS = 30;

/**
 * 계산에 쓸 실거래가. 실거래가 없으면 0.
 *
 * 0을 돌려주는 건 의도적이다. 호가로 슬쩍 메우면 사용자는 그 숫자가
 * 실거래인 줄 알게 된다. 값이 없으면 화면에서 "실거래 없음"이라고 말해야 한다.
 */
export function tradePriceOf(quote: PriceQuote | undefined): number {
  if (!quote) return 0;
  return quote.basis === 'recent-trade' ? quote.price : 0;
}

/** 실거래가가 있는지 */
export function hasTradePrice(quote: PriceQuote | undefined): boolean {
  return tradePriceOf(quote) > 0;
}

/** 신선도 기준(목표 6개월) 안에 거래가 없어 대표가를 내지 못한 상태인지 */
export function isStaleQuote(quote: PriceQuote | undefined): boolean {
  return quote?.stale === true;
}

/** 참고용 호가 (사용자가 설정에 직접 입력한 값) */
export function askingPriceOf(quote: PriceQuote | undefined, manualPrice?: number): number {
  return quote?.askingPrice ?? manualPrice ?? 0;
}

/**
 * 호가 − 직전 실거래가 (원). 둘 중 하나라도 없으면 undefined.
 *
 * %만 보여 주면 "그래서 얼마를 더 준비해야 하나"가 바로 오지 않는다.
 * 갈아타기는 결국 현금 차이라 금액이 필요하다. 음수면 호가가 직전 체결가보다
 * 낮다는 뜻이고, 그 자체가 신호다 (급매·하락 국면).
 *
 * 계산에는 쓰지 않는다 — 갭·세금은 실거래만 쓴다는 원칙 그대로다.
 */
export function askingGap(quote: PriceQuote | undefined, manualPrice?: number): number | undefined {
  const trade = tradePriceOf(quote);
  const asking = askingPriceOf(quote, manualPrice);
  if (trade <= 0 || asking <= 0) return undefined;
  return asking - trade;
}

/**
 * 호가가 실거래 대비 몇 % 높은지. 둘 중 하나라도 없으면 undefined.
 * 추세 참고용 지표다.
 */
export function askingPremiumPct(
  quote: PriceQuote | undefined,
  manualPrice?: number,
): number | undefined {
  const trade = tradePriceOf(quote);
  const asking = askingPriceOf(quote, manualPrice);
  if (trade <= 0 || asking <= 0) return undefined;
  return ((asking - trade) / trade) * 100;
}

/**
 * 호가를 본 날로부터 며칠 지났는지. 날짜가 없거나 호가가 없으면 undefined.
 *
 * 미래 날짜(시계 오차·오입력)는 0으로 눕힌다 — "-3일 전"은 읽는 사람을 혼란스럽게만 한다.
 */
export function askingAgeDays(quote: PriceQuote | undefined, now = new Date()): number | undefined {
  if (!quote?.askingPriceAt || askingPriceOf(quote) <= 0) return undefined;
  const at = Date.parse(`${quote.askingPriceAt}T00:00:00+09:00`);
  if (Number.isNaN(at)) return undefined;
  return Math.max(0, Math.floor((now.getTime() - at) / 86_400_000));
}

/**
 * 호가가 낡았거나 언제 값인지 모를 때의 한 줄 경고. 멀쩡하면 null.
 *
 * 값을 지우거나 감추지는 않는다 — 낡은 호가도 없는 것보다는 낫고,
 * 판단은 그 나이를 아는 사람이 한다.
 */
export function askingStaleWarning(quote: PriceQuote | undefined, now = new Date()): string | null {
  if (askingPriceOf(quote) <= 0) return null;
  if (!quote?.askingPriceAt) return '호가를 언제 본 값인지 기록이 없습니다';
  const days = askingAgeDays(quote, now);
  if (days === undefined || days <= ASKING_FRESHNESS_DAYS) return null;
  return `호가가 ${days}일 전 값입니다`;
}
