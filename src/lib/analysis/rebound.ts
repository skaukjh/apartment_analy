/**
 * 상승장 확산 / 미반등 지역 분석 (요구사항 3)
 *
 * 방법:
 *  1) 국토부 실거래가에서 시군구별 월 ㎡당 중앙값을 뽑아 시계열을 만든다.
 *  2) 2023-01을 100으로 정규화한 지수를 계산한다.
 *  3) 노이즈가 큰 월별 거래를 3개월 이동평균으로 평활한다.
 *  4) 저점 대비 반등률 / 기준시점 대비 변동률 / 최근 3개월 모멘텀으로 단계를 나눈다.
 *
 * 실거래 표본이 적은 달은 지수를 왜곡시키므로 최소 거래건수 필터를 둔다.
 */

import type { RegionPricePoint, ReboundAnalysis } from '@/lib/types';
import { findSigungu, regionLabel } from '@/lib/regions';

/** 반등 분석 기준 시점 */
export const BASE_MONTH = '2023-01';

/** 지수 계산에 포함할 월 최소 거래 건수 */
const MIN_MONTHLY_TRADES = 5;

/** 3개월 이동평균 평활 */
function medianOf(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * 이동 3개월 "중앙값" 평활.
 *
 * 처음엔 거래량 가중평균을 썼는데, 신축 대단지 입주로 한 달에 494건이
 * 몰린 달(중랑 2026-07)이 창 전체를 지배해 +36%짜리 허수 상승률을 만들었다.
 * 달별 중앙값들의 중앙값은 스파이크 한 달이 끼어도 흔들리지 않는다.
 * (신축 입주로 거래 구성 자체가 바뀌는 소도시의 편향은 이걸로도 못 없앤다 —
 *  그런 지역은 thinSample 로 표시해 순위에서 걸러 읽게 한다)
 */
function smooth(series: RegionPricePoint[], window = 3): RegionPricePoint[] {
  return series.map((p, i) => {
    const slice = series.slice(Math.max(0, i - window + 1), i + 1);
    return { ...p, pricePerM2: Math.round(medianOf(slice.map((x) => x.pricePerM2))) };
  });
}

export interface ReboundOptions {
  /** 기준 시점 (YYYY-MM) */
  baseMonth?: string;
  /** 종료 시점 (YYYY-MM). 지정하면 그 달까지만 보고 비교한다 */
  endMonth?: string;
  /** 최소 월 거래건수 */
  minTrades?: number;
}

export function analyzeRebound(
  lawdCd: string,
  rawSeries: RegionPricePoint[],
  options: ReboundOptions = {},
): ReboundAnalysis {
  const baseMonth = options.baseMonth || BASE_MONTH;
  const minTrades = options.minTrades ?? MIN_MONTHLY_TRADES;
  const region = findSigungu(lawdCd);

  const endMonth = options.endMonth;
  const filtered = rawSeries
    .filter(
      (p) => p.count >= minTrades && p.month >= baseMonth && (!endMonth || p.month <= endMonth),
    )
    .sort((a, b) => a.month.localeCompare(b.month));

  const empty: ReboundAnalysis = {
    lawdCd,
    regionName: regionLabel(lawdCd),
    sido: region?.sidoShort ?? '',
    indexNow: 100,
    indexTrough: 100,
    reboundFromTrough: 0,
    changeSinceBase: 0,
    recent3mChange: 0,
    recent1mChange: 0,
    stage: 'insufficient-data',
    sampleSize: rawSeries.reduce((s, p) => s + p.count, 0),
    series: [],
    baseMonth,
    latestMonth: rawSeries[rawSeries.length - 1]?.month ?? baseMonth,
    baseShifted: false,
    thinSample: true,
    volatileMix: false,
  };

  if (filtered.length < 6) return empty;

  const smoothed = smooth(filtered);

  /*
   * 기준값은 기준월 한 달이 아니라 기준월부터 3개월의 거래량 가중평균으로 잡는다.
   * 한 달치 중앙값은 그 달에 어떤 단지가 거래됐는지에 따라 쉽게 흔들리고,
   * 기준월에 거래가 적은 지역은 지수 전체가 왜곡되기 때문이다.
   */
  const baseWindow = filtered.slice(0, 3);
  const basePrice = medianOf(baseWindow.map((p) => p.pricePerM2));

  if (!basePrice) return empty;

  // 기준 구간이 요청한 기준월보다 늦게 시작하면 비교가 왜곡되므로 알려준다
  const actualBaseMonth = smoothed[0].month;
  const latestMonth = smoothed[smoothed.length - 1].month;

  const indexed = smoothed.map((p) => ({
    ...p,
    pricePerM2: Math.round((p.pricePerM2 / basePrice) * 1000) / 10, // 지수 (base=100)
  }));

  const values = indexed.map((p) => p.pricePerM2);
  const indexNow = values[values.length - 1];
  const indexTrough = Math.min(...values);
  const troughIdx = values.indexOf(indexTrough);

  const reboundFromTrough = ((indexNow - indexTrough) / indexTrough) * 100;
  const changeSinceBase = indexNow - 100;

  const idx3mAgo = values[Math.max(0, values.length - 4)];
  const recent3mChange = ((indexNow - idx3mAgo) / idx3mAgo) * 100;

  /* 전월 대비 — 분기 모멘텀만 보면 최근 한 달의 방향 전환(꺾임)이 묻힌다.
     3개월 이동 중앙값으로 평활한 지수라 한 달치도 단발 거래에 덜 흔들린다. */
  const idx1mAgo = values[Math.max(0, values.length - 2)];
  const recent1mChange = ((indexNow - idx1mAgo) / idx1mAgo) * 100;

  const thinSample = medianOf(filtered.map((p) => p.count)) < 30;

  /* 월별 중앙값 단가의 전월 대비 변동률(절대값) 중앙값이 8% 이상이면 "구성 편향" 지역.
     종로처럼 고가 단지(경희궁자이 등)가 거래된 달과 아닌 달의 단가가 널뛰는 곳은
     지수 등락이 실제 시세보다 과장돼 보인다 — 평활로도 다 못 잡아 표시로 알린다. */
  const monthlyMoves = filtered
    .slice(1)
    .map((p, i) => Math.abs(p.pricePerM2 / filtered[i].pricePerM2 - 1) * 100);
  const volatileMix = monthlyMoves.length >= 6 && medianOf(monthlyMoves) >= 8;

  // 저점 이후 경과 개월 — 최근에 저점을 찍었다면 아직 반등 초입
  const monthsSinceTrough = values.length - 1 - troughIdx;

  let stage: ReboundAnalysis['stage'];
  if (changeSinceBase >= 10 && recent3mChange > 0.5) {
    stage = 'leading'; // 선도: 기준 대비 크게 올랐고 아직 상승 중
  } else if (reboundFromTrough >= 5 && recent3mChange > 0) {
    stage = 'spreading'; // 확산: 저점 탈출 후 상승 전환
  } else if (reboundFromTrough >= 2 || (monthsSinceTrough >= 3 && recent3mChange > -0.5)) {
    stage = 'lagging'; // 후행: 바닥은 다졌으나 아직 미미
  } else {
    stage = 'no-rebound'; // 미반등: 2023년 초 이후 저점 근처에 머무름
  }

  return {
    lawdCd,
    regionName: regionLabel(lawdCd),
    sido: region?.sidoShort ?? '',
    indexNow: Math.round(indexNow * 10) / 10,
    indexTrough: Math.round(indexTrough * 10) / 10,
    reboundFromTrough: Math.round(reboundFromTrough * 10) / 10,
    changeSinceBase: Math.round(changeSinceBase * 10) / 10,
    recent3mChange: Math.round(recent3mChange * 100) / 100,
    recent1mChange: Math.round(recent1mChange * 100) / 100,
    stage,
    thinSample,
    volatileMix,
    sampleSize: filtered.reduce((s, p) => s + p.count, 0),
    series: indexed,
    baseMonth: actualBaseMonth,
    latestMonth,
    baseShifted: actualBaseMonth !== baseMonth,
  };
}

export const STAGE_META: Record<
  ReboundAnalysis['stage'],
  { label: string; description: string; color: string; order: number }
> = {
  leading: {
    label: '선도',
    description: '2023년 초 대비 +10% 이상, 지금도 상승 중. 상승장 진원지',
    color: '#dc2626',
    order: 0,
  },
  spreading: {
    label: '확산',
    description: '저점 대비 5% 이상 반등하며 상승 전환. 물결이 도달한 지역',
    color: '#f59e0b',
    order: 1,
  },
  lagging: {
    label: '후행',
    description: '바닥은 다졌으나 반등은 미미. 물결이 곧 닿을 가능성',
    color: '#3b82f6',
    order: 2,
  },
  'no-rebound': {
    label: '미반등',
    description: '2023년 초 이후 저점 근처. 상승 물결이 아직 도달하지 않음',
    color: '#64748b',
    order: 3,
  },
  'insufficient-data': {
    label: '표본부족',
    description: '월 거래량이 적어 지수 산출 불가',
    color: '#e2e8f0',
    order: 4,
  },
};

/** 확산 요약 — 브리핑 문장 생성에 사용 */
export interface SpreadSummary {
  total: number;
  leading: ReboundAnalysis[];
  spreading: ReboundAnalysis[];
  lagging: ReboundAnalysis[];
  noRebound: ReboundAnalysis[];
  /** 반등 확산률 (%) = (선도+확산) / 분석가능 지역 */
  spreadRate: number;
  /** 최근 3개월 모멘텀 상위 */
  topMomentum: ReboundAnalysis[];
  /** 2023년 초부터 전혀 반등하지 않은 지역 */
  neverRebounded: ReboundAnalysis[];
  /** 미반등이었다가 최근 상승 전환에 성공한 지역 */
  recentlyRecovered: ReboundAnalysis[];
}

export function summarizeSpread(analyses: ReboundAnalysis[]): SpreadSummary {
  const valid = analyses.filter((a) => a.stage !== 'insufficient-data');
  const leading = valid.filter((a) => a.stage === 'leading');
  const spreading = valid.filter((a) => a.stage === 'spreading');
  const lagging = valid.filter((a) => a.stage === 'lagging');
  const noRebound = valid.filter((a) => a.stage === 'no-rebound');

  return {
    total: valid.length,
    leading: [...leading].sort((a, b) => b.changeSinceBase - a.changeSinceBase),
    spreading: [...spreading].sort((a, b) => b.reboundFromTrough - a.reboundFromTrough),
    lagging: [...lagging].sort((a, b) => b.recent3mChange - a.recent3mChange),
    noRebound: [...noRebound].sort((a, b) => a.changeSinceBase - b.changeSinceBase),
    spreadRate: valid.length > 0 ? ((leading.length + spreading.length) / valid.length) * 100 : 0,
    topMomentum: [...valid].sort((a, b) => b.recent3mChange - a.recent3mChange).slice(0, 8),
    // 기준 대비 여전히 마이너스이고 저점 대비 반등도 2% 미만
    neverRebounded: valid
      .filter((a) => a.changeSinceBase < 0 && a.reboundFromTrough < 2)
      .sort((a, b) => a.changeSinceBase - b.changeSinceBase),
    // 기준 대비는 아직 마이너스지만 저점을 확실히 벗어나 오르는 중 — "반등 성공" 후보
    recentlyRecovered: valid
      .filter((a) => a.changeSinceBase < 0 && a.reboundFromTrough >= 2 && a.recent3mChange > 0)
      .sort((a, b) => b.recent3mChange - a.recent3mChange),
  };
}
