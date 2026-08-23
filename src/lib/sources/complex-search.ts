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
import { loadTradeCacheRows, saveTradeCache } from '@/lib/store/market-data';
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

/**
 * 검색에 쓸 최근 개월 수.
 *
 * 12개월로 뒀더니 "평형이 2개만 나온다", "단지가 다 안 보인다"는 문제가 있었다.
 * 거래가 뜸한 평형은 1년 안에 한 건도 없을 수 있기 때문이다.
 * 국토부는 (시군구 × 월) 단위로만 조회되므로 기간을 늘린 만큼 호출도 늘어난다.
 * 24개월이 응답 시간과 누락 사이의 타협점이다.
 */
const DEFAULT_LOOKBACK_MONTHS = 24;
const MAX_LOOKBACK_MONTHS = 60;

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
 * 비교용 이름 키.
 *
 * 국토부에 등록된 이름과 사람들이 부르는 이름이 다르다.
 *  등록: "우성2"      부르는 이름: "자양우성2차"
 *  등록: "자양우성7"  부르는 이름: "자양우성7차"
 * 그래서 '차·아파트·단지' 같은 흔한 꼬리말을 떼고 비교한다.
 */
function nameKey(s: string): string {
  return normalize(s).replace(/차$|아파트|apt|단지/g, '');
}

/**
 * 단지명이 검색어에 걸리는지.
 *
 * 양방향 부분일치를 쓴다. 검색어가 등록명보다 길 수도(자양우성2차 ⊃ 우성2),
 * 짧을 수도(우성 ⊂ 자양우성7) 있기 때문이다.
 * 동 이름으로 검색하면 그 동의 단지를 전부 보여준다 ("자양" → 자양동 전체).
 */
function complexMatches(complexName: string, dong: string, query: string): boolean {
  const q = nameKey(query);
  if (!q) return true;

  const name = nameKey(complexName);
  if (name.includes(q) || q.includes(name)) return true;

  // "자양" 처럼 동 이름으로 찾는 경우
  const d = nameKey(dong).replace(/동$/, '');
  return Boolean(d) && (d.includes(q) || q.includes(d));
}

/**
 * 취득일 인근의 해당 단지·면적 실거래 1건 — 취득가액 자동 채움용.
 *
 * 사용자가 산 그 거래 자체가 국토부 실거래에 신고돼 있으므로,
 * 취득일(잔금일)과 가장 가까운 계약을 찾으면 취득가액을 채울 수 있다.
 * 계약일과 잔금일은 보통 2~3개월 차이가 나므로 창을 앞뒤 6개월로 잡는다.
 */
export async function findTradeNearDate(
  lawdCd: string,
  complexName: string,
  areaM2: number,
  dateIso: string,
  windowMonths = 6,
): Promise<TradeRecord | null> {
  const target = new Date(dateIso);
  if (Number.isNaN(target.getTime()) || !/^\d{5}$/.test(lawdCd) || !complexName) return null;

  // 취득일 기준 앞뒤 windowMonths 개월의 YYYYMM 목록
  const months: string[] = [];
  for (let off = -windowMonths; off <= windowMonths; off += 1) {
    const d = new Date(target.getFullYear(), target.getMonth() + off, 1);
    const ym = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (ym <= `${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, '0')}`) {
      months.push(ym);
    }
  }
  if (months.length === 0) return null;

  const cachedRows = await loadTradeCacheRows(lawdCd, months[0]);
  const cached = new Map(cachedRows.map((r) => [r.month, r]));
  const need = months.filter((ym) => !cached.has(ym));

  let trades: TradeRecord[] = months.flatMap((ym) => cached.get(ym)?.trades ?? []);
  if (need.length > 0) {
    try {
      const byMonth = await fetchTradesForMonths(lawdCd, need);
      trades = trades.concat(Object.values(byMonth).flat());
      await Promise.all(
        Object.entries(byMonth).map(([ym, list]) =>
          saveTradeCache(lawdCd, ym, list).catch(() => {}),
        ),
      );
    } catch {
      // 쿼터 소진 등 — 있는 캐시만으로 찾는다
    }
  }

  const targetMs = target.getTime();
  let best: TradeRecord | null = null;
  let bestGap = Infinity;
  for (const t of trades) {
    if (!complexMatches(t.complexName, t.dong, complexName)) continue;
    if (Math.abs(t.areaM2 - areaM2) > 0.5) continue;
    const gap = Math.abs(new Date(t.dealDate).getTime() - targetMs);
    if (gap < bestGap) {
      bestGap = gap;
      best = t;
    }
  }
  return best;
}

/**
 * 단지의 대표 지번 — 캐시된 실거래에서 최빈값을 고른다. 네트워크 호출 없음.
 * 건축물대장(단지 스펙) 조회의 입력으로 쓴다.
 */
export async function findComplexJibun(
  lawdCd: string,
  complexName: string,
): Promise<{ dong: string; jibun: string } | null> {
  if (!/^\d{5}$/.test(lawdCd) || !complexName) return null;

  const months = recentYearMonths(DEFAULT_LOOKBACK_MONTHS);
  const rows = await loadTradeCacheRows(lawdCd, months[0]).catch(() => []);

  const count = new Map<string, number>();
  for (const row of rows) {
    for (const t of row.trades ?? []) {
      if (!t.jibun || !complexMatches(t.complexName, t.dong, complexName)) continue;
      const k = `${t.dong}|${t.jibun}`;
      count.set(k, (count.get(k) ?? 0) + 1);
    }
  }

  let best: string | null = null;
  let bestN = 0;
  for (const [k, n] of count) {
    if (n > bestN) {
      best = k;
      bestN = n;
    }
  }
  if (!best) return null;
  const [dong, jibun] = best.split('|');
  return { dong, jibun };
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
  limit = 60,
  lookbackMonths = DEFAULT_LOOKBACK_MONTHS,
): Promise<ComplexOption[]> {
  const months = recentYearMonths(
    Math.min(MAX_LOOKBACK_MONTHS, Math.max(1, Math.round(lookbackMonths))),
  );

  /* 캐시는 "지역 전체"가 아니라 **달 단위**로 판단한다.
     크론은 사용자 지역의 최근 2개월만 원본 거래를 캐시하므로, 그걸 보고
     "캐시 있음"으로 처리하면 과거 22개월이 통째로 빠진 채 검색된다 —
     최근 두 달 거래가 없는 단지(자양동 우성2, 마지막 거래 6월)가
     검색에서 영영 안 나오던 원인이다. 빠진 달만 국토부에서 받아 채운다. */
  const cachedRows = await loadTradeCacheRows(lawdCd, months[0]);
  const cached = new Map(cachedRows.map((r) => [r.month, r]));

  /* 신고 기한이 계약 후 30일이라 최근 달의 캐시는 계속 낡는다.
     최근 3개월은 저장한 지 반나절이 지났으면 다시 받는다. */
  const RECENT_STALE_MS = 12 * 60 * 60 * 1000;
  const recentSet = new Set(months.slice(-3));
  const need = new Set(
    months.filter((ym) => {
      const row = cached.get(ym);
      if (!row) return true;
      return recentSet.has(ym) && Date.now() - Date.parse(row.updatedAt) > RECENT_STALE_MS;
    }),
  );

  let trades: TradeRecord[] = months
    .filter((ym) => !need.has(ym))
    .flatMap((ym) => cached.get(ym)?.trades ?? []);

  if (need.size > 0) {
    try {
      const byMonth = await fetchTradesForMonths(lawdCd, [...need]);
      trades = trades.concat(Object.values(byMonth).flat());
      // 거래 0건인 달도 저장한다 — "조회한 적 있음"이 남아야 다음 검색이 또 받지 않는다
      await Promise.all(
        Object.entries(byMonth).map(([ym, list]) =>
          saveTradeCache(lawdCd, ym, list).catch(() => {}),
        ),
      );
    } catch {
      // 쿼터 소진 등으로 못 받으면 있는 캐시만으로 검색한다 (낡아도 없는 것보단 낫다)
      trades = trades.concat([...need].flatMap((ym) => cached.get(ym)?.trades ?? []));
    }
  }

  const region = findSigungu(lawdCd);

  // 단지 + 면적 단위로 모은다. 같은 단지라도 면적이 다르면 시세가 완전히 다르다.
  const groups = new Map<
    string,
    { info: Omit<ComplexOption, 'areas' | 'tradeCount'>; trades: TradeRecord[] }
  >();

  for (const t of trades) {
    // 직거래는 시세 표본에서 제외 — 가족 간 저가 이전이 중앙값·최근가를 왜곡한다
    if (t.directDeal) continue;
    if (!complexMatches(t.complexName, t.dong, query)) continue;
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
