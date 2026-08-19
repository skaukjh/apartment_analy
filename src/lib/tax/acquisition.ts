/**
 * 주택 유상취득 취득세 계산 (지방세법 제11조·제13조의2 기준)
 *
 * ⚠️ 참고용 추정치입니다. 감면·특례·조정대상지역 지정은 수시로 바뀌므로
 *    실제 신고 전에는 반드시 위택스 계산기 또는 세무 전문가로 확인하세요.
 *    https://www.wetax.go.kr
 */

import type { AcquisitionTaxResult, HouseholdProfile } from '@/lib/types';

export interface AcquisitionTaxInput {
  /** 취득가액 (원) */
  price: number;
  /** 전용면적 (㎡) — 85㎡ 초과 시 농어촌특별세 부과 */
  areaM2: number;
  /** 취득 후 세대 보유 주택 수 (취득하는 주택 포함) */
  houseCountAfter: number;
  /** 취득 대상 주택이 조정대상지역에 있는지 */
  isRegulated: boolean;
  /** 일시적 2주택 특례 (기존 주택 처분 조건) */
  temporaryTwoHouse: boolean;
  /** 생애최초 주택 구입 감면 대상 여부 */
  firstTimeBuyer: boolean;
}

const OVER_85_THRESHOLD = 85;
const SIX_EOK = 600_000_000;
const NINE_EOK = 900_000_000;

/**
 * 6억 초과 ~ 9억 이하 구간의 누진 세율(%)
 * 지방세법 시행령: 세율 = (취득가액(억원) × 2/3 − 3), 소수점 다섯째 자리에서 반올림하여 넷째 자리까지
 */
function progressiveRate(price: number): number {
  const eok = price / 100_000_000;
  const raw = eok * (2 / 3) - 3;
  return Math.round(raw * 10_000) / 10_000;
}

/** 표준세율(1~3%) 결정 */
function standardRate(price: number): number {
  if (price <= SIX_EOK) return 1;
  if (price <= NINE_EOK) return progressiveRate(price);
  return 3;
}

/** 다주택·조정대상지역 중과세율 결정 */
function decideRate(input: AcquisitionTaxInput): { rate: number; heavy: boolean; note: string } {
  const { price, houseCountAfter, isRegulated, temporaryTwoHouse } = input;
  const std = standardRate(price);

  // 1주택이거나 일시적 2주택 특례 적용 시 표준세율
  if (houseCountAfter <= 1 || temporaryTwoHouse) {
    return {
      rate: std,
      heavy: false,
      note: temporaryTwoHouse
        ? '일시적 2주택 특례로 표준세율 적용 (기한 내 종전주택 미처분 시 차액 추징)'
        : '1주택 표준세율 적용',
    };
  }

  if (isRegulated) {
    if (houseCountAfter === 2) return { rate: 8, heavy: true, note: '조정대상지역 2주택 중과 8%' };
    return { rate: 12, heavy: true, note: '조정대상지역 3주택 이상 중과 12%' };
  }

  // 비조정대상지역
  if (houseCountAfter === 2)
    return { rate: std, heavy: false, note: '비조정지역 2주택 표준세율 적용' };
  if (houseCountAfter === 3) return { rate: 8, heavy: true, note: '비조정지역 3주택 중과 8%' };
  return { rate: 12, heavy: true, note: '비조정지역 4주택 이상 중과 12%' };
}

/** 지방교육세율(%) — 표준세율 구간은 세율의 1/10, 중과 구간은 0.4% 고정 */
function localEducationRate(rate: number, heavy: boolean): number {
  return heavy ? 0.4 : rate * 0.1;
}

/** 농어촌특별세율(%) — 전용 85㎡ 이하는 비과세 */
function ruralRate(rate: number, heavy: boolean, over85: boolean): number {
  if (!over85) return 0;
  if (!heavy) return 0.2;
  return rate === 12 ? 1.0 : 0.6;
}

/** 생애최초 주택 구입 취득세 감면 (최대 200만원, 실거래가 12억 이하) */
function firstTimeBuyerReduction(price: number, acquisitionTax: number, eligible: boolean): number {
  if (!eligible) return 0;
  if (price > 1_200_000_000) return 0;
  return Math.min(acquisitionTax, 2_000_000);
}

export function calcAcquisitionTax(input: AcquisitionTaxInput): AcquisitionTaxResult {
  const notes: string[] = [];
  const base = Math.max(0, Math.round(input.price));
  const over85 = input.areaM2 > OVER_85_THRESHOLD;

  const { rate, heavy, note } = decideRate(input);
  notes.push(note);

  const acquisitionTaxRaw = Math.floor((base * rate) / 100);
  const reduction = firstTimeBuyerReduction(base, acquisitionTaxRaw, input.firstTimeBuyer);
  if (reduction > 0) {
    notes.push(`생애최초 감면 ${reduction.toLocaleString('ko-KR')}원 적용 (한도 200만원)`);
  }
  const acquisitionTax = acquisitionTaxRaw - reduction;

  const eduRate = localEducationRate(rate, heavy);
  const localEducationTax = Math.floor((base * eduRate) / 100);

  const ruRate = ruralRate(rate, heavy, over85);
  const ruralTax = Math.floor((base * ruRate) / 100);
  notes.push(
    over85
      ? `전용 ${input.areaM2}㎡ (85㎡ 초과) → 농어촌특별세 ${ruRate}% 부과`
      : `전용 ${input.areaM2}㎡ (국민주택규모 이하) → 농어촌특별세 비과세`,
  );

  const total = acquisitionTax + localEducationTax + ruralTax;

  return {
    base,
    rate,
    acquisitionTax,
    localEducationTax,
    ruralTax,
    reduction,
    total,
    effectiveRate: base > 0 ? (total / base) * 100 : 0,
    notes,
  };
}

/** 세대 프로필 + 매수 정보로 바로 계산하는 헬퍼 */
export function calcAcquisitionTaxFor(
  price: number,
  areaM2: number,
  household: HouseholdProfile,
  opts: { replacesExisting?: boolean } = {},
): AcquisitionTaxResult {
  // 갈아타기(기존 1주택 매도 → 신규 매수)는 일시적 2주택으로 보아 표준세율
  const houseCountAfter = opts.replacesExisting
    ? household.ownedHouseCount
    : household.ownedHouseCount + 1;

  return calcAcquisitionTax({
    price,
    areaM2,
    houseCountAfter,
    isRegulated: household.targetIsRegulated,
    temporaryTwoHouse: opts.replacesExisting ? true : household.temporaryTwoHouse,
    firstTimeBuyer: household.firstTimeBuyer && household.ownedHouseCount === 0,
  });
}
