import { NextResponse } from 'next/server';
import { errorResponse } from '@/lib/api-auth';
import { getSessionUser } from '@/lib/auth/server';
import { loadTodayApiUsage } from '@/lib/store/api-usage';

export const dynamic = 'force-dynamic';

/**
 * 오늘(KST)의 외부 API 호출량 — 설정 화면의 소스 키 섹션에 표시한다.
 *
 * 어느 공공 API 도 "남은 쿼터"를 응답으로 주지 않아 자체 집계한 근사치다.
 * Next 데이터 캐시에서 응답된 호출도 세므로 실제 API 소비보다 크게 나올 수 있다
 * (즉, 이 수치가 한도 아래면 실제로는 확실히 여유가 있다).
 */
export async function GET() {
  try {
    const user = await getSessionUser();
    if (!user)
      return NextResponse.json({ ok: false, error: '로그인이 필요합니다.' }, { status: 401 });

    const rows = await loadTodayApiUsage();
    return NextResponse.json({
      ok: true,
      // null 이면 0005_api_usage.sql 마이그레이션이 아직 적용되지 않은 것
      available: rows !== null,
      usage: rows ?? [],
    });
  } catch (e) {
    return errorResponse(e);
  }
}
