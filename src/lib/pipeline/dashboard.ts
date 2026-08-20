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
import { analyzeRebound, summarizeSpread } from '@/lib/analysis/rebound';
import {
  computeSentiment,
  findPriceExtremes,
  mergeMonthlySeries,
} from '@/lib/analysis/market-signals';
import { buildCatalysts } from '@/lib/analysis/catalysts';
import { buildSchedule } from '@/lib/analysis/schedule';
import { fetchAllMacro } from '@/lib/sources/ecos';
import { fetchMarketNews, fetchRegionNews } from '@/lib/sources/news';
import { fetchRebBundle } from '@/lib/sources/reb';
import { filterComplex } from '@/lib/sources/molit';
import { DEFAULT_ANALYSIS_REGIONS } from '@/lib/regions';
import { featureFlags } from '@/lib/env';
import { maybeRefreshTrades } from './lazy-refresh';
import { formatArea, median, todayKst } from '@/lib/format';
import { tradePriceOf } from '@/lib/analysis/price-basis';
import { calcAcquisitionTaxFor } from '@/lib/tax/acquisition';
import { calcTransactionCost } from '@/lib/tax/transaction-costs';
import { calcCapitalGainsTax } from '@/lib/tax/capital-gains';

/* ------------------------------------------------------------------ */
/* 시세 산출                                                            */
/* ------------------------------------------------------------------ */

function quoteFromTrades(
  trades: TradeRecord[],
  complexName: string,
  areaM2: number,
  manualPrice?: number,
): PriceQuote {
  const matched = filterComplex(trades, complexName, areaM2);

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

      // 세후 실제 필요 자금 = (매수가 + 취득세 + 매수부대) - (매도가 - 양도세 - 매도부대 - 대출/보증금)
      const cgt = calcCapitalGainsTax({
        salePrice: holdingPrice,
        acquisitionPrice: holding.acquisitionPrice,
        expenses: holding.acquisitionCost + holding.capitalExpenditure,
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
      const sellCost = calcTransactionCost({ price: holdingPrice, side: 'sell' });
      const buyCost = calcTransactionCost({ price: targetPrice, side: 'buy', withMortgage: true });

      const netFromSale = holdingPrice - cgt.total - sellCost.total;
      const realCashNeeded = targetPrice + acq.total + buyCost.total - netFromSale;

      gaps.push({
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
}

export async function buildDashboard(options: BuildDashboardOptions = {}): Promise<DashboardData> {
  const generatedAt = new Date().toISOString();
  const sourceStatus: SourceStatus[] = [];
  const config = await loadConfig();

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
  const twelveMonthsAgo = new Date();
  twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 24);
  const tradeFromMonth = `${twelveMonthsAgo.getFullYear()}${String(twelveMonthsAgo.getMonth() + 1).padStart(2, '0')}`;

  let userTrades: TradeRecord[] = [];
  try {
    userTrades = await loadTradeCache(userCodes, tradeFromMonth);
  } catch (e) {
    sourceStatus.push({
      name: '실거래 원본 캐시',
      url: '#',
      status: 'error',
      message: (e as Error).message,
    });
  }

  const quotes: Record<string, PriceQuote> = {};
  for (const h of config.holdings) {
    quotes[h.id] = quoteFromTrades(userTrades, h.complexName, h.areaM2, h.manualPrice);
  }
  for (const t of config.targets) {
    quotes[t.id] = quoteFromTrades(userTrades, t.complexName, t.areaM2, t.manualPrice);
  }

  const gaps = buildGaps(config, quotes);

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

  /* --- 7) 뉴스 · 호재 (요구사항 4) --- */
  let news: NewsItem[] = [];
  if (!options.skipLive && featureFlags.hasNaver) {
    const [regionNews, marketNews] = await Promise.all([
      fetchRegionNews(config.watchRegions).catch(() => ({ items: [], errors: ['지역 뉴스 실패'] })),
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

  const catalysts = buildCatalysts({ regions: config.watchRegions, news });

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
