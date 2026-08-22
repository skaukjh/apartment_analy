import { NextResponse } from 'next/server';
import { loadConfig, loadConfigHistory, saveConfig, isConfigEmpty } from '@/lib/store/config';
import { getSessionUser, requireApprovedUser, ANON_CONFIG_ID } from '@/lib/auth/server';
import { errorResponse } from '@/lib/api-auth';
import { featureFlags } from '@/lib/env';
import { invalidateDashboardCache } from '@/lib/pipeline/dashboard-cache';

export const dynamic = 'force-dynamic';

/**
 * 설정 조회/저장 — 로그인 사용자별로 분리된다.
 *
 * 어느 설정을 읽고 쓸지는 서버가 세션에서 정한다.
 * 클라이언트가 보낸 id 를 믿으면 남의 설정을 고칠 수 있으므로 받지 않는다.
 */
export async function GET(request: Request) {
  try {
    const user = await getSessionUser();

    // 설정 히스토리 — 저장할 때마다 직전 저장본이 남는다 (카드 단위 복원용)
    if (new URL(request.url).searchParams.get('action') === 'history') {
      if (!user) {
        return NextResponse.json({ ok: false, error: '로그인이 필요합니다.' }, { status: 401 });
      }
      const history = await loadConfigHistory(user.id);
      return NextResponse.json({ ok: true, history });
    }

    const config = await loadConfig(user?.id ?? ANON_CONFIG_ID);
    return NextResponse.json({
      ok: true,
      config,
      user: user ? { email: user.email } : null,
      persisted: featureFlags.hasSupabaseAdmin,
    });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function PUT(request: Request) {
  try {
    const gate = await requireApprovedUser();
    if ('error' in gate) {
      return NextResponse.json({ ok: false, error: gate.error }, { status: gate.status });
    }
    const user = gate.user;

    const body = await request.json();
    const config = await saveConfig(body, user.id);
    // 설정이 바뀌었으니 이전 설정으로 조립된 대시보드 캐시는 버린다
    await invalidateDashboardCache(user.id).catch(() => {});
    return NextResponse.json({
      ok: true,
      config,
      persisted: featureFlags.hasSupabaseAdmin,
      warning: featureFlags.hasSupabaseAdmin
        ? undefined
        : 'Supabase 가 설정되지 않아 서버 재시작 시 설정이 사라집니다. 카카오 브리핑을 쓰려면 Supabase 연결이 필요합니다.',
    });
  } catch (e) {
    return errorResponse(e, 400);
  }
}

/**
 * 레거시(로그인 도입 전) 공용 설정을 내 계정으로 복사한다.
 * 내 설정이 비어 있을 때만 동작한다 — 이미 입력한 걸 덮어쓰지 않는다.
 */
export async function POST(request: Request) {
  try {
    const url = new URL(request.url);
    if (url.searchParams.get('action') !== 'import-legacy') {
      return NextResponse.json({ ok: false, error: '알 수 없는 action' }, { status: 400 });
    }

    const gate = await requireApprovedUser();
    if ('error' in gate) {
      return NextResponse.json({ ok: false, error: gate.error }, { status: gate.status });
    }
    const user = gate.user;

    const mine = await loadConfig(user.id);
    if (!isConfigEmpty(mine)) {
      return NextResponse.json(
        { ok: false, error: '이미 설정이 있습니다. 비어 있을 때만 가져올 수 있습니다.' },
        { status: 409 },
      );
    }

    const legacy = await loadConfig(ANON_CONFIG_ID);
    if (isConfigEmpty(legacy)) {
      return NextResponse.json(
        { ok: false, error: '가져올 공용 설정이 없습니다.' },
        { status: 404 },
      );
    }

    const config = await saveConfig(legacy, user.id);
    return NextResponse.json({ ok: true, config });
  } catch (e) {
    return errorResponse(e);
  }
}
