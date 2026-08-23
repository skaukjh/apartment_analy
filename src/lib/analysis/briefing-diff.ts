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
  userId?: string;
  generatedAt?: string;
  gaps?: DashboardData['gaps'];
  sentiment?: DashboardData['sentiment'];
  quotes?: Record<string, PriceQuote>;
}

/**
 * 이 사용자의 가장 최근 브리핑 스냅샷.
 *
 * 반드시 userId 로 걸러야 한다 — 사용자 구분 없이 최신 행을 읽던 시절,
 * 다른 계정(레거시 default)의 브리핑이 1분 먼저 발송되면 그 스냅샷이
 * 비교 대상이 되어 아파트가 하나도 안 겹치고 "변화 0건"으로 판정되는
 * 실제 사고가 있었다 (변경 분석 메시지가 안 나간 원인).
 */
export async function loadPreviousBriefingSnapshot(userId: string): Promise<{
  capturedAt: string;
  snap: BriefingSnapshot;
} | null> {
  const client = getAdminClient();
  if (!client) {
    const found = memoryState().snapshots.find((s) => {
      const p = s.payload as BriefingSnapshot & { kind?: string };
      return !p?.kind && p?.userId === userId;
    });
    return found ? { capturedAt: found.capturedAt, snap: found.payload as BriefingSnapshot } : null;
  }

  const { data, error } = await client
    .from('dashboard_snapshot')
    .select('captured_at, payload')
    .is('payload->>kind', null)
    .eq('payload->>userId', userId)
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

/**
 * 변경의 의미를 규칙으로 해석 — AI 가 없거나 실패했을 때의 대체 분석.
 * "갈아타기(하급지 매도 → 상급지 매수)" 관점으로 방향을 읽는다.
 */
export function interpretDiffFallback(data: DashboardData, prev: BriefingSnapshot): string[] {
  const out: string[] = [];

  const nowGap = data.gaps[0];
  const prevGap =
    nowGap && prev.gaps
      ? prev.gaps.find((g) => g.holdingId === nowGap.holdingId && g.targetId === nowGap.targetId)
      : undefined;
  if (nowGap && prevGap) {
    const dGap = nowGap.gap - prevGap.gap;
    if (dGap < 0) {
      out.push(
        `갭이 ${formatKrw(-dGap, { compact: true })} 줄었습니다 — 상급지와의 격차가 좁혀져 갈아타기에 유리한 방향입니다.`,
      );
    } else if (dGap > 0) {
      out.push(
        `갭이 ${formatKrw(dGap, { compact: true })} 벌어졌습니다 — 기다릴수록 상급지 진입 부담이 커지는 방향입니다.`,
      );
    }
    const dCash = nowGap.realCashNeeded - prevGap.realCashNeeded;
    if (dCash !== 0) {
      out.push(
        `실소요 자금이 ${formatKrw(Math.abs(dCash), { compact: true })} ${dCash > 0 ? '늘었습니다' : '줄었습니다'}.`,
      );
    }
  }

  if (prev.sentiment) {
    const d = data.sentiment.heatScore - prev.sentiment.heatScore;
    if (d >= 5) {
      out.push(
        '과열점수가 뚜렷이 올랐습니다 — 매수 경쟁이 심해지는 국면으로, 목표 단지 시세가 먼저 움직일 수 있습니다.',
      );
    } else if (d <= -5) {
      out.push(
        '과열점수가 뚜렷이 내렸습니다 — 관망세가 짙어지는 국면으로, 급하게 추격 매수할 이유는 약해집니다.',
      );
    }
  }

  if (out.length === 0) {
    out.push('시세 변동 폭이 크지 않아 갈아타기 판단을 바꿀 수준은 아닙니다.');
  }
  return out;
}
