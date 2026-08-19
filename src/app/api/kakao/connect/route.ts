import { NextResponse } from 'next/server';
import { buildAuthUrl } from '@/lib/kakao/client';
import { env } from '@/lib/env';
import { errorResponse } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

/** 카카오 로그인 동의 화면으로 리다이렉트 */
export async function GET(request: Request) {
  try {
    const origin = new URL(request.url).origin;
    const redirectUri = env.kakaoRedirectUri ?? `${origin}/api/kakao/callback`;
    return NextResponse.redirect(buildAuthUrl(redirectUri));
  } catch (e) {
    return errorResponse(e, 400);
  }
}
