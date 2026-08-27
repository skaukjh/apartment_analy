/**
 * 목표 아파트 예산 상한 — "넘었으면 알려주고, 평형을 낮출 길을 함께 보여준다"
 *
 * 갈아탈 집을 고를 때 정작 먼저 흔들리는 건 예산이다. 등록할 때는 상한 안이었어도
 * 몇 달 뒤 실거래가 올라 조용히 넘어가 있는다. 숫자는 화면 어딘가에 이미 있지만,
 * 사용자가 매번 상한과 비교해 보지는 않는다.
 *
 * 그래서 두 가지를 함께 만든다.
 *  1) 상한을 넘은 목표
 *  2) 같은 단지에서 **아직 상한 안에 있는 평형** — 단지를 포기하는 대신 평형을 낮추는 길
 *
 * 판단 기준은 화면·갭 계산과 같은 대표가(가장 최근 실거래가)다. 호가는 쓰지 않는다 —
 * 검증할 수 없는 값으로 "예산을 넘었다"고 말하면 근거 없는 경고가 된다.
 */

import type {
  BudgetAlternativeArea,
  BudgetCapAlert,
  PriceQuote,
  TargetApartment,
  TradeRecord,
  UserConfig,
} from '@/lib/types';
import { filterComplex } from '@/lib/sources/molit';
import { TARGET_FRESHNESS_MONTHS } from './price-basis';
import { isTargetEnabled } from './target-pool';

/** 대안으로 제시할 평형 수 — 큰 평형부터 몇 개만 */
const MAX_ALTERNATIVES = 3;

/** 면적을 0.1㎡ 단위로 묶는다 — 같은 평형인데 소수점이 미세하게 다른 신고가 흔하다 */
function areaKey(areaM2: number): number {
  return Math.round(areaM2 * 10) / 10;
}

function monthsAgoIso(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d.toISOString().slice(0, 10);
}

/**
 * 같은 단지에서 상한 안에 있는 평형을 찾는다.
 *
 * 이름 매칭은 대표가와 같은 규칙(filterComplex)을 쓰되 면적 제한을 풀어
 * 단지 전체 거래를 모은 뒤 평형별로 다시 나눈다. 동이 있으면 그쪽으로 좁힌다 —
 * 성동구 "현대"처럼 같은 시군구에 같은 이름이 여러 곳인 경우를 갈라내기 위함이다.
 */
function alternativesUnderCap(
  trades: TradeRecord[],
  target: TargetApartment,
  cap: number,
): BudgetAlternativeArea[] {
  // 면적 허용오차를 무한대로 줘서 "이름이 같은 단지의 모든 거래"를 얻는다
  const byName = filterComplex(trades, target.complexName, 0, Number.POSITIVE_INFINITY).filter(
    (t) => !t.directDeal,
  );
  const byDong = target.dong ? byName.filter((t) => t.dong === target.dong) : [];
  const matched = byDong.length > 0 ? byDong : byName;
  if (matched.length === 0) return [];

  const cutoff = monthsAgoIso(TARGET_FRESHNESS_MONTHS);

  const groups = new Map<number, TradeRecord[]>();
  for (const t of matched) {
    const key = areaKey(t.areaM2);
    const arr = groups.get(key) ?? [];
    arr.push(t);
    groups.set(key, arr);
  }

  const options: BudgetAlternativeArea[] = [];
  for (const [area, list] of groups) {
    // 지금 살고 있는(=지금 노리는) 평형 자체는 대안이 아니다
    if (Math.abs(area - target.areaM2) < 0.5) continue;

    const sorted = [...list].sort((a, b) => b.dealDate.localeCompare(a.dealDate));
    const latest = sorted[0];

    /* 대표가와 같은 규칙으로 판단한다 — 가장 최근 실거래가.
       그 값이 상한을 넘으면 대안이 아니다. */
    if (latest.price > cap) continue;

    /* 6개월 안에 거래가 없는 평형은 제안하지 않는다. 그 값으로 갈아타자고 하면
       이미 사라진 가격을 목표로 삼게 되고, 등록해도 곧 자동으로 꺼진다. */
    const recent = sorted.filter((t) => t.dealDate >= cutoff);
    if (recent.length === 0) continue;

    options.push({
      areaM2: area,
      price: latest.price,
      lastDealDate: latest.dealDate,
      recentTradeCount: recent.length,
    });
  }

  // 예산 안에서 가장 큰 평형이 먼저 눈에 들어오게
  return options.sort((a, b) => b.areaM2 - a.areaM2).slice(0, MAX_ALTERNATIVES);
}

/**
 * 상한을 넘은 목표를 찾는다.
 *
 * 상한이 없거나 대표가가 실거래로 산출되지 않은 목표는 조용히 넘어간다.
 * 꺼 둔 목표도 보지 않는다 — 후보가 아닌 단지까지 경고하면 배너가 소음이 된다.
 */
export function findBudgetCapAlerts(
  config: UserConfig,
  quotes: Record<string, PriceQuote>,
  tradesFor: (lawdCd: string) => TradeRecord[],
): BudgetCapAlert[] {
  const cap = config.targetBudgetCap;
  if (!cap || cap <= 0) return [];

  const alerts: BudgetCapAlert[] = [];

  for (const target of config.targets) {
    if (!isTargetEnabled(target)) continue;

    const quote = quotes[target.id];
    // 실거래로 산출된 값만 쓴다. 호가로 "예산 초과"를 말하지 않는다.
    if (!quote || quote.basis !== 'recent-trade') continue;
    if (quote.price <= cap) continue;

    alerts.push({
      targetId: target.id,
      complexName: target.complexName,
      areaM2: target.areaM2,
      price: quote.price,
      lastDealDate: quote.lastDealDate,
      over: quote.price - cap,
      alternatives: alternativesUnderCap(tradesFor(target.lawdCd), target, cap),
    });
  }

  // 많이 넘어선 것부터
  return alerts.sort((a, b) => b.over - a.over);
}
