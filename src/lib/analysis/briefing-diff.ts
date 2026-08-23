/**
 * 지난 브리핑 대비 변화 계산.
 *
 * 브리핑을 보낼 때마다 시세·갭·심리 스냅샷이 저장된다 (briefing-service 의 saveSnapshot).
 * 이 모듈은 가장 최근 스냅샷을 불러와 현재 대시보드와 비교해
 * "무엇이 얼마나 달라졌는지"를 사람이 읽는 문장으로 만든다.
 * 오늘의 요약 페이지와 카카오·텔레그램 브리핑 본문이 함께 쓴다.
 */

import type { DashboardData, PriceQuote } from '@/lib/types';
import { formatKrw } from '@/lib/format';
import { getAdminClient } from '@/lib/store/supabase';
import { memoryState } from '@/lib/store/memory';

export interface BriefingSnapshot {
  generatedAt?: string;
  gaps?: DashboardData['gaps'];
  sentiment?: DashboardData['sentiment'];
  quotes?: Record<string, PriceQuote>;
}

/**
 * 가장 최근 브리핑 스냅샷.
 * dashboard_snapshot 테이블에는 캐시·히스토리 등 kind 가 붙은 행이 섞여 있어
 * kind 없는 행(브리핑 스냅샷)만 걸러 읽는다.
 */
export async function loadPreviousBriefingSnapshot(): Promise<{
  capturedAt: string;
  snap: BriefingSnapshot;
} | null> {
  const client = getAdminClient();
  if (!client) {
    const found = memoryState().snapshots.find(
      (s) => !(s.payload as { kind?: string } | null)?.kind,
    );
    return found ? { capturedAt: found.capturedAt, snap: found.payload as BriefingSnapshot } : null;
  }

  const { data, error } = await client
    .from('dashboard_snapshot')
    .select('captured_at, payload')
    .is('payload->>kind', null)
    .order('captured_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;

  const snap = data.payload as BriefingSnapshot | null;
  if (!snap || (!snap.quotes && !snap.sentiment)) return null;
  return { capturedAt: data.captured_at as string, snap };
}

const sign = (v: number) => (v > 0 ? '+' : '');

/** 현재 대시보드와 스냅샷의 차이를 문장 목록으로. 변화가 없으면 빈 배열 */
export function buildBriefingDiff(data: DashboardData, prev: BriefingSnapshot): string[] {
  const lines: string[] = [];

  /* 1) 보유·목표 시세 변화 */
  if (prev.quotes) {
    const apartments = [...data.config.holdings, ...data.config.targets];
    for (const a of apartments) {
      const now = data.quotes[a.id]?.price ?? 0;
      const before = prev.quotes[a.id]?.price ?? 0;
      if (now > 0 && before > 0 && now !== before) {
        const d = now - before;
        lines.push(
          `${a.complexName}: ${formatKrw(before, { compact: true })} → ${formatKrw(now, { compact: true })} (${sign(d)}${formatKrw(d, { compact: true })})`,
        );
      }
    }
  }

  /* 2) 1순위 조합의 갭·실소요 변화 */
  const nowGap = data.gaps[0];
  const prevGap =
    nowGap && prev.gaps
      ? prev.gaps.find((g) => g.holdingId === nowGap.holdingId && g.targetId === nowGap.targetId)
      : undefined;
  if (nowGap && prevGap) {
    const dGap = nowGap.gap - prevGap.gap;
    if (dGap !== 0) {
      lines.push(
        `1순위 갭(${nowGap.targetName}): ${formatKrw(prevGap.gap, { compact: true })} → ${formatKrw(nowGap.gap, { compact: true })} (${sign(dGap)}${formatKrw(dGap, { compact: true })})`,
      );
    }
    const dCash = nowGap.realCashNeeded - prevGap.realCashNeeded;
    if (dCash !== 0) {
      lines.push(
        `실소요 자금: ${formatKrw(prevGap.realCashNeeded, { compact: true })} → ${formatKrw(nowGap.realCashNeeded, { compact: true })} (${sign(dCash)}${formatKrw(dCash, { compact: true })})`,
      );
    }
  }

  /* 3) 시장 과열도 변화 */
  if (prev.sentiment && data.sentiment.heatScore !== prev.sentiment.heatScore) {
    const d = data.sentiment.heatScore - prev.sentiment.heatScore;
    lines.push(
      `과열점수: ${prev.sentiment.heatScore} → ${data.sentiment.heatScore} (${sign(d)}${d})`,
    );
  }

  return lines;
}
