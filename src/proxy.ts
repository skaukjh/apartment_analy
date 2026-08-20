/**
 * 세션 갱신 프록시 (Next 16: middleware → proxy 로 개명됨)
 *
 * Supabase 세션 토큰은 만료되면 새로 발급받아 쿠키에 다시 써야 하는데,
 * 서버 컴포넌트는 쿠키를 쓸 수 없다. 그래서 모든 요청이 렌더링 전에
 * 여기를 거치며 토큰을 갱신한다. 이게 없으면 로그인 상태가 1시간 뒤
 * 조용히 풀린다.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return response;

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  // getUser() 호출 자체가 만료 토큰을 갱신한다. 결과는 쓰지 않아도 된다.
  await supabase.auth.getUser();

  return response;
}

export const config = {
  // 정적 자산에는 세션 갱신이 필요 없다
  matcher: ['/((?!_next/static|_next/image|favicon.ico|geo/).*)'],
};
