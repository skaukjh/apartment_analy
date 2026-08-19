/**
 * 국토교통부 아파트 매매 실거래가 (공공데이터포털) 어댑터
 *
 * 신청: https://www.data.go.kr/data/15126469/openapi.do
 * 엔드포인트: https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev
 *
 * 응답은 XML이므로 의존성 없는 경량 파서로 처리한다.
 */

import { env } from '@/lib/env';
import type { RegionPricePoint, TradeRecord } from '@/lib/types';
import { dashYearMonth, median } from '@/lib/format';
import { findSigungu } from '@/lib/regions';
import { SOURCE_TTL } from '@/lib/refresh-policy';

const ENDPOINT = 'https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev';

export class MolitError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'MolitError';
  }
}

/* ------------------------------------------------------------------ */
/* 경량 XML 파서                                                        */
/* ------------------------------------------------------------------ */

function decodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function pickTag(xml: string, tag: string): string | undefined {
  const m = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return m ? decodeEntities(m[1]).trim() : undefined;
}

function extractItems(xml: string): string[] {
  const items: string[] = [];
  const re = /<item>([\s\S]*?)<\/item>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) items.push(m[1]);
  return items;
}

/** "  82,500" (만원) → 825000000 (원) */
function parseDealAmount(raw: string | undefined): number {
  if (!raw) return 0;
  const n = Number(raw.replace(/[,\s]/g, ''));
  return Number.isFinite(n) ? n * 10_000 : 0;
}

function parseItem(itemXml: string, fallbackSigungu: string): TradeRecord | null {
  const price = parseDealAmount(pickTag(itemXml, 'dealAmount'));
  if (price <= 0) return null;

  const year = pickTag(itemXml, 'dealYear');
  const month = pickTag(itemXml, 'dealMonth');
  const day = pickTag(itemXml, 'dealDay');
  if (!year || !month || !day) return null;

  const areaM2 = Number(pickTag(itemXml, 'excluUseAr') ?? '0');
  if (!Number.isFinite(areaM2) || areaM2 <= 0) return null;

  const cdealType = pickTag(itemXml, 'cdealType');

  return {
    dealDate: `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`,
    sigungu: pickTag(itemXml, 'estateAgentSggNm') ?? fallbackSigungu,
    dong: pickTag(itemXml, 'umdNm') ?? '',
    complexName: pickTag(itemXml, 'aptNm') ?? pickTag(itemXml, 'aptDong') ?? '',
    areaM2,
    floor: Number(pickTag(itemXml, 'floor') ?? '0') || 0,
    price,
    builtYear: Number(pickTag(itemXml, 'buildYear') ?? '0') || undefined,
    canceled: cdealType === 'O',
  };
}

/* ------------------------------------------------------------------ */
/* API 호출                                                            */
/* ------------------------------------------------------------------ */

/**
 * 특정 시군구·월의 아파트 매매 실거래 전체를 가져온다.
 * @param lawdCd 법정동코드 앞 5자리
 * @param dealYmd YYYYMM
 * @param revalidate 캐시 유효시간(초). 과거 월은 길게, 당월은 짧게 준다.
 */
export async function fetchTrades(
  lawdCd: string,
  dealYmd: string,
  revalidate = SOURCE_TTL.molitRecent,
): Promise<TradeRecord[]> {
  const key = env.molitKey;
  if (!key) throw new MolitError('DATA_GO_KR_SERVICE_KEY 가 설정되지 않았습니다.', 'NO_KEY');

  const region = findSigungu(lawdCd);
  const all: TradeRecord[] = [];
  const numOfRows = 1000;

  for (let pageNo = 1; pageNo <= 10; pageNo += 1) {
    const url =
      `${ENDPOINT}?serviceKey=${encodeURIComponent(key)}` +
      `&LAWD_CD=${lawdCd}&DEAL_YMD=${dealYmd}&pageNo=${pageNo}&numOfRows=${numOfRows}`;

    const res = await fetch(url, {
      next: { revalidate },
      headers: { Accept: 'application/xml' },
    });

    if (!res.ok) {
      throw new MolitError(`실거래가 API HTTP ${res.status}`, String(res.status));
    }

    const xml = await res.text();

    const resultCode = pickTag(xml, 'resultCode');
    if (resultCode && resultCode !== '00' && resultCode !== '000') {
      const msg = pickTag(xml, 'resultMsg') ?? pickTag(xml, 'returnAuthMsg') ?? '알 수 없는 오류';
      throw new MolitError(`실거래가 API 오류(${resultCode}): ${msg}`, resultCode);
    }
    if (xml.includes('SERVICE_KEY_IS_NOT_REGISTERED_ERROR')) {
      throw new MolitError(
        '서비스키가 등록되지 않았습니다. 활용신청 승인 여부를 확인하세요.',
        'NO_KEY',
      );
    }

    const items = extractItems(xml);
    for (const item of items) {
      const rec = parseItem(item, region?.name ?? '');
      if (rec && !rec.canceled) all.push(rec);
    }

    const totalCount = Number(pickTag(xml, 'totalCount') ?? '0');
    if (items.length < numOfRows || pageNo * numOfRows >= totalCount) break;
  }

  return all;
}

/** 여러 월을 순차 조회 (동시 요청 수 제한으로 API 차단 방지) */
export async function fetchTradesForMonths(
  lawdCd: string,
  months: string[],
  concurrency = 3,
): Promise<Record<string, TradeRecord[]>> {
  const result: Record<string, TradeRecord[]> = {};
  const queue = [...months];

  async function worker() {
    for (;;) {
      const m = queue.shift();
      if (!m) return;
      try {
        // 최근 2개월은 신고가 계속 들어오므로 캐시를 짧게, 과거월은 길게
        const isRecent = months.indexOf(m) >= months.length - 2;
        result[m] = await fetchTrades(
          lawdCd,
          m,
          isRecent ? SOURCE_TTL.molitRecent : SOURCE_TTL.molitHistory,
        );
      } catch (e) {
        if (e instanceof MolitError && e.code === 'NO_KEY') throw e;
        result[m] = [];
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, months.length) }, worker));
  return result;
}

/* ------------------------------------------------------------------ */
/* 집계                                                                */
/* ------------------------------------------------------------------ */

/**
 * 월별 ㎡당 평균 거래가로 지역 시계열을 만든다.
 * 단순 평균은 거래된 단지 구성에 따라 흔들리므로 중앙값을 쓴다.
 */
export function aggregateMonthly(tradesByMonth: Record<string, TradeRecord[]>): RegionPricePoint[] {
  return Object.entries(tradesByMonth)
    .map(([month, trades]) => {
      const valid = trades.filter((t) => t.areaM2 > 0 && t.price > 0);
      const perM2 = valid.map((t) => t.price / t.areaM2);
      return {
        month: dashYearMonth(month),
        pricePerM2: Math.round(median(perM2)),
        count: valid.length,
      };
    })
    .filter((p) => p.count > 0)
    .sort((a, b) => a.month.localeCompare(b.month));
}

/**
 * 법정동별 월 시계열 집계.
 * 실거래 응답의 umdNm(법정동)을 그대로 키로 쓴다.
 */
export function aggregateMonthlyByDong(
  tradesByMonth: Record<string, TradeRecord[]>,
): Record<string, RegionPricePoint[]> {
  const byDong: Record<string, Record<string, { prices: number[]; count: number }>> = {};

  for (const [month, trades] of Object.entries(tradesByMonth)) {
    for (const t of trades) {
      if (!t.dong || t.areaM2 <= 0 || t.price <= 0) continue;
      const dong = (byDong[t.dong] ??= {});
      const bucket = (dong[month] ??= { prices: [], count: 0 });
      bucket.prices.push(t.price / t.areaM2);
      bucket.count += 1;
    }
  }

  const result: Record<string, RegionPricePoint[]> = {};
  for (const [dong, months] of Object.entries(byDong)) {
    result[dong] = Object.entries(months)
      .map(([month, b]) => ({
        month: dashYearMonth(month),
        pricePerM2: Math.round(median(b.prices)),
        count: b.count,
      }))
      .sort((a, b) => a.month.localeCompare(b.month));
  }
  return result;
}

/** 특정 단지·면적대의 최근 실거래만 추출 */
export function filterComplex(
  trades: TradeRecord[],
  complexName: string,
  areaM2: number,
  areaTolerance = 3,
): TradeRecord[] {
  const normalized = complexName.replace(/\s+/g, '').toLowerCase();
  return trades
    .filter((t) => {
      const name = t.complexName.replace(/\s+/g, '').toLowerCase();
      return (
        (name.includes(normalized) || normalized.includes(name)) &&
        Math.abs(t.areaM2 - areaM2) <= areaTolerance
      );
    })
    .sort((a, b) => b.dealDate.localeCompare(a.dealDate));
}
