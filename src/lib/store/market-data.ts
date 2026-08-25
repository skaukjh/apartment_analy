/**
 * 실거래 파생 데이터 저장소 (시군구·월별 집계 + 원본 거래 캐시).
 * Supabase 미설정 시 프로세스 메모리를 사용한다.
 */

import type { RegionPricePoint, TradeRecord } from '@/lib/types';
import { getAdminClient } from './supabase';
import { memoryState } from './memory';

/* ------------------------------------------------------------------ */
/* 월별 집계                                                            */
/* ------------------------------------------------------------------ */

/**
 * 조회는 끝났지만 거래가 0건이던 월을 표시하는 값.
 *
 * 이걸 남기지 않으면 백필이 "아직 안 받은 월"로 보고 매번 다시 조회한다.
 * 실제로 그런 무한 반복이 있었다 — 거래 없는 시골 지역/월이 흔하기 때문이다.
 * 분석 쪽에서는 `count === 0` 인 점을 빼고 쓴다.
 */
export function emptyMonthPoint(month: string): RegionPricePoint {
  return { month, pricePerM2: 0, count: 0 };
}

export async function saveRegionMonthly(lawdCd: string, points: RegionPricePoint[]): Promise<void> {
  if (points.length === 0) return;

  const client = getAdminClient();
  if (!client) {
    points.forEach((p) => memoryState().regionMonthly.set(`${lawdCd}|${p.month}`, p));
    return;
  }

  const rows = points.map((p) => ({
    lawd_cd: lawdCd,
    month: p.month,
    price_per_m2: p.pricePerM2,
    trade_count: p.count,
    updated_at: new Date().toISOString(),
  }));

  const { error } = await client.from('region_monthly').upsert(rows, {
    onConflict: 'lawd_cd,month',
  });
  if (error) throw new Error(`region_monthly 저장 실패: ${error.message}`);

  points.forEach((p) => memoryState().regionMonthly.set(`${lawdCd}|${p.month}`, p));
}

/**
 * 저장된 (지역, 월) 키 전체. 거래 0건으로 기록된 월도 포함한다.
 * 백필이 "이미 조회한 월"을 건너뛰는 판단에 쓴다.
 */
export async function loadRegionMonthlyKeys(
  lawdCodes: string[],
  fromMonth = '2022-01',
): Promise<Set<string>> {
  const keys = new Set<string>();
  const client = getAdminClient();

  if (!client) {
    for (const key of memoryState().regionMonthly.keys()) {
      const [code, month] = key.split('|');
      if (!lawdCodes.includes(code) || month < fromMonth) continue;
      keys.add(key);
    }
    return keys;
  }

  // PostgREST 는 한 번에 최대 1,000행만 준다. 전부 받으려면 페이지를 넘겨야 한다.
  // 이걸 놓치면 "이미 받은 월"을 1,000개까지만 인식해 백필이 같은 구간을 무한 반복한다.
  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    let query = client
      .from('region_monthly')
      .select('lawd_cd, month')
      .gte('month', fromMonth)
      .order('lawd_cd', { ascending: true })
      .order('month', { ascending: true })
      .range(offset, offset + PAGE - 1);

    if (lawdCodes.length > 0) query = query.in('lawd_cd', lawdCodes);

    const { data, error } = await query;
    if (error) throw new Error(`region_monthly 키 조회 실패: ${error.message}`);

    for (const row of data ?? []) keys.add(`${row.lawd_cd}|${row.month}`);
    if (!data || data.length < PAGE) break;
  }

  return keys;
}

export async function loadRegionMonthly(
  lawdCodes?: string[],
  fromMonth = '2022-01',
): Promise<Record<string, RegionPricePoint[]>> {
  const client = getAdminClient();

  if (!client) {
    const result: Record<string, RegionPricePoint[]> = {};
    for (const [key, point] of memoryState().regionMonthly) {
      const [code, month] = key.split('|');
      if (lawdCodes && !lawdCodes.includes(code)) continue;
      if (month < fromMonth) continue;
      (result[code] ??= []).push(point);
    }
    Object.values(result).forEach((s) => s.sort((a, b) => a.month.localeCompare(b.month)));
    return result;
  }

  // PostgREST 기본 상한(1,000행) 때문에 페이지를 넘겨가며 전부 받는다
  const PAGE = 1000;
  const rows: Array<Record<string, unknown>> = [];
  for (let offset = 0; ; offset += PAGE) {
    let query = client
      .from('region_monthly')
      .select('lawd_cd, month, price_per_m2, trade_count')
      .gte('month', fromMonth)
      .order('month', { ascending: true })
      .range(offset, offset + PAGE - 1);

    if (lawdCodes && lawdCodes.length > 0) query = query.in('lawd_cd', lawdCodes);

    const { data, error } = await query;
    if (error) throw new Error(`region_monthly 조회 실패: ${error.message}`);

    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }

  const result: Record<string, RegionPricePoint[]> = {};
  for (const row of rows) {
    // 거래 0건 표시용 행은 분석에서 제외한다 (0원이 섞이면 중앙값이 무너진다)
    if (Number(row.trade_count) === 0) continue;
    (result[row.lawd_cd as string] ??= []).push({
      month: row.month as string,
      pricePerM2: Number(row.price_per_m2),
      count: Number(row.trade_count),
    });
  }
  return result;
}

/* ------------------------------------------------------------------ */
/* 법정동별 월 집계                                                      */
/* ------------------------------------------------------------------ */

export async function saveDongMonthly(
  lawdCd: string,
  byDong: Record<string, RegionPricePoint[]>,
): Promise<void> {
  const entries = Object.entries(byDong).filter(([, points]) => points.length > 0);
  if (entries.length === 0) return;

  const client = getAdminClient();
  if (!client) {
    for (const [dong, points] of entries) {
      points.forEach((p) => memoryState().dongMonthly.set(`${lawdCd}|${dong}|${p.month}`, p));
    }
    return;
  }

  const rows = entries.flatMap(([dong, points]) =>
    points.map((p) => ({
      lawd_cd: lawdCd,
      dong,
      month: p.month,
      price_per_m2: p.pricePerM2,
      trade_count: p.count,
      updated_at: new Date().toISOString(),
    })),
  );

  const { error } = await client.from('dong_monthly').upsert(rows, {
    onConflict: 'lawd_cd,dong,month',
  });
  if (error) throw new Error(`dong_monthly 저장 실패: ${error.message}`);

  for (const [dong, points] of entries) {
    points.forEach((p) => memoryState().dongMonthly.set(`${lawdCd}|${dong}|${p.month}`, p));
  }
}

export async function loadDongMonthly(
  lawdCd: string,
  fromMonth = '2022-01',
): Promise<Record<string, RegionPricePoint[]>> {
  const client = getAdminClient();

  if (!client) {
    const result: Record<string, RegionPricePoint[]> = {};
    for (const [key, point] of memoryState().dongMonthly) {
      const [code, dong, month] = key.split('|');
      if (code !== lawdCd || month < fromMonth) continue;
      (result[dong] ??= []).push(point);
    }
    Object.values(result).forEach((s) => s.sort((a, b) => a.month.localeCompare(b.month)));
    return result;
  }

  const { data, error } = await client
    .from('dong_monthly')
    .select('dong, month, price_per_m2, trade_count')
    .eq('lawd_cd', lawdCd)
    .gte('month', fromMonth)
    .order('month', { ascending: true })
    .limit(50_000);

  if (error) throw new Error(`dong_monthly 조회 실패: ${error.message}`);

  const result: Record<string, RegionPricePoint[]> = {};
  for (const row of data ?? []) {
    (result[row.dong as string] ??= []).push({
      month: row.month as string,
      pricePerM2: Number(row.price_per_m2),
      count: Number(row.trade_count),
    });
  }
  return result;
}

/* ------------------------------------------------------------------ */
/* 원본 거래 캐시                                                       */
/* ------------------------------------------------------------------ */

export async function saveTradeCache(
  lawdCd: string,
  yyyymm: string,
  trades: TradeRecord[],
): Promise<void> {
  const client = getAdminClient();
  if (!client) {
    memoryState().tradeCache.set(`${lawdCd}|${yyyymm}`, trades);
    memoryTradeCacheSavedAt.set(`${lawdCd}|${yyyymm}`, Date.now());
    return;
  }

  const { error } = await client
    .from('trade_cache')
    .upsert(
      { lawd_cd: lawdCd, month: yyyymm, payload: trades, updated_at: new Date().toISOString() },
      { onConflict: 'lawd_cd,month' },
    );
  if (error) throw new Error(`trade_cache 저장 실패: ${error.message}`);
  memoryState().tradeCache.set(`${lawdCd}|${yyyymm}`, trades);
}

/** 월별 캐시 행 — "어느 달이 비어 있는지"까지 알아야 할 때 쓴다 */
export interface TradeCacheRow {
  /** YYYYMM */
  month: string;
  /** 마지막 저장 시각 (ISO) */
  updatedAt: string;
  trades: TradeRecord[];
}

/** 메모리 모드에서 월별 저장 시각을 기억한다 (Supabase 는 updated_at 컬럼 사용) */
const memoryTradeCacheSavedAt = new Map<string, number>();

/**
 * 한 지역의 월별 캐시를 행 단위로 돌려준다.
 *
 * loadTradeCache 는 "캐시가 있냐 없냐"만 알 수 있어, 최근 두 달만 저장된
 * 지역에서 나머지 달이 통째로 빠져 있어도 구분하지 못했다.
 * 검색이 "빠진 달만 받아오기" 판단을 하려면 달별 존재 여부와 저장 시각이 필요하다.
 */
export async function loadTradeCacheRows(
  lawdCd: string,
  fromMonth: string,
): Promise<TradeCacheRow[]> {
  const client = getAdminClient();
  if (!client) {
    const out: TradeCacheRow[] = [];
    for (const [key, trades] of memoryState().tradeCache) {
      const [code, month] = key.split('|');
      if (code !== lawdCd || month < fromMonth) continue;
      out.push({
        month,
        updatedAt: new Date(memoryTradeCacheSavedAt.get(key) ?? Date.now()).toISOString(),
        trades,
      });
    }
    return out.sort((a, b) => a.month.localeCompare(b.month));
  }

  const { data, error } = await client
    .from('trade_cache')
    .select('month, payload, updated_at')
    .eq('lawd_cd', lawdCd)
    .gte('month', fromMonth)
    .order('month', { ascending: true });

  if (error) throw new Error(`trade_cache 조회 실패: ${error.message}`);

  return (data ?? []).map((row) => ({
    month: row.month as string,
    updatedAt: (row.updated_at as string) ?? new Date(0).toISOString(),
    trades: (row.payload as TradeRecord[]) ?? [],
  }));
}

export async function loadTradeCache(
  lawdCodes: string[],
  fromMonth: string,
): Promise<TradeRecord[]> {
  if (lawdCodes.length === 0) return [];

  const client = getAdminClient();
  if (!client) {
    const out: TradeRecord[] = [];
    for (const [key, trades] of memoryState().tradeCache) {
      const [code, month] = key.split('|');
      if (!lawdCodes.includes(code) || month < fromMonth) continue;
      out.push(...trades);
    }
    return out;
  }

  const { data, error } = await client
    .from('trade_cache')
    .select('payload')
    .in('lawd_cd', lawdCodes)
    .gte('month', fromMonth)
    .limit(5000);

  if (error) throw new Error(`trade_cache 조회 실패: ${error.message}`);

  return (data ?? []).flatMap((row) => (row.payload as TradeRecord[]) ?? []);
}

/* ------------------------------------------------------------------ */
/* 대시보드 스냅샷                                                      */
/* ------------------------------------------------------------------ */

export async function saveSnapshot(payload: unknown): Promise<void> {
  const client = getAdminClient();
  const capturedAt = new Date().toISOString();

  if (!client) {
    const snapshots = memoryState().snapshots;
    snapshots.unshift({ capturedAt, payload });
    snapshots.length = Math.min(snapshots.length, 30);
    return;
  }

  const { error } = await client
    .from('dashboard_snapshot')
    .insert({ captured_at: capturedAt, payload });
  if (error) console.error('[store] 스냅샷 저장 실패:', error.message);
}

/** n일 전 스냅샷 (갭 변화 비교용) */
export async function loadSnapshotBefore(days: number): Promise<unknown | null> {
  const before = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const client = getAdminClient();

  if (!client) {
    return memoryState().snapshots.find((s) => s.capturedAt <= before)?.payload ?? null;
  }

  /* dashboard_snapshot 은 여러 용도가 공유한다 (AI 요약 캐시·정책 확인 표시·
     실거래 반영 측정 …). 종류를 안 가리면 gaps 가 없는 행이 잡혀 갭 변화가
     조용히 사라진다 — 실제로 "갭 축소/확대" 문구가 안 나가던 원인이다. */
  const { data, error } = await client
    .from('dashboard_snapshot')
    .select('payload')
    .lte('captured_at', before)
    .not('payload->gaps', 'is', null)
    .order('captured_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return null;
  return data?.payload ?? null;
}
