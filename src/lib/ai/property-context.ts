/**
 * AI 평가·챗봇에 넘길 "부동산 종합 컨텍스트" 조립.
 *
 * 여기서 모으는 정보가 곧 AI 가 아는 전부다. 그래서 수치는 반드시 출처와 기준 시점을
 * 함께 넣고, 추정치는 추정이라고 표시한다. AI 가 없는 사실을 지어내지 않게 하려면
 * 프롬프트보다 컨텍스트의 정직함이 먼저다.
 */

import type { ApartmentRef, DashboardData, PriceQuote } from '@/lib/types';
import { regulationOf, REGULATION_AS_OF } from '@/lib/analysis/regulation';
import { calcAcquisitionTax } from '@/lib/tax/acquisition';
import { calcTransactionCost } from '@/lib/tax/transaction-costs';
import { calcLoanLimit } from '@/lib/tax/loan-limit';
import { fetchNearby, hasPlaceApi, type NearbySummary } from '@/lib/sources/place';
import { fetchBankMortgageRates, hasBankRates, type BankRate } from '@/lib/sources/bank-rates';
import { HEAT_META } from '@/lib/analysis/market-signals';
import { STAGE_META } from '@/lib/analysis/rebound';
import { formatKrw, formatPct } from '@/lib/format';

export interface PropertyContext {
  /** 사람이 읽어도 되는 마크다운 — 그대로 프롬프트에 넣는다 */
  markdown: string;
  /** 화면 표시용 부가 정보 */
  nearby: NearbySummary | null;
  bankRates: BankRate[];
  /** 컨텍스트에 담지 못한 것 (AI 에게 "모른다"고 알려줄 항목) */
  gaps: string[];
}

function line(label: string, value: string): string {
  return `- ${label}: ${value}`;
}

export async function buildPropertyContext(
  apartment: ApartmentRef,
  data: DashboardData,
  options: { price?: number } = {},
): Promise<PropertyContext> {
  const gaps: string[] = [];
  const quote: PriceQuote | undefined = data.quotes[apartment.id];
  const price = options.price ?? quote?.price ?? 0;

  const reg = regulationOf(apartment.lawdCd);
  const region = data.rebound.find((r) => r.lawdCd === apartment.lawdCd);
  const household = data.config.household;

  /* --- 외부 정보 (실패해도 진행) --- */
  const [nearby, bankRates] = await Promise.all([
    hasPlaceApi()
      ? fetchNearby(apartment.complexName, apartment.sigungu, apartment.dong).catch(() => null)
      : Promise.resolve(null),
    hasBankRates() ? fetchBankMortgageRates(6).catch(() => []) : Promise.resolve([]),
  ]);

  if (!nearby)
    gaps.push('주변 입지(역·학교·마트) 정보 없음 — KAKAO_REST_API_KEY 미설정 또는 단지 검색 실패');
  if (bankRates.length === 0) gaps.push('은행별 공시 금리 없음 — FSS_API_KEY 미설정');
  if (price <= 0) gaps.push('시세 없음 — 실거래 수집 전이거나 호가 미입력');

  const rate = bankRates[0]?.minRate ?? 4.2;

  /* --- 비용·대출 계산 --- */
  const sections: string[] = [];

  sections.push(
    `# 대상 아파트\n` +
      line('단지', `${apartment.complexName} 전용 ${apartment.areaM2}㎡`) +
      '\n' +
      line('위치', `${apartment.sido} ${apartment.sigungu} ${apartment.dong ?? ''}`.trim()) +
      '\n' +
      line(
        '시세',
        price > 0
          ? `${formatKrw(price)} (근거: ${
              quote?.basis === 'manual'
                ? '사용자 입력 호가'
                : quote?.basis === 'recent-trade'
                  ? `최근 실거래 ${quote.sampleSize}건 중앙값, 최근 거래일 ${quote.lastDealDate ?? '-'}`
                  : '미확인'
            })`
          : '확인 불가',
      ),
  );

  sections.push(
    `\n# 규제 현황 (${REGULATION_AS_OF} 기준, 정부 공고로 변동)\n` +
      line('지정', reg.badges.join(', ')) +
      '\n' +
      reg.effects.map((e) => `- ${e}`).join('\n'),
  );

  if (price > 0) {
    const loan = calcLoanLimit({
      price,
      regulated: reg.adjusted,
      metro: reg.metro,
      retainedHouseCount: household.ownedHouseCount > 0 ? 0 : 0, // 갈아타기/무주택 모두 처분조건 가정
      firstTimeBuyer: household.firstTimeBuyer,
      annualIncome: household.annualIncome,
      otherDebtAnnualPayment: household.otherDebtAnnualPayment,
      rate,
    });
    const acq = calcAcquisitionTax({
      price,
      areaM2: apartment.areaM2,
      houseCountAfter: 1,
      isRegulated: reg.adjusted,
      temporaryTwoHouse: household.temporaryTwoHouse,
      firstTimeBuyer: household.firstTimeBuyer,
    });
    const cost = calcTransactionCost({ price, side: 'buy', withMortgage: loan.limit > 0 });

    sections.push(
      `\n# 자금 계산 (금리 ${rate}% 가정${bankRates[0] ? `, ${bankRates[0].bank} 최저 공시금리` : ''})\n` +
        line(
          '대출 가능액',
          `${formatKrw(loan.limit)} (${loan.bindingFactor} 기준, LTV ${loan.ltvRate}%)`,
        ) +
        '\n' +
        line('월 원리금', `${formatKrw(loan.monthlyPayment)} (40년 원리금균등)`) +
        '\n' +
        line('취득세 등', `${formatKrw(acq.total)} (세율 ${acq.rate}%)`) +
        '\n' +
        line('중개·법무 등 부대비', formatKrw(cost.total)) +
        '\n' +
        line('총 필요 자금', formatKrw(price + acq.total + cost.total)) +
        '\n' +
        line('대출 제외 필요 현금', formatKrw(price + acq.total + cost.total - loan.limit)) +
        '\n' +
        line('보유 현금', household.cashAssets > 0 ? formatKrw(household.cashAssets) : '미입력'),
    );
  }

  if (region) {
    sections.push(
      `\n# 지역 시세 흐름 (${apartment.sigungu})\n` +
        line(
          `${region.baseMonth} 대비`,
          `${formatPct(region.changeSinceBase, 1)} (최신 ${region.latestMonth})`,
        ) +
        '\n' +
        line('저점 대비 반등', formatPct(region.reboundFromTrough, 1)) +
        '\n' +
        line('최근 3개월', formatPct(region.recent3mChange, 2)) +
        '\n' +
        line(
          '반등 단계',
          `${STAGE_META[region.stage].label} — ${STAGE_META[region.stage].description}`,
        ) +
        '\n' +
        line('분석 표본', `${region.sampleSize.toLocaleString('ko-KR')}건`),
    );
  } else {
    gaps.push(`${apartment.sigungu} 지역 시세 시계열 없음`);
  }

  if (nearby) {
    const fmt = (list: NearbySummary['subway']) =>
      list.length > 0
        ? list.map((p) => `${p.name}(${p.distance}m, 도보 ${p.walkMinutes}분)`).join(', ')
        : '주변에 없음';
    sections.push(
      `\n# 주변 입지 (카카오 로컬, 좌표 매칭: ${nearby.coord.matched})\n` +
        line('지하철역', fmt(nearby.subway)) +
        '\n' +
        line('학교', fmt(nearby.school)) +
        '\n' +
        line('대형마트', fmt(nearby.mart)) +
        '\n' +
        line('병원', fmt(nearby.hospital)) +
        '\n' +
        line('공원', fmt(nearby.park)),
    );
  }

  const catalysts = data.catalysts
    .filter((c) => c.regionId === apartment.lawdCd || true)
    .slice(0, 5);
  if (catalysts.length > 0) {
    sections.push(
      `\n# 관련 호재 (뉴스에서 단계 추론)\n` +
        catalysts
          .map(
            (c) =>
              `- ${c.title}: ${c.stage} (${c.progress}%), 영향도 ${c.impact}, 최근 업데이트 ${c.lastUpdate === '미확인' ? '없음' : c.lastUpdate.slice(0, 10)}`,
          )
          .join('\n'),
    );
  }

  const heat = HEAT_META[data.sentiment.heatLevel];
  sections.push(
    `\n# 시장 온도\n` +
      line('과열 점수', `${data.sentiment.heatScore}/100 (${heat.label})`) +
      '\n' +
      line('매매수급지수', `${data.sentiment.supplyDemandIndex} (100 초과 = 매수우위)`) +
      '\n' +
      line('신고가 비중', `${data.sentiment.newHighRatio.toFixed(1)}%`) +
      '\n' +
      line('거래량 전년比', formatPct(data.sentiment.volumeYoy, 0)),
  );

  if (data.macro.length > 0) {
    sections.push(
      `\n# 거시 지표\n` +
        data.macro
          .map((m) => `- ${m.label}: ${m.latest}${m.unit === '%' ? '%' : ''} (${m.latestPeriod})`)
          .join('\n'),
    );
  }

  if (bankRates.length > 0) {
    sections.push(
      `\n# 시중은행 주담대 공시금리 (금감원, ${bankRates[0].disclosureMonth} 기준)\n` +
        bankRates
          .map(
            (b) =>
              `- ${b.bank} ${b.product}: ${b.minRate}~${b.maxRate}% (${b.rateType}, ${b.repayType})`,
          )
          .join('\n'),
    );
  }

  if (gaps.length > 0) {
    sections.push(
      `\n# 확보하지 못한 정보 (추측하지 말 것)\n` + gaps.map((g) => `- ${g}`).join('\n'),
    );
  }

  return { markdown: sections.join('\n'), nearby, bankRates, gaps };
}
