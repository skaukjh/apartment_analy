import { NextResponse } from 'next/server';
import { authorizeCron, errorResponse } from '@/lib/api-auth';
import { runBriefing } from '@/lib/pipeline/briefing-service';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** 일일 카카오톡 브리핑 발송 (Vercel Cron) */
export async function GET(request: Request) {
  const denied = authorizeCron(request);
  if (denied) return denied;

  try {
    const result = await runBriefing();
    return NextResponse.json(
      {
        ok: result.ok,
        messageCount: result.messageCount,
        skippedReason: result.skippedReason,
        error: result.error,
        preview: result.text.slice(0, 500),
      },
      { status: result.ok ? 200 : 502 },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
