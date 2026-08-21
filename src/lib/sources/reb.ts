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
import type { MacroSeriesPoint } from '@/lib/types';
import { SOURCE_TTL } from '@/lib/refresh-policy';

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
