/**
 * Cron / 관리자 라우트 인증.
 * Vercel Cron 은 CRON_SECRET 이 설정돼 있으면 `Authorization: Bearer <CRON_SECRET>` 헤더를 붙여 호출한다.
 * 수동 실행 편의를 위해 `?secret=` 쿼리도 허용한다.
 */

import { NextResponse } from 'next/server';
import { env } from '@/lib/env';

export function authorizeCron(request: Request): NextResponse | null {
  const secret = env.cronSecret;

  // 시크릿 미설정 시: 로컬 개발에서는 통과, 배포 환경에서는 차단
  if (!secret) {
    if (process.env.NODE_ENV !== 'production') return null;
    return NextResponse.json(
      { ok: false, error: 'CRON_SECRET 이 설정되지 않아 실행을 거부했습니다.' },
      { status: 500 },
    );
  }

  const header = request.headers.get('authorization');
  if (header === `Bearer ${secret}`) return null;

  const url = new URL(request.url);
  if (url.searchParams.get('secret') === secret) return null;

  return NextResponse.json({ ok: false, error: '인증 실패' }, { status: 401 });
}

export function errorResponse(e: unknown, status = 500): NextResponse {
  const message = e instanceof Error ? e.message : String(e);
  console.error('[api]', message);
  return NextResponse.json({ ok: false, error: message }, { status });
}
