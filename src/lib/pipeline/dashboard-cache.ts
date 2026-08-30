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
 *
 * ── 만료돼도 일단 보여준다 (stale-while-revalidate) ────────────────
 * 예열이 제때 돌지 않으면 (GitHub Actions 무료 cron 은 30분 간격을 걸러
 * 하루 몇 번만 돈다) 캐시가 하루 대부분 만료 상태다. 만료를 "없음"으로
 * 취급하면 그때마다 사용자가 조립 18초 — 콜드면 70초 — 를 서서 기다린다.
 * 그래서 24시간 안쪽이면 낡은 값이라도 먼저 돌려주고, 갱신은 응답을 보낸
 * 뒤(after)에 돌린다. 지표는 실거래 기준이라 몇 시간 낡아도 판단이 뒤집히지
 * 않는다 — 20초를 기다리는 쪽이 훨씬 나쁘다.
 */

import { getAdminClient } from '@/lib/store/supabase';
import type { DashboardData } from '@/lib/types';

const KIND = 'dashboard-cache';

/** 캐시 유효 시간 — tick 주기(1시간) + 지연 여유. 이 안이면 그대로 쓴다. */
export const DASHBOARD_CACHE_TTL_MS = 65 * 60 * 1000;

/**
 * 만료 뒤에도 이만큼은 낡은 값을 먼저 보여준다 (뒤에서 갱신).
 * 하루를 넘긴 값은 실거래가 여러 건 바뀌었을 수 있어 그냥 다시 조립한다.
 */
export const DASHBOARD_CACHE_STALE_MS = 24 * 60 * 60 * 1000;

/** 캐시에서 꺼낸 결과 — 낡았는지 함께 알려 준다. */
export interface DashboardCacheEntry {
  data: DashboardData;
  /** 저장 시각 (epoch ms) */
  savedAt: number;
  /** TTL 을 넘겼다 — 쓰되 뒤에서 갱신해야 한다 */
  stale: boolean;
}

interface CacheEnvelope {
  kind: typeof KIND;
  userId: string;
  data: DashboardData;
}

const memory = new Map<string, { at: number; data: DashboardData }>();

/**
 * 캐시를 저장 시각과 함께 꺼낸다 (없으면 null).
 *
 * TTL 을 넘긴 값도 24시간 안쪽이면 `stale: true` 로 돌려준다 — 버릴지 쓸지는
 * 부르는 쪽이 정한다. 화면(buildDashboardCached)은 쓰고 뒤에서 갱신한다.
 */
export async function loadDashboardCacheEntry(userId: string): Promise<DashboardCacheEntry | null> {
  const now = Date.now();
  const entryOf = (savedAt: number, data: DashboardData): DashboardCacheEntry => ({
    data,
    savedAt,
    stale: now - savedAt >= DASHBOARD_CACHE_TTL_MS,
  });

  const mem = memory.get(userId);
  if (mem && now - mem.at < DASHBOARD_CACHE_STALE_MS) return entryOf(mem.at, mem.data);

  const client = getAdminClient();
  if (!client) return null;

  const since = new Date(now - DASHBOARD_CACHE_STALE_MS).toISOString();
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
  const savedAt = Date.parse(data.captured_at as string);
  memory.set(userId, { at: savedAt, data: p.data });
  return entryOf(savedAt, p.data);
}

/** 신선한 캐시만 (TTL 안쪽). 낡은 값을 보여주면 안 되는 곳에서 쓴다. */
export async function loadDashboardCache(userId: string): Promise<DashboardData | null> {
  const entry = await loadDashboardCacheEntry(userId);
  return entry && !entry.stale ? entry.data : null;
}

/**
 * 설정이 바뀌면 캐시를 버린다.
 *
 * 저장 직후에도 다음 tick(최대 1시간)까지 갭·시세가 이전 설정 기준으로
 * 표시되던 문제의 수정 — 목표 아파트 4곳을 등록했는데 홈에
 * "등록된 아파트가 없습니다"가 떠 있었다. 캐시를 지우면 다음 페이지
 * 로드가 새 설정으로 다시 조립한다 (첫 로드만 느리고 이후는 다시 캐시).
 */
export async function invalidateDashboardCache(userId: string): Promise<void> {
  memory.delete(userId);

  const client = getAdminClient();
  if (!client) return;

  const { error } = await client
    .from('dashboard_snapshot')
    .delete()
    .eq('payload->>kind', KIND)
    .eq('payload->>userId', userId);
  if (error) console.error('[dashboard] 캐시 무효화 실패:', error.message);
}

export async function saveDashboardCache(userId: string, data: DashboardData): Promise<void> {
  memory.set(userId, { at: Date.now(), data });

  const client = getAdminClient();
  if (!client) return;

  const envelope: CacheEnvelope = { kind: KIND, userId, data };
  const capturedAt = new Date().toISOString();
  const { error } = await client
    .from('dashboard_snapshot')
    .insert({ captured_at: capturedAt, payload: envelope });
  if (error) {
    console.error('[dashboard] 캐시 저장 실패:', error.message);
    return;
  }

  /* 페이로드가 0.5MB 라 쌓이면 테이블이 비대해진다. 이 사용자의 이전 캐시는 지운다.
     "3시간 지난 것"이 아니라 "방금 넣은 것보다 오래된 것 전부"를 지운다 —
     예열이 멈춘 동안 남아 있어야 할 마지막 한 줄까지 시간 기준으로 지워 버리면
     낡은 값을 먼저 보여주는 길(stale-while-revalidate)이 막힌다. */
  await client
    .from('dashboard_snapshot')
    .delete()
    .lt('captured_at', capturedAt)
    .eq('payload->>kind', KIND)
    .eq('payload->>userId', userId);
}
