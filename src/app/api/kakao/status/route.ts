import { NextResponse } from 'next/server';
import { clearToken, getConnectionStatus } from '@/lib/kakao/client';
import { errorResponse } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json({ ok: true, ...(await getConnectionStatus()) });
  } catch (e) {
    return errorResponse(e);
  }
}

/** 연결 해제 */
export async function DELETE() {
  try {
    await clearToken();
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
