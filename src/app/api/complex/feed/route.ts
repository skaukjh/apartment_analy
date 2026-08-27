import { NextResponse } from 'next/server';
import { DEFAULT_PER_KIND, MAX_COMPLEX_NAMES, fetchComplexFeeds } from '@/lib/sources/complex-feed';
import { errorResponse } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * 단지별 소식 — 블로그 · 카페 · 기사를 최신순으로.
 *
 * GET /api/complex/feed?names=잠실엘스,헬리오시티&limit=10
 *
 * 단지마다 네이버 검색 API 를 3회 호출한다. 단지 수는 10개로 제한한다.
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const names = (url.searchParams.get('names') ?? '')
      .split(',')
      .map((n) => n.trim())
      .filter(Boolean);

    if (names.length === 0) {
      return NextResponse.json(
        { ok: false, error: '단지명(names)이 필요합니다. 쉼표로 구분해 넣으세요.' },
        { status: 400 },
      );
    }

    const limitParam = Number(url.searchParams.get('limit') ?? DEFAULT_PER_KIND);
    const limit = Number.isFinite(limitParam) ? limitParam : DEFAULT_PER_KIND;

    const feeds = await fetchComplexFeeds(names, limit);

    return NextResponse.json({
      ok: true,
      generatedAt: new Date().toISOString(),
      /** 상한을 넘겨 잘린 단지가 있으면 화면에서 알려준다 */
      truncated: names.length > MAX_COMPLEX_NAMES,
      maxNames: MAX_COMPLEX_NAMES,
      feeds,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
