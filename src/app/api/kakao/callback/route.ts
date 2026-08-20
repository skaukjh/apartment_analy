import { NextResponse } from 'next/server';
import { exchangeCodeAndRegister } from '@/lib/kakao/client';
import { env } from '@/lib/env';

export const dynamic = 'force-dynamic';

/** 카카오 OAuth 리다이렉트 수신 → 토큰 교환 후 수신자로 등록하고 설정 화면으로 복귀 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');
  // state 에는 별명(label)과 등록 대상 사용자 id 가 base64url JSON 으로 담겨 있다.
  // 예전 형식(별명 문자열 그대로)도 파싱 실패 시 폴백으로 지원한다.
  const rawState = url.searchParams.get('state')?.trim() || undefined;
  let label: string | undefined = rawState;
  let stateUserId = 'default';
  if (rawState) {
    try {
      const parsed = JSON.parse(Buffer.from(rawState, 'base64url').toString('utf8')) as {
        l?: string;
        u?: string;
      };
      label = parsed.l;
      if (parsed.u) stateUserId = parsed.u;
    } catch {
      /* 구형 state — 별명으로 취급 */
    }
  }
  const settingsUrl = new URL('/settings', url.origin);

  if (error) {
    settingsUrl.searchParams.set('kakao', 'error');
    settingsUrl.searchParams.set('message', url.searchParams.get('error_description') ?? error);
    return NextResponse.redirect(settingsUrl);
  }

  if (!code) {
    settingsUrl.searchParams.set('kakao', 'error');
    settingsUrl.searchParams.set('message', '인가 코드가 없습니다.');
    return NextResponse.redirect(settingsUrl);
  }

  try {
    const redirectUri = env.kakaoRedirectUri ?? `${url.origin}/api/kakao/callback`;
    const recipient = await exchangeCodeAndRegister(code, redirectUri, label, stateUserId);
    settingsUrl.searchParams.set('kakao', 'connected');
    settingsUrl.searchParams.set('name', recipient.label ?? recipient.nickname ?? '수신자');
    return NextResponse.redirect(settingsUrl);
  } catch (e) {
    settingsUrl.searchParams.set('kakao', 'error');
    settingsUrl.searchParams.set('message', (e as Error).message);
    return NextResponse.redirect(settingsUrl);
  }
}
