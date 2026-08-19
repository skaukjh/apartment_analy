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

  let query = client
    .from('region_monthly')
    .select('lawd_cd, month, price_per_m2, trade_count')
    .gte('month', fromMonth)
    .order('month', { ascending: true });

  if (lawdCodes && lawdCodes.length > 0) query = query.in('lawd_cd', lawdCodes);

  const { data, error } = await query.limit(100_000);
  if (error) throw new Error(`region_monthly 조회 실패: ${error.message}`);

  const result: Record<string, RegionPricePoint[]> = {};
  for (const row of data ?? []) {
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

  const { data, error } = await client
    .from('dashboard_snapshot')
    .select('payload')
    .lte('captured_at', before)
    .order('captured_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return null;
  return data?.payload ?? null;
}
