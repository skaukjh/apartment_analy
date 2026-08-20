import { NextResponse } from 'next/server';
import { searchComplexes } from '@/lib/sources/complex-search';
import { errorResponse } from '@/lib/api-auth';
import { findSigungu } from '@/lib/regions';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * 단지 검색.
 *
 * GET /api/complex/search?lawdCd=11710&q=헬리오
 *
 * 최근 12개월 실거래에서 단지와 평형을 뽑아준다.
 * 설정 화면에서 단지를 고르면 평형별 실거래가로 입력값을 채우는 데 쓴다.
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const lawdCd = url.searchParams.get('lawdCd')?.trim() ?? '';
    const q = url.searchParams.get('q')?.trim() ?? '';

    if (!/^\d{5}$/.test(lawdCd)) {
      return NextResponse.json(
        { ok: false, error: '법정동코드 5자리(lawdCd)가 필요합니다.' },
        { status: 400 },
      );
    }

    const region = findSigungu(lawdCd);
    if (!region) {
      return NextResponse.json(
        { ok: false, error: `알 수 없는 지역코드입니다: ${lawdCd}` },
        { status: 400 },
      );
    }

    const complexes = await searchComplexes(lawdCd, q);

    return NextResponse.json({
      ok: true,
      region: region.name,
      lawdCd,
      query: q,
      count: complexes.length,
      complexes,
      // 호가는 공식 API 가 없어 실거래가만 제공한다
      priceBasis: 'recent-trade',
    });
  } catch (e) {
    return errorResponse(e);
  }
}
