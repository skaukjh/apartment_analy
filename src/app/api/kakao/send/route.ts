import { NextResponse } from 'next/server';
import { recentBriefings, runBriefing } from '@/lib/pipeline/briefing-service';
import { errorResponse } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 180;

/** 브리핑 미리보기 및 최근 발송 이력 */
export async function GET() {
  try {
    const [result, history] = await Promise.all([
      runBriefing({ dryRun: true }),
      recentBriefings(10),
    ]);
    return NextResponse.json({ ok: true, preview: result, history });
  } catch (e) {
    return errorResponse(e);
  }
}

/** 즉시 발송 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const result = await runBriefing({
      dryRun: Boolean(body?.dryRun),
      force: Boolean(body?.force),
      recipientIds: Array.isArray(body?.recipientIds) ? body.recipientIds : undefined,
    });
    return NextResponse.json(result, { status: result.ok ? 200 : 502 });
  } catch (e) {
    return errorResponse(e);
  }
}
