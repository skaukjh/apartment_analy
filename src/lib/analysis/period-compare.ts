/**
 * 지표의 "직전 월 / 직전 분기 대비" 를 한 곳에서 만든다.
 *
 * 화면마다 따로 계산하면 같은 지표가 페이지마다 다른 값으로 보이는 사고가 난다
 * (갭 변화가 화면별로 어긋났던 이력이 있어 산식을 여기 못박는다).
 *
 * 단위 규칙 — 값 자체가 %인 지표(금리·비중)는 %p 차이로, 그 외(지수·금액·건수)는
 * 변동률(%)로 준다. 기준금리 2.50 → 2.75 를 "+10%" 로 적으면 오해를 부르기 때문이다.
 */

import type { MacroSeriesPoint, PeriodDelta } from '@/lib/types';
import { median } from '@/lib/format';

/** 'YYYY-MM' 또는 'YYYY-MM-DD' 를 n개월 이동. 일자는 그대로 둔다 (비교 상한선으로만 쓰므로 말일 넘침은 무해) */
export function shiftPeriod(period: string, deltaMonths: number): string {
  const y = Number(period.slice(0, 4));
  const m = Number(period.slice(5, 7));
  if (!Number.isFinite(y) || !Number.isFinite(m)) return period;
  const total = y * 12 + (m - 1) + deltaMonths;
  const head = `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
  return period.length > 7 ? `${head}${period.slice(7)}` : head;
}

/** 오름차순 시계열에서 targetPeriod 이하의 가장 늦은 점 */
function pointAtOrBefore(
  sorted: MacroSeriesPoint[],
  targetPeriod: string,
): MacroSeriesPoint | undefined {
  let found: MacroSeriesPoint | undefined;
  for (const p of sorted) {
    if (p.period <= targetPeriod) found = p;
    else break;
  }
  return found;
}

export interface CompareOptions {
  /** 값 자체가 %인 지표 — 차이를 %p 로 준다 */
  pointDiff?: boolean;
  /** 최신 점을 직접 지정 (당월 미확정 등으로 마지막 점을 안 쓸 때) */
  latest?: MacroSeriesPoint;
}

/**
 * 시계열에서 전월·전분기 대비를 뽑는다.
 * 해당 월에 점이 없으면 그보다 앞선 가장 가까운 점을 쓰고, 실제 기준 시점을 함께 돌려준다.
 */
export function comparePeriods(
  series: MacroSeriesPoint[],
  options: CompareOptions = {},
): PeriodDelta {
  const sorted = [...series]
    .filter((p) => Number.isFinite(p.value))
    .sort((a, b) => a.period.localeCompare(b.period));
  const latest = options.latest ?? sorted[sorted.length - 1];
  if (!latest) return {};

  const pointDiff = options.pointDiff ?? false;
  const earlier = sorted.filter((p) => p.period < latest.period);

  const diff = (base: MacroSeriesPoint | undefined): number | undefined => {
    if (!base) return undefined;
    if (pointDiff) return Math.round((latest.value - base.value) * 100) / 100;
    if (base.value === 0) return undefined;
    return Math.round(((latest.value - base.value) / Math.abs(base.value)) * 10000) / 100;
  };

  const momBase = pointAtOrBefore(earlier, shiftPeriod(latest.period, -1));
  const qoqBase = pointAtOrBefore(earlier, shiftPeriod(latest.period, -3));

  return {
    mom: diff(momBase),
    qoq: diff(qoqBase),
    momBasePeriod: momBase?.period,
    qoqBasePeriod: qoqBase?.period,
    pointDiff,
  };
}

/** 실거래 목록 → 월별 중앙값 시계열 (YYYY-MM). 단지 시세의 전월·전분기 비교에 쓴다 */
export function monthlyMedianSeries(
  trades: Array<{ dealDate: string; price: number }>,
): MacroSeriesPoint[] {
  const byMonth = new Map<string, number[]>();
  for (const t of trades) {
    if (!t.dealDate || !(t.price > 0)) continue;
    const month = t.dealDate.slice(0, 7);
    (byMonth.get(month) ?? byMonth.set(month, []).get(month)!).push(t.price);
  }
  return [...byMonth.entries()]
    .map(([period, prices]) => ({ period, value: Math.round(median(prices)) }))
    .sort((a, b) => a.period.localeCompare(b.period));
}

/**
 * "전월 +1.2% · 전분기 -0.4%" 처럼 한 줄로 읽히게 하는 라벨 (텍스트 브리핑용).
 * 비교할 게 없으면 빈 문자열 — 호출부가 줄 자체를 빼기 쉽게 한다.
 */
export function compareLabel(
  delta: PeriodDelta | undefined,
  options: { digits?: number; unit?: string } = {},
): string {
  if (!delta) return '';
  const digits = options.digits ?? 1;
  // 값 자체가 %인 지표는 차이가 %p 다. 점수·건수처럼 단위가 다르면 호출부가 지정한다.
  const unit = options.unit ?? (delta.pointDiff ? '%p' : '%');
  const fmt = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(digits)}${unit}`;
  const parts: string[] = [];
  if (delta.mom !== undefined) parts.push(`전월 ${fmt(delta.mom)}`);
  if (delta.qoq !== undefined) parts.push(`전분기 ${fmt(delta.qoq)}`);
  return parts.join(' · ');
}
