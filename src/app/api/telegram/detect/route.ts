import { NextResponse } from 'next/server';
import { errorResponse } from '@/lib/api-auth';
import { getSessionUser } from '@/lib/auth/server';
import { detectChats, getBotInfo, hasTelegram } from '@/lib/telegram/client';

export const dynamic = 'force-dynamic';

/**
 * 봇이 최근 받은 메시지·초대에서 대화 후보(chat_id)를 찾는다.
 * 사용자는 봇에게 메시지를 보내거나 그룹에 초대한 뒤 이 API 를 호출한다.
 */
export async function GET() {
  try {
    const user = await getSessionUser();
    if (user && !user.approved) {
      return NextResponse.json({ ok: false, error: '가입 승인 대기 중입니다.' }, { status: 403 });
    }
    if (!hasTelegram()) {
      return NextResponse.json(
        { ok: false, error: 'TELEGRAM_BOT_TOKEN 이 설정되지 않았습니다.' },
        { status: 400 },
      );
    }

    const [chats, bot] = await Promise.all([detectChats(), getBotInfo().catch(() => ({}))]);
    return NextResponse.json({ ok: true, chats, bot });
  } catch (e) {
    return errorResponse(e);
  }
}
