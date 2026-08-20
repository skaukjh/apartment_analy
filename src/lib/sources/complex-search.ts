/**
 * 단지 검색 · 평형별 시세 조회
 *
 * 설정 화면에서 "단지명을 검색하고 평형을 고르면 값이 채워지는" 흐름을 위한 데이터 소스다.
 *
 * ── 호가는 왜 없는가 ──────────────────────────────────────────────
 * 국내에는 호가를 공개하는 공식 API 가 없다. 네이버 부동산 등의 크롤링은
 * 이용약관 위반이라 쓰지 않는다. 그래서 여기서 채워주는 값은 전부
 * **국토교통부 실거래가(실제 체결가)** 기준이며, 호가는 사용자가 직접 입력하거나
 * 실거래가 대비 비율로 추정한다.
 */

import { fetchTradesForMonths } from '@/lib/sources/molit';
import { recentYearMonths } from '@/lib/format';
import { findSigungu } from '@/lib/regions';
import type { TradeRecord } from '@/lib/types';

/** 한 단지의 한 평형 */
export interface AreaOption {
  /** 전용면적 (㎡) */
  areaM2: number;
  /** 대표 시세 (원) — 최근 실거래 중앙값 */
  price: number;
  /** 최근 실거래가 (원) */
  latestPrice: number;
  /** 최근 거래일 (YYYY-MM-DD) */
  latestDealDate: string;
  /** 표본 거래 건수 */
  tradeCount: number;
  /** 최저 ~ 최고 거래가 (원) */
  minPrice: number;
  maxPrice: number;
}

/** 검색 결과 단지 */
export interface ComplexOption {
  complexName: string;
  dong: string;
  sigungu: string;
  lawdCd: string;
  builtYear?: number;
  /** 전용면적 오름차순 */
  areas: AreaOption[];
  /** 단지 전체 거래 건수 */
  tradeCount: number;
}

/** 검색에 쓸 최근 개월 수. 너무 짧으면 거래 없는 평형이 안 잡힌다. */
const LOOKBACK_MONTHS = 12;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? Math.round((sorted[mid - 1] + sorted[mid]) / 2) : sorted[mid];
}

/** 검색어 정규화 — 공백/괄호 차이로 안 잡히는 걸 막는다 */
function normalize(s: string): string {
  return s.replace(/[\s()（）·・.]/g, '').toLowerCase();
}

/**
 * 시군구 안에서 단지명으로 검색한다.
 *
 * @param lawdCd 법정동코드 앞 5자리
 * @param query  단지명 일부 (비우면 거래 많은 순 전체)
 * @param limit  최대 단지 수
 */
export async function searchComplexes(
  lawdCd: string,
  query: string,
  limit = 20,
): Promise<ComplexOption[]> {
  const months = recentYearMonths(LOOKBACK_MONTHS);
  const byMonth = await fetchTradesForMonths(lawdCd, months);
  const trades = Object.values(byMonth).flat();

  const region = findSigungu(lawdCd);
  const needle = normalize(query);

  // 단지 + 면적 단위로 모은다. 같은 단지라도 면적이 다르면 시세가 완전히 다르다.
  const groups = new Map<
    string,
    { info: Omit<ComplexOption, 'areas' | 'tradeCount'>; trades: TradeRecord[] }
  >();

  for (const t of trades) {
    if (needle && !normalize(t.complexName).includes(needle)) continue;
    const key = `${t.complexName}|${t.dong}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        info: {
          complexName: t.complexName,
          dong: t.dong,
          sigungu: t.sigungu || region?.name || '',
          lawdCd,
          builtYear: t.builtYear,
        },
        trades: [],
      };
      groups.set(key, g);
    }
    g.trades.push(t);
  }

  const results: ComplexOption[] = [];

  for (const { info, trades: list } of groups.values()) {
    // 면적은 소수점이 미세하게 다른 경우가 있어 0.1㎡ 단위로 반올림해 묶는다
    const byArea = new Map<number, TradeRecord[]>();
    for (const t of list) {
      const rounded = Math.round(t.areaM2 * 10) / 10;
      const arr = byArea.get(rounded) ?? [];
      arr.push(t);
      byArea.set(rounded, arr);
    }

    const areas: AreaOption[] = [...byArea.entries()]
      .map(([areaM2, ts]) => {
        const sorted = [...ts].sort((a, b) => b.dealDate.localeCompare(a.dealDate));
        const prices = ts.map((t) => t.price);
        return {
          areaM2,
          price: median(prices),
          latestPrice: sorted[0].price,
          latestDealDate: sorted[0].dealDate,
          tradeCount: ts.length,
          minPrice: Math.min(...prices),
          maxPrice: Math.max(...prices),
        };
      })
      .sort((a, b) => a.areaM2 - b.areaM2);

    results.push({ ...info, areas, tradeCount: list.length });
  }

  // 거래가 많은 단지가 대개 사용자가 찾는 단지다
  return results.sort((a, b) => b.tradeCount - a.tradeCount).slice(0, limit);
}
