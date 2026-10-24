/**
 * 실거래 정기 갱신의 진행 상태 — "마지막으로 한 바퀴를 다 돈 시각"과 "이번 바퀴에 남은 지역".
 *
 * ── 왜 필요한가 ──────────────────────────────────────────────────
 * 예전에는 tick 이 03·15시(KST)에 들어왔을 때만 갱신했다. 그런데 tick 을 부르는
 * GitHub Actions 무료 cron 은 하루 48번 중 3~5번만 실제로 온다. 그 몇 번이
 * 03·15시를 비켜 가면 그날 갱신은 통째로 빠졌다 — 2026-10-22 15시 이후 사흘 가까이
 * 서울 전역 갱신이 없었다.
 *
 * 브리핑 발송처럼 "정각인가"가 아니라 "지난 갱신 이후 충분히 지났는가"로 판단하면
 * tick 이 언제 오든 하루 두 번 안팎으로 맞춰진다. 그 판단에 쓸 기록이 이것이다.
 *
 * ── 왜 남은 지역까지 적나 ──────────────────────────────────────────
 * 한 번에 쓸 수 있는 시간(budget)을 넘기면 뒤쪽 지역이 남는다. 다음 tick 이
 * 처음부터 다시 돌면 늘 같은 뒤쪽 지역만 굶는다. 남은 목록을 이어받게 한다.
 *
 * 저장은 dashboard_snapshot 재사용 (마이그레이션 불필요). 최신 1행만 쓴다.
 */

import { getAdminClient } from '@/lib/store/supabase';

const KIND = 'trade-refresh-mark';

/** 한 바퀴를 다 돌고 이만큼 지나면 새 바퀴를 시작한다 — 하루 두 번 안팎 */
export const TRADE_REFRESH_INTERVAL_MS = 11 * 60 * 60 * 1000;

export interface TradeRefreshMark {
  /** 마지막으로 한 바퀴를 다 돈 시각 (ISO). 없으면 한 번도 다 못 돈 것 */
  completedAt: string | null;
  /** 이번 바퀴를 시작한 시각 (ISO) */
  roundStartedAt: string | null;
  /** 이번 바퀴에서 아직 안 돈 지역 코드. 비어 있으면 진행 중인 바퀴가 없다 */
  pending: string[];
}

interface MarkEnvelope extends TradeRefreshMark {
  kind: typeof KIND;
}

let memoryMark: TradeRefreshMark | null = null;

export async function loadTradeRefreshMark(): Promise<TradeRefreshMark> {
  const empty: TradeRefreshMark = { completedAt: null, roundStartedAt: null, pending: [] };

  const client = getAdminClient();
  if (!client) return memoryMark ?? empty;

  const { data, error } = await client
    .from('dashboard_snapshot')
    .select('payload')
    .eq('payload->>kind', KIND)
    .order('captured_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return empty;
  const p = data.payload as MarkEnvelope | null;
  if (p?.kind !== KIND) return empty;
  return {
    completedAt: p.completedAt ?? null,
    roundStartedAt: p.roundStartedAt ?? null,
    pending: Array.isArray(p.pending) ? p.pending : [],
  };
}

export async function saveTradeRefreshMark(mark: TradeRefreshMark): Promise<void> {
  memoryMark = mark;

  const client = getAdminClient();
  if (!client) return;

  const capturedAt = new Date().toISOString();
  const envelope: MarkEnvelope = { kind: KIND, ...mark };
  const { error } = await client
    .from('dashboard_snapshot')
    .insert({ captured_at: capturedAt, payload: envelope });
  if (error) {
    console.error('[refresh] 갱신 상태 저장 실패:', error.message);
    return;
  }
  // 최신 1행만 남긴다
  await client
    .from('dashboard_snapshot')
    .delete()
    .lt('captured_at', capturedAt)
    .eq('payload->>kind', KIND);
}

/**
 * 이번 tick 에 갱신할 지역을 정한다.
 *
 * - 진행 중인 바퀴가 있으면(pending) 그 남은 지역을 이어서 돈다
 * - 없으면 마지막 완료 후 TRADE_REFRESH_INTERVAL_MS 가 지났을 때만 새 바퀴를 연다
 * - force 면 간격과 무관하게 새 바퀴를 연다 (수동 실행)
 *
 * 새 바퀴는 사용자 등록 지역을 앞에 둔다 — 시간이 모자라 잘려도 사람이 보는
 * 단지의 시세부터 최신이 되게.
 */
export function planTradeRefresh(
  mark: TradeRefreshMark,
  allCodes: string[],
  priorityCodes: Set<string>,
  options: { force?: boolean; now?: number } = {},
): { codes: string[]; newRound: boolean } {
  const now = options.now ?? Date.now();
  const known = new Set(allCodes);

  if (!options.force && mark.pending.length > 0) {
    // 설정에서 빠진 지역은 버린다
    const codes = mark.pending.filter((c) => known.has(c));
    if (codes.length > 0) return { codes, newRound: false };
  }

  const last = mark.completedAt ? Date.parse(mark.completedAt) : 0;
  if (!options.force && now - last < TRADE_REFRESH_INTERVAL_MS) {
    return { codes: [], newRound: false };
  }

  const codes = [
    ...allCodes.filter((c) => priorityCodes.has(c)),
    ...allCodes.filter((c) => !priorityCodes.has(c)),
  ];
  return { codes, newRound: true };
}
