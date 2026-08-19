/**
 * 한국은행 경제통계시스템(ECOS) OpenAPI 어댑터
 *
 * 신청: https://ecos.bok.or.kr/api/#/AuthKeyApply
 * 형식: /api/StatisticSearch/{인증키}/json/kr/{시작건수}/{종료건수}/{통계표코드}/{주기}/{시작}/{종료}/{항목코드1}
 */

import { env } from '@/lib/env';
import type { MacroIndicator, MacroSeriesPoint } from '@/lib/types';
import { nowKst } from '@/lib/format';
import { SOURCE_TTL } from '@/lib/refresh-policy';

const BASE = 'https://ecos.bok.or.kr/api/StatisticSearch';

export interface EcosSpec {
  key: MacroIndicator['key'];
  label: string;
  unit: string;
  statCode: string;
  cycle: 'M' | 'Q' | 'A' | 'D';
  itemCode: string;
  /** 값이 클수록 시장에 부정적이면 true (금리 등) */
  invert?: boolean;
  description: string;
}

/**
 * 조회 대상 지표.
 * 통계표/항목 코드는 ECOS 개편 시 바뀔 수 있어 환경변수로 덮어쓸 수 있게 했다.
 */
export const ECOS_SPECS: EcosSpec[] = [
  {
    key: 'base-rate',
    label: '한국은행 기준금리',
    unit: '%',
    statCode: process.env.ECOS_STAT_BASE_RATE ?? '722Y001',
    cycle: 'M',
    itemCode: process.env.ECOS_ITEM_BASE_RATE ?? '0101000',
    invert: true,
    description: '주담대 금리와 매수 여력을 좌우하는 1차 변수',
  },
  {
    key: 'cpi',
    label: '소비자물가지수(CPI)',
    unit: '2020=100',
    statCode: process.env.ECOS_STAT_CPI ?? '901Y009',
    cycle: 'M',
    itemCode: process.env.ECOS_ITEM_CPI ?? '0',
    invert: true,
    description: '물가가 잡혀야 금리 인하 명분이 생긴다',
  },
  {
    key: 'm2',
    label: '광의통화 M2 (평잔, 계절조정)',
    unit: '십억원',
    statCode: process.env.ECOS_STAT_M2 ?? '101Y004',
    cycle: 'M',
    itemCode: process.env.ECOS_ITEM_M2 ?? 'BBHA00',
    description: '시중 유동성. 부동산 가격과 장기 상관이 가장 높은 지표',
  },
  {
    key: 'mortgage-rate',
    label: '예금은행 주택담보대출금리 (신규취급)',
    unit: '%',
    statCode: process.env.ECOS_STAT_MORTGAGE ?? '121Y006',
    cycle: 'M',
    itemCode: process.env.ECOS_ITEM_MORTGAGE ?? 'BECBLA03',
    invert: true,
    description: '실제 대출 실행 금리. 매수 심리에 직결',
  },
];

interface EcosRow {
  TIME: string;
  DATA_VALUE: string;
  UNIT_NAME?: string;
  ITEM_NAME1?: string;
}

function formatPeriod(time: string, cycle: EcosSpec['cycle']): string {
  if (cycle === 'M' && time.length === 6) return `${time.slice(0, 4)}-${time.slice(4, 6)}`;
  if (cycle === 'D' && time.length === 8)
    return `${time.slice(0, 4)}-${time.slice(4, 6)}-${time.slice(6, 8)}`;
  return time;
}

function periodRange(cycle: EcosSpec['cycle'], months: number): [string, string] {
  const now = nowKst();
  const end = new Date(now.getFullYear(), now.getMonth(), 1);
  const start = new Date(now.getFullYear(), now.getMonth() - months, 1);
  const fmt = (d: Date) =>
    cycle === 'M'
      ? `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`
      : cycle === 'A'
        ? `${d.getFullYear()}`
        : `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}01`;
  return [fmt(start), fmt(end)];
}

export async function fetchEcosSeries(spec: EcosSpec, months = 60): Promise<MacroSeriesPoint[]> {
  const key = env.ecosKey;
  if (!key) throw new Error('ECOS_API_KEY 가 설정되지 않았습니다.');

  const [start, end] = periodRange(spec.cycle, months);
  const url = `${BASE}/${key}/json/kr/1/1000/${spec.statCode}/${spec.cycle}/${start}/${end}/${spec.itemCode}`;

  const res = await fetch(url, { next: { revalidate: SOURCE_TTL.ecos } });
  if (!res.ok) throw new Error(`ECOS HTTP ${res.status}`);

  const json = (await res.json()) as Record<string, unknown>;

  if (json.RESULT) {
    const r = json.RESULT as { CODE?: string; MESSAGE?: string };
    throw new Error(`ECOS 오류(${r.CODE}): ${r.MESSAGE}`);
  }

  const container = json.StatisticSearch as { row?: EcosRow[] } | undefined;
  const rows = container?.row ?? [];

  return rows
    .map((r) => ({
      period: formatPeriod(r.TIME, spec.cycle),
      value: Number(r.DATA_VALUE),
    }))
    .filter((p) => Number.isFinite(p.value))
    .sort((a, b) => a.period.localeCompare(b.period));
}

export async function fetchMacroIndicator(spec: EcosSpec): Promise<MacroIndicator> {
  const series = await fetchEcosSeries(spec);
  if (series.length === 0) throw new Error(`${spec.label}: 데이터가 비어 있습니다.`);

  const latest = series[series.length - 1];
  const prev = series[series.length - 2];
  const yearAgo = series[series.length - 13];

  return {
    key: spec.key,
    label: spec.label,
    unit: spec.unit,
    latest: latest.value,
    latestPeriod: latest.period,
    change: prev ? latest.value - prev.value : 0,
    yoy: yearAgo ? ((latest.value - yearAgo.value) / yearAgo.value) * 100 : undefined,
    series,
    source: '한국은행 ECOS',
    sourceUrl: `https://ecos.bok.or.kr/#/Short/${spec.statCode}`,
  };
}

/** 전체 거시 지표를 한 번에. 실패한 지표는 조용히 제외하고 오류 목록을 함께 반환 */
export async function fetchAllMacro(): Promise<{
  indicators: MacroIndicator[];
  errors: Array<{ label: string; message: string }>;
}> {
  const results = await Promise.allSettled(ECOS_SPECS.map(fetchMacroIndicator));
  const indicators: MacroIndicator[] = [];
  const errors: Array<{ label: string; message: string }> = [];

  results.forEach((r, i) => {
    if (r.status === 'fulfilled') indicators.push(r.value);
    else
      errors.push({ label: ECOS_SPECS[i].label, message: String(r.reason?.message ?? r.reason) });
  });

  return { indicators, errors };
}
