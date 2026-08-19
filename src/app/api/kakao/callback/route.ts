import { NextResponse } from 'next/server';
import { exchangeCodeAndRegister } from '@/lib/kakao/client';
import { env } from '@/lib/env';

export const dynamic = 'force-dynamic';

/** 카카오 OAuth 리다이렉트 수신 → 토큰 교환 후 수신자로 등록하고 설정 화면으로 복귀 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');
  // 수신자를 추가할 때 넘긴 별명 (state 에 실어 보낸다)
  const label = url.searchParams.get('state')?.trim() || undefined;
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
    const recipient = await exchangeCodeAndRegister(code, redirectUri, label);
    settingsUrl.searchParams.set('kakao', 'connected');
    settingsUrl.searchParams.set('name', recipient.label ?? recipient.nickname ?? '수신자');
    return NextResponse.redirect(settingsUrl);
  } catch (e) {
    settingsUrl.searchParams.set('kakao', 'error');
    settingsUrl.searchParams.set('message', (e as Error).message);
    return NextResponse.redirect(settingsUrl);
  }
}
