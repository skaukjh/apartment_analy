/**
 * 매매 부대비용 추정 — 중개보수 / 법무비 / 인지세 / 국민주택채권 / 이사비
 *
 * ⚠️ 중개보수는 상한요율이며 실제로는 협의로 결정됩니다.
 *    법무비·채권할인은 시점과 지역에 따라 편차가 큰 추정치입니다.
 */

import type { TransactionCostResult } from '@/lib/types';

/**
 * 주택 매매 중개보수 상한요율 (2021.10 개정, 공인중개사법 시행규칙 별표1)
 * 구간 상한은 전부 "미만" 이다 — 예: 9억 이상 ~ 12억 "미만" 0.5%.
 * 정확히 9억이면 0.5% 구간이므로 비교는 < (미만) 이어야 한다.
 */
const BROKER_TIERS: Array<{ below: number; rate: number; cap?: number }> = [
  { below: 50_000_000, rate: 0.006, cap: 250_000 },
  { below: 200_000_000, rate: 0.005, cap: 800_000 },
  { below: 900_000_000, rate: 0.004 },
  { below: 1_200_000_000, rate: 0.005 },
  { below: 1_500_000_000, rate: 0.006 },
  { below: Infinity, rate: 0.007 },
];

/** 중개보수 상한 (VAT 별도) */
export function calcBrokerFee(price: number): { fee: number; rate: number; capped: boolean } {
  const tier = BROKER_TIERS.find((t) => price < t.below)!;
  const raw = Math.floor(price * tier.rate);
  const capped = tier.cap !== undefined && raw > tier.cap;
  // 0.004 * 100 이 0.4000000000000001 로 나오는 부동소수점 오차를 정리
  return { fee: capped ? tier.cap! : raw, rate: Math.round(tier.rate * 10_000) / 100, capped };
}

/**
 * 부동산 매매계약서 인지세 (인지세법 별표)
 * 주택은 기재금액 1억 이하 비과세 (인지세법 제6조 제5호) — 이 앱은 아파트 전용이다.
 */
export function calcStampTax(price: number): number {
  if (price <= 100_000_000) return 0;
  if (price <= 1_000_000_000) return 150_000;
  return 350_000;
}

export interface TransactionCostInput {
  /** 거래가액 (원) */
  price: number;
  /** 매수 측인지 매도 측인지 */
  side: 'buy' | 'sell';
  /** 중개보수에 부가세(10%) 포함할지 (일반과세 중개사) */
  brokerVat?: boolean;
  /** 협의 할인율 (0~1). 0.2면 상한요율의 80%만 지급 */
  brokerDiscount?: number;
  /** 대출을 일으키는지 (근저당 설정비·채권매입 발생) */
  withMortgage?: boolean;
  /** 이사·인테리어 등 실비 (원) */
  movingEtc?: number;
}

export function calcTransactionCost(input: TransactionCostInput): TransactionCostResult {
  const notes: string[] = [];
  const { price, side } = input;
  const brokerVat = input.brokerVat ?? true;
  const discount = input.brokerDiscount ?? 0;

  const broker = calcBrokerFee(price);
  let brokerFee = Math.floor(broker.fee * (1 - discount));
  if (brokerVat) brokerFee = Math.floor(brokerFee * 1.1);
  notes.push(
    `중개보수 상한요율 ${broker.rate}%${broker.capped ? ' (한도액 적용)' : ''}` +
      `${discount > 0 ? `, ${Math.round(discount * 100)}% 협의 할인` : ''}` +
      `${brokerVat ? ', VAT 10% 포함' : ''}`,
  );

  // 매도자는 등기·인지세 부담이 없다 (인지세는 통상 매수·매도 각 1/2 부담이나 실무상 매수자 부담이 일반적)
  if (side === 'sell') {
    const movingEtc = input.movingEtc ?? 0;
    notes.push('매도 측은 중개보수 외 등기비용이 발생하지 않습니다 (양도세는 별도 계산).');
    return {
      brokerFee,
      registrationFee: 0,
      stampTax: 0,
      bondDiscount: 0,
      movingEtc,
      total: brokerFee + movingEtc,
      notes,
    };
  }

  // 매수: 소유권이전등기 법무사 보수 + 인지세 + 국민주택채권 할인
  // 법무사 보수는 거래가액에 따라 대략 30~80만원 수준으로 추정
  const registrationFee = Math.min(
    900_000,
    Math.max(300_000, Math.floor((price * 0.0006) / 10_000) * 10_000),
  );
  notes.push('법무사 보수는 거래가액 기준 개략 추정치입니다 (셀프등기 시 대부분 절감 가능).');

  const stampTax = calcStampTax(price);

  // 국민주택채권: 시가표준액 기준 매입 후 즉시 매도 시 할인손실이 발생.
  // 시가표준액은 실거래가의 약 70%로 가정. 매입률은 특별시·광역시 기준
  // 시가표준액 6억 이상 3.1%, 미만 2.6% (주택도시기금 매입기준) — 고가 아파트에서
  // 2.6% 고정은 부담을 20% 가까이 과소 추정하던 것을 보정. 할인율 약 12% 가정.
  const assessedValue = price * 0.7;
  const bondRate = assessedValue >= 600_000_000 ? 0.031 : 0.026;
  const bondDiscount = Math.floor((assessedValue * bondRate * 0.12) / 1_000) * 1_000;
  notes.push(
    `국민주택채권 할인부담은 시가표준액 70%·매입률 ${(bondRate * 100).toFixed(1)}%·할인율 12% 가정 추정치입니다.`,
  );

  const mortgageFee = input.withMortgage ? 400_000 : 0;
  if (mortgageFee > 0) notes.push('근저당권 설정비(등록면허세·법무비) 약 40만원을 포함했습니다.');

  const movingEtc = (input.movingEtc ?? 0) + mortgageFee;
  const total = brokerFee + registrationFee + stampTax + bondDiscount + movingEtc;

  return { brokerFee, registrationFee, stampTax, bondDiscount, movingEtc, total, notes };
}
