import { NextResponse } from 'next/server';
import { getConnectionStatus, removeRecipient, setRecipientEnabled } from '@/lib/kakao/client';
import { errorResponse } from '@/lib/api-auth';
import { configIdForRequest } from '@/lib/auth/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json({
      ok: true,
      ...(await getConnectionStatus(await configIdForRequest())),
    });
  } catch (e) {
    return errorResponse(e);
  }
}

/** 수신자 활성/비활성 토글 — body: { id, enabled } */
export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const id = String(body?.id ?? '');
    if (!id) return NextResponse.json({ ok: false, error: 'id 가 필요합니다.' }, { status: 400 });
    await setRecipientEnabled(id, Boolean(body?.enabled));
    return NextResponse.json({
      ok: true,
      ...(await getConnectionStatus(await configIdForRequest())),
    });
  } catch (e) {
    return errorResponse(e);
  }
}

/** 수신자 연결 해제 — ?id=... (없으면 전체 해제) */
export async function DELETE(request: Request) {
  try {
    const id = new URL(request.url).searchParams.get('id');
    if (id) {
      await removeRecipient(id);
    } else {
      const status = await getConnectionStatus(await configIdForRequest());
      await Promise.all(status.recipients.map((r) => removeRecipient(r.id)));
    }
    return NextResponse.json({
      ok: true,
      ...(await getConnectionStatus(await configIdForRequest())),
    });
  } catch (e) {
    return errorResponse(e);
  }
}
