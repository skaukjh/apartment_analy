/**
 * 정책 갱신 경고 확인 표시 저장소.
 *
 * 관리자가 "확인했음"을 누른 경고(alert id)는 다시 배너에 띄우지 않는다.
 * 같은 발표(url)에 대한 경고는 id 가 안정적이라(ruleKey+url 해시) 한 번 확인하면
 * 다이제스트가 재생성돼도 다시 나타나지 않고, 새 발표가 나오면 새 id 로 다시 뜬다.
 *
 * 저장은 dashboard_snapshot 재사용 (마이그레이션 불필요).
 */

import { getAdminClient } from '@/lib/store/supabase';

const KIND = 'policy-alert-ack';

interface AckEnvelope {
  kind: typeof KIND;
  alertId: string;
  ackedBy: string;
  ackedAt: string;
}

/** Supabase 미연결(로컬 메모리) 폴백 */
const memoryAcks = new Set<string>();

/** 확인 처리된 경고 id 집합 */
export async function loadAckedAlertIds(): Promise<Set<string>> {
  const client = getAdminClient();
  if (!client) return new Set(memoryAcks);

  // 경고 수명은 다이제스트 캐시(최대 7일 조회)와 같으므로 최근 30일이면 충분하다
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data } = await client
    .from('dashboard_snapshot')
    .select('payload')
    .gte('captured_at', since)
    .eq('payload->>kind', KIND)
    .limit(500);

  const out = new Set(memoryAcks);
  for (const row of data ?? []) {
    const p = row.payload as AckEnvelope | null;
    if (p?.alertId) out.add(p.alertId);
  }
  return out;
}

/** 경고를 확인 처리한다 */
export async function ackAlert(alertId: string, ackedBy: string): Promise<void> {
  memoryAcks.add(alertId);

  const client = getAdminClient();
  if (!client) return;

  const envelope: AckEnvelope = {
    kind: KIND,
    alertId,
    ackedBy,
    ackedAt: new Date().toISOString(),
  };
  const { error } = await client
    .from('dashboard_snapshot')
    .insert({ captured_at: envelope.ackedAt, payload: envelope });
  if (error) console.error('[policy] 경고 확인 저장 실패:', error.message);
}
