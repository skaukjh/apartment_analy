/**
 * 과열 지표 · 매수심리 (요구사항 6) / 신고가 · 신저가 (요구사항 7)
 *
 * 부동산원 매매수급지수 키가 없어도 국토부 실거래가만으로 다음을 계산한다.
 *  - 거래량 및 전년 동월 대비 증감
 *  - 신고가 거래 비중 (단지·면적대별 과거 최고가 갱신 비율)
 *  - 가격 모멘텀 (3개월 이동 지수 변화율)
 * 이 세 가지를 합성해 0~100 과열 점수를 만든다.
 */

import type {
  MacroSeriesPoint,
  MarketSentiment,
  PeriodDelta,
  PriceExtreme,
  RegionPricePoint,
  TradeRecord,
} from '@/lib/types';
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
    if (t.canceled || t.directDeal || t.price <= 0) continue;
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

/**
 * 최근 거래 중 신고가 비중 (%) — 과열도 산출용.
 * untilDate 를 주면 그 날짜까지만 "최근"으로 본다 (과거 시점의 값을 다시 계산할 때).
 */
export function newHighRatio(
  trades: TradeRecord[],
  cutoffDate: string,
  untilDate?: string,
): number {
  const groups = new Map<string, TradeRecord[]>();
  for (const t of trades) {
    if (t.canceled || t.directDeal) continue;
    if (untilDate && t.dealDate > untilDate) continue;
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
  /**
   * 부동산원 매매수급지수 원본 시계열 (주간).
   * 전월·전분기 대비를 같은 출처로 계산하기 위해 받는다 — 최신값만 부동산원,
   * 과거값은 대리지표로 섞으면 비교 자체가 거짓말이 된다.
   */
  supplyDemandSeries?: MacroSeriesPoint[];
  /** 부동산원 주간 매매가격지수 변동률 (%) */
  weeklyPriceChange?: number;
  asOf: string;
}

/** 한 시점의 과열 지표 구성값 — 현재·전월·전분기를 같은 산식으로 만든다 */
interface SentimentCore {
  monthlyVolume: number;
  volumeYoy: number;
  priceMomentum: number;
  newHighRatio: number;
  supplyDemandIndex: number;
  /** 매매수급지수가 부동산원 원본인지(true) 실거래 대리지표인지(false) */
  supplyDemandFromReb: boolean;
  heatScore: number;
  scores: { sd: number; high: number; vol: number; mom: number };
}

/**
 * monthsBack 개월 전 시점의 과열 지표를 계산한다 (0 = 현재).
 *
 * 최신값과 과거값을 반드시 같은 함수로 만들어야 "전월 대비 +3점" 같은 문장이 성립한다.
 * 시계열이 짧거나 그 시점의 수급지수 출처가 달라지면 null 을 돌려 비교를 포기한다.
 */
function coreAt(input: SentimentInput, monthsBack: number): SentimentCore | null {
  const monthly = [...input.monthly].sort((a, b) => a.month.localeCompare(b.month));
  // 당월은 신고 지연으로 과소집계되므로 직전월을 최신으로 본다
  const latestIdx = monthly.length - 2 - monthsBack;
  if (latestIdx < 0) return null;

  const latest = monthly[latestIdx];
  const asOf = shiftIsoMonths(input.asOf, -monthsBack);
  const monthlyVolume = latest.count;

  const [ly, lm] = latest.month.split('-').map(Number);
  const yearAgo = monthly.find((m) => m.month === `${ly - 1}-${String(lm).padStart(2, '0')}`);
  const volumeYoy =
    yearAgo && yearAgo.count > 0 ? ((monthlyVolume - yearAgo.count) / yearAgo.count) * 100 : 0;

  const priceNow = latest.pricePerM2;
  const price3mAgo = monthly[latestIdx - 3]?.pricePerM2 ?? priceNow;
  const priceMomentum = price3mAgo > 0 ? ((priceNow - price3mAgo) / price3mAgo) * 100 : 0;

  const highRatio = newHighRatio(input.trades, cutoffMonthsAgo(asOf, 3), asOf);

  /* 매매수급지수 — 부동산원 값을 쓰는 시점과 대리지표를 쓰는 시점이 섞이면
     "전월 대비"가 출처 차이를 변화로 둔갑시킨다. 그래서 출처가 다르면 null 이다. */
  let supplyDemandIndex: number;
  let supplyDemandFromReb = false;
  if (input.supplyDemandIndex !== undefined) {
    supplyDemandFromReb = true;
    if (monthsBack === 0) {
      supplyDemandIndex = input.supplyDemandIndex;
    } else {
      const past = valueAtOrBefore(input.supplyDemandSeries, asOf);
      if (past === undefined) return null;
      supplyDemandIndex = past;
    }
  } else {
    // 실거래 기반 대리지표: 기준 90 + 거래량 증감 + 신고가 비중 반영
    supplyDemandIndex = clamp(90 + volumeYoy * 0.15 + highRatio * 0.35, 60, 130);
  }

  /*
   * 과열 점수 (0~100) 합성
   *  - 매매수급지수 40%: 85 → 0점, 115 → 100점
   *  - 신고가 비중 30%: 0% → 0점, 30% → 100점
   *  - 거래량 YoY 20%: -50% → 0점, +80% → 100점
   *  - 가격 모멘텀 10%: -5% → 0점, +8% → 100점
   */
  const sd = clamp(((supplyDemandIndex - 85) / 30) * 100, 0, 100);
  const high = clamp((highRatio / 30) * 100, 0, 100);
  const vol = clamp(((volumeYoy + 50) / 130) * 100, 0, 100);
  const mom = clamp(((priceMomentum + 5) / 13) * 100, 0, 100);

  return {
    monthlyVolume,
    volumeYoy,
    priceMomentum,
    newHighRatio: highRatio,
    supplyDemandIndex,
    supplyDemandFromReb,
    heatScore: Math.round(sd * 0.4 + high * 0.3 + vol * 0.2 + mom * 0.1),
    scores: { sd, high, vol, mom },
  };
}

/** 현재값 − 과거값. pointDiff 면 값 차이(점·%p), 아니면 변동률(%) */
function deltaOf(now: number, prev: number | undefined, pointDiff: boolean): number | undefined {
  if (prev === undefined || !Number.isFinite(prev)) return undefined;
  if (pointDiff) return Math.round((now - prev) * 100) / 100;
  if (prev === 0) return undefined;
  return Math.round(((now - prev) / Math.abs(prev)) * 10000) / 100;
}

function buildDelta(
  now: number,
  month: number | undefined,
  quarter: number | undefined,
  pointDiff: boolean,
): PeriodDelta {
  return {
    mom: deltaOf(now, month, pointDiff),
    qoq: deltaOf(now, quarter, pointDiff),
    pointDiff,
  };
}

export function computeSentiment(input: SentimentInput): MarketSentiment {
  const notes: string[] = [];

  const now = coreAt(input, 0);
  const monthAgo = coreAt(input, 1);
  const quarterAgo = coreAt(input, 3);

  if (!now) {
    // 시계열이 아예 없을 때도 화면이 깨지지 않도록 0으로 채운다
    return {
      supplyDemandIndex: 0,
      supplyDemandChange: 0,
      weeklyPriceChange: input.weeklyPriceChange ?? 0,
      monthlyVolume: 0,
      volumeYoy: 0,
      newHighRatio: 0,
      heatScore: 0,
      heatLevel: 'neutral',
      asOf: input.asOf,
      notes: ['실거래 월별 집계가 없어 과열 지표를 계산하지 못했습니다.'],
    };
  }

  const supplyDemandChange =
    input.supplyDemandIndex !== undefined && input.supplyDemandPrev !== undefined
      ? input.supplyDemandIndex - input.supplyDemandPrev
      : 0;

  notes.push(
    now.supplyDemandFromReb
      ? '매매수급지수는 한국부동산원 주간 통계를 사용했습니다.'
      : '⚠️ 부동산원 매매수급지수 키가 없어 실거래 거래량·신고가 비중으로 추정한 대리지표입니다.',
  );

  const weeklyPriceChange = input.weeklyPriceChange ?? now.priceMomentum / 12;

  const heatLevel: MarketSentiment['heatLevel'] =
    now.heatScore >= 75
      ? 'overheated'
      : now.heatScore >= 58
        ? 'warming'
        : now.heatScore >= 42
          ? 'neutral'
          : now.heatScore >= 25
            ? 'cooling'
            : 'cold';

  notes.push(
    `구성: 수급 ${now.scores.sd.toFixed(0)}점(40%) · 신고가 ${now.scores.high.toFixed(0)}점(30%) · 거래량 ${now.scores.vol.toFixed(0)}점(20%) · 모멘텀 ${now.scores.mom.toFixed(0)}점(10%)`,
  );
  if (now.monthlyVolume < 100) {
    notes.push('⚠️ 최근월 거래 표본이 적어 지표 신뢰도가 낮습니다.');
  }
  if (monthAgo || quarterAgo) {
    notes.push(
      '전월·전분기 대비는 같은 산식을 그 시점에 다시 돌려 만든 값입니다 (과열 점수·수급·신고가는 차이, 거래량은 변동률).',
    );
  } else {
    notes.push('⚠️ 과거 시계열이 짧아 전월·전분기 대비를 계산하지 못했습니다.');
  }

  return {
    supplyDemandIndex: Math.round(now.supplyDemandIndex * 10) / 10,
    supplyDemandChange: Math.round(supplyDemandChange * 10) / 10,
    weeklyPriceChange: Math.round(weeklyPriceChange * 100) / 100,
    monthlyVolume: now.monthlyVolume,
    volumeYoy: Math.round(now.volumeYoy * 10) / 10,
    newHighRatio: Math.round(now.newHighRatio * 10) / 10,
    heatScore: now.heatScore,
    heatLevel,
    compare: {
      heatScore: buildDelta(now.heatScore, monthAgo?.heatScore, quarterAgo?.heatScore, true),
      supplyDemandIndex: buildDelta(
        now.supplyDemandIndex,
        monthAgo?.supplyDemandIndex,
        quarterAgo?.supplyDemandIndex,
        true,
      ),
      newHighRatio: buildDelta(
        now.newHighRatio,
        monthAgo?.newHighRatio,
        quarterAgo?.newHighRatio,
        true,
      ),
      monthlyVolume: buildDelta(
        now.monthlyVolume,
        monthAgo?.monthlyVolume,
        quarterAgo?.monthlyVolume,
        false,
      ),
    },
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

/** YYYY-MM-DD 를 n개월 이동 */
function shiftIsoMonths(iso: string, deltaMonths: number): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  d.setMonth(d.getMonth() + deltaMonths);
  return d.toISOString().slice(0, 10);
}

/** 오름차순 시계열에서 asOf 이하의 마지막 값 */
function valueAtOrBefore(series: MacroSeriesPoint[] | undefined, asOf: string): number | undefined {
  if (!series || series.length === 0) return undefined;
  let found: number | undefined;
  for (const p of [...series].sort((a, b) => a.period.localeCompare(b.period))) {
    if (p.period <= asOf) found = p.value;
    else break;
  }
  return found;
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
