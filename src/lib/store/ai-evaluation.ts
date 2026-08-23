/**
 * AI 매물 평가 저장소.
 *
 * 평가는 토큰 비용이 드는 호출이라, 받은 결과를 (사용자, 아파트) 단위로
 * 저장해 두고 패널을 열면 그대로 다시 보여준다. 시세가 평가 시점과
 * 달라졌거나 오래됐으면 "재평가 필요"를 표시해 다시 받게 유도한다.
 * 저장은 dashboard_snapshot 재사용 (마이그레이션 불필요).
 */

import { getAdminClient } from './supabase';
import type { NearbySummary } from '@/lib/sources/place';
import type { BankRate } from '@/lib/sources/bank-rates';

const KIND = 'ai-evaluation';

export interface StoredEvaluation {
  userId: string;
  apartmentId: string;
  complexName: string;
  areaM2: number;
  evaluation: string;
  nearby: NearbySummary | null;
  bankRates: BankRate[];
  gaps: string[];
  model: string;
  generatedAt: string;
  /** 평가 시점의 시세 — 재평가 필요 판정 기준 */
  priceAtEval: number;
}

export async function saveEvaluation(e: StoredEvaluation): Promise<void> {
  const client = getAdminClient();
  if (!client) return;

  const capturedAt = new Date().toISOString();
  const { error } = await client
    .from('dashboard_snapshot')
    .insert({ captured_at: capturedAt, payload: { kind: KIND, ...e } });
  if (error) {
    console.error('[ai] 평가 저장 실패:', error.message);
    return;
  }

  // 같은 아파트의 이전 평가는 지운다 — 최신 1건만 유지
  await client
    .from('dashboard_snapshot')
    .delete()
    .lt('captured_at', capturedAt)
    .eq('payload->>kind', KIND)
    .eq('payload->>userId', e.userId)
    .eq('payload->>apartmentId', e.apartmentId);
}

export async function loadEvaluation(
  userId: string,
  apartmentId: string,
): Promise<StoredEvaluation | null> {
  const client = getAdminClient();
  if (!client) return null;

  const { data, error } = await client
    .from('dashboard_snapshot')
    .select('payload')
    .eq('payload->>kind', KIND)
    .eq('payload->>userId', userId)
    .eq('payload->>apartmentId', apartmentId)
    .order('captured_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data?.payload) return null;
  const p = data.payload as StoredEvaluation & { kind: string };
  return p.evaluation ? p : null;
}
