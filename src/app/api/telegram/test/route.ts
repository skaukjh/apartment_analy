import { NextResponse } from 'next/server';
import { errorResponse } from '@/lib/api-auth';
import { configIdForRequest, getSessionUser } from '@/lib/auth/server';
import { loadConfig } from '@/lib/store/config';
import { hasTelegram, sendTelegramText } from '@/lib/telegram/client';

export const dynamic = 'force-dynamic';

/** 텔레그램 테스트 발송 — body: { chatId?: string } (없으면 저장된 값 사용) */
export async function POST(request: Request) {
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

    const body = await request.json().catch(() => ({}));
    const chatId =
      (typeof body?.chatId === 'string' && body.chatId.trim()) ||
      (await loadConfig(await configIdForRequest())).telegramChatId;
    if (!chatId) {
      return NextResponse.json(
        { ok: false, error: 'chat_id 가 없습니다. 대화 감지로 먼저 찾아 저장하세요.' },
        { status: 400 },
      );
    }

    await sendTelegramText(
      chatId,
      '✅ 이사각 텔레그램 연결 테스트\n이 방으로 일일 브리핑이 발송됩니다.',
    );
    return NextResponse.json({ ok: true, chatId });
  } catch (e) {
    return errorResponse(e);
  }
}
