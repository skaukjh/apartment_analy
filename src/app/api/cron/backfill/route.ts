import { NextResponse } from 'next/server';
import { authorizeCron, errorResponse } from '@/lib/api-auth';
import { backfill, BACKFILL_FROM } from '@/lib/pipeline/refresh';
import { analysisTargets, loadConfig } from '@/lib/store/config';
import { DEFAULT_ANALYSIS_REGIONS } from '@/lib/regions';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * 과거 실거래 백필. 이미 저장된 (지역, 월)은 건너뛰므로 remaining 이 0이 될 때까지 반복 호출하면 된다.
 *
 * 쿼리:
 *  - from: 시작 YYYYMM (기본 202201)
 *  - regions: 한 번에 처리할 지역 수 (기본 6)
 *  - scope: user | all (기본 all)
 */
export async function GET(request: Request) {
  const denied = authorizeCron(request);
  if (denied) return denied;

  try {
    const url = new URL(request.url);
    const fromYm = url.searchParams.get('from') ?? BACKFILL_FROM;
    const maxRegions = Number(url.searchParams.get('regions') ?? '6');
    const scope = url.searchParams.get('scope') ?? 'all';

    const config = await loadConfig();
    const userCodes = analysisTargets(config);
    const codes =
      scope === 'user' ? userCodes : [...new Set([...userCodes, ...DEFAULT_ANALYSIS_REGIONS])];

    const result = await backfill(codes, {
      fromYm,
      maxRegionsPerRun: Number.isFinite(maxRegions) ? maxRegions : 6,
      cacheTradesFor: new Set(userCodes),
      budgetMs: 260_000,
    });

    return NextResponse.json({
      ok: true,
      fromYm,
      totalRegions: codes.length,
      ...result,
      hint:
        (result.remaining ?? 0) > 0
          ? '남은 작업이 있습니다. 같은 URL 을 다시 호출하세요.'
          : '백필 완료',
    });
  } catch (e) {
    return errorResponse(e);
  }
}
