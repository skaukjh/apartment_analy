import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth/server';
import { requireAdminClient } from '@/lib/store/supabase';
import { errorResponse } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

/**
 * 가입 승인 관리 — ADMIN_EMAILS 에 등록된 관리자만.
 *
 * GET  : 사용자 목록 (승인 대기 우선)
 * POST : { userId, approve: boolean } — 승인/승인 취소
 * 시간 제한은 없다. 대기자는 승인 전까지 열람만 가능할 뿐 계정이 사라지지 않는다.
 */
async function requireAdmin() {
  const user = await getSessionUser();
  if (!user) return { error: '로그인이 필요합니다.', status: 401 } as const;
  if (!user.isAdmin) return { error: '관리자만 쓸 수 있습니다.', status: 403 } as const;
  return { user } as const;
}

export async function GET() {
  try {
    const gate = await requireAdmin();
    if ('error' in gate) {
      return NextResponse.json({ ok: false, error: gate.error }, { status: gate.status });
    }

    const admin = requireAdminClient();
    const { data, error } = await admin.auth.admin.listUsers({ perPage: 200 });
    if (error) throw new Error(error.message);

    const users = data.users
      .map((u) => ({
        id: u.id,
        email: u.email ?? '(이메일 없음)',
        createdAt: u.created_at,
        approved:
          (u.app_metadata as Record<string, unknown> | null)?.approved === true ||
          Boolean(u.email && gate.user.email === u.email.toLowerCase() && gate.user.isAdmin),
        isAdmin: Boolean(u.email && u.email.toLowerCase() === gate.user.email),
      }))
      .sort((a, b) => Number(a.approved) - Number(b.approved));

    return NextResponse.json({ ok: true, users });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(request: Request) {
  try {
    const gate = await requireAdmin();
    if ('error' in gate) {
      return NextResponse.json({ ok: false, error: gate.error }, { status: gate.status });
    }

    const body = (await request.json().catch(() => ({}))) as {
      userId?: string;
      approve?: boolean;
    };
    if (!body.userId) {
      return NextResponse.json({ ok: false, error: 'userId 가 필요합니다.' }, { status: 400 });
    }

    const admin = requireAdminClient();
    const { error } = await admin.auth.admin.updateUserById(body.userId, {
      app_metadata: { approved: body.approve !== false },
    });
    if (error) throw new Error(error.message);

    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
