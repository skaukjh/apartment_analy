/**
 * 시중은행 주택담보대출 금리 — 금융감독원 「금융상품 통합비교공시」 OpenAPI
 *
 * 신청: https://finlife.fss.or.kr/finlife/api/fnprdInfo/list (인증키 무료 발급)
 * 엔드포인트: /finlifeapi/mortgageLoanProductsSearch.json
 *   topFinGrpNo=020000 (은행), pageNo=1
 *
 * 은행별 최저·최고 금리를 그대로 받아 "어느 은행이 지금 가장 싼가"를 보여준다.
 * 공시 금리는 신용도·우대조건 반영 전 값이라 실제 실행 금리와는 차이가 있다.
 */

import { SOURCE_TTL } from '@/lib/refresh-policy';

const BASE = 'https://finlife.fss.or.kr/finlifeapi/mortgageLoanProductsSearch.json';

function apiKey(): string | undefined {
  const v = process.env.FSS_API_KEY?.trim();
  return v && v.length > 0 ? v : undefined;
}

export function hasBankRates(): boolean {
  return Boolean(apiKey());
}

export interface BankRate {
  /** 금융회사명 */
  bank: string;
  /** 상품명 */
  product: string;
  /** 대출 종류 (주택담보대출) */
  loanType: string;
  /** 금리 유형 (고정/변동) */
  rateType: string;
  /** 상환 방식 */
  repayType: string;
  /** 최저 금리 (%) */
  minRate: number;
  /** 최고 금리 (%) */
  maxRate: number;
  /** 전월 취급 평균 금리 (%) */
  avgRate?: number;
  /** 공시 기준 연월 (YYYYMM) */
  disclosureMonth: string;
}

interface BaseListRow {
  fin_co_no: string;
  kor_co_nm: string;
  fin_prdt_cd: string;
  fin_prdt_nm: string;
  dcls_month: string;
  loan_inci_expn?: string;
  erly_rpay_fee?: string;
}

interface OptionRow {
  fin_co_no: string;
  fin_prdt_cd: string;
  mrtg_type_nm: string; // 담보 유형 (아파트 등)
  rpay_type_nm: string; // 상환 방식
  lend_rate_type_nm: string; // 금리 유형 (고정/변동)
  lend_rate_min: string;
  lend_rate_max: string;
  lend_rate_avg?: string;
}

/**
 * 은행 주택담보대출 금리를 최저금리 오름차순으로 반환.
 * 담보 유형이 '아파트'인 옵션만 남긴다.
 */
export async function fetchBankMortgageRates(limit = 12): Promise<BankRate[]> {
  const key = apiKey();
  if (!key) throw new Error('FSS_API_KEY 가 설정되지 않았습니다.');

  const url = `${BASE}?auth=${encodeURIComponent(key)}&topFinGrpNo=020000&pageNo=1`;
  const res = await fetch(url, { next: { revalidate: SOURCE_TTL.ecos } });
  if (!res.ok) throw new Error(`금감원 API HTTP ${res.status}`);

  const json = (await res.json()) as {
    result?: {
      err_cd?: string;
      err_msg?: string;
      baseList?: BaseListRow[];
      optionList?: OptionRow[];
    };
  };

  const result = json.result;
  if (!result || (result.err_cd && result.err_cd !== '000')) {
    throw new Error(`금감원 API 오류: ${result?.err_cd} ${result?.err_msg ?? ''}`);
  }

  const products = new Map(
    (result.baseList ?? []).map((b) => [`${b.fin_co_no}|${b.fin_prdt_cd}`, b]),
  );

  const rates: BankRate[] = [];
  for (const o of result.optionList ?? []) {
    if (!o.mrtg_type_nm?.includes('아파트')) continue;
    const min = Number(o.lend_rate_min);
    const max = Number(o.lend_rate_max);
    if (!Number.isFinite(min) || min <= 0) continue;

    const base = products.get(`${o.fin_co_no}|${o.fin_prdt_cd}`);
    rates.push({
      bank: base?.kor_co_nm ?? '(미상)',
      product: base?.fin_prdt_nm ?? '(미상)',
      loanType: o.mrtg_type_nm,
      rateType: o.lend_rate_type_nm ?? '-',
      repayType: o.rpay_type_nm ?? '-',
      minRate: min,
      maxRate: Number.isFinite(max) ? max : min,
      avgRate: o.lend_rate_avg ? Number(o.lend_rate_avg) : undefined,
      disclosureMonth: base?.dcls_month ?? '',
    });
  }

  return rates.sort((a, b) => a.minRate - b.minRate).slice(0, limit);
}

/** 전체 상품 중 최저 금리 한 건 (대출 계산 기본값으로 사용) */
export function cheapestRate(rates: BankRate[]): BankRate | null {
  return rates.length > 0 ? rates[0] : null;
}
