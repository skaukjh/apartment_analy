/**
 * 국토교통부 아파트 매매 실거래가 (공공데이터포털) 어댑터
 *
 * 신청: https://www.data.go.kr/data/15126469/openapi.do
 * 기술문서: docs/아파트 매매 실거래가 자료 기술문서.hwp
 *
 * 문서 기준(2024.07.17 개편):
 *  - 엔드포인트: https://apis.data.go.kr/1613000/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade
 *  - 파라미터: LAWD_CD(법정동코드 앞5자리), DEAL_YMD(계약년월 6자리), serviceKey, pageNo, numOfRows
 *  - 응답: XML only (JSON 미지원)
 *  - 제한: 30 TPS, 개발계정 일 10,000건
 *
 * 개편 전 경로(...AptTradeDev)를 쓰는 계정도 있어, 12(서비스 없음)/30(미등록 키)이 뜨면
 * 다른 경로로 한 번 더 시도한다. 성공한 경로는 기억해 이후 호출에 재사용한다.
 */

import { env } from '@/lib/env';
import type { RegionPricePoint, TradeRecord } from '@/lib/types';
import { dashYearMonth, median } from '@/lib/format';
import { findSigungu } from '@/lib/regions';
import { SOURCE_TTL } from '@/lib/refresh-policy';

/** 기술문서 기준 현행 경로를 먼저, 개편 전 경로를 나중에 시도한다 */
const ENDPOINTS: string[] = (() => {
  const override = process.env.MOLIT_ENDPOINT?.trim();
  if (override) return [override];
  return [
    'https://apis.data.go.kr/1613000/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade',
    'https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev',
  ];
})();

/** 한 번 성공한 경로를 기억해 매번 두 번 호출하지 않게 한다 */
let workingEndpoint: string | null = null;

/** 공공데이터포털 공통 에러코드 → 사람이 읽고 바로 조치할 수 있는 메시지 */
const ERROR_GUIDE: Record<string, string> = {
  '01': '제공기관 서비스 장애입니다. 잠시 후 다시 시도하세요.',
  '02': '제공기관 DB 오류입니다. 잠시 후 다시 시도하세요.',
  '03': '해당 조건에 거래 데이터가 없습니다.',
  '04': '제공기관 HTTP 오류입니다. 잠시 후 다시 시도하세요.',
  '05': '제공기관 응답 시간이 초과됐습니다.',
  '10': 'serviceKey 파라미터가 누락됐습니다.',
  '11': '필수 파라미터(LAWD_CD 또는 DEAL_YMD)가 누락됐습니다.',
  '12': '해당 오픈API 서비스가 없거나 폐기됐습니다. 엔드포인트를 확인하세요.',
  '20': '활용승인이 되지 않았습니다. 공공데이터포털에서 신청 승인 상태를 확인하세요 (보통 2~3일).',
  '22': '일일 트래픽을 초과했습니다. 개발계정은 하루 10,000건이며 운영계정 전환으로 늘릴 수 있습니다.',
  '30': '등록되지 않은 서비스키입니다. 마이페이지의 "일반 인증키(Decoding)" 값을 넣었는지 확인하세요.',
  '31': '서비스키 사용기간이 만료됐습니다. 공공데이터포털에서 연장하세요.',
  '32': '등록되지 않은 IP 입니다.',
  '33': '서명하지 않은 호출입니다.',
  '99': '기타 오류입니다.',
};

/** 데이터가 없다는 뜻이라 재시도해도 소용없는 코드 */
const NO_DATA_CODES = new Set(['03']);

/** 다른 엔드포인트로 바꿔 시도해 볼 만한 코드 */
const RETRY_OTHER_ENDPOINT = new Set(['12', '30', '20']);

/**
 * 계속 호출해도 똑같이 실패하는 코드.
 * 백필처럼 수천 번 도는 작업에서 이걸 만나면 즉시 멈춰 남은 트래픽을 아낀다.
 */
export const FATAL_CODES = new Set(['NO_KEY', '10', '20', '22', '30', '31', '32']);

export class MolitError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'MolitError';
  }
}

function describeError(code: string, rawMsg?: string): string {
  const guide = ERROR_GUIDE[code];
  return guide
    ? `실거래가 API 오류(${code}): ${guide}`
    : `실거래가 API 오류(${code}): ${rawMsg ?? '알 수 없는 오류'}`;
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
/** 한 엔드포인트로 전체 페이지를 긁는다 */
async function fetchFromEndpoint(
  endpoint: string,
  lawdCd: string,
  dealYmd: string,
  revalidate: number,
): Promise<TradeRecord[]> {
  const key = env.molitKey!;
  const region = findSigungu(lawdCd);
  const all: TradeRecord[] = [];
  const numOfRows = 1000;

  for (let pageNo = 1; pageNo <= 10; pageNo += 1) {
    const url =
      `${endpoint}?serviceKey=${encodeURIComponent(key)}` +
      `&LAWD_CD=${lawdCd}&DEAL_YMD=${dealYmd}&pageNo=${pageNo}&numOfRows=${numOfRows}`;

    const res = await fetch(url, {
      next: { revalidate },
      headers: { Accept: 'application/xml' },
    });

    if (!res.ok) {
      throw new MolitError(`실거래가 API HTTP ${res.status}`, String(res.status));
    }

    const xml = await res.text();

    // 인증 실패는 별도 XML 로 오기도 한다 (resultCode 없이)
    if (/SERVICE_KEY_IS_NOT_REGISTERED_ERROR|등록되지\s*않은\s*서비스키/.test(xml)) {
      throw new MolitError(describeError('30'), '30');
    }

    const resultCode = pickTag(xml, 'resultCode');
    if (resultCode) {
      const normalized = resultCode.replace(/^0+(?=\d)/, '').padStart(2, '0');
      const isOk = resultCode === '00' || resultCode === '000';
      if (!isOk) {
        if (NO_DATA_CODES.has(normalized)) return all; // 데이터 없음은 정상 종료
        throw new MolitError(describeError(normalized, pickTag(xml, 'resultMsg')), normalized);
      }
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

export async function fetchTrades(
  lawdCd: string,
  dealYmd: string,
  revalidate = SOURCE_TTL.molitRecent,
): Promise<TradeRecord[]> {
  if (!env.molitKey) {
    throw new MolitError('DATA_GO_KR_SERVICE_KEY 가 설정되지 않았습니다.', 'NO_KEY');
  }

  // 이미 통한 경로가 있으면 그것만 쓴다
  const candidates = workingEndpoint ? [workingEndpoint] : ENDPOINTS;
  let lastError: MolitError | null = null;

  for (const endpoint of candidates) {
    try {
      const result = await fetchFromEndpoint(endpoint, lawdCd, dealYmd, revalidate);
      workingEndpoint = endpoint;
      return result;
    } catch (e) {
      const err = e instanceof MolitError ? e : new MolitError(String(e));
      lastError = err;
      // 경로 문제로 보이면 다음 후보를 시도하고, 그 외(트래픽 초과 등)는 즉시 중단
      if (!err.code || !RETRY_OTHER_ENDPOINT.has(err.code)) throw err;
    }
  }

  throw lastError ?? new MolitError('실거래가 API 호출에 실패했습니다.');
}

/** 현재 사용 중인 엔드포인트 (진단용) */
export function activeEndpoint(): string {
  return workingEndpoint ?? ENDPOINTS[0];
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
        // 키·승인·트래픽 문제는 다음 월을 시도해도 똑같이 실패한다. 즉시 멈춰 호출을 아낀다.
        if (e instanceof MolitError && FATAL_CODES.has(e.code ?? '')) throw e;
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
