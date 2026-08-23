/**
 * 대시보드 데이터 조립.
 * 저장소(Supabase)에 쌓인 실거래 집계 + 라이브 API(거시지표·뉴스)를 합쳐 한 덩어리로 만든다.
 * 개별 소스 실패는 전체를 죽이지 않고 sourceStatus 로 보고한다.
 */

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
import { analysisTargets, loadConfig } from '@/lib/store/config';
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
import { loadDashboardCache, saveDashboardCache } from './dashboard-cache';
import { formatArea, median, todayKst } from '@/lib/format';
import { tradePriceOf } from '@/lib/analysis/price-basis';
import { calcAcquisitionTaxFor } from '@/lib/tax/acquisition';
import { calcTransactionCost } from '@/lib/tax/transaction-costs';
import { calcCapitalGainsTax } from '@/lib/tax/capital-gains';
import { calcLoanLimit } from '@/lib/tax/loan-limit';
import { regulationOf } from '@/lib/analysis/regulation';

/* ------------------------------------------------------------------ */
/* 시세 산출                                                            */
/* ------------------------------------------------------------------ */

function quoteFromTrades(
  trades: TradeRecord[],
  complexName: string,
  areaM2: number,
  manualPrice?: number,
  dong?: string,
): PriceQuote {
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
      ? { price: manualPrice, basis: 'manual', sampleSize: 0 }
      : { price: 0, basis: 'unknown', sampleSize: 0 };
  }

  // 최근 6개월 거래 우선, 없으면 전체
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - 6);
  const cutoffIso = cutoff.toISOString().slice(0, 10);
  const recent = matched.filter((t) => t.dealDate >= cutoffIso);
  const pool = recent.length > 0 ? recent : matched.slice(0, 6);

  const prices = pool.map((t) => t.price);
  const tradePrice = Math.round(median(prices));

  // 직전 6개월 대비 변동률
  const prevCutoff = new Date();
  prevCutoff.setMonth(prevCutoff.getMonth() - 12);
  const prevPool = matched.filter(
    (t) => t.dealDate < cutoffIso && t.dealDate >= prevCutoff.toISOString().slice(0, 10),
  );
  const changeRate =
    prevPool.length > 0
      ? ((tradePrice - median(prevPool.map((t) => t.price))) /
          median(prevPool.map((t) => t.price))) *
        100
      : undefined;

  // 직전 실거래가 — 가장 최근 체결가. 대표 시세의 기준으로 삼는다.
  const sortedByDate = [...matched].sort((a, b) => b.dealDate.localeCompare(a.dealDate));
  const latestPrice = sortedByDate[0]?.price ?? tradePrice;

  return {
    // 실제로 체결된 가장 최근 가격을 쓴다.
    // 호가(manualPrice)는 검증할 방법이 없어 실거래가 있으면 실거래를 우선한다.
    price: latestPrice,
    basis: 'recent-trade',
    sampleSize: pool.length,
    lastDealDate: sortedByDate[0]?.dealDate,
    /** 최근 6개월 중앙값 — 단발 고가/저가 거래에 흔들리지 않는 참고값 */
    medianPrice: tradePrice,
    /** 사용자가 설정에 입력한 호가 (있으면 화면에서 비교용으로 보여준다) */
    askingPrice: manualPrice,
    high: Math.max(...matched.map((t) => t.price)),
    low: Math.min(...matched.map((t) => t.price)),
    changeRate: changeRate !== undefined ? Math.round(changeRate * 10) / 10 : undefined,
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

    for (const target of [...config.targets].sort((a, b) => a.priority - b.priority)) {
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
        residenceMonths: holding.residenceMonths,
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
 * 캐시 우선 조회 — 페이지 렌더링용.
 *
 * 매시간 tick 이 buildDashboard 를 돌려 캐시를 채우므로, 페이지는
 * 대부분 저장된 결과(<1초)를 읽는다. 캐시가 없거나 낡았을 때만
 * 직접 조립하고 그 결과를 캐시에 넣는다.
 */
export async function buildDashboardCached(
  userId: string,
  options: { fresh?: boolean } = {},
): Promise<DashboardData> {
  if (!options.fresh) {
    const cached = await loadDashboardCache(userId);
    if (cached) return cached;
  }
  const data = await buildDashboard({ userId });
  await saveDashboardCache(userId, data).catch(() => {});
  return data;
}

export async function buildDashboard(options: BuildDashboardOptions = {}): Promise<DashboardData> {
  const generatedAt = new Date().toISOString();
  const sourceStatus: SourceStatus[] = [];
  const config = await loadConfig(options.userId);

  // 실거래 집계가 1시간 넘게 낡았으면 최근월만 백그라운드로 다시 긁는다 (응답은 기다리지 않음)
  const lazy = options.skipLive
    ? { lastRefreshedAt: null, running: false, triggered: false, reason: '라이브 호출 생략' }
    : maybeRefreshTrades();

  /* --- 1) 실거래 집계 --- */
  const userCodes = analysisTargets(config);
  const analysisCodes = [...new Set([...DEFAULT_ANALYSIS_REGIONS, ...userCodes])];

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
  const tradeWindowStart = new Date();
  tradeWindowStart.setMonth(tradeWindowStart.getMonth() - 24);
  const tradeFromMonth = `${tradeWindowStart.getFullYear()}${String(tradeWindowStart.getMonth() + 1).padStart(2, '0')}`;

  /* 시세 매칭은 반드시 그 아파트의 시군구 캐시 안에서만 한다.
     전 지역을 합쳐 이름으로 찾으면 성동구 "옥수삼성"에 수서동·오금동의
     "삼성"아파트 거래가 섞여 시세가 25.7억으로 뛰는 실제 사고가 있었다
     (느슨한 이름 매칭이 "삼성" ⊂ "옥수삼성"을 허용하기 때문). */
  const tradesByRegion = new Map<string, TradeRecord[]>();
  for (const code of userCodes) {
    try {
      tradesByRegion.set(code, await loadTradeCache([code], tradeFromMonth));
    } catch (e) {
      tradesByRegion.set(code, []);
      sourceStatus.push({
        name: `실거래 원본 캐시 (${code})`,
        url: '#',
        status: 'error',
        message: (e as Error).message,
      });
    }
  }
  const userTrades: TradeRecord[] = [...tradesByRegion.values()].flat();

  const quotes: Record<string, PriceQuote> = {};
  for (const h of config.holdings) {
    quotes[h.id] = quoteFromTrades(
      tradesByRegion.get(h.lawdCd) ?? [],
      h.complexName,
      h.areaM2,
      h.manualPrice,
      h.dong,
    );
  }
  for (const t of config.targets) {
    quotes[t.id] = quoteFromTrades(
      tradesByRegion.get(t.lawdCd) ?? [],
      t.complexName,
      t.areaM2,
      t.manualPrice,
      t.dong,
    );
  }

  const gaps = buildGaps(config, quotes);

  /* 갭 변화(전주 대비) — 브리핑 발송 때 저장해 둔 스냅샷과 비교한다.
     타입에 gapBefore/gapDelta 가 정의만 있고 채우는 곳이 없어
     "갭 축소/확대" 문구가 영영 안 나가던 것을 여기서 살린다. */
  try {
    const before = (await loadSnapshotBefore(7)) as { gaps?: GapSummary[] } | null;
    if (before?.gaps?.length) {
      for (const g of gaps) {
        const prev = before.gaps.find(
          (b) => b.holdingId === g.holdingId && b.targetId === g.targetId,
        );
        if (prev && prev.gap > 0) {
          g.gapBefore = prev.gap;
          g.gapDelta = g.gap - prev.gap;
        }
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
