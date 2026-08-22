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

/* 신선도는 "마지막 자료 점검 시각" 기준이다. 본문 생성 시각(generatedAt)으로 보면
   기준 미달로 재사용 중인 요약이 1시간 만에 만료돼 페이지마다 재생성된다. */
function isFresh(outlook: MarketOutlook): boolean {
  const t = Date.parse(outlook.refreshedAt ?? outlook.generatedAt);
  return Number.isFinite(t) && Date.now() - t < OUTLOOK_TTL_MS;
}

/**
 * 가장 최근 요약 — 신선도 무시 (중복 생성 판단용).
 * "지난번과 입력이 같은가"를 보려면 낡은 것이라도 이전 결과가 필요하다.
 */
export async function loadLatestOutlook(userId = 'default'): Promise<MarketOutlook | null> {
  const mem = memoryCache.get(userId);
  if (mem) return mem.outlook;

  const client = getAdminClient();
  if (!client) return null;

  const since = new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString();
  const { data } = await client
    .from('dashboard_snapshot')
    .select('payload')
    .gte('captured_at', since)
    .eq('payload->>kind', KIND)
    .eq('payload->>userId', userId)
    .order('captured_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const p = (data?.payload ?? null) as CacheEnvelope | null;
  return p?.outlook ?? null;
}

/** 1시간 안에 만든 요약이 있으면 그걸 준다. 없으면 null. 사용자별로 분리된다. */
export async function loadCachedOutlook(userId = 'default'): Promise<MarketOutlook | null> {
  const mem = memoryCache.get(userId);
  if (mem && Date.now() - mem.at < OUTLOOK_TTL_MS) {
    return mem.outlook;
  }

  const client = getAdminClient();
  if (!client) return null;

  /* kind·userId 를 SQL 에서 거른다. 예전엔 최근 20행을 받아 JS 로 걸렀는데,
     대시보드 캐시·브리핑 표시 등 다른 kind 행이 한 시간에 20행을 넘으면
     요약 행이 창 밖으로 밀려 캐시 미스 → 페이지마다 재생성되는 문제가 있었다. */
  const since = new Date(Date.now() - OUTLOOK_TTL_MS).toISOString();
  const { data, error } = await client
    .from('dashboard_snapshot')
    .select('payload')
    .gte('captured_at', since)
    .eq('payload->>kind', KIND)
    .eq('payload->>userId', userId)
    .order('captured_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;

  const payload = data.payload as CacheEnvelope | null;
  if (payload?.kind !== KIND || !payload.outlook) return null;
  if (!isFresh(payload.outlook)) return null;

  memoryCache.set(userId, {
    at: Date.parse(payload.outlook.refreshedAt ?? payload.outlook.generatedAt),
    outlook: payload.outlook,
  });
  return payload.outlook;
}

/** 새로 만든 요약을 캐시에 넣는다. 실패해도 본 기능을 막지 않는다. */
export async function saveOutlookCache(outlook: MarketOutlook, userId = 'default'): Promise<void> {
  memoryCache.set(userId, { at: Date.now(), outlook });

  const client = getAdminClient();
  if (!client) return;

  const envelope: CacheEnvelope = { kind: KIND, userId, outlook };
  const { error } = await client
    .from('dashboard_snapshot')
    .insert({ captured_at: outlook.refreshedAt ?? outlook.generatedAt, payload: envelope });

  if (error) console.error('[ai] 요약 캐시 저장 실패:', error.message);
}
