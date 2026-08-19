/**
 * 과열 지표 · 매수심리 (요구사항 6) / 신고가 · 신저가 (요구사항 7)
 *
 * 부동산원 매매수급지수 키가 없어도 국토부 실거래가만으로 다음을 계산한다.
 *  - 거래량 및 전년 동월 대비 증감
 *  - 신고가 거래 비중 (단지·면적대별 과거 최고가 갱신 비율)
 *  - 가격 모멘텀 (3개월 이동 지수 변화율)
 * 이 세 가지를 합성해 0~100 과열 점수를 만든다.
 */

import type { MarketSentiment, PriceExtreme, RegionPricePoint, TradeRecord } from '@/lib/types';
import { clamp, median } from '@/lib/format';

/* ------------------------------------------------------------------ */
/* 신고가 / 신저가                                                      */
/* ------------------------------------------------------------------ */

/** 단지 + 면적대(5㎡ 버킷)를 하나의 비교 단위로 본다 */
function unitKey(t: TradeRecord): string {
  const bucket = Math.round(t.areaM2 / 5) * 5;
  return `${t.sigungu}|${t.complexName}|${bucket}`;
}

export interface ExtremeOptions {
  /** 신고가/신저가로 판정할 최근 기간 (개월) */
  recentMonths?: number;
  /** 비교 대상이 되기 위한 최소 과거 거래 건수 */
  minHistory?: number;
  /** 최대 반환 건수 */
  limit?: number;
}

/**
 * 최근 거래 중 과거 전체 이력의 최고가/최저가를 갱신한 건을 찾는다.
 * @param trades 분석 대상 전체 거래 (기간 전체)
 * @param cutoffDate 이 날짜 이후 거래를 "최근"으로 본다 (YYYY-MM-DD)
 */
export function findPriceExtremes(
  trades: TradeRecord[],
  cutoffDate: string,
  options: ExtremeOptions = {},
): PriceExtreme[] {
  const minHistory = options.minHistory ?? 3;
  const limit = options.limit ?? 30;

  const groups = new Map<string, TradeRecord[]>();
  for (const t of trades) {
    if (t.canceled || t.price <= 0) continue;
    const key = unitKey(t);
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(t);
  }

  const results: PriceExtreme[] = [];

  for (const list of groups.values()) {
    const sorted = [...list].sort((a, b) => a.dealDate.localeCompare(b.dealDate));
    const history = sorted.filter((t) => t.dealDate < cutoffDate);
    const recent = sorted.filter((t) => t.dealDate >= cutoffDate);
    if (history.length < minHistory || recent.length === 0) continue;

    const prevHigh = Math.max(...history.map((t) => t.price));
    const prevLow = Math.min(...history.map((t) => t.price));

    const topRecent = recent.reduce((a, b) => (b.price > a.price ? b : a));
    const bottomRecent = recent.reduce((a, b) => (b.price < a.price ? b : a));

    if (topRecent.price > prevHigh) {
      results.push({
        complexName: topRecent.complexName,
        sigungu: topRecent.sigungu,
        dong: topRecent.dong,
        areaM2: topRecent.areaM2,
        floor: topRecent.floor,
        price: topRecent.price,
        dealDate: topRecent.dealDate,
        gap: topRecent.price - prevHigh,
        gapRate: ((topRecent.price - prevHigh) / prevHigh) * 100,
        type: 'new-high',
      });
    }

    if (bottomRecent.price < prevLow) {
      results.push({
        complexName: bottomRecent.complexName,
        sigungu: bottomRecent.sigungu,
        dong: bottomRecent.dong,
        areaM2: bottomRecent.areaM2,
        floor: bottomRecent.floor,
        price: bottomRecent.price,
        dealDate: bottomRecent.dealDate,
        gap: bottomRecent.price - prevLow,
        gapRate: ((bottomRecent.price - prevLow) / prevLow) * 100,
        type: 'new-low',
      });
    }
  }

  return results
    .sort((a, b) => {
      // 최신순 → 갱신폭 큰 순
      const d = b.dealDate.localeCompare(a.dealDate);
      return d !== 0 ? d : Math.abs(b.gapRate) - Math.abs(a.gapRate);
    })
    .slice(0, limit);
}

/** 최근 거래 중 신고가 비중 (%) — 과열도 산출용 */
export function newHighRatio(trades: TradeRecord[], cutoffDate: string): number {
  const groups = new Map<string, TradeRecord[]>();
  for (const t of trades) {
    if (t.canceled) continue;
    const key = unitKey(t);
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(t);
  }

  let recentTotal = 0;
  let highs = 0;

  for (const list of groups.values()) {
    const history = list.filter((t) => t.dealDate < cutoffDate);
    const recent = list.filter((t) => t.dealDate >= cutoffDate);
    if (history.length < 2 || recent.length === 0) continue;
    const prevHigh = Math.max(...history.map((t) => t.price));
    recentTotal += recent.length;
    highs += recent.filter((t) => t.price > prevHigh).length;
  }

  return recentTotal > 0 ? (highs / recentTotal) * 100 : 0;
}

/* ------------------------------------------------------------------ */
/* 과열 지표 / 매수심리                                                  */
/* ------------------------------------------------------------------ */

export interface SentimentInput {
  /** 분석 대상 전체 거래 */
  trades: TradeRecord[];
  /** 월별 집계 시계열 (전체 대상 지역 통합) */
  monthly: RegionPricePoint[];
  /** 부동산원 매매수급지수 (있으면 사용) */
  supplyDemandIndex?: number;
  supplyDemandPrev?: number;
  /** 부동산원 주간 매매가격지수 변동률 (%) */
  weeklyPriceChange?: number;
  asOf: string;
}

export function computeSentiment(input: SentimentInput): MarketSentiment {
  const notes: string[] = [];
  const monthly = [...input.monthly].sort((a, b) => a.month.localeCompare(b.month));

  // 최근 완료월(당월은 신고 지연으로 과소집계되므로 직전월 사용)
  const latest = monthly[monthly.length - 2] ?? monthly[monthly.length - 1];
  const monthlyVolume = latest?.count ?? 0;

  const yearAgo = monthly.find((m) => {
    if (!latest) return false;
    const [y, mo] = latest.month.split('-').map(Number);
    return m.month === `${y - 1}-${String(mo).padStart(2, '0')}`;
  });
  const volumeYoy =
    yearAgo && yearAgo.count > 0 ? ((monthlyVolume - yearAgo.count) / yearAgo.count) * 100 : 0;

  // 가격 모멘텀: 최근 3개월 ㎡당 중앙값 변화율
  const priceNow = latest?.pricePerM2 ?? 0;
  const price3mAgo = monthly[monthly.length - 5]?.pricePerM2 ?? priceNow;
  const priceMomentum = price3mAgo > 0 ? ((priceNow - price3mAgo) / price3mAgo) * 100 : 0;

  // 신고가 비중 — 최근 3개월
  const cutoff = cutoffMonthsAgo(input.asOf, 3);
  const highRatio = newHighRatio(input.trades, cutoff);

  // 매매수급지수: 부동산원 값이 없으면 거래량 + 신고가 비중으로 대리 추정
  let supplyDemandIndex = input.supplyDemandIndex ?? 0;
  let supplyDemandChange = 0;
  if (input.supplyDemandIndex !== undefined) {
    supplyDemandChange =
      input.supplyDemandPrev !== undefined ? input.supplyDemandIndex - input.supplyDemandPrev : 0;
    notes.push('매매수급지수는 한국부동산원 주간 통계를 사용했습니다.');
  } else {
    // 실거래 기반 대리지표: 기준 90 + 거래량 증감 + 신고가 비중 반영
    supplyDemandIndex = clamp(90 + volumeYoy * 0.15 + highRatio * 0.35, 60, 130);
    notes.push(
      '⚠️ 부동산원 매매수급지수 키가 없어 실거래 거래량·신고가 비중으로 추정한 대리지표입니다.',
    );
  }

  const weeklyPriceChange = input.weeklyPriceChange ?? priceMomentum / 12;

  /*
   * 과열 점수 (0~100) 합성
   *  - 매매수급지수 40%: 85 → 0점, 115 → 100점
   *  - 신고가 비중 30%: 0% → 0점, 30% → 100점
   *  - 거래량 YoY 20%: -50% → 0점, +80% → 100점
   *  - 가격 모멘텀 10%: -5% → 0점, +8% → 100점
   */
  const sdScore = clamp(((supplyDemandIndex - 85) / 30) * 100, 0, 100);
  const highScore = clamp((highRatio / 30) * 100, 0, 100);
  const volScore = clamp(((volumeYoy + 50) / 130) * 100, 0, 100);
  const momScore = clamp(((priceMomentum + 5) / 13) * 100, 0, 100);

  const heatScore = Math.round(sdScore * 0.4 + highScore * 0.3 + volScore * 0.2 + momScore * 0.1);

  const heatLevel: MarketSentiment['heatLevel'] =
    heatScore >= 75
      ? 'overheated'
      : heatScore >= 58
        ? 'warming'
        : heatScore >= 42
          ? 'neutral'
          : heatScore >= 25
            ? 'cooling'
            : 'cold';

  notes.push(
    `구성: 수급 ${sdScore.toFixed(0)}점(40%) · 신고가 ${highScore.toFixed(0)}점(30%) · 거래량 ${volScore.toFixed(0)}점(20%) · 모멘텀 ${momScore.toFixed(0)}점(10%)`,
  );
  if (monthlyVolume < 100) {
    notes.push('⚠️ 최근월 거래 표본이 적어 지표 신뢰도가 낮습니다.');
  }

  return {
    supplyDemandIndex: Math.round(supplyDemandIndex * 10) / 10,
    supplyDemandChange: Math.round(supplyDemandChange * 10) / 10,
    weeklyPriceChange: Math.round(weeklyPriceChange * 100) / 100,
    monthlyVolume,
    volumeYoy: Math.round(volumeYoy * 10) / 10,
    newHighRatio: Math.round(highRatio * 10) / 10,
    heatScore,
    heatLevel,
    asOf: input.asOf,
    notes,
  };
}

export const HEAT_META: Record<
  MarketSentiment['heatLevel'],
  { label: string; color: string; advice: string }
> = {
  cold: {
    label: '침체',
    color: '#2563eb',
    advice: '거래 절벽 구간. 매수자 우위지만 매도 자체가 어려워 갈아타기 실행 난이도가 높습니다.',
  },
  cooling: {
    label: '관망',
    color: '#0ea5e9',
    advice: '심리 위축 구간. 급매 위주 시장이라 상급지 급매를 노릴 만한 시기입니다.',
  },
  neutral: {
    label: '중립',
    color: '#64748b',
    advice: '방향성 탐색 구간. 지역별 차별화가 커지므로 개별 단지 단위로 봐야 합니다.',
  },
  warming: {
    label: '회복',
    color: '#f59e0b',
    advice:
      '매수세 유입 구간. 상급지부터 갭이 벌어지기 시작하니 갈아타기는 서두르는 편이 유리합니다.',
  },
  overheated: {
    label: '과열',
    color: '#dc2626',
    advice: '신고가 속출 구간. 추격 매수 위험이 크고 규제 강화 가능성을 함께 봐야 합니다.',
  },
};

function cutoffMonthsAgo(asOf: string, months: number): string {
  const d = new Date(asOf);
  d.setMonth(d.getMonth() - months);
  return d.toISOString().slice(0, 10);
}

/** 전체 지역 월별 시계열을 하나로 합산 */
export function mergeMonthlySeries(
  seriesByRegion: Record<string, RegionPricePoint[]>,
): RegionPricePoint[] {
  const buckets = new Map<string, { prices: number[]; count: number }>();

  for (const series of Object.values(seriesByRegion)) {
    for (const p of series) {
      const b = buckets.get(p.month) ?? { prices: [], count: 0 };
      // 거래건수만큼 가중치를 주기 위해 대표값을 반복 삽입하는 대신 가중평균용으로 저장
      b.prices.push(p.pricePerM2);
      b.count += p.count;
      buckets.set(p.month, b);
    }
  }

  return [...buckets.entries()]
    .map(([month, b]) => ({
      month,
      pricePerM2: Math.round(median(b.prices)),
      count: b.count,
    }))
    .sort((a, b) => a.month.localeCompare(b.month));
}
