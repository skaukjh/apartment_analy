/**
 * 텔레그램 봇 API 클라이언트 — 브리핑 발송용.
 *
 * 카카오와 달리 텔레그램은 봇이 들어간 그룹/채널이나 1:1 대화에
 * 공식 API 로 자유롭게 보낼 수 있다 (무료, 검수 없음).
 *
 * 준비:
 *  1. 텔레그램에서 @BotFather 에게 /newbot → 봇 이름·아이디 정하면 토큰 발급
 *  2. 토큰을 Vercel 환경변수 TELEGRAM_BOT_TOKEN 에 추가
 *  3. 받을 방(그룹)에 봇을 초대하거나, 봇과 1:1 대화 시작 후 아무 메시지 전송
 *  4. 설정 화면의 "대화 감지"로 chat_id 를 잡아 저장
 *
 * 주의: getUpdates 는 봇이 웹훅을 쓰지 않을 때만 동작한다 (이 앱은 웹훅 미사용).
 */

import { env } from '@/lib/env';
import { bumpApiUsage } from '@/lib/store/api-usage';

const API = 'https://api.telegram.org';

export function hasTelegram(): boolean {
  return Boolean(env.telegramBotToken);
}

interface TgResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
}

async function call<T>(method: string, body?: Record<string, unknown>): Promise<T> {
  const token = env.telegramBotToken;
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN 이 설정되지 않았습니다.');

  bumpApiUsage('telegram');
  const res = await fetch(`${API}/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
    cache: 'no-store',
  });
  const json = (await res.json()) as TgResponse<T>;
  if (!json.ok) {
    throw new Error(`텔레그램 ${method} 실패: ${json.description ?? res.status}`);
  }
  return json.result as T;
}

/** 4096자 제한에 맞춰 줄 단위로 나눈다 */
function splitText(text: string, max = 4000): string[] {
  if (text.length <= max) return [text];
  const chunks: string[] = [];
  let current = '';
  for (const line of text.split('\n')) {
    if (current.length + line.length + 1 > max) {
      if (current) chunks.push(current);
      current = line;
    } else {
      current = current ? `${current}\n${line}` : line;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

/** 텍스트 메시지 발송 — 길면 나눠 보낸다 */
export async function sendTelegramText(chatId: string, text: string): Promise<void> {
  for (const chunk of splitText(text)) {
    await call('sendMessage', {
      chat_id: chatId,
      text: chunk,
      // 링크 미리보기가 본문을 가리지 않게 끈다
      link_preview_options: { is_disabled: true },
    });
    // 연속 발송 rate limit 여유
    await new Promise((r) => setTimeout(r, 300));
  }
}

export interface TelegramChatCandidate {
  chatId: string;
  /** 그룹 제목 또는 상대 이름 */
  title: string;
  /** private | group | supergroup | channel */
  type: string;
}

interface TgUpdate {
  message?: TgIncoming;
  my_chat_member?: { chat: TgChat };
  channel_post?: TgIncoming;
}
interface TgIncoming {
  chat: TgChat;
}
interface TgChat {
  id: number;
  type: string;
  title?: string;
  first_name?: string;
  last_name?: string;
  username?: string;
}

/**
 * 봇이 최근 받은 메시지·초대에서 대화 후보를 찾는다.
 * 사용자는 봇에게 아무 메시지나 보내거나 그룹에 초대한 뒤 이걸 호출하면 된다.
 */
export async function detectChats(): Promise<TelegramChatCandidate[]> {
  const updates = await call<TgUpdate[]>('getUpdates', { limit: 100 });
  const byId = new Map<string, TelegramChatCandidate>();
  for (const u of updates) {
    const chat = u.message?.chat ?? u.channel_post?.chat ?? u.my_chat_member?.chat;
    if (!chat) continue;
    const title =
      chat.title ??
      [chat.first_name, chat.last_name].filter(Boolean).join(' ') ??
      chat.username ??
      String(chat.id);
    // 뒤에 온 업데이트가 최신 — 덮어써서 최신 제목을 유지
    byId.set(String(chat.id), {
      chatId: String(chat.id),
      title: title || String(chat.id),
      type: chat.type,
    });
  }
  return [...byId.values()].reverse();
}

/** 봇 정보 (설정 화면에서 봇 아이디 안내용) */
export async function getBotInfo(): Promise<{ username?: string; name?: string }> {
  const me = await call<{ username?: string; first_name?: string }>('getMe');
  return { username: me.username, name: me.first_name };
}
