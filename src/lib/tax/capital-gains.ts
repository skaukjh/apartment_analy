/**
 * 주택 양도소득세 계산 (소득세법 제89조·제95조·제104조 기준)
 *
 * ⚠️ 참고용 추정치입니다. 1세대1주택 비과세 요건(보유·거주), 다주택 중과 한시 배제,
 *    조정대상지역 지정 여부는 수시로 바뀝니다. 실제 신고 전 홈택스 모의계산 또는
 *    세무 전문가 확인이 필요합니다. https://hometax.go.kr
 */

import type { CapitalGainsTaxResult } from '@/lib/types';
import { monthsBetween } from '@/lib/format';

export interface CapitalGainsInput {
  /** 양도가액 (원) */
  salePrice: number;
  /** 취득가액 (원) */
  acquisitionPrice: number;
  /** 필요경비 (취득세·중개보수·자본적지출 등, 원) */
  expenses: number;
  /** 취득일 (YYYY-MM-DD) */
  acquiredAt: string;
  /** 양도일 (YYYY-MM-DD) */
  soldAt: string;
  /** 실거주 개월 수 */
  residenceMonths: number;
  /** 1세대1주택 비과세 대상 여부 */
  isOneHouseExempt: boolean;
  /** 다주택 중과 적용 여부 */
  multiHouseSurcharge: false | 2 | 3;
  /** 조정대상지역 소재 여부 (중과 판단) */
  isRegulated: boolean;
  /** 같은 해 이미 사용한 기본공제 (원) */
  usedBasicDeduction: number;
}

/** 1세대1주택 고가주택 기준선 */
const HIGH_VALUE_THRESHOLD = 1_200_000_000;
/** 양도소득 기본공제 */
const BASIC_DEDUCTION = 2_500_000;

/** 종합소득세 누진세율표 (2026년 기준) */
const BRACKETS: Array<{ upTo: number; rate: number; deduct: number }> = [
  { upTo: 14_000_000, rate: 6, deduct: 0 },
  { upTo: 50_000_000, rate: 15, deduct: 1_260_000 },
  { upTo: 88_000_000, rate: 24, deduct: 5_760_000 },
  { upTo: 150_000_000, rate: 35, deduct: 15_440_000 },
  { upTo: 300_000_000, rate: 38, deduct: 19_940_000 },
  { upTo: 500_000_000, rate: 40, deduct: 25_940_000 },
  { upTo: 1_000_000_000, rate: 42, deduct: 35_940_000 },
  { upTo: Infinity, rate: 45, deduct: 65_940_000 },
];

function progressiveTax(taxBase: number): { tax: number; rate: number } {
  if (taxBase <= 0) return { tax: 0, rate: 0 };
  const bracket = BRACKETS.find((b) => taxBase <= b.upTo)!;
  return {
    tax: Math.max(0, Math.floor((taxBase * bracket.rate) / 100 - bracket.deduct)),
    rate: bracket.rate,
  };
}

/**
 * 장기보유특별공제율(%)
 * - 1세대1주택 고가주택: 보유 연 4%(최대 40%) + 거주 연 4%(최대 40%) = 최대 80%
 * - 그 외: 보유 3년 이상부터 연 2%, 최대 30%
 */
function longTermRate(
  holdingMonths: number,
  residenceMonths: number,
  isOneHouseExempt: boolean,
): { rate: number; note: string } {
  const holdYears = Math.floor(holdingMonths / 12);

  const residenceYears = Math.floor(residenceMonths / 12);

  // 표2(보유 연 4% + 거주 연 4%)는 "보유기간 중 거주 2년 이상"인 1세대1주택에만
  // 적용된다 (소득세법 제95조 제2항 단서, 2020.1.1 이후 양도분).
  // 거주 2년 미만이면 1주택이라도 일반 표1(연 2%, 최대 30%)로 떨어진다.
  if (isOneHouseExempt && residenceYears >= 2) {
    if (holdYears < 3) {
      return { rate: 0, note: '보유 3년 미만 — 장기보유특별공제 없음' };
    }
    const holdRate = Math.min(40, holdYears * 4);
    const liveRate = Math.min(40, residenceYears * 4);
    return {
      rate: holdRate + liveRate,
      note: `1세대1주택 표2 적용: 보유 ${holdYears}년 ${holdRate}% + 거주 ${residenceYears}년 ${liveRate}% = ${holdRate + liveRate}%`,
    };
  }

  if (isOneHouseExempt && residenceYears < 2 && holdYears >= 3) {
    const rate = Math.min(30, holdYears * 2);
    return {
      rate,
      note: `거주 2년 미만이라 표2 대신 일반 표1 적용: 보유 ${holdYears}년 × 2% = ${rate}%`,
    };
  }

  if (holdYears < 3) return { rate: 0, note: '보유 3년 미만 — 장기보유특별공제 없음' };
  const rate = Math.min(30, holdYears * 2);
  return { rate, note: `일반 표1 적용: 보유 ${holdYears}년 × 2% = ${rate}%` };
}

export function calcCapitalGainsTax(input: CapitalGainsInput): CapitalGainsTaxResult {
  const notes: string[] = [];
  const holdingMonths = monthsBetween(input.acquiredAt, input.soldAt);
  const holdYears = holdingMonths / 12;

  const grossGain = Math.max(
    0,
    Math.round(input.salePrice - input.acquisitionPrice - input.expenses),
  );

  if (grossGain <= 0) {
    return {
      grossGain: Math.round(input.salePrice - input.acquisitionPrice - input.expenses),
      taxableGain: 0,
      longTermDeduction: 0,
      longTermRate: 0,
      gainAfterDeduction: 0,
      basicDeduction: 0,
      taxBase: 0,
      rate: 0,
      incomeTax: 0,
      localTax: 0,
      total: 0,
      exempt: false,
      holdingMonths,
      notes: ['양도차익이 없어 납부할 양도소득세가 없습니다 (양도차손은 별도 통산 검토).'],
    };
  }

  // 1) 1세대1주택 비과세 판정
  let taxableGain = grossGain;
  let exempt = false;

  if (input.isOneHouseExempt) {
    if (holdingMonths < 24) {
      notes.push('⚠️ 보유 2년 미만 — 1세대1주택 비과세 요건 미충족으로 전액 과세됩니다.');
    } else if (input.salePrice <= HIGH_VALUE_THRESHOLD) {
      exempt = true;
      taxableGain = 0;
      notes.push('1세대1주택 12억 이하 → 양도소득세 전액 비과세');
    } else {
      const ratio = (input.salePrice - HIGH_VALUE_THRESHOLD) / input.salePrice;
      taxableGain = Math.round(grossGain * ratio);
      notes.push(`1세대1주택 고가주택: 12억 초과분만 과세 (과세비율 ${(ratio * 100).toFixed(2)}%)`);
    }
  }

  if (exempt) {
    return {
      grossGain,
      taxableGain: 0,
      longTermDeduction: 0,
      longTermRate: 0,
      gainAfterDeduction: 0,
      basicDeduction: 0,
      taxBase: 0,
      rate: 0,
      incomeTax: 0,
      localTax: 0,
      total: 0,
      exempt: true,
      holdingMonths,
      notes,
    };
  }

  // 2) 단기 양도 여부 (중과세율 우선 적용)
  const shortTermRate = holdYears < 1 ? 70 : holdYears < 2 ? 60 : 0;

  // 3) 장기보유특별공제 — 단기 양도 및 중과 대상은 배제
  const surchargeApplies =
    input.multiHouseSurcharge !== false && input.isRegulated && shortTermRate === 0;

  let ltRate = 0;
  let ltNote = '';
  if (shortTermRate > 0) {
    ltNote = `보유 ${holdingMonths}개월(2년 미만) — 장기보유특별공제 배제`;
  } else if (surchargeApplies) {
    ltNote = '조정대상지역 다주택 중과 대상 — 장기보유특별공제 배제';
  } else {
    const r = longTermRate(holdingMonths, input.residenceMonths, input.isOneHouseExempt);
    ltRate = r.rate;
    ltNote = r.note;
  }
  notes.push(ltNote);

  const longTermDeduction = Math.floor((taxableGain * ltRate) / 100);
  const gainAfterDeduction = taxableGain - longTermDeduction;

  // 4) 기본공제 (연 250만원, 인별)
  const basicDeduction = Math.min(
    Math.max(0, BASIC_DEDUCTION - input.usedBasicDeduction),
    gainAfterDeduction,
  );
  const taxBase = Math.max(0, gainAfterDeduction - basicDeduction);

  // 5) 세율 적용
  let incomeTax: number;
  let appliedRate: number;

  if (shortTermRate > 0) {
    incomeTax = Math.floor((taxBase * shortTermRate) / 100);
    appliedRate = shortTermRate;
    notes.push(
      `보유 ${holdingMonths}개월 → 단기 양도 중과세율 ${shortTermRate}% 적용 (누진세율 비교과세 중 큰 금액)`,
    );
    // 단기세율과 누진세율 중 큰 금액으로 비교과세
    const prog = progressiveTax(taxBase);
    if (prog.tax > incomeTax) {
      incomeTax = prog.tax;
      appliedRate = prog.rate;
      notes.push('누진세율이 더 커서 누진세율로 과세');
    }
  } else {
    const prog = progressiveTax(taxBase);
    let surcharge = 0;
    if (surchargeApplies) {
      surcharge = input.multiHouseSurcharge === 2 ? 20 : 30;
      notes.push(
        `⚠️ 조정대상지역 ${input.multiHouseSurcharge}주택 이상 중과: 기본세율 +${surcharge}%p`,
      );
    }
    appliedRate = prog.rate + surcharge;
    incomeTax = Math.floor(
      (taxBase * appliedRate) / 100 - (BRACKETS.find((b) => taxBase <= b.upTo)?.deduct ?? 0),
    );
    incomeTax = Math.max(0, incomeTax);
  }

  const localTax = Math.floor(incomeTax * 0.1);
  notes.push('지방소득세는 양도소득세의 10%로 산출됩니다.');

  return {
    grossGain,
    taxableGain,
    longTermDeduction,
    longTermRate: ltRate,
    gainAfterDeduction,
    basicDeduction,
    taxBase,
    rate: appliedRate,
    incomeTax,
    localTax,
    total: incomeTax + localTax,
    exempt: false,
    holdingMonths,
    notes,
  };
}
