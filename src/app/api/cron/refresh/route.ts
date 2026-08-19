import { NextResponse } from 'next/server';
import { authorizeCron, errorResponse } from '@/lib/api-auth';
import { refreshRecent } from '@/lib/pipeline/refresh';
import { analysisTargets, loadConfig } from '@/lib/store/config';
import { DEFAULT_ANALYSIS_REGIONS } from '@/lib/regions';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * 최근 N개월 실거래 증분 갱신.
 * 실거래 신고 기한이 계약일로부터 30일이라 최근 2~3개월은 계속 값이 바뀐다.
 *
 * 쿼리:
 *  - months: 갱신할 최근 개월 수 (기본 3)
 *  - scope: user(등록 지역만) | all(분석 대상 전체, 기본)
 */
export async function GET(request: Request) {
  const denied = authorizeCron(request);
  if (denied) return denied;

  try {
    const url = new URL(request.url);
    const months = Number(url.searchParams.get('months') ?? '3');
    const scope = url.searchParams.get('scope') ?? 'all';

    const config = await loadConfig();
    const userCodes = analysisTargets(config);
    const codes =
      scope === 'user' ? userCodes : [...new Set([...DEFAULT_ANALYSIS_REGIONS, ...userCodes])];

    const result = await refreshRecent(codes, Number.isFinite(months) ? months : 3, {
      // 보유·목표·관심 지역은 원본 거래까지 저장해 신고가 분석에 쓴다
      cacheTradesFor: new Set(userCodes),
      budgetMs: 260_000,
    });

    return NextResponse.json({ ok: true, scope, regionCount: codes.length, ...result });
  } catch (e) {
    return errorResponse(e);
  }
}
