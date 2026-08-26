/**
 * 한국부동산원 R-ONE 부동산통계정보 OpenAPI 어댑터
 *
 * 신청: https://www.reb.or.kr/r-one/portal/openapi/openApiIntro.do
 * 형식: https://www.reb.or.kr/r-one/openapi/SttsApiTblData.do
 *        ?KEY=&Type=json&pIndex=1&pSize=100&STATBL_ID=&DTACYCLE_CD=&WRTTIME_IDTFR_ID=
 *
 * 여기서 가져오는 것:
 *  - 주간 아파트 매매가격지수 (전국/시도)
 *  - 매매수급동향지수 (100 초과 = 매수우위)
 *
 * 키가 없으면 국토부 실거래가로부터 파생 지표를 계산하는 폴백을 사용한다.
 */

import { env } from '@/lib/env';
import type { MacroIndicator, MacroSeriesPoint } from '@/lib/types';
import { SOURCE_TTL } from '@/lib/refresh-policy';
import { comparePeriods } from '@/lib/analysis/period-compare';
import { bumpApiUsage } from '@/lib/store/api-usage';

const BASE = 'https://www.reb.or.kr/r-one/openapi/SttsApiTblData.do';

export interface RebSpec {
  /** 통계표 ID */
  statblId: string;
  /** 주기: WK(주), MM(월) */
  cycle: 'WK' | 'MM';
  /** 분류값 (지역 등) */
  clsId?: string;
  label: string;
}

/**
 * 통계표 ID는 R-ONE 개편으로 바뀔 수 있어 환경변수로 덮어쓸 수 있게 했다.
 * 기본값은 널리 쓰이는 코드이며, 실제 응답이 비면 폴백 계산으로 넘어간다.
 */
export const REB_SPECS = {
  /** 주간 아파트 매매가격지수 */
  weeklySalePriceIndex: {
    // R-ONE 카탈로그(docs/REB-CATALOG.md)에서 확인한 실제 ID — 기존 A_2024_00178 은 존재하지 않았다
    statblId: process.env.REB_STATBL_WEEKLY_PRICE ?? 'T244183132827305',
    cycle: 'WK' as const,
    label: '주간 아파트 매매가격지수',
  },
  /** 매매수급동향 */
  supplyDemand: {
    statblId: process.env.REB_STATBL_SUPPLY_DEMAND ?? 'T248163133074619',
    cycle: 'WK' as const,
    label: '아파트 매매수급동향',
  },
} satisfies Record<string, RebSpec>;

interface RebRow {
  WRTTIME_IDTFR_ID: string;
  CLS_NM?: string;
  CLS_ID?: string;
  /** 계층 전체 이름 — '전국', '전국>계', '경기>이천시' 형태. 전국 행 식별에 쓴다 */
  CLS_FULLNM?: string;
  DTA_VAL: string | number;
  ITM_NM?: string;
}

export interface RebSeries {
  label: string;
  /** 지역명 → 시계열 */
  byRegion: Record<string, MacroSeriesPoint[]>;
  sourceUrl: string;
}

function formatRebPeriod(raw: string): string {
  // 202608 또는 20260817 형태
  if (raw.length === 6) return `${raw.slice(0, 4)}-${raw.slice(4, 6)}`;
  if (raw.length === 8) return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  return raw;
}

export async function fetchRebSeries(spec: RebSpec, pSize = 1000): Promise<RebSeries> {
  const key = env.rebKey;
  if (!key) throw new Error('REB_API_KEY 가 설정되지 않았습니다.');

  const url =
    `${BASE}?KEY=${encodeURIComponent(key)}&Type=json&pIndex=1&pSize=${pSize}` +
    `&STATBL_ID=${spec.statblId}&DTACYCLE_CD=${spec.cycle}`;

  bumpApiUsage('reb');
  const res = await fetch(url, { next: { revalidate: SOURCE_TTL.reb } });
  if (!res.ok) throw new Error(`R-ONE HTTP ${res.status}`);

  const json = (await res.json()) as Record<string, unknown>;

  // R-ONE 응답 구조: { SttsApiTblData: [ {head:[...]}, {row:[...]} ] }
  const container = json.SttsApiTblData as Array<Record<string, unknown>> | undefined;
  if (!container) {
    const result = json.RESULT as { CODE?: string; MESSAGE?: string } | undefined;
    throw new Error(`R-ONE 응답 파싱 실패${result ? `: ${result.CODE} ${result.MESSAGE}` : ''}`);
  }

  const rowBlock = container.find((c) => Array.isArray(c.row));
  const rows = (rowBlock?.row ?? []) as RebRow[];

  const byRegion: Record<string, MacroSeriesPoint[]> = {};
  for (const r of rows) {
    const region = r.CLS_NM ?? r.CLS_ID ?? '전국';
    const value = Number(r.DTA_VAL);
    if (!Number.isFinite(value)) continue;
    (byRegion[region] ??= []).push({
      period: formatRebPeriod(String(r.WRTTIME_IDTFR_ID)),
      value,
    });
  }

  for (const key of Object.keys(byRegion)) {
    byRegion[key].sort((a, b) => a.period.localeCompare(b.period));
  }

  return {
    label: spec.label,
    byRegion,
    sourceUrl: 'https://www.reb.or.kr/r-one/',
  };
}

/* ------------------------------------------------------------------ */
/* 월간 전국 지표 — R-ONE 공표 통계를 거시 지표 카드에 올린다              */
/* ------------------------------------------------------------------ */

/**
 * 월간 통계표 목록. 통계표 ID 는 docs/REB-CATALOG.md 에서 확인한 실제 값이다.
 *
 * pages: R-ONE 은 오래된 행부터 페이지가 시작되므로 "마지막 N페이지"만 받는다.
 * 표마다 월당 행 수(지역 수)가 달라 필요한 페이지 수도 다르다.
 * (지가변동률 표는 월 6,000행이 넘어 전국 시계열을 뽑으려면 수십 페이지가
 *  필요해 제외했다 — 연간 표로 대체할 수 있으면 그때 붙인다)
 */
const REB_MONTHLY_SPECS: Array<{
  key: MacroIndicator['key'];
  statblId: string;
  pages: number;
  label: string;
  unit: string;
  /** 전국 행이 없는 표는 '시도>계' 행을 합산해 전국을 만든다 (미분양) */
  aggregate?: 'sum-sido-totals';
}> = [
  {
    key: 'reb-apt-sale-index',
    statblId: 'A_2024_00045',
    pages: 5,
    label: '아파트 매매가격지수 (전국주택가격동향조사)',
    unit: '',
  },
  {
    key: 'reb-apt-jeonse-index',
    statblId: 'A_2024_00050',
    pages: 5,
    label: '아파트 전세가격지수 (전국주택가격동향조사)',
    unit: '',
  },
  {
    key: 'reb-apt-rt-index',
    statblId: 'A_2024_00178',
    pages: 2,
    label: '공동주택 실거래가격지수 (아파트)',
    unit: '',
  },
  {
    key: 'reb-unsold',
    statblId: 'T237973129847263',
    pages: 5,
    label: '전국 미분양 주택',
    unit: '호',
    // 이 표는 최근 월에 '전국' 행이 없고 '시도>계' 17행만 있다
    aggregate: 'sum-sido-totals',
  },
  {
    key: 'reb-consumer-sentiment',
    statblId: 'T232543129897499',
    pages: 2,
    label: '주택시장 소비심리지수',
    unit: '',
  },
];

/** '전국' 행인지 — 표마다 '전국', '전국>계', '전국>소계' 로 다르다 */
function isNationalRow(r: RebRow): boolean {
  const full = r.CLS_FULLNM ?? '';
  return full === '전국' || full.startsWith('전국>') || r.CLS_NM === '전국';
}

async function fetchRebPage(
  statblId: string,
  pIndex: number,
  pSize: number,
): Promise<{
  rows: RebRow[];
  total: number;
}> {
  const key = env.rebKey;
  if (!key) throw new Error('REB_API_KEY 가 설정되지 않았습니다.');

  const url =
    `${BASE}?KEY=${encodeURIComponent(key)}&Type=json&pIndex=${pIndex}&pSize=${pSize}` +
    `&STATBL_ID=${statblId}&DTACYCLE_CD=MM`;

  bumpApiUsage('reb');
  const res = await fetch(url, { next: { revalidate: SOURCE_TTL.reb } });
  if (!res.ok) throw new Error(`R-ONE HTTP ${res.status}`);

  const json = (await res.json()) as Record<string, unknown>;
  const container = json.SttsApiTblData as Array<Record<string, unknown>> | undefined;
  if (!container) {
    const result = json.RESULT as { CODE?: string; MESSAGE?: string } | undefined;
    throw new Error(`R-ONE 응답 파싱 실패${result ? `: ${result.CODE} ${result.MESSAGE}` : ''}`);
  }

  const rows = (container.find((c) => Array.isArray(c.row))?.row ?? []) as RebRow[];
  const head = container[0]?.head as Array<Record<string, unknown>> | undefined;
  const total = Number(head?.find((h) => h.list_total_count)?.list_total_count ?? 0);
  return { rows, total };
}

/** YYYY-MM 에서 12개월 전 */
function minus12Months(period: string): string {
  const [y, m] = period.split('-').map(Number);
  const d = new Date(y, m - 1 - 12, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** 한 통계표의 전국 월간 시계열을 MacroIndicator 로 만든다 */
async function fetchRebMonthlyIndicator(
  spec: (typeof REB_MONTHLY_SPECS)[number],
): Promise<MacroIndicator> {
  // 최신 행이 뒤에 있으므로 총 행수를 확인해 마지막 페이지들만 받는다
  const PAGE = 1000;
  const probe = await fetchRebPage(spec.statblId, 1, 1);
  const lastPage = Math.max(1, Math.ceil(probe.total / PAGE));

  const rows: RebRow[] = [];
  for (let p = Math.max(1, lastPage - spec.pages + 1); p <= lastPage; p += 1) {
    const { rows: pageRows } = await fetchRebPage(spec.statblId, p, PAGE);
    rows.push(...pageRows);
  }

  const byPeriod = new Map<string, number>();

  if (spec.aggregate === 'sum-sido-totals') {
    /* '시도>계' 17행을 월별로 합산한다. 페이지 경계에 걸려 시도 일부만 잡힌
       달은 전국값이 작게 나오므로, 15개 시도 이상 모인 달만 채택한다. */
    const acc = new Map<string, { sum: number; n: number }>();
    for (const r of rows) {
      if (!/^[^>]+>계$/.test(r.CLS_FULLNM ?? '')) continue;
      const value = Number(r.DTA_VAL);
      if (!Number.isFinite(value)) continue;
      const period = formatRebPeriod(String(r.WRTTIME_IDTFR_ID));
      const a = acc.get(period) ?? { sum: 0, n: 0 };
      a.sum += value;
      a.n += 1;
      acc.set(period, a);
    }
    for (const [period, a] of acc) {
      if (a.n >= 15) byPeriod.set(period, a.sum);
    }
  } else {
    // 전국 행만 → 기간별 마지막 값 (중복 시 뒤가 최신 발표)
    for (const r of rows) {
      if (!isNationalRow(r)) continue;
      const value = Number(r.DTA_VAL);
      if (!Number.isFinite(value)) continue;
      byPeriod.set(formatRebPeriod(String(r.WRTTIME_IDTFR_ID)), value);
    }
  }

  const series: MacroSeriesPoint[] = [...byPeriod.entries()]
    .map(([period, value]) => ({ period, value }))
    .sort((a, b) => a.period.localeCompare(b.period));

  if (series.length === 0) throw new Error(`${spec.label}: 전국 시계열이 비어 있습니다.`);

  const latest = series[series.length - 1];
  const prev = series[series.length - 2];
  const yearAgo = series.find((p) => p.period === minus12Months(latest.period));

  return {
    key: spec.key,
    label: spec.label,
    unit: spec.unit,
    latest: Math.round(latest.value * 100) / 100,
    latestPeriod: latest.period,
    change: prev ? Math.round((latest.value - prev.value) * 100) / 100 : 0,
    yoy: yearAgo ? ((latest.value - yearAgo.value) / yearAgo.value) * 100 : undefined,
    compare: comparePeriods(series, { pointDiff: spec.unit === '%' }),
    series,
    source: '한국부동산원 R-ONE',
    sourceUrl: 'https://www.reb.or.kr/r-one/',
  };
}

/** 월간 전국 지표 묶음 — 실패한 표는 오류 목록으로 흘려보낸다 */
export async function fetchRebMonthlyMacro(): Promise<{
  indicators: MacroIndicator[];
  errors: string[];
}> {
  const indicators: MacroIndicator[] = [];
  const errors: string[] = [];

  // 순차 호출 — 표당 페이지가 여러 개라 병렬로 몰면 R-ONE 이 간헐적으로 거부한다
  for (const spec of REB_MONTHLY_SPECS) {
    try {
      indicators.push(await fetchRebMonthlyIndicator(spec));
    } catch (e) {
      errors.push(`${spec.label}: ${(e as Error).message}`);
    }
  }

  return { indicators, errors };
}

/** 부동산원 지표를 한 번에 가져오되, 실패는 null로 흘려보낸다 */
export async function fetchRebBundle(): Promise<{
  priceIndex: RebSeries | null;
  supplyDemand: RebSeries | null;
  errors: string[];
}> {
  const errors: string[] = [];
  const [priceIndex, supplyDemand] = await Promise.all([
    fetchRebSeries(REB_SPECS.weeklySalePriceIndex).catch((e) => {
      errors.push(`주간 매매가격지수: ${e.message}`);
      return null;
    }),
    fetchRebSeries(REB_SPECS.supplyDemand).catch((e) => {
      errors.push(`매매수급동향: ${e.message}`);
      return null;
    }),
  ]);

  return { priceIndex, supplyDemand, errors };
}
