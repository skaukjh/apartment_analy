import { NextResponse } from 'next/server';
import { authorizeCron, errorResponse } from '@/lib/api-auth';
import { runBriefing } from '@/lib/pipeline/briefing-service';
import { refreshRecent } from '@/lib/pipeline/refresh';
import { analysisTargets, loadConfig } from '@/lib/store/config';
import { slotForHour, type BriefingSlot } from '@/lib/kakao/briefing';
import { nowKst } from '@/lib/format';
import { hasOpenAI } from '@/lib/ai/client';
import { buildDashboard } from '@/lib/pipeline/dashboard';
import { buildMarketOutlook } from '@/lib/ai/market-outlook';
import { saveOutlookCache } from '@/lib/ai/outlook-cache';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * 매시간 도는 단일 cron.
 *
 * ── 왜 하나로 합쳤나 ──────────────────────────────────────────────
 * Vercel 은 요금제별로 등록 가능한 cron 개수가 제한된다.
 * 발송 시각마다 cron 을 따로 두면 4개가 필요하므로, 매시간 한 번만 깨어나
 * "지금이 발송 시각인가"를 스스로 판단하는 구조로 만들었다.
 *
 * 하는 일:
 *  1. 매시간 — 최근 실거래를 갱신한다 (오늘의 요약 페이지가 최신 데이터를 쓰도록)
 *  2. 05·11·18·22시(KST) — 그 시간대에 맞는 카카오톡 브리핑을 보낸다
 *
 * 수동 실행:
 *  /api/cron/tick?secret=…            지금 시각 기준으로 판단
 *  /api/cron/tick?secret=…&slot=night 슬롯을 강제로 지정해 발송 (테스트용)
 *  /api/cron/tick?secret=…&refreshOnly=1  갱신만 하고 발송하지 않음
 */
export async function GET(request: Request) {
  const denied = authorizeCron(request);
  if (denied) return denied;

  try {
    const url = new URL(request.url);
    const forced = url.searchParams.get('slot') as BriefingSlot | null;
    const refreshOnly = url.searchParams.get('refreshOnly') === '1';

    const kst = nowKst();
    const hour = kst.getHours();
    const slot = forced ?? slotForHour(hour);

    /* 1) 최근 실거래 갱신 — 오늘의 요약이 실데이터를 보게 한다 */
    const config = await loadConfig();
    const codes = analysisTargets(config);
    const refresh = await refreshRecent(codes, 2, { budgetMs: 120_000 });

    /* 1-2) AI 요약을 미리 만들어 캐시에 넣는다.
       사용자가 페이지를 열 때 20~40초를 기다리지 않아도 되고,
       호출 횟수가 시간당 1회로 고정돼 비용이 예측 가능해진다. */
    let outlookCached = false;
    if (hasOpenAI()) {
      try {
        const data = await buildDashboard();
        const outlook = await buildMarketOutlook(data);
        await saveOutlookCache(outlook);
        outlookCached = true;
      } catch (e) {
        console.error('[tick] AI 요약 생성 실패:', (e as Error).message);
      }
    }

    /* 2) 발송 시각이면 브리핑 */
    if (refreshOnly || !slot) {
      return NextResponse.json({
        ok: true,
        hourKst: hour,
        slot,
        sent: false,
        reason: refreshOnly ? '갱신만 요청됨' : '발송 시각이 아님 (05·11·18·22시)',
        outlookCached,
        refresh: {
          regions: refresh.regionsProcessed,
          trades: refresh.tradesCollected,
          errors: refresh.errors.length,
        },
      });
    }

    const result = await runBriefing({ slot });

    return NextResponse.json(
      {
        ok: result.ok,
        hourKst: hour,
        slot,
        sent: !result.skippedReason,
        messageCount: result.messageCount,
        skippedReason: result.skippedReason,
        error: result.error,
        preview: result.chunks[0]?.slice(0, 300),
        outlookCached,
        refresh: {
          regions: refresh.regionsProcessed,
          trades: refresh.tradesCollected,
          errors: refresh.errors.length,
        },
      },
      { status: result.ok ? 200 : 502 },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
