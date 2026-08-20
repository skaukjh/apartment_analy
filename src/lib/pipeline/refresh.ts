/**
 * 실거래 데이터 수집 파이프라인.
 *
 * 국토부 실거래가 API 는 (시군구 × 월) 단위로만 조회되므로,
 * 65개 지역 × 40개월 = 2,600여 회 호출이 필요하다. 한 번의 요청에서 다 할 수 없어
 *  - 매일 cron: 최근 3개월만 전체 지역 갱신 (증분)
 *  - 백필: 이미 저장된 (지역, 월)은 건너뛰고 배치 단위로 반복 실행
 * 두 갈래로 나눴다.
 */

import {
  aggregateMonthly,
  aggregateMonthlyByDong,
  FATAL_CODES,
  fetchTradesForMonths,
  MolitError,
} from '@/lib/sources/molit';
import {
  emptyMonthPoint,
  loadRegionMonthlyKeys,
  saveDongMonthly,
  saveRegionMonthly,
  saveTradeCache,
} from '@/lib/store/market-data';
import { dashYearMonth, nowKst, recentYearMonths, shiftYearMonth } from '@/lib/format';
import type { TradeRecord } from '@/lib/types';

export interface RefreshResult {
  regionsProcessed: number;
  monthsFetched: number;
  tradesCollected: number;
  skipped: number;
  errors: string[];
  durationMs: number;
  /** 아직 남은 (지역, 월) 조합 수 — 백필 진행률 확인용 */
  remaining?: number;
}

/** 백필 시작 월 (반등 분석 기준시점보다 1년 앞서 잡아 저점 탐지에 여유를 준다) */
export const BACKFILL_FROM = '202201';

function monthsBetweenYm(from: string, to: string): string[] {
  const out: string[] = [];
  let cursor = from;
  while (cursor <= to) {
    out.push(cursor);
    cursor = shiftYearMonth(cursor, 1);
  }
  return out;
}

function currentYm(): string {
  const d = nowKst();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
}

interface RunOptions {
  /** 원본 거래를 trade_cache 에도 저장할 지역 (신고가 분석 대상) */
  cacheTradesFor?: Set<string>;
  /** 전체 실행 시간 상한 (ms). 초과하면 남은 작업을 남기고 종료 */
  budgetMs?: number;
}

async function runRegionMonths(
  plan: Array<{ lawdCd: string; months: string[] }>,
  options: RunOptions = {},
): Promise<RefreshResult> {
  const startedAt = Date.now();
  const budgetMs = options.budgetMs ?? 240_000;
  const errors: string[] = [];

  let regionsProcessed = 0;
  let monthsFetched = 0;
  let tradesCollected = 0;
  let remaining = 0;

  for (const { lawdCd, months } of plan) {
    if (Date.now() - startedAt > budgetMs) {
      remaining += months.length;
      continue;
    }
    if (months.length === 0) continue;

    try {
      const byMonth = await fetchTradesForMonths(lawdCd, months);
      const points = aggregateMonthly(byMonth);

      // 거래가 0건이던 월도 "조회 완료"로 남긴다.
      // 안 그러면 백필이 그 월을 영원히 미완료로 보고 같은 지역만 무한 반복한다.
      const covered = new Set(points.map((p) => p.month));
      const withEmpties = [
        ...points,
        ...months
          .map((ym) => dashYearMonth(ym))
          .filter((m) => !covered.has(m))
          .map(emptyMonthPoint),
      ];

      if (withEmpties.length > 0) await saveRegionMonthly(lawdCd, withEmpties);

      // 지도 드릴다운(동 단위)용 법정동별 집계도 함께 저장한다
      await saveDongMonthly(lawdCd, aggregateMonthlyByDong(byMonth));

      if (options.cacheTradesFor?.has(lawdCd)) {
        for (const [ym, trades] of Object.entries(byMonth)) {
          if (trades.length > 0) await saveTradeCache(lawdCd, ym, trades);
        }
      }

      monthsFetched += months.length;
      tradesCollected += Object.values(byMonth).reduce((s, t: TradeRecord[]) => s + t.length, 0);
      regionsProcessed += 1;
    } catch (e) {
      // 키·승인·트래픽 문제는 남은 지역을 돌아도 똑같이 실패하므로 즉시 중단한다
      if (e instanceof MolitError && FATAL_CODES.has(e.code ?? '')) {
        errors.push(e.message);
        remaining += months.length;
        break;
      }
      errors.push(`${lawdCd}: ${(e as Error).message}`);
    }
  }

  return {
    regionsProcessed,
    monthsFetched,
    tradesCollected,
    skipped: 0,
    errors,
    durationMs: Date.now() - startedAt,
    remaining,
  };
}

/**
 * 최근 N개월 증분 갱신. 실거래 신고 기한이 30일이라 최근 2~3개월은 계속 값이 바뀐다.
 */
export async function refreshRecent(
  lawdCodes: string[],
  months = 3,
  options: RunOptions = {},
): Promise<RefreshResult> {
  const targetMonths = recentYearMonths(months);
  const plan = lawdCodes.map((lawdCd) => ({ lawdCd, months: targetMonths }));
  return runRegionMonths(plan, options);
}

/**
 * 과거 데이터 백필. 이미 저장된 (지역, 월)은 건너뛴다.
 * 한 번에 다 못 하므로 반복 호출하며 remaining 이 0이 될 때까지 돌린다.
 */
export async function backfill(
  lawdCodes: string[],
  options: RunOptions & { fromYm?: string; maxRegionsPerRun?: number } = {},
): Promise<RefreshResult> {
  const fromYm = options.fromYm ?? BACKFILL_FROM;
  const allMonths = monthsBetweenYm(fromYm, currentYm());

  // 거래 0건으로 기록된 월도 "이미 조회함"에 포함해야 같은 구간을 반복하지 않는다
  const existingKeys = await loadRegionMonthlyKeys(lawdCodes, dashYearMonth(fromYm));

  let skipped = 0;
  const plan: Array<{ lawdCd: string; months: string[] }> = [];

  for (const lawdCd of lawdCodes) {
    const missing = allMonths.filter((ym) => {
      const has = existingKeys.has(`${lawdCd}|${dashYearMonth(ym)}`);
      if (has) skipped += 1;
      return !has;
    });
    if (missing.length > 0) plan.push({ lawdCd, months: missing });
  }

  const limited = options.maxRegionsPerRun ? plan.slice(0, options.maxRegionsPerRun) : plan;
  const leftover = plan.slice(limited.length).reduce((s, p) => s + p.months.length, 0);

  const result = await runRegionMonths(limited, options);
  return {
    ...result,
    skipped,
    remaining: (result.remaining ?? 0) + leftover,
  };
}
