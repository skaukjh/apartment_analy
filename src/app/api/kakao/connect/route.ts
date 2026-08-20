import { NextResponse } from 'next/server';
import { buildAuthUrl } from '@/lib/kakao/client';
import { env } from '@/lib/env';
import { errorResponse } from '@/lib/api-auth';
import { getSessionUser, ANON_CONFIG_ID } from '@/lib/auth/server';

export const dynamic = 'force-dynamic';

/**
 * 카카오 로그인 동의 화면으로 리다이렉트.
 * ?label=아내  처럼 별명을 주면 등록 후 그 이름으로 표시된다.
 *
 * 수신자를 여러 명 등록하려면 각자 자기 카카오 계정으로 이 흐름을 1회씩 거치면 된다.
 * (카카오는 ID 로 남에게 보내는 API 를 제공하지 않는다)
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const label = url.searchParams.get('label')?.trim();
    const redirectUri = env.kakaoRedirectUri ?? `${url.origin}/api/kakao/callback`;

    // 콜백에서 "누구의 수신자로 등록할지"를 알 수 있게 state 에 사용자 id 를 실어 보낸다.
    // (카카오를 거쳐 돌아오는 동안 세션 쿠키는 유지되지만, state 로 명시하는 쪽이 안전하다)
    const user = await getSessionUser();
    const state = Buffer.from(
      JSON.stringify({ l: label || undefined, u: user?.id ?? ANON_CONFIG_ID }),
      'utf8',
    ).toString('base64url');

    return NextResponse.redirect(buildAuthUrl(redirectUri, state));
  } catch (e) {
    return errorResponse(e, 400);
  }
}
