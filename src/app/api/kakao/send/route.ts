import { NextResponse } from 'next/server';
import { recentBriefings, runBriefing } from '@/lib/pipeline/briefing-service';
import { authorizeCron, errorResponse } from '@/lib/api-auth';
import { configIdForRequest, getSessionUser } from '@/lib/auth/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 180;

/** 브리핑 미리보기 및 최근 발송 이력 */
export async function GET() {
  try {
    const [result, history] = await Promise.all([
      runBriefing({ dryRun: true, userId: await configIdForRequest() }),
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
    // 수동 발송은 비용·알림이 드는 동작 — 승인 계정 또는 레거시(비로그인 로컬 운영)만.
    const user = await getSessionUser();
    if (user && !user.approved) {
      return NextResponse.json({ ok: false, error: '가입 승인 대기 중입니다.' }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));

    /* 운영자 수동 발송용 사용자 지정 — CRON_SECRET 인증을 통과할 때만 허용.
       세션 없이(CLI 등) 특정 회원 설정으로 발송해야 할 때 쓴다. */
    let overrideUserId: string | undefined;
    if (typeof body?.userId === 'string' && body.userId) {
      const denied = authorizeCron(request);
      if (denied) return denied;
      overrideUserId = body.userId;
    }
    const result = await runBriefing({
      dryRun: Boolean(body?.dryRun),
      force: Boolean(body?.force),
      recipientIds: Array.isArray(body?.recipientIds) ? body.recipientIds : undefined,
      // 시간대별 문구를 미리 확인할 때 쓴다 (morning | noon | evening | night)
      slot: body?.slot,
      // 특정 채널만 보낼 때 (예: ["kakao"]) — 생략하면 켜진 채널 모두
      channels: Array.isArray(body?.channels)
        ? (body.channels.filter((c: unknown) => c === 'kakao' || c === 'telegram') as Array<
            'kakao' | 'telegram'
          >)
        : undefined,
      userId: overrideUserId ?? (await configIdForRequest()),
    });
    return NextResponse.json(result, { status: result.ok ? 200 : 502 });
  } catch (e) {
    return errorResponse(e);
  }
}
