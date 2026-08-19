/**
 * 주택담보대출 가능액 추정 — LTV · DSR · 정책 한도
 *
 * ⚠️ 대출 규제는 부동산 정책 중 가장 자주 바뀌는 영역입니다.
 *    아래 상수는 2025~2026년 기준 일반적인 은행권 규칙이며,
 *    실제 한도는 은행 심사(소득 인정 방식·기존 부채·신용도)에 따라 달라집니다.
 *    실행 전 반드시 은행 상담으로 확인하세요.
 *
 * 반영한 규칙:
 *  - LTV: 비규제 70% / 조정대상지역(규제) 50% / 규제지역 2주택 이상 0%(신규 주담대 금지)
 *  - 생애최초: 지역 무관 LTV 80%
 *  - 수도권·규제지역 주담대 총액 한도 6억 (2025.6.27 가계부채 대책)
 *  - DSR: 은행권 40%, 스트레스 금리 +1.5%p 가산(변동금리 가정)
 *  - 갈아타기(기존 주택 처분조건부)는 무주택자와 같은 LTV 를 적용
 */

export interface LoanLimitInput {
  /** 매수 가격 (원) */
  price: number;
  /** 조정대상지역(규제지역) 여부 */
  regulated: boolean;
  /** 수도권 여부 (주담대 6억 총액 한도 적용) */
  metro: boolean;
  /** 매수 후에도 계속 보유할 주택 수 (갈아타기 처분조건이면 0으로 취급) */
  retainedHouseCount: number;
  /** 생애최초 주택 구입 여부 */
  firstTimeBuyer: boolean;
  /** 연 소득 (원). 0 이면 DSR 계산 생략 */
  annualIncome: number;
  /** 기존 대출의 연간 원리금 상환액 (원) — DSR 에서 차감 */
  otherDebtAnnualPayment: number;
  /** 대출 금리 (%) */
  rate: number;
  /** 만기 (년). 기본 40년 원리금균등 */
  termYears?: number;
}

export interface LoanLimitResult {
  /** 적용 LTV (%) */
  ltvRate: number;
  /** LTV 기준 한도 (원) */
  ltvLimit: number;
  /** DSR 기준 한도 (원). 소득 미입력이면 null */
  dsrLimit: number | null;
  /** 정책 총액 한도 (원). 해당 없으면 null */
  policyCap: number | null;
  /** 최종 대출 가능액 (원) */
  limit: number;
  /** 최종 한도로 빌렸을 때 월 상환액 (원) */
  monthlyPayment: number;
  /** 한도를 결정한 요인 */
  bindingFactor: 'LTV' | 'DSR' | '정책한도' | '대출불가';
  notes: string[];
}

/** 수도권·규제지역 주담대 총액 한도 (원) — 정책 변경 시 env 로 덮어쓰기 */
const POLICY_CAP = Number(process.env.NEXT_PUBLIC_MORTGAGE_CAP ?? '') || 600_000_000;

/** DSR 비율 (은행권) */
const DSR_RATIO = 0.4;

/** 스트레스 DSR 가산 금리 (%p) */
const STRESS_RATE = 1.5;

/** 원리금균등 월 상환액 */
export function monthlyPaymentOf(principal: number, ratePct: number, years: number): number {
  if (principal <= 0) return 0;
  const r = ratePct / 100 / 12;
  const n = years * 12;
  if (r <= 0) return principal / n;
  return (principal * r) / (1 - Math.pow(1 + r, -n));
}

/** 연간 상환액이 주어졌을 때 빌릴 수 있는 원금 (원리금균등 역산) */
function principalFromAnnualPayment(annualPayment: number, ratePct: number, years: number): number {
  if (annualPayment <= 0) return 0;
  const r = ratePct / 100 / 12;
  const n = years * 12;
  const monthly = annualPayment / 12;
  if (r <= 0) return monthly * n;
  return (monthly * (1 - Math.pow(1 + r, -n))) / r;
}

export function calcLoanLimit(input: LoanLimitInput): LoanLimitResult {
  const notes: string[] = [];
  const termYears = input.termYears ?? 40;

  /* 1) LTV */
  let ltvRate: number;
  if (input.retainedHouseCount >= 1 && input.regulated) {
    ltvRate = 0;
    notes.push('규제지역에서 기존 주택을 유지한 채 추가 매수 — 신규 주담대가 금지됩니다.');
  } else if (input.firstTimeBuyer) {
    ltvRate = 80;
    notes.push('생애최초 구입 — LTV 80% 우대를 적용했습니다.');
  } else if (input.regulated) {
    ltvRate = 50;
    notes.push('조정대상지역 — LTV 50% 를 적용했습니다 (무주택·처분조건부 갈아타기 기준).');
  } else {
    ltvRate = 70;
    notes.push('비규제지역 — LTV 70% 를 적용했습니다.');
  }
  const ltvLimit = Math.floor((input.price * ltvRate) / 100);

  /* 2) DSR (스트레스 금리 가산) */
  let dsrLimit: number | null = null;
  if (input.annualIncome > 0) {
    const capacity = input.annualIncome * DSR_RATIO - input.otherDebtAnnualPayment;
    dsrLimit = Math.max(0, Math.floor(principalFromAnnualPayment(capacity, input.rate + STRESS_RATE, termYears)));
    notes.push(
      `DSR 40% 기준: 연소득의 40%(기존 부채 상환액 차감) 이내에서 스트레스 금리 +${STRESS_RATE}%p, ${termYears}년 원리금균등으로 역산했습니다.`,
    );
  } else {
    notes.push('연소득을 입력하면 DSR 한도까지 함께 계산합니다 (현재는 LTV 만 적용).');
  }

  /* 3) 정책 총액 한도 */
  let policyCap: number | null = null;
  if ((input.metro || input.regulated) && ltvRate > 0) {
    policyCap = POLICY_CAP;
    notes.push(
      `수도권·규제지역 주담대 총액 한도 ${(POLICY_CAP / 100_000_000).toFixed(0)}억을 적용했습니다 (2025.6 가계부채 대책 기준).`,
    );
  }

  /* 4) 최종 한도 */
  const candidates: Array<{ v: number; f: LoanLimitResult['bindingFactor'] }> = [
    { v: ltvLimit, f: 'LTV' },
  ];
  if (dsrLimit !== null) candidates.push({ v: dsrLimit, f: 'DSR' });
  if (policyCap !== null) candidates.push({ v: policyCap, f: '정책한도' });

  const binding = candidates.reduce((min, c) => (c.v < min.v ? c : min));
  const limit = Math.max(0, binding.v);

  return {
    ltvRate,
    ltvLimit,
    dsrLimit,
    policyCap,
    limit,
    monthlyPayment: Math.round(monthlyPaymentOf(limit, input.rate, termYears)),
    bindingFactor: limit === 0 ? '대출불가' : binding.f,
    notes,
  };
}
