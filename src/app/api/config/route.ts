import { NextResponse } from 'next/server';
import { loadConfig, saveConfig } from '@/lib/store/config';
import { errorResponse } from '@/lib/api-auth';
import { featureFlags } from '@/lib/env';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const config = await loadConfig();
    return NextResponse.json({
      ok: true,
      config,
      persisted: featureFlags.hasSupabaseAdmin,
    });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const config = await saveConfig(body);
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
