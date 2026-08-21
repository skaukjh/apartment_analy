/**
 * 대시보드 데이터 캐시 (사용자별, 최대 65분)
 *
 * ── 왜 필요한가 ──────────────────────────────────────────────────
 * buildDashboard 는 외부 API 수십 개를 모아 8~18초가 걸린다.
 * 페이지가 이동할 때마다 이걸 다시 하니 "화면이 10초씩 걸린다"는
 * 문제가 됐다. 그런데 매시간 tick 이 어차피 같은 계산을 한다 —
 * 그 결과를 저장해 두면 페이지는 읽기만 하면 된다 (<1초).
 *
 * 신선도: 최대 1시간. 실거래는 12시간 주기, 뉴스·AI 는 tick 이
 * 매시간 갱신하므로 화면 기준으로는 차이가 없다.
 * 페이로드는 약 0.5MB — 같은 사용자의 이전 캐시는 지워 비대를 막는다.
 */

import { getAdminClient } from '@/lib/store/supabase';
import type { DashboardData } from '@/lib/types';

const KIND = 'dashboard-cache';

/** 캐시 유효 시간 — tick 주기(1시간) + 지연 여유 */
export const DASHBOARD_CACHE_TTL_MS = 65 * 60 * 1000;

interface CacheEnvelope {
  kind: typeof KIND;
  userId: string;
  data: DashboardData;
}

const memory = new Map<string, { at: number; data: DashboardData }>();

export async function loadDashboardCache(userId: string): Promise<DashboardData | null> {
  const mem = memory.get(userId);
  if (mem && Date.now() - mem.at < DASHBOARD_CACHE_TTL_MS) return mem.data;

  const client = getAdminClient();
  if (!client) return null;

  const since = new Date(Date.now() - DASHBOARD_CACHE_TTL_MS).toISOString();
  // 스냅샷 테이블에는 다른 종류의 큰 행들도 섞여 있다.
  // kind/userId 로 서버에서 걸러 정확히 1행만 받는다 — 훑어오면 수 MB 를 나른다.
  const { data, error } = await client
    .from('dashboard_snapshot')
    .select('payload, captured_at')
    .gte('captured_at', since)
    .eq('payload->>kind', KIND)
    .eq('payload->>userId', userId)
    .order('captured_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;

  const p = data.payload as CacheEnvelope | null;
  if (p?.kind !== KIND || !p.data) return null;
  memory.set(userId, { at: Date.parse(data.captured_at as string), data: p.data });
  return p.data;
}

export async function saveDashboardCache(userId: string, data: DashboardData): Promise<void> {
  memory.set(userId, { at: Date.now(), data });

  const client = getAdminClient();
  if (!client) return;

  const envelope: CacheEnvelope = { kind: KIND, userId, data };
  const { error } = await client
    .from('dashboard_snapshot')
    .insert({ captured_at: new Date().toISOString(), payload: envelope });
  if (error) {
    console.error('[dashboard] 캐시 저장 실패:', error.message);
    return;
  }

  // 페이로드가 0.5MB 라 쌓이면 테이블이 비대해진다. 이 사용자의 낡은 캐시는 지운다.
  const cutoff = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
  await client
    .from('dashboard_snapshot')
    .delete()
    .lt('captured_at', cutoff)
    .eq('payload->>kind', KIND)
    .eq('payload->>userId', userId);
}
