/**
 * 느린 외부 원천의 결과를 DB 에 저장해 두고 재사용하는 캐시 (stale-while-revalidate).
 *
 * ── 왜 필요한가 ──────────────────────────────────────────────────
 * 부동산원 월간 통계는 표 5개를 순서대로, 표마다 1000행짜리 페이지를 5장씩
 * 받는다 (R-ONE 이 병렬 요청을 간헐적으로 거부해서 순차다). 로컬에서도 8.5초,
 * 미국 리전 함수에서는 그 몇 배라 요약 화면 재조립 시간의 대부분이 여기였다.
 * 그런데 이 숫자는 한 달에 한 번 바뀐다. 매번 받을 이유가 없다.
 *
 * fetch 의 `next.revalidate` 는 응답 하나가 2MB 를 넘으면 저장되지 않고, 인스턴스가
 * 바뀌면 다시 받는다 — 그래서 결과(작은 요약)를 DB 에 직접 남긴다.
 *
 * 동작: TTL 안이면 그대로, TTL 을 넘겼지만 staleMs 안이면 낡은 값을 돌려주고
 * 응답 뒤(after)에 다시 받는다. 그보다 오래됐거나 없으면 기다려서 받는다.
 *
 * 저장은 dashboard_snapshot 재사용 (마이그레이션 불필요). 키마다 최신 1행만 남긴다.
 */

import { after } from 'next/server';
import { getAdminClient } from '@/lib/store/supabase';

const KIND = 'source-cache';

interface CacheEnvelope<T> {
  kind: typeof KIND;
  key: string;
  value: T;
}

const memory = new Map<string, { at: number; value: unknown }>();
const inflight = new Map<string, Promise<unknown>>();

async function load<T>(key: string): Promise<{ at: number; value: T } | null> {
  const mem = memory.get(key);
  if (mem) return mem as { at: number; value: T };

  const client = getAdminClient();
  if (!client) return null;

  const { data, error } = await client
    .from('dashboard_snapshot')
    .select('payload, captured_at')
    .eq('payload->>kind', KIND)
    .eq('payload->>key', key)
    .order('captured_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;

  const p = data.payload as CacheEnvelope<T> | null;
  if (p?.kind !== KIND || p.value === undefined) return null;
  const entry = { at: Date.parse(data.captured_at as string), value: p.value };
  memory.set(key, entry);
  return entry;
}

async function save<T>(key: string, value: T): Promise<void> {
  memory.set(key, { at: Date.now(), value });

  const client = getAdminClient();
  if (!client) return;

  const capturedAt = new Date().toISOString();
  const envelope: CacheEnvelope<T> = { kind: KIND, key, value };
  const { error } = await client
    .from('dashboard_snapshot')
    .insert({ captured_at: capturedAt, payload: envelope });
  if (error) {
    console.error(`[source-cache] ${key} 저장 실패:`, error.message);
    return;
  }
  await client
    .from('dashboard_snapshot')
    .delete()
    .lt('captured_at', capturedAt)
    .eq('payload->>kind', KIND)
    .eq('payload->>key', key);
}

/**
 * key 의 저장값을 돌려주거나, 없으면 fetcher 로 받아 저장한다.
 *
 * @param shouldSave 받은 값을 저장할지 — 실패에 가까운 결과(빈 목록 등)로 좋은 값을 덮지 않게
 */
export async function cachedSource<T>(
  key: string,
  options: { ttlMs: number; staleMs: number; shouldSave?: (value: T) => boolean },
  fetcher: () => Promise<T>,
): Promise<T> {
  const refresh = (): Promise<T> => {
    const running = inflight.get(key);
    if (running) return running as Promise<T>;
    const task = fetcher()
      .then(async (value) => {
        if (!options.shouldSave || options.shouldSave(value))
          await save(key, value).catch(() => {});
        return value;
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, task);
    return task;
  };

  const entry = await load<T>(key).catch(() => null);
  if (entry) {
    const age = Date.now() - entry.at;
    if (age < options.ttlMs) return entry.value;
    if (age < options.staleMs) {
      try {
        after(() => refresh().catch(() => {}));
      } catch {
        /* 요청 문맥 밖(스크립트) — 낡은 값만 돌려준다 */
      }
      return entry.value;
    }
  }
  return refresh();
}
