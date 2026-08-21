import { NextResponse } from 'next/server';
import { requireAdminClient } from '@/lib/store/supabase';
import { errorResponse } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

/**
 * 가입 — 서버에서 admin API 로 계정을 만든다.
 *
 * ── 왜 클라이언트 signUp 을 안 쓰는가 ──────────────────────────────
 * Supabase 기본 설정은 "이메일 확인" 이 켜져 있고, 확인 메일의 링크는
 * 대시보드의 Site URL(기본 localhost:3000)로 돌아간다. 대시보드를 손대지 않으면
 * 배포 환경에서 가입이 확인 메일 단계에서 끊긴다.
 * admin.createUser 는 email_confirm 을 서버가 지정할 수 있어 이 의존이 사라진다.
 *
 * 비밀번호는 저장하지 않고 Supabase Auth 로 바로 넘긴다.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      email?: string;
      password?: string;
    };
    const email = String(body.email ?? '')
      .trim()
      .toLowerCase();
    const password = String(body.password ?? '');

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json(
        { ok: false, error: '올바른 이메일을 입력하세요.' },
        { status: 400 },
      );
    }
    if (password.length < 8) {
      return NextResponse.json(
        { ok: false, error: '비밀번호는 8자 이상이어야 합니다.' },
        { status: 400 },
      );
    }

    const admin = requireAdminClient();
    const { error } = await admin.auth.admin.createUser({
      email,
      password,
      // 확인 메일 없이 바로 로그인 가능하게. 어차피 비밀번호 재설정이 메일 소유를 검증한다.
      email_confirm: true,
      // 가입 남발 방지 — 관리자가 승인하기 전까지 설정·발송 등 쓰기 기능이 잠긴다
      app_metadata: { approved: false },
    });

    if (error) {
      const friendly = /already been registered|already registered/i.test(error.message)
        ? '이미 가입된 이메일입니다. 로그인하거나 비밀번호를 재설정하세요.'
        : error.message;
      return NextResponse.json({ ok: false, error: friendly }, { status: 409 });
    }

    return NextResponse.json({
      ok: true,
      pendingApproval: true,
      message: '가입 완료. 관리자 승인 후 설정 기능을 쓸 수 있습니다.',
    });
  } catch (e) {
    return errorResponse(e);
  }
}
