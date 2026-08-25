/**
 * 설정 자동 채움.
 *
 * 사용자가 꼭 알아야만 하는 값(단지명·지역·전용면적·취득일·취득가액)만 넣으면
 * 나머지는 현재 시점의 세법·시세·금리로 계산해 채운다. 채운 값은 모두 수정 가능하다.
 *
 * 자동 계산의 기준 시점은 항상 "지금"이다:
 *  - 세금·중개보수: 현행 세율표 (지방세법·소득세법·공인중개사법 시행규칙)
 *  - 시세: 최근 6개월 실거래 중앙값
 *  - 대출금리: 한국은행 ECOS 예금은행 주택담보대출 신규취급 평균금리
 *  - 조정대상지역: 아래 목록 (정부 지정 변경 시 설정에서 직접 수정)
 */

import type {
  Holding,
  MacroIndicator,
  PriceQuote,
  TargetApartment,
  TradeRecord,
  UserConfig,
} from '@/lib/types';
import { calcAcquisitionTax } from '@/lib/tax/acquisition';
import { calcTransactionCost } from '@/lib/tax/transaction-costs';
import { monthsBetween, todayKst } from '@/lib/format';

/**
 * 규제지역 판정은 analysis/regulation.ts 에 모아두고 여기서는 재수출만 한다.
 * (조정대상지역·투기과열지구·토지거래허가구역을 한곳에서 관리하기 위함)
 */
import { isRegulatedArea } from './regulation';

export { ADJUSTED_AREAS as REGULATED_AREAS, regulationOf } from './regulation';
export { isRegulatedArea as isRegulated } from './regulation';

/** 모듈 내부에서 쓰는 별칭 */
const isRegulated = isRegulatedArea;

export const REGULATED_NOTE =
  '10·15 대책(2025) + 2026-07 추가 지정 기준 — 서울 전 지역과 경기 15곳(과천·광명·분당·동탄·기흥·구리 등)이 조정대상지역·투기과열지구·토지거래허가구역입니다. 정부 공고로 바뀌므로 직접 확인 후 수정하세요.';

/* ------------------------------------------------------------------ */
/* 파생 값                                                              */
/* ------------------------------------------------------------------ */

export interface AutoFillContext {
  /** 아파트 id → 실거래 기반 시세 */
  quotes: Record<string, PriceQuote>;
  /** 거시 지표 (주담대 금리 사용) */
  macro: MacroIndicator[];
  /** 현재 세대가 보유한 주택 수 (취득세율 판정) */
  ownedHouseCount: number;
  /**
   * 보유 아파트 id → 취득일 인근의 그 단지·면적 실거래.
   * 사용자의 매수 거래 자체가 국토부에 신고돼 있으므로 취득가액을 채울 수 있다.
   */
  acquisitionTrades?: Record<string, TradeRecord>;
}

/** 자동으로 채운 항목 하나 */
export interface FilledField {
  field: string;
  label: string;
  value: number;
  /** 숫자로 표현되지 않는 값 (예: 재건축 단계). 있으면 화면은 이걸 그대로 쓴다. */
  text?: string;
  /** 어떻게 계산했는지 */
  basis: string;
}

export interface AutoFillResult<T> {
  values: Partial<T>;
  filled: FilledField[];
  /** 채우지 못한 이유 */
  skipped: string[];
}

/** 현재 주택담보대출 평균 금리 (없으면 보수적 기본값) */
export function currentMortgageRate(macro: MacroIndicator[]): { rate: number; basis: string } {
  const m = macro.find((x) => x.key === 'mortgage-rate');
  if (m) {
    return {
      rate: Math.round(m.latest * 100) / 100,
      basis: `한국은행 ECOS 예금은행 주택담보대출 신규취급 평균금리 ${m.latest}% (${m.latestPeriod})`,
    };
  }
  const base = macro.find((x) => x.key === 'base-rate');
  if (base) {
    const est = Math.round((base.latest + 1.3) * 100) / 100;
    return {
      rate: est,
      basis: `주담대 금리 데이터가 없어 기준금리 ${base.latest}% + 가산 1.3%p 로 추정`,
    };
  }
  return { rate: 4.0, basis: '금리 데이터가 없어 4.0% 기본값을 적용 (직접 수정 권장)' };
}

/**
 * 보유 아파트의 나머지 값들을 계산한다.
 * 필요한 최소 입력: lawdCd, areaM2, acquiredAt, acquisitionPrice
 */
export function autoFillHolding(
  holding: Holding,
  ctx: AutoFillContext,
  options: { overwrite?: boolean } = {},
): AutoFillResult<Holding> {
  const values: Partial<Holding> = {};
  const filled: FilledField[] = [];
  const skipped: string[] = [];
  const overwrite = options.overwrite ?? false;
  const isEmpty = (v: number | undefined) => v === undefined || v === 0;

  // 0) 취득가액 — 취득일과 가장 가까운 그 단지·면적 실거래.
  //    본인의 매수 계약 자체가 신고돼 있을 가능성이 높다 (계약일·잔금일 차이는 감안).
  const acqTrade = ctx.acquisitionTrades?.[holding.id];
  let acquisitionPrice = holding.acquisitionPrice;
  if (acqTrade && (overwrite || isEmpty(holding.acquisitionPrice))) {
    acquisitionPrice = acqTrade.price;
    values.acquisitionPrice = acqTrade.price;
    filled.push({
      field: 'acquisitionPrice',
      label: '취득가액',
      value: acqTrade.price,
      basis: `취득일(${holding.acquiredAt})과 가장 가까운 ${holding.complexName} ${acqTrade.areaM2}㎡ 실거래 (계약 ${acqTrade.dealDate}). 본인 계약이 아닐 수 있으니 실제 취득가액과 다르면 수정하세요.`,
    });
  } else if (isEmpty(holding.acquisitionPrice) && holding.acquiredAt) {
    skipped.push('취득일 인근의 해당 단지·면적 실거래를 찾지 못해 취득가액은 채우지 못했습니다.');
  }

  // 1) 취득 부대비용 = 취득 당시 취득세 + 중개보수 + 법무·등기비
  if (acquisitionPrice > 0 && holding.areaM2 > 0) {
    if (overwrite || isEmpty(holding.acquisitionCost)) {
      // 취득 시점에는 그 집이 첫 집이었다고 보고 표준세율로 계산한다
      const tax = calcAcquisitionTax({
        price: acquisitionPrice,
        areaM2: holding.areaM2,
        houseCountAfter: 1,
        isRegulated: isRegulated(holding.lawdCd),
        temporaryTwoHouse: false,
        firstTimeBuyer: false,
      });
      const cost = calcTransactionCost({
        price: acquisitionPrice,
        side: 'buy',
        withMortgage: true,
      });
      const total = tax.total + cost.total;
      values.acquisitionCost = total;
      filled.push({
        field: 'acquisitionCost',
        label: '취득 부대비용',
        value: total,
        basis: `취득세 등 ${tax.total.toLocaleString('ko-KR')}원(세율 ${tax.rate}%) + 중개보수·법무비 ${cost.total.toLocaleString('ko-KR')}원. 현행 세율 기준 추정이며 실제 납부액이 있으면 그 값으로 바꾸세요.`,
      });
    }
  } else {
    skipped.push('취득가액과 전용면적을 입력해야 취득 부대비용을 계산할 수 있습니다.');
  }

  // 2) 실거주 개월 수 — 취득일부터 지금까지 거주했다고 가정
  if (holding.acquiredAt) {
    if (overwrite || isEmpty(holding.residenceMonths)) {
      const months = monthsBetween(holding.acquiredAt, todayKst());
      values.residenceMonths = months;
      filled.push({
        field: 'residenceMonths',
        label: '실거주 개월 수',
        value: months,
        basis: `취득일(${holding.acquiredAt})부터 오늘까지 ${months}개월. 실제 거주하지 않은 기간이 있으면 줄이세요 (1세대1주택 장기보유특별공제에 영향).`,
      });
    }
  } else {
    skipped.push('취득일을 입력해야 실거주 개월 수를 계산할 수 있습니다.');
  }

  // 3) 대출 금리 — 현재 시장 평균
  if (overwrite || isEmpty(holding.loanRate)) {
    const { rate, basis } = currentMortgageRate(ctx.macro);
    values.loanRate = rate;
    filled.push({ field: 'loanRate', label: '대출 금리', value: rate, basis });
  }

  // 4) 현재 호가 — 최근 실거래 중앙값
  const quote = ctx.quotes[holding.id];
  if (quote && quote.basis === 'recent-trade' && quote.price > 0) {
    if (overwrite || isEmpty(holding.manualPrice)) {
      values.manualPrice = quote.price;
      filled.push({
        field: 'manualPrice',
        label: '현재 호가',
        value: quote.price,
        basis: `최근 실거래 ${quote.sampleSize}건의 중앙값${quote.lastDealDate ? ` (최근 거래일 ${quote.lastDealDate})` : ''}. 호가는 보통 실거래보다 높으니 알고 있는 호가가 있으면 그 값을 쓰세요.`,
      });
    }
  } else {
    skipped.push(
      '해당 단지·면적의 실거래를 찾지 못해 현재 호가는 채우지 못했습니다. 단지명이 실거래 표기와 같은지 확인하세요.',
    );
  }

  return { values, filled, skipped };
}

/** 목표 아파트 — 채울 값은 호가뿐이다 */
export function autoFillTarget(
  target: TargetApartment,
  ctx: AutoFillContext,
  options: { overwrite?: boolean } = {},
): AutoFillResult<TargetApartment> {
  const values: Partial<TargetApartment> = {};
  const filled: FilledField[] = [];
  const skipped: string[] = [];
  const overwrite = options.overwrite ?? false;

  const quote = ctx.quotes[target.id];
  if (quote && quote.basis === 'recent-trade' && quote.price > 0) {
    if (overwrite || !target.manualPrice) {
      values.manualPrice = quote.price;
      filled.push({
        field: 'manualPrice',
        label: '현재 호가',
        value: quote.price,
        basis: `최근 실거래 ${quote.sampleSize}건의 중앙값${quote.lastDealDate ? ` (최근 거래일 ${quote.lastDealDate})` : ''}`,
      });
    }
  } else {
    skipped.push('해당 단지·면적의 실거래를 찾지 못했습니다. 단지명 표기를 확인하세요.');
  }

  return { values, filled, skipped };
}

/* ------------------------------------------------------------------ */
/* 세대 프로필                                                          */
/* ------------------------------------------------------------------ */

export interface HouseholdFillResult {
  values: Partial<UserConfig['household']>;
  notes: string[];
}

/** 등록된 아파트 정보로 세대 프로필을 추론한다 */
export function autoFillHousehold(config: UserConfig): HouseholdFillResult {
  const notes: string[] = [];
  const values: Partial<UserConfig['household']> = {};

  // 보유 주택 수 = 등록된 보유 아파트 수
  values.ownedHouseCount = config.holdings.length;
  notes.push(
    `보유 주택 수를 등록된 보유 아파트 ${config.holdings.length}건으로 설정했습니다. 등록하지 않은 주택이 있으면 직접 늘리세요.`,
  );

  // 조정대상지역 여부
  const holdingRegulated = config.holdings.some((h) => isRegulated(h.lawdCd));
  const targetRegulated = config.targets.some((t) => isRegulated(t.lawdCd));
  values.holdingIsRegulated = holdingRegulated;
  values.targetIsRegulated = targetRegulated;
  notes.push(
    `조정대상지역 여부 — 보유 ${holdingRegulated ? '해당' : '비해당'}, 목표 ${targetRegulated ? '해당' : '비해당'}. ${REGULATED_NOTE}`,
  );

  // 갈아타기 전제이므로 일시적 2주택 특례를 켠다
  if (config.holdings.length > 0 && config.targets.length > 0) {
    values.temporaryTwoHouse = true;
    notes.push(
      '보유 주택을 팔고 목표 주택을 사는 갈아타기로 보아 일시적 2주택 특례를 켰습니다 (취득세 표준세율 적용). 기한 내 종전주택을 처분하지 못하면 차액이 추징됩니다.',
    );
  }

  // 생애최초는 보유 주택이 없을 때만
  values.firstTimeBuyer = config.holdings.length === 0;
  if (config.holdings.length === 0) {
    notes.push('보유 주택이 없어 생애최초 주택 구입으로 설정했습니다 (취득세 최대 200만원 감면).');
  }

  // 다주택 양도세 중과는 현재 한시 배제 여부에 따라 달라져 기본값을 끈 상태로 둔다
  notes.push(
    '다주택자 양도세 중과는 한시 배제 정책이 반복 연장돼 왔습니다. 기본값은 "적용 안 함"이며, 배제가 종료됐다면 직접 켜세요.',
  );

  return { values, notes };
}
