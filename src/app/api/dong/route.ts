import { NextResponse } from 'next/server';
import { errorResponse } from '@/lib/api-auth';
import { loadDongMonthly } from '@/lib/store/market-data';
import { analyzeRebound } from '@/lib/analysis/rebound';
import { findSigungu } from '@/lib/regions';
import type { DongStat } from '@/lib/types';

export const dynamic = 'force-dynamic';

/**
 * 시군구 내 법정동별 반등 요약 — 지도 드릴다운(동 단위 색칠)에서 사용.
 * GET /api/dong?lawd=11710
 */
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const lawd = params.get('lawd') ?? '';
    if (!/^\d{5}$/.test(lawd)) {
      return NextResponse.json({ ok: false, error: 'lawd 파라미터(5자리)가 필요합니다.' }, {
        status: 400,
      });
    }

    const from = params.get('from') ?? undefined;
    const to = params.get('to') ?? undefined;
    const byDong = await loadDongMonthly(lawd, from ?? '2022-01');

    const dongs: DongStat[] = Object.entries(byDong)
      .map(([name, series]) => {
        // 동 단위는 표본이 적으므로 최소 거래건수 기준을 낮춘다
        const a = analyzeRebound(lawd, series, { minTrades: 3, baseMonth: from, endMonth: to });
        return {
          name,
          changeSinceBase: a.changeSinceBase,
          recent3mChange: a.recent3mChange,
          reboundFromTrough: a.reboundFromTrough,
          sampleSize: series.reduce((s, p) => s + p.count, 0),
          stage: a.stage,
          baseMonth: a.baseMonth,
          latestMonth: a.latestMonth,
        };
      })
      .sort((a, b) => b.changeSinceBase - a.changeSinceBase);

    return NextResponse.json({
      ok: true,
      lawd,
      region: findSigungu(lawd)?.name ?? lawd,
      dongs,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
