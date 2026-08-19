import { NextResponse } from 'next/server';
import { errorResponse } from '@/lib/api-auth';
import { loadRegionMonthly } from '@/lib/store/market-data';
import { analysisTargets, loadConfig } from '@/lib/store/config';
import { analyzeRebound, BASE_MONTH } from '@/lib/analysis/rebound';
import { DEFAULT_ANALYSIS_REGIONS } from '@/lib/regions';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MONTH_RE = /^\d{4}-\d{2}$/;

/**
 * 기간을 바꿔 반등 분석을 다시 계산한다 (확산 지도의 날짜 범위 선택용).
 * GET /api/rebound?from=2024-01&to=2026-08
 */
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const from = params.get('from') ?? BASE_MONTH;
    const to = params.get('to') ?? undefined;

    if (!MONTH_RE.test(from) || (to && !MONTH_RE.test(to))) {
      return NextResponse.json(
        { ok: false, error: '기간 형식은 YYYY-MM 입니다.' },
        { status: 400 },
      );
    }
    if (to && to < from) {
      return NextResponse.json(
        { ok: false, error: '종료월이 시작월보다 빠릅니다.' },
        { status: 400 },
      );
    }

    const config = await loadConfig();
    const codes = [...new Set([...DEFAULT_ANALYSIS_REGIONS, ...analysisTargets(config)])];

    // 기준월보다 이른 데이터는 필요 없지만, 저점 탐지를 위해 그대로 넘긴다
    const series = await loadRegionMonthly(codes, from);

    const rebound = Object.entries(series)
      .map(([code, points]) => analyzeRebound(code, points, { baseMonth: from, endMonth: to }))
      .sort((a, b) => b.changeSinceBase - a.changeSinceBase);

    return NextResponse.json({ ok: true, from, to: to ?? null, rebound });
  } catch (e) {
    return errorResponse(e);
  }
}
