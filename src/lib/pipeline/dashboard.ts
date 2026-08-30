/**
 * 대시보드 데이터 조립.
 * 저장소(Supabase)에 쌓인 실거래 집계 + 라이브 API(거시지표·뉴스)를 합쳐 한 덩어리로 만든다.
 * 개별 소스 실패는 전체를 죽이지 않고 sourceStatus 로 보고한다.
 */

import { after } from 'next/server';
import type {
  CommunityPost,
  DashboardData,
  GapSummary,
  MacroIndicator,
  NewsItem,
  PriceQuote,
  SourceStatus,
  TradeRecord,
  UserConfig,
} from '@/lib/types';
import { fetchCommunityPosts } from '@/lib/sources/community';
import { configuredRssFeeds, fetchOfficialPress } from '@/lib/sources/gov';
import { fetchNetMigration, hasKosis } from '@/lib/sources/kosis';
import { analysisTargets, loadConfig, saveTargetSwitches } from '@/lib/store/config';
import { activeTargets, autoDisableStaleTargets } from '@/lib/analysis/target-pool';
import { loadRegionMonthly, loadTradeCache } from '@/lib/store/market-data';
import { loadSnapshotBefore } from '@/lib/store/market-data';
import { analyzeRebound, summarizeSpread } from '@/lib/analysis/rebound';
import {
  computeSentiment,
  findPriceExtremes,
  mergeMonthlySeries,
} from '@/lib/analysis/market-signals';
import { buildCatalysts, catalystCoverageRegions } from '@/lib/analysis/catalysts';
import { buildSchedule } from '@/lib/analysis/schedule';
import { fetchAllMacro } from '@/lib/sources/ecos';
import { fetchRebMonthlyMacro } from '@/lib/sources/reb';
import { fetchMarketNews, fetchRegionNews } from '@/lib/sources/news';
import { fetchRebBundle } from '@/lib/sources/reb';
import { filterComplex } from '@/lib/sources/molit';
import { DEFAULT_ANALYSIS_REGIONS } from '@/lib/regions';
import { featureFlags } from '@/lib/env';
import { maybeRefreshTrades } from './lazy-refresh';
import { loadDashboardCacheEntry, saveDashboardCache } from './dashboard-cache';
import { formatArea, median, todayKst } from '@/lib/format';
import { TARGET_FRESHNESS_MONTHS, tradePriceOf } from '@/lib/analysis/price-basis';
import { comparePeriods, monthlyMedianSeries } from '@/lib/analysis/period-compare';
import { calcAcquisitionTaxFor } from '@/lib/tax/acquisition';
import { calcTransactionCost } from '@/lib/tax/transaction-costs';
import { calcCapitalGainsTax, residenceMonthsAt } from '@/lib/tax/capital-gains';
import { calcLoanLimit } from '@/lib/tax/loan-limit';
import { regulationOf } from '@/lib/analysis/regulation';
import { findBudgetCapAlerts } from '@/lib/analysis/budget-cap';

/* ------------------------------------------------------------------ */
/* 시세 산출                                                            */
/* ------------------------------------------------------------------ */

interface QuoteOptions {
  /** 사용자가 설정에 입력한 호가 */
  manualPrice?: number;
  /** 그 호가를 본 날 (YYYY-MM-DD) */
  askingPriceAt?: string;
  /** 법정동 — 같은 시군구 안 동명이 단지를 갈라내는 데 쓴다 */
  dong?: string;
  /**
   * 대표가로 인정할 최근 실거래 기간(개월).
   * 목표 아파트는 6개월 — 그보다 오래된 체결가는 "지금 살 수 있는 값"이 아니라서
   * 갭·시뮬레이션의 기준으로 쓰면 안 된다. 이 기간에 거래가 없으면 대표가를 내지 않는다.
   * 생략하면 같은 6개월 창을 쓰되, 창 밖이어도 마지막 체결가를 대표가로 쓴다 (보유 아파트용).
   */
  freshnessMonths?: number;
}

/** n개월 전 날짜 (YYYY-MM-DD) */
function monthsAgoIso(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d.toISOString().slice(0, 10);
}

/** 두 날짜(YYYY-MM-DD) 사이 개월 수 — 마지막 거래가 얼마나 오래됐는지 표시용 */
function monthsSince(dealDate: string): number {
  const a = new Date(dealDate);
  const b = new Date();
  if (Number.isNaN(a.getTime())) return 0;
  let months = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
  if (b.getDate() < a.getDate()) months -= 1;
  return Math.max(0, months);
}

function quoteFromTrades(
  trades: TradeRecord[],
  complexName: string,
  areaM2: number,
  options: QuoteOptions = {},
): PriceQuote {
  const { manualPrice, askingPriceAt, dong, freshnessMonths } = options;

  // 직거래(가족 간 저가 이전 등)는 시세로 쓰지 않는다 — 실제 왜곡 사례가 있었다
  const byName = filterComplex(trades, complexName, areaM2).filter((t) => !t.directDeal);

  /* 같은 시군구 안에 같은 이름의 다른 단지가 있으면 법정동으로 더 좁힌다.
     성동구에는 "현대"가 10곳인데 마장동 현대와 옥수동 현대가 둘 다 전용 84.9㎡라,
     동을 구분하지 않으면 13.6억(마장동) 거래가 21.0억(옥수동) 시세에 섞인다.
     이름 매칭이 양방향 부분일치라 이름만으로는 분리할 수 없다.
     동이 비어 있거나 그 동에 거래가 없으면(표기 차이·오입력) 이름 매칭 결과를 그대로 쓴다. */
  const byDong = dong ? byName.filter((t) => t.dong === dong) : [];
  const matched = byDong.length > 0 ? byDong : byName;

  if (matched.length === 0) {
    return manualPrice
      ? {
          price: manualPrice,
          basis: 'manual',
          sampleSize: 0,
          freshnessMonths,
          askingPrice: manualPrice,
          askingPriceAt,
        }
      : { price: 0, basis: 'unknown', sampleSize: 0, freshnessMonths };
  }

  const sortedByDate = [...matched].sort((a, b) => b.dealDate.localeCompare(a.dealDate));
  const lastDeal = sortedByDate[0];
  const elapsed = monthsSince(lastDeal.dealDate);

  /* 전월·전분기 대비 — 단지 월별 실거래 중앙값 기준.
     한 달에 한두 건뿐인 단지가 많아 단발 고가 거래에 흔들리므로 중앙값을 쓴다. */
  const compare = comparePeriods(monthlyMedianSeries(matched));

  const windowMonths = freshnessMonths ?? 6;
  const cutoffIso = monthsAgoIso(windowMonths);
  const recent = matched.filter((t) => t.dealDate >= cutoffIso);

  /* 신선도 기준(목표 6개월) 밖이면 "오래됨" 표시만 하고 값은 그대로 돌려준다.
     값을 0으로 만들어 목록에서 지워 버리면 사용자는 자기 단지가 왜 사라졌는지 모른다 —
     대신 target-pool 이 그 표시를 보고 on/off 스위치를 자동으로 끄고 사유를 남긴다.
     호가로 메우지는 않는다. 사용자가 그 숫자를 실거래로 읽기 때문이다. */
  const stale = freshnessMonths !== undefined && recent.length === 0;
  const pool = recent.length > 0 ? recent : matched.slice(0, 6);
  const tradePrice = Math.round(median(pool.map((t) => t.price)));

  // 직전 동일 기간 대비 변동률
  const prevCutoff = monthsAgoIso(windowMonths * 2);
  const prevPool = matched.filter((t) => t.dealDate < cutoffIso && t.dealDate >= prevCutoff);
  const prevMedian = prevPool.length > 0 ? median(prevPool.map((t) => t.price)) : 0;
  const changeRate = prevMedian > 0 ? ((tradePrice - prevMedian) / prevMedian) * 100 : undefined;

  return {
    // 실제로 체결된 가장 최근 가격을 쓴다.
    // 호가(manualPrice)는 검증할 방법이 없어 실거래가 있으면 실거래를 우선한다.
    price: lastDeal.price,
    basis: 'recent-trade',
    sampleSize: pool.length,
    lastDealDate: lastDeal.dealDate,
    monthsSinceLastDeal: elapsed,
    /** 창 기간(6개월) 중앙값 — 단발 고가/저가 거래에 흔들리지 않는 참고값 */
    medianPrice: tradePrice,
    /** 사용자가 설정에 입력한 호가 (있으면 화면에서 비교용으로 보여준다) */
    askingPrice: manualPrice,
    askingPriceAt,
    high: Math.max(...matched.map((t) => t.price)),
    low: Math.min(...matched.map((t) => t.price)),
    changeRate: changeRate !== undefined ? Math.round(changeRate * 10) / 10 : undefined,
    compare,
    freshnessMonths,
    stale,
  };
}

/* ------------------------------------------------------------------ */
/* 갭 요약 (요구사항 1 + 2)                                             */
/* ------------------------------------------------------------------ */

function buildGaps(config: UserConfig, quotes: Record<string, PriceQuote>): GapSummary[] {
  const gaps: GapSummary[] = [];

  for (const holding of config.holdings) {
    // 갭·세금 계산은 실거래가만 쓴다. 호가로 계산하면 근거 없는 숫자가 나온다.
    const holdingPrice = tradePriceOf(quotes[holding.id]);

    /* 제외 표시한 목표와 최근 6개월 실거래가 없는 목표는 후보에서 빠진다
       (tradePriceOf 가 0을 돌려주므로 아래 가드에서 자동으로 걸린다). */
    for (const target of activeTargets(config)) {
      const targetPrice = tradePriceOf(quotes[target.id]);
      if (holdingPrice <= 0 || targetPrice <= 0) continue;

      /* 세후 실소요 자금 = (매수가 + 취득세 + 매수부대) − (매도가 − 양도세 − 매도부대).
         기존 대출 상환·전세보증금 반환은 "자산이 줄어드는" 게 아니라 부채가 사라지는
         것이므로 여기 넣지 않는다 — 그 금액까지 합친 "당장 준비할 현금·대출"은
         갭 카드 상세 패널에 별도로 보여준다. 주석과 산식이 달라 혼선을 준 이력이 있어
         정의를 여기 못박는다. */
      // 매도 중개보수는 양도세 필요경비로 공제된다 — 먼저 계산해 경비에 넣는다
      const sellCost = calcTransactionCost({ price: holdingPrice, side: 'sell' });

      const cgt = calcCapitalGainsTax({
        salePrice: holdingPrice,
        acquisitionPrice: holding.acquisitionPrice,
        expenses: holding.acquisitionCost + holding.capitalExpenditure + sellCost.brokerFee,
        acquiredAt: holding.acquiredAt,
        soldAt: todayKst(),
        residenceMonths: residenceMonthsAt(holding, todayKst()),
        isOneHouseExempt: config.household.ownedHouseCount <= 1,
        multiHouseSurcharge: false,
        isRegulated: config.household.holdingIsRegulated,
        usedBasicDeduction: 0,
      });
      const acq = calcAcquisitionTaxFor(targetPrice, target.areaM2, config.household, {
        replacesExisting: true,
      });
      const buyCost = calcTransactionCost({ price: targetPrice, side: 'buy', withMortgage: true });

      const netFromSale = holdingPrice - cgt.total - sellCost.total;
      const realCashNeeded = targetPrice + acq.total + buyCost.total - netFromSale;

      /* 사용자가 실제로 모아야 하는 현금까지 여기서 계산해 둔다.
         대출은 은행에서 나오므로 "내 돈"이 결론이고, 화면·브리핑이 같은 값을 쓰도록
         한곳에서 만든다 (예전엔 화면마다 따로 계산해 값이 어긋날 여지가 있었다). */
      const reg = regulationOf(target.lawdCd);
      const loanLimit = calcLoanLimit({
        price: targetPrice,
        regulated: config.household.targetIsRegulated || reg.adjusted,
        metro: reg.metro,
        retainedHouseCount: 0,
        firstTimeBuyer: config.household.firstTimeBuyer,
        annualIncome: config.household.annualIncome,
        otherDebtAnnualPayment: config.household.otherDebtAnnualPayment,
        rate: holding.loanRate || 4,
      }).limit;
      const totalNeeded = realCashNeeded + holding.loanBalance + holding.leaseDeposit;
      const cashNeeded = Math.max(0, totalNeeded - Math.min(loanLimit, Math.max(0, totalNeeded)));

      gaps.push({
        loanLimit,
        totalNeeded,
        cashNeeded,
        holdingId: holding.id,
        holdingName: `${holding.complexName} ${formatArea(holding.areaM2)}`,
        targetId: target.id,
        targetName: `${target.complexName} ${formatArea(target.areaM2)}`,
        holdingPrice,
        targetPrice,
        gap: targetPrice - holdingPrice,
        ratio: targetPrice / holdingPrice,
        realCashNeeded,
      });
    }
  }

  // 실소요 자금이 적은 순 = 실행 가능성이 높은 순. 화면(gap-section)·README 와 같은 기준을 쓴다.
  return gaps.sort((a, b) => a.realCashNeeded - b.realCashNeeded);
}

/* ------------------------------------------------------------------ */
/* 메인                                                                */
/* ------------------------------------------------------------------ */

export interface BuildDashboardOptions {
  /** 뉴스·거시지표 등 외부 라이브 호출을 생략 (빠른 렌더링용) */
  skipLive?: boolean;
  /** 어느 사용자의 설정으로 조립할지. 생략하면 레거시 'default' */
  userId?: string;
}

/**
 * 같은 사용자의 재조립이 겹치지 않게 하는 자물쇠.
 *
 * 낡은 캐시를 여러 사람이 동시에 열면 뒤쪽 갱신이 사람 수만큼 돈다.
 * 하나가 도는 동안 나머지는 그 약속을 같이 기다린다.
 */
const rebuilding = new Map<string, Promise<DashboardData>>();

function rebuildOnce(userId: string): Promise<DashboardData> {
  const running = rebuilding.get(userId);
  if (running) return running;

  const task = buildDashboard({ userId })
    .then(async (data) => {
      await saveDashboardCache(userId, data).catch(() => {});
      return data;
    })
    .finally(() => rebuilding.delete(userId));

  rebuilding.set(userId, task);
  return task;
}

/**
 * 캐시 우선 조회 — 페이지 렌더링용.
 *
 * 매시간 tick 이 buildDashboard 를 돌려 캐시를 채우므로, 페이지는
 * 대부분 저장된 결과(<1초)를 읽는다.
 *
 * 캐시가 만료됐어도 24시간 안쪽이면 **그 값을 먼저 돌려주고 갱신은 응답 뒤로
 * 미룬다**(after). 예열 cron 이 걸러지는 날에도 화면은 1초 안에 뜨고, 다음
 * 사람이 여는 화면은 방금 갱신된 값을 본다. 캐시가 아예 없을 때만 조립을
 * 기다린다 — 첫 방문이라 보여줄 게 없으니 그 경우엔 도리가 없다.
 */
export async function buildDashboardCached(
  userId: string,
  options: { fresh?: boolean } = {},
): Promise<DashboardData> {
  if (!options.fresh) {
    const entry = await loadDashboardCacheEntry(userId);
    if (entry && !entry.stale) return entry.data;

    if (entry) {
      /* 낡은 값을 쓰기로 했으니 갱신은 응답을 보낸 뒤에 돌린다.
         after 는 요청 문맥 밖(스크립트·테스트)에서는 던지므로, 그때는
         조용히 넘어가고 다음 요청이나 tick 이 채우게 둔다. */
      try {
        after(() => rebuildOnce(userId).catch(() => {}));
      } catch {
        /* 요청 문맥이 아니다 — 배경 갱신 없이 낡은 값만 돌려준다 */
      }
      return entry.data;
    }
  }
  return rebuildOnce(userId);
}

export async function buildDashboard(options: BuildDashboardOptions = {}): Promise<DashboardData> {
  const generatedAt = new Date().toISOString();
  const sourceStatus: SourceStatus[] = [];
  let config = await loadConfig(options.userId);

  /* 실거래 집계가 3시간 넘게 낡았으면 최근월만 백그라운드로 다시 긁는다 (응답은 기다리지 않음).
     userId 를 반드시 넘긴다 — 안 넘기면 누가 열든 default 설정의 지역만 갱신된다. */
  const lazy = options.skipLive
    ? { lastRefreshedAt: null, running: false, triggered: false, reason: '라이브 호출 생략' }
    : maybeRefreshTrades(options.userId);

  /* --- 1) 실거래 집계 --- */
  const userCodes = analysisTargets(config);
  const analysisCodes = [...new Set([...DEFAULT_ANALYSIS_REGIONS, ...userCodes])];

  /* 월 집계(1)와 원본 거래(3)는 서로 필요 없는 별개 조회인데 순차로 돌면
     4초 + 3초가 그대로 더해진다. 여기서 둘 다 띄워 놓고 각자 필요한 자리에서
     기다린다 — 사이에 낀 반등 분석은 월 집계만 쓴다. */
  const tradeWindowStart = new Date();
  tradeWindowStart.setMonth(tradeWindowStart.getMonth() - 24);
  const tradeFromMonth = `${tradeWindowStart.getFullYear()}${String(tradeWindowStart.getMonth() + 1).padStart(2, '0')}`;

  /* 시세 매칭은 반드시 그 아파트의 시군구 캐시 안에서만 한다.
     전 지역을 합쳐 이름으로 찾으면 성동구 "옥수삼성"에 수서동·오금동의
     "삼성"아파트 거래가 섞여 시세가 25.7억으로 뛰는 실제 사고가 있었다
     (느슨한 이름 매칭이 "삼성" ⊂ "옥수삼성"을 허용하기 때문).

     지역끼리도 서로 독립이라 한꺼번에 던진다 — 순차로 돌면 지역당 ~1초가
     그대로 더해졌다 (지역 6개면 6초). 실패는 지역별로 따로 보고한다. */
  const tradesPending = Promise.all(
    userCodes.map((code) =>
      loadTradeCache([code], tradeFromMonth).then(
        (trades) => ({ code, trades, error: null as Error | null }),
        (e: Error) => ({ code, trades: [] as TradeRecord[], error: e }),
      ),
    ),
  );

  let seriesByRegion: Record<string, ReturnType<typeof mergeMonthlySeries>> = {};
  try {
    seriesByRegion = await loadRegionMonthly(analysisCodes, '2022-01');
    const regionCount = Object.keys(seriesByRegion).length;
    sourceStatus.push({
      name: '국토교통부 아파트 매매 실거래가',
      url: 'https://rt.molit.go.kr',
      status: regionCount > 0 ? 'ok' : featureFlags.hasMolit ? 'stale' : 'missing-key',
      message:
        (regionCount > 0
          ? `${regionCount}개 시군구 시계열 로드`
          : featureFlags.hasMolit
            ? '아직 수집된 데이터가 없습니다. /api/cron/backfill 을 먼저 실행하세요.'
            : 'DATA_GO_KR_SERVICE_KEY 미설정') + ` · ${lazy.reason}`,
      fetchedAt: lazy.lastRefreshedAt ?? generatedAt,
    });
  } catch (e) {
    sourceStatus.push({
      name: '국토교통부 아파트 매매 실거래가',
      url: 'https://rt.molit.go.kr',
      status: 'error',
      message: (e as Error).message,
    });
  }

  /* --- 2) 반등 확산 분석 (요구사항 3) --- */
  const rebound = Object.entries(seriesByRegion)
    .map(([code, series]) => analyzeRebound(code, series))
    .sort((a, b) => b.changeSinceBase - a.changeSinceBase);

  /* --- 3) 보유/목표 아파트 시세 (요구사항 1) --- */
  const tradesByRegion = new Map<string, TradeRecord[]>();
  for (const { code, trades, error } of await tradesPending) {
    tradesByRegion.set(code, trades);
    if (!error) continue;
    sourceStatus.push({
      name: `실거래 원본 캐시 (${code})`,
      url: '#',
      status: 'error',
      message: error.message,
    });
  }
  const userTrades: TradeRecord[] = [...tradesByRegion.values()].flat();

  const quotes: Record<string, PriceQuote> = {};
  for (const h of config.holdings) {
    quotes[h.id] = quoteFromTrades(tradesByRegion.get(h.lawdCd) ?? [], h.complexName, h.areaM2, {
      manualPrice: h.manualPrice,
      askingPriceAt: h.askingPriceAt,
      dong: h.dong,
    });
  }
  /* 목표 아파트는 최근 6개월 실거래만 대표가로 인정한다.
     그보다 오래된 체결가로 갭을 계산하면 이미 사라진 가격을 목표로 삼게 된다. */
  for (const t of config.targets) {
    quotes[t.id] = quoteFromTrades(tradesByRegion.get(t.lawdCd) ?? [], t.complexName, t.areaM2, {
      manualPrice: t.manualPrice,
      askingPriceAt: t.askingPriceAt,
      dong: t.dong,
      freshnessMonths: TARGET_FRESHNESS_MONTHS,
    });
  }

  /* 대표가가 6개월 넘게 묵은 목표는 스위치를 자동으로 끈다.
     목록에서 지우지 않고 끄기만 하므로 사용자가 사유를 보고 다시 켤 수 있다.
     상태가 실제로 바뀐 경우에만 저장한다 — 매 조립마다 쓰면 DB 를 헛되이 두드린다. */
  const auto = autoDisableStaleTargets(config.targets, quotes, generatedAt);
  if (auto.changed) {
    config = { ...config, targets: auto.targets };
    await saveTargetSwitches(options.userId, auto.targets).catch((e) =>
      console.error('[dashboard] 목표 스위치 저장 실패:', (e as Error).message),
    );
  }
  if (auto.disabled.length > 0) {
    sourceStatus.push({
      name: '목표 아파트 자동 비활성화',
      url: '/settings',
      status: 'stale',
      message: auto.disabled.map((c) => `${c.complexName}: ${c.reason}`).join(' / '),
      fetchedAt: generatedAt,
    });
  }

  const gaps = buildGaps(config, quotes);

  /* 갭 변화 — 브리핑 발송 때 저장해 둔 스냅샷과 비교한다.
     전주(브리핑 문구용)에 더해 전월·전분기까지 채운다: 주 단위 변화는 실거래 한 건에도
     출렁여서 방향을 읽기 어렵고, 갈아타기는 월·분기 단위로 판단하는 일이라서다. */
  try {
    const snapshotUser = options.userId ?? 'default';
    const [weekAgo, monthAgo, quarterAgo] = await Promise.all([
      loadSnapshotBefore(7, snapshotUser) as Promise<{ gaps?: GapSummary[] } | null>,
      loadSnapshotBefore(30, snapshotUser) as Promise<{ gaps?: GapSummary[] } | null>,
      loadSnapshotBefore(90, snapshotUser) as Promise<{ gaps?: GapSummary[] } | null>,
    ]);
    const findPrev = (snapshot: { gaps?: GapSummary[] } | null, g: GapSummary) =>
      snapshot?.gaps?.find((b) => b.holdingId === g.holdingId && b.targetId === g.targetId);

    for (const g of gaps) {
      const w = findPrev(weekAgo, g);
      if (w && w.gap > 0) {
        g.gapBefore = w.gap;
        g.gapDelta = g.gap - w.gap;
      }
      const m = findPrev(monthAgo, g);
      if (m && m.gap > 0) {
        g.gapMonthAgo = m.gap;
        g.gapMomDelta = g.gap - m.gap;
      }
      const q = findPrev(quarterAgo, g);
      if (q && q.gap > 0) {
        g.gapQuarterAgo = q.gap;
        g.gapQoqDelta = g.gap - q.gap;
      }
    }
  } catch {
    /* 스냅샷이 없으면 변화 없이 표시 */
  }

  /* --- 4) 신고가 / 신저가 (요구사항 7) --- */
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - 2);
  const extremes = findPriceExtremes(userTrades, cutoff.toISOString().slice(0, 10), {
    limit: 40,
  });

  /* --- 5) 과열 지표 / 매수심리 (요구사항 6) --- */
  const rebBundle = options.skipLive
    ? { priceIndex: null, supplyDemand: null, errors: ['라이브 호출 생략'] }
    : await fetchRebBundle().catch((e) => ({
        priceIndex: null,
        supplyDemand: null,
        errors: [(e as Error).message],
      }));

  const nationalSupplyDemand =
    rebBundle.supplyDemand?.byRegion['전국'] ?? rebBundle.supplyDemand?.byRegion['서울'];
  const nationalPriceIndex =
    rebBundle.priceIndex?.byRegion['전국'] ?? rebBundle.priceIndex?.byRegion['서울'];

  sourceStatus.push({
    name: '한국부동산원 R-ONE (주간 가격지수·매매수급)',
    url: 'https://www.reb.or.kr/r-one/',
    status:
      rebBundle.supplyDemand || rebBundle.priceIndex
        ? 'ok'
        : featureFlags.hasReb
          ? 'error'
          : 'missing-key',
    message: rebBundle.errors.length > 0 ? rebBundle.errors.join(' / ') : '정상',
    fetchedAt: generatedAt,
  });

  const mergedMonthly = mergeMonthlySeries(seriesByRegion);
  const weeklyChange =
    nationalPriceIndex && nationalPriceIndex.length >= 2
      ? ((nationalPriceIndex[nationalPriceIndex.length - 1].value -
          nationalPriceIndex[nationalPriceIndex.length - 2].value) /
          nationalPriceIndex[nationalPriceIndex.length - 2].value) *
        100
      : undefined;

  const sentiment = computeSentiment({
    trades: userTrades,
    monthly: mergedMonthly,
    supplyDemandIndex: nationalSupplyDemand?.[nationalSupplyDemand.length - 1]?.value,
    supplyDemandPrev: nationalSupplyDemand?.[nationalSupplyDemand.length - 2]?.value,
    // 전월·전분기 과열 점수를 같은 출처로 다시 계산하려면 원본 시계열이 필요하다
    supplyDemandSeries: nationalSupplyDemand ?? undefined,
    weeklyPriceChange: weeklyChange,
    asOf: todayKst(),
  });

  /* --- 6) 거시 지표 (요구사항 8) --- */
  let macro: MacroIndicator[] = [];
  if (!options.skipLive && featureFlags.hasEcos) {
    const { indicators, errors } = await fetchAllMacro();
    macro = indicators;
    // 통계청 KOSIS — 수도권 인구 순이동 (키 있을 때만)
    if (hasKosis()) {
      try {
        macro.push(await fetchNetMigration());
        sourceStatus.push({
          name: '통계청 KOSIS (인구 순이동)',
          url: 'https://kosis.kr/openapi',
          status: 'ok',
          message: '수도권 순이동 시계열 수집',
          fetchedAt: generatedAt,
        });
      } catch (e) {
        sourceStatus.push({
          name: '통계청 KOSIS (인구 순이동)',
          url: 'https://kosis.kr/openapi',
          status: 'error',
          message: (e as Error).message,
        });
      }
    } else {
      sourceStatus.push({
        name: '통계청 KOSIS (인구 순이동)',
        url: 'https://kosis.kr/openapi',
        status: 'missing-key',
        message: 'KOSIS_API_KEY 미설정 — CPI 등 핵심 통계청 지표는 ECOS 경유로 이미 수집 중',
      });
    }
    sourceStatus.push({
      name: '한국은행 ECOS (기준금리·CPI·M2·주담대금리)',
      url: 'https://ecos.bok.or.kr',
      status: errors.length === 0 ? 'ok' : indicators.length > 0 ? 'stale' : 'error',
      message:
        errors.length > 0 ? errors.map((e) => `${e.label}: ${e.message}`).join(' / ') : '정상',
      fetchedAt: generatedAt,
    });
  } else {
    sourceStatus.push({
      name: '한국은행 ECOS',
      url: 'https://ecos.bok.or.kr',
      status: featureFlags.hasEcos ? 'stale' : 'missing-key',
      message: featureFlags.hasEcos ? '라이브 호출 생략' : 'ECOS_API_KEY 미설정',
    });
  }

  /* --- 6-2) 부동산원 R-ONE 월간 공표 통계 --- */
  // 매매·전세가격지수(동향조사), 공동주택 실거래가격지수, 미분양, 소비심리 —
  // 실거래 원본과 다른 공식 조사 지표라 시장을 교차 검증하는 데 쓴다.
  if (!options.skipLive && featureFlags.hasReb) {
    const reb = await fetchRebMonthlyMacro().catch((e) => ({
      indicators: [] as MacroIndicator[],
      errors: [(e as Error).message],
    }));
    macro.push(...reb.indicators);
    sourceStatus.push({
      name: '한국부동산원 R-ONE (월간 공표 통계)',
      url: 'https://www.reb.or.kr/r-one/',
      status: reb.errors.length === 0 ? 'ok' : reb.indicators.length > 0 ? 'stale' : 'error',
      message:
        reb.errors.length > 0
          ? reb.errors.join(' / ')
          : '매매·전세지수, 실거래지수, 미분양, 소비심리 수집',
      fetchedAt: generatedAt,
    });
  }

  /* --- 7) 뉴스 · 호재 (요구사항 4) --- */
  let news: NewsItem[] = [];
  // 호재·악재 추적 지역: 관심 지역에 보유·목표 아파트 지역을 합친다
  const catalystRegions = catalystCoverageRegions(config);

  if (!options.skipLive && featureFlags.hasNaver) {
    const [regionNews, marketNews] = await Promise.all([
      fetchRegionNews(catalystRegions).catch(() => ({ items: [], errors: ['지역 뉴스 실패'] })),
      fetchMarketNews().catch(() => ({ items: [], errors: ['시장 뉴스 실패'] })),
    ]);
    news = [...regionNews.items, ...marketNews.items];
    const errors = [...regionNews.errors, ...marketNews.errors];
    sourceStatus.push({
      name: '네이버 뉴스 검색 API',
      url: 'https://developers.naver.com',
      status: news.length > 0 ? 'ok' : 'error',
      message: errors.length > 0 ? errors.slice(0, 3).join(' / ') : `${news.length}건 수집`,
      fetchedAt: generatedAt,
    });
  } else {
    sourceStatus.push({
      name: '네이버 뉴스 검색 API',
      url: 'https://developers.naver.com',
      status: featureFlags.hasNaver ? 'stale' : 'missing-key',
      message: featureFlags.hasNaver
        ? '라이브 호출 생략'
        : 'NAVER_CLIENT_ID / NAVER_CLIENT_SECRET 미설정',
    });
  }

  const catalysts = buildCatalysts({ regions: catalystRegions, news });

  /* --- 7-2) 공식 발표 + 블로그·카페 (참고용) --- */
  let press: NewsItem[] = [];
  let community: CommunityPost[] = [];
  if (!options.skipLive && featureFlags.hasNaver) {
    const [pressResult, communityResult] = await Promise.all([
      fetchOfficialPress().catch((e) => ({ items: [], errors: [(e as Error).message] })),
      fetchCommunityPosts(config.watchRegions).catch((e) => ({
        posts: [],
        errors: [(e as Error).message],
      })),
    ]);
    press = pressResult.items;
    community = communityResult.posts;

    sourceStatus.push({
      name: '정부 부처 공식 발표 (뉴스 표적 수집 + RSS)',
      url: 'https://www.molit.go.kr',
      status: press.length > 0 ? 'ok' : configuredRssFeeds().length > 0 ? 'error' : 'stale',
      message:
        pressResult.errors.length > 0
          ? pressResult.errors.slice(0, 2).join(' / ')
          : `${press.length}건 수집 (RSS 피드 ${configuredRssFeeds().length}개 구독 중)`,
      fetchedAt: generatedAt,
    });
    sourceStatus.push({
      name: '네이버 블로그·카페 (참고용)',
      url: 'https://developers.naver.com',
      status: community.length > 0 ? 'ok' : 'error',
      message:
        communityResult.errors.length > 0
          ? communityResult.errors.slice(0, 2).join(' / ')
          : `${community.length}건 수집 · 광고성 글 자동 제외`,
      fetchedAt: generatedAt,
    });
  } else {
    sourceStatus.push({
      name: '공식 발표 · 블로그 · 카페',
      url: 'https://developers.naver.com',
      status: featureFlags.hasNaver ? 'stale' : 'missing-key',
      message: featureFlags.hasNaver
        ? '라이브 호출 생략'
        : 'NAVER_CLIENT_ID / NAVER_CLIENT_SECRET 미설정 (뉴스와 같은 키 사용)',
    });
  }

  /* --- 8) 주요 일정 --- */
  const schedule = buildSchedule(60);

  /* --- 9) 예산 상한 초과 목표 ---
     같은 tradesByRegion 을 넘겨 같은 단지의 더 작은 평형을 함께 찾는다. */
  const budgetAlerts = findBudgetCapAlerts(
    config,
    quotes,
    (lawdCd) => tradesByRegion.get(lawdCd) ?? [],
  );

  return {
    generatedAt,
    config,
    quotes,
    gaps,
    rebound,
    catalysts,
    news: news.slice(0, 60),
    press,
    community: community.slice(0, 40),
    sentiment,
    extremes,
    macro,
    schedule,
    budgetAlerts,
    sourceStatus,
  };
}

/** 대시보드에서 파생되는 요약값 (브리핑·헤더에서 재사용) */
export function summarizeDashboard(data: DashboardData) {
  const spread = summarizeSpread(data.rebound);
  const primaryGap = data.gaps[0];
  const newHighs = data.extremes.filter((e) => e.type === 'new-high');
  const newLows = data.extremes.filter((e) => e.type === 'new-low');

  return { spread, primaryGap, newHighs, newLows };
}
