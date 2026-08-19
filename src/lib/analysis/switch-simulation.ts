/**
 * 갈아타기 시뮬레이션 (요구사항 1·5)
 *
 * 핵심 아이디어: 하락장에서는 상급지의 하락폭(절대금액)이 하급지보다 크기 때문에
 * 갭(목표가 − 보유가)이 줄어든다. 다만 세금·중개보수 등 마찰비용은 거의 그대로여서
 * "갭 축소분 > 마찰비용" 이 되는 지점부터 갈아타기가 실질적으로 유리해진다.
 */

import type {
  HouseholdProfile,
  Holding,
  SwitchSimulationInput,
  SwitchSimulationResult,
  TargetApartment,
} from '@/lib/types';
import { calcAcquisitionTaxFor } from '@/lib/tax/acquisition';
import { calcCapitalGainsTax } from '@/lib/tax/capital-gains';
import { calcTransactionCost } from '@/lib/tax/transaction-costs';
import { todayKst, isOver85 } from '@/lib/format';

export function simulateSwitch(
  input: SwitchSimulationInput,
  scenarioLabel = '기준 시나리오',
): SwitchSimulationResult {
  const { holding, household, sellPrice, buyPrice } = input;

  // 1) 매도 — 양도소득세
  const isOneHouse = household.ownedHouseCount <= 1;
  const capitalGainsTax = calcCapitalGainsTax({
    salePrice: sellPrice,
    acquisitionPrice: holding.acquisitionPrice,
    expenses: holding.acquisitionCost + holding.capitalExpenditure,
    acquiredAt: holding.acquiredAt,
    soldAt: todayKst(),
    residenceMonths: holding.residenceMonths,
    isOneHouseExempt: isOneHouse,
    multiHouseSurcharge:
      household.applyMultiHouseSurcharge && household.ownedHouseCount >= 3
        ? 3
        : household.applyMultiHouseSurcharge && household.ownedHouseCount === 2
          ? 2
          : false,
    isRegulated: household.holdingIsRegulated,
    usedBasicDeduction: household.otherCapitalGainThisYear > 0 ? 2_500_000 : 0,
  });

  // 2) 매도 부대비용
  const sellCost = calcTransactionCost({ price: sellPrice, side: 'sell' });

  // 3) 매수 — 취득세 (기존 주택 처분 전제 → 일시적 2주택 표준세율)
  const acquisitionTax = calcAcquisitionTaxFor(buyPrice, input.target.areaM2, household, {
    replacesExisting: true,
  });

  // 4) 매수 부대비용
  const buyCost = calcTransactionCost({
    price: buyPrice,
    side: 'buy',
    withMortgage: input.newLoan > 0,
  });

  // 5) 자금 흐름
  const netFromSale =
    sellPrice - holding.loanBalance - holding.leaseDeposit - capitalGainsTax.total - sellCost.total;

  const totalNeeded = buyPrice + acquisitionTax.total + buyCost.total;
  const available = netFromSale + input.cashOnHand + input.newLoan;
  const fundingGap = available - totalNeeded;

  // 6) 이자 부담 변화
  const oldInterest = holding.loanBalance * (holding.loanRate / 100);
  const newInterest = input.newLoan * (input.newLoanRate / 100);
  const annualInterestDelta = newInterest - oldInterest;

  const totalFriction =
    capitalGainsTax.total + sellCost.total + acquisitionTax.total + buyCost.total;

  return {
    scenarioLabel,
    sellPrice,
    buyPrice,
    priceGap: buyPrice - sellPrice,
    capitalGainsTax,
    sellCost,
    acquisitionTax,
    buyCost,
    netFromSale,
    totalNeeded,
    fundingGap,
    annualInterestDelta,
    totalFriction,
    frictionRate: buyPrice > 0 ? (totalFriction / buyPrice) * 100 : 0,
  };
}

/* ------------------------------------------------------------------ */
/* 하락장 시나리오 세트                                                  */
/* ------------------------------------------------------------------ */

export interface DownturnScenario {
  label: string;
  /** 보유 아파트 하락률 (%, 음수) */
  holdingDrop: number;
  /** 목표 아파트 하락률 (%, 음수) */
  targetDrop: number;
  description: string;
}

/**
 * 하락장 시나리오 프리셋.
 * 상급지가 더 크게 빠지는 "역전 하락"과, 하급지가 더 크게 빠지는 "차별화 하락"을 함께 본다.
 * 2022~2023 하락기 실제 패턴은 초기에는 상급지 낙폭이 컸고(고점 대비 -25~30%),
 * 회복기에는 상급지가 먼저 반등하며 갭이 다시 벌어졌다.
 */
export const DOWNTURN_SCENARIOS: DownturnScenario[] = [
  {
    label: '현재 시세 유지',
    holdingDrop: 0,
    targetDrop: 0,
    description: '지금 바로 갈아탈 경우의 기준선',
  },
  {
    label: '완만한 조정 (상급지 -10%)',
    holdingDrop: -6,
    targetDrop: -10,
    description: '금리 동결 + 거래량 감소. 상급지 낙폭이 다소 큰 일반적 조정 국면',
  },
  {
    label: '본격 하락 (상급지 -20%)',
    holdingDrop: -12,
    targetDrop: -20,
    description: '2022년형 급락. 상급지 절대 낙폭이 커서 갭이 크게 축소',
  },
  {
    label: '역전 하락 (상급지 -30%)',
    holdingDrop: -18,
    targetDrop: -30,
    description: '고점 대비 최대 낙폭 국면. 갈아타기 적기이나 매도 자체가 어려움',
  },
  {
    label: '하급지 급락 (내 집만 -20%)',
    holdingDrop: -20,
    targetDrop: -8,
    description: '입지 차별화 심화. 갭이 오히려 벌어져 갈아타기가 불리해지는 최악 케이스',
  },
  {
    label: '상승장 재개 (+10%)',
    holdingDrop: 6,
    targetDrop: 12,
    description: '반등 확산. 기다릴수록 갭이 벌어지는 국면',
  },
];

export interface ScenarioComparison {
  scenario: DownturnScenario;
  result: SwitchSimulationResult;
  /** 기준선 대비 갭 변화 (원, 음수면 갭 축소 = 유리) */
  gapDelta: number;
  /** 기준선 대비 총 필요자금 변화 (원) */
  cashDelta: number;
  /** 종합 판정 */
  verdict: '매우 유리' | '유리' | '중립' | '불리' | '매우 불리';
}

export function runScenarioMatrix(
  base: SwitchSimulationInput,
  scenarios: DownturnScenario[] = DOWNTURN_SCENARIOS,
): ScenarioComparison[] {
  const baseline = simulateSwitch(base, '기준');
  const baselineGap = baseline.priceGap;
  const baselineCash = baseline.totalNeeded - baseline.netFromSale;

  return scenarios.map((scenario) => {
    const sellPrice = Math.round(base.sellPrice * (1 + scenario.holdingDrop / 100));
    const buyPrice = Math.round(base.buyPrice * (1 + scenario.targetDrop / 100));
    const result = simulateSwitch({ ...base, sellPrice, buyPrice }, scenario.label);

    const gapDelta = result.priceGap - baselineGap;
    const cashDelta = result.totalNeeded - result.netFromSale - baselineCash;

    // 필요 현금이 얼마나 줄었는지를 기준선 갭 대비 비율로 판정
    const denom = Math.max(1, Math.abs(baselineGap));
    const ratio = -cashDelta / denom;
    const verdict: ScenarioComparison['verdict'] =
      ratio > 0.25
        ? '매우 유리'
        : ratio > 0.08
          ? '유리'
          : ratio > -0.08
            ? '중립'
            : ratio > -0.25
              ? '불리'
              : '매우 불리';

    return { scenario, result, gapDelta, cashDelta, verdict };
  });
}

/**
 * "언제 갈아타야 하나"를 한 줄로 답하는 손익분기 계산.
 * 목표 아파트가 x% 하락하고 보유 아파트가 그 절반만 하락한다고 가정할 때,
 * 마찰비용을 상쇄하려면 몇 %가 필요한지 역산한다.
 */
export function breakEvenDrop(base: SwitchSimulationInput): {
  requiredTargetDrop: number;
  friction: number;
  gapReductionPerPercent: number;
} {
  const baseline = simulateSwitch(base);
  const friction = baseline.totalFriction;
  // 목표 -1%, 보유 -0.5% 일 때 갭 축소액
  const gapReductionPerPercent = base.buyPrice * 0.01 - base.sellPrice * 0.005;
  const requiredTargetDrop =
    gapReductionPerPercent > 0 ? friction / gapReductionPerPercent : Infinity;
  return { requiredTargetDrop, friction, gapReductionPerPercent };
}

/** 보유·목표 아파트로부터 시뮬레이션 기본 입력을 만든다 */
export function buildSimulationInput(
  holding: Holding,
  target: TargetApartment,
  household: HouseholdProfile,
  sellPrice: number,
  buyPrice: number,
  opts: { cashOnHand?: number; newLoan?: number; newLoanRate?: number } = {},
): SwitchSimulationInput {
  return {
    holding,
    target,
    household,
    sellPrice,
    buyPrice,
    cashOnHand: opts.cashOnHand ?? 0,
    newLoan: opts.newLoan ?? holding.loanBalance,
    newLoanRate: opts.newLoanRate ?? holding.loanRate,
    targetOver85: isOver85(target.areaM2),
    holdingOver85: isOver85(holding.areaM2),
  };
}
