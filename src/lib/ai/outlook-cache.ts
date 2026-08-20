/**
 * AI 시장 요약 캐시 (1시간)
 *
 * ── 왜 캐시하는가 ──────────────────────────────────────────────────
 * 요약 1회 생성에 약 6,300토큰(입력 5,500 / 출력 830)이 든다.
 * 캐시가 없으면 페이지를 새로고침할 때마다 비용이 나가고, 20~40초를 기다려야 한다.
 * 데이터 자체가 1시간 주기로 갱신되므로 그보다 자주 만들 이유가 없다.
 *
 * 저장은 기존 dashboard_snapshot 테이블을 재사용한다.
 * payload 안에 kind 표시를 넣어 구분하므로 마이그레이션이 필요 없다.
 */

import { getAdminClient } from '@/lib/store/supabase';
import type { MarketOutlook } from '@/lib/ai/market-outlook';

const KIND = 'ai-outlook';

/** 캐시 유효 시간 (ms) */
export const OUTLOOK_TTL_MS = 60 * 60 * 1000;

interface CacheEnvelope {
  kind: typeof KIND;
  /** 어느 사용자의 설정으로 만든 요약인지. 없으면 레거시 'default'. */
  userId?: string;
  outlook: MarketOutlook;
}

/** 서버리스 인스턴스가 살아 있는 동안 쓰는 1차 캐시 (사용자별) */
const memoryCache = new Map<string, { at: number; outlook: MarketOutlook }>();

function isFresh(generatedAt: string): boolean {
  const t = Date.parse(generatedAt);
  return Number.isFinite(t) && Date.now() - t < OUTLOOK_TTL_MS;
}

/** 1시간 안에 만든 요약이 있으면 그걸 준다. 없으면 null. 사용자별로 분리된다. */
export async function loadCachedOutlook(userId = 'default'): Promise<MarketOutlook | null> {
  const mem = memoryCache.get(userId);
  if (mem && Date.now() - mem.at < OUTLOOK_TTL_MS) {
    return mem.outlook;
  }

  const client = getAdminClient();
  if (!client) return null;

  const since = new Date(Date.now() - OUTLOOK_TTL_MS).toISOString();
  const { data, error } = await client
    .from('dashboard_snapshot')
    .select('payload')
    .gte('captured_at', since)
    .order('captured_at', { ascending: false })
    .limit(20);

  if (error || !data) return null;

  for (const row of data) {
    const payload = row.payload as CacheEnvelope | null;
    if (payload?.kind !== KIND || !payload.outlook) continue;
    if ((payload.userId ?? 'default') !== userId) continue;
    if (!isFresh(payload.outlook.generatedAt)) continue;
    memoryCache.set(userId, {
      at: Date.parse(payload.outlook.generatedAt),
      outlook: payload.outlook,
    });
    return payload.outlook;
  }

  return null;
}

/** 새로 만든 요약을 캐시에 넣는다. 실패해도 본 기능을 막지 않는다. */
export async function saveOutlookCache(outlook: MarketOutlook, userId = 'default'): Promise<void> {
  memoryCache.set(userId, { at: Date.now(), outlook });

  const client = getAdminClient();
  if (!client) return;

  const envelope: CacheEnvelope = { kind: KIND, userId, outlook };
  const { error } = await client
    .from('dashboard_snapshot')
    .insert({ captured_at: outlook.generatedAt, payload: envelope });

  if (error) console.error('[ai] 요약 캐시 저장 실패:', error.message);
}
