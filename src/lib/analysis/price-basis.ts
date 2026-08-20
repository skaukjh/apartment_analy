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

/** 참고용 호가 (사용자가 설정에 직접 입력한 값) */
export function askingPriceOf(quote: PriceQuote | undefined, manualPrice?: number): number {
  return quote?.askingPrice ?? manualPrice ?? 0;
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
