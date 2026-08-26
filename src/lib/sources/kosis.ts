/**
 * 통계청 KOSIS OpenAPI 어댑터.
 *
 * 신청: https://kosis.kr/openapi (활용신청 → 인증키 발급)
 * 기본으로 가져오는 것: 국내인구이동통계 시도별 순이동자수 (orgId 101, DT_1B26001_A01).
 * 수도권 순유입은 주택 수요의 장기 선행 지표라 갈아타기 판단에 직접 쓸모가 있다.
 *
 * KOSIS 는 통계표마다 파라미터가 달라, 표 ID·항목이 개편되면
 * KOSIS_URL_NET_MIGRATION 환경변수로 전체 URL 을 덮어쓸 수 있게 했다.
 * (CPI 등 통계청의 다른 핵심 지표는 이미 한국은행 ECOS 경유로 수집한다)
 */

import type { MacroIndicator, MacroSeriesPoint } from '@/lib/types';
import { SOURCE_TTL } from '@/lib/refresh-policy';
import { comparePeriods } from '@/lib/analysis/period-compare';
import { bumpApiUsage } from '@/lib/store/api-usage';

function apiKey(): string | undefined {
  const v = process.env.KOSIS_API_KEY?.trim();
  return v && v.length > 0 ? v : undefined;
}

export function hasKosis(): boolean {
  return Boolean(apiKey());
}

interface KosisRow {
  PRD_DE: string; // 기간 (YYYYMM)
  DT: string; // 값
  C1_NM?: string; // 분류1 이름 (시도)
  ITM_NM?: string; // 항목 이름
}

function defaultUrl(key: string): string {
  const params = new URLSearchParams({
    method: 'getList',
    apiKey: key,
    format: 'json',
    jsonVD: 'Y',
    orgId: '101',
    tblId: 'DT_1B26001_A01',
    itmId: 'T20', // 순이동자수
    objL1: 'ALL', // 전 시도
    prdSe: 'M',
    newEstPrdCnt: '25',
  });
  return `https://kosis.kr/openapi/Param/statisticsParameterData.do?${params.toString()}`;
}

/** 수도권(서울·인천·경기) 월별 순이동자수 합계를 거시 지표로 만든다 */
export async function fetchNetMigration(): Promise<MacroIndicator> {
  const key = apiKey();
  if (!key) throw new Error('KOSIS_API_KEY 가 설정되지 않았습니다.');

  const url = process.env.KOSIS_URL_NET_MIGRATION?.trim() || defaultUrl(key);
  bumpApiUsage('kosis');
  const res = await fetch(url, { next: { revalidate: SOURCE_TTL.ecos } });
  if (!res.ok) throw new Error(`KOSIS HTTP ${res.status}`);

  const json = (await res.json()) as KosisRow[] | { err?: string; errMsg?: string };
  if (!Array.isArray(json)) {
    throw new Error(`KOSIS 오류: ${json.errMsg ?? json.err ?? '알 수 없는 응답'}`);
  }

  const METRO = new Set(['서울특별시', '인천광역시', '경기도']);
  const byMonth = new Map<string, number>();
  for (const row of json) {
    if (!row.C1_NM || !METRO.has(row.C1_NM)) continue;
    const v = Number(row.DT);
    if (!Number.isFinite(v)) continue;
    byMonth.set(row.PRD_DE, (byMonth.get(row.PRD_DE) ?? 0) + v);
  }

  const series: MacroSeriesPoint[] = [...byMonth.entries()]
    .map(([prd, value]) => ({ period: `${prd.slice(0, 4)}-${prd.slice(4, 6)}`, value }))
    .sort((a, b) => a.period.localeCompare(b.period));

  if (series.length === 0) {
    throw new Error('KOSIS 응답에서 수도권 순이동 시계열을 만들지 못했습니다 (표 개편 가능성).');
  }

  const latest = series[series.length - 1];
  const prev = series[series.length - 2];
  const yearAgo = series[series.length - 13];

  return {
    key: 'net-migration',
    label: '수도권 인구 순이동 (통계청)',
    unit: '명/월',
    latest: latest.value,
    latestPeriod: latest.period,
    change: prev ? latest.value - prev.value : 0,
    yoy:
      yearAgo && yearAgo.value !== 0
        ? ((latest.value - yearAgo.value) / Math.abs(yearAgo.value)) * 100
        : undefined,
    compare: comparePeriods(series),
    series,
    source: '통계청 KOSIS 국내인구이동통계',
    sourceUrl: 'https://kosis.kr/statHtml/statHtml.do?orgId=101&tblId=DT_1B26001_A01',
  };
}
