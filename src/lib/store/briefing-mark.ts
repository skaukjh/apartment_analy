/**
 * 브리핑 발송 표시 — (날짜, 슬롯, 사용자) 단위로 "보냈다"를 기록한다.
 *
 * ── 왜 필요한가 ──────────────────────────────────────────────────
 * 스케줄러(GitHub Actions cron)는 정각에 안 온다. 30~50분씩 밀리고,
 * 실제로 02시대(=11시 KST)가 통째로 건너뛰어 11시 브리핑이 안 나간 날이 있었다.
 * 그래서 "지금이 발송 시각인가"가 아니라 "지나간 발송 시각 중 아직 안 보낸 게
 * 있는가"로 판단해야 하고, 그러려면 보낸 기록이 필요하다.
 * 같은 슬롯을 두 번 보내지 않게 막는 역할도 겸한다.
 *
 * 저장은 dashboard_snapshot 재사용 (마이그레이션 불필요).
 */

import { getAdminClient } from '@/lib/store/supabase';

const KIND = 'briefing-mark';

interface MarkEnvelope {
  kind: typeof KIND;
  /** YYYY-MM-DD (KST) */
  date: string;
  slot: string;
  userId: string;
}

/** Supabase 미연결(로컬 메모리) 폴백 */
const memoryMarks = new Set<string>();

function keyOf(date: string, slot: string, userId: string): string {
  return `${date}|${slot}|${userId}`;
}

/** 오늘 이 슬롯을 이 사용자에게 이미 보냈는가 */
export async function wasBriefingSent(
  date: string,
  slot: string,
  userId: string,
): Promise<boolean> {
  if (memoryMarks.has(keyOf(date, slot, userId))) return true;

  const client = getAdminClient();
  if (!client) return false;

  // 표시는 하루 수십 건 수준이라 최근 것만 훑으면 충분하다
  const since = new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString();
  const { data, error } = await client
    .from('dashboard_snapshot')
    .select('payload')
    .gte('captured_at', since)
    .order('captured_at', { ascending: false })
    .limit(300);

  if (error || !data) return false;

  for (const row of data) {
    const p = row.payload as MarkEnvelope | null;
    if (p?.kind !== KIND) continue;
    if (p.date === date && p.slot === slot && p.userId === userId) {
      memoryMarks.add(keyOf(date, slot, userId));
      return true;
    }
  }
  return false;
}

/** 발송 성공을 기록한다. 실패해도 발송 자체를 막지 않는다. */
export async function markBriefingSent(date: string, slot: string, userId: string): Promise<void> {
  memoryMarks.add(keyOf(date, slot, userId));

  const client = getAdminClient();
  if (!client) return;

  const envelope: MarkEnvelope = { kind: KIND, date, slot, userId };
  const { error } = await client
    .from('dashboard_snapshot')
    .insert({ captured_at: new Date().toISOString(), payload: envelope });
  if (error) console.error('[briefing] 발송 표시 저장 실패:', error.message);
}
