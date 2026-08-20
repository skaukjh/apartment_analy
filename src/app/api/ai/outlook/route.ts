import { NextResponse } from 'next/server';
import { buildDashboard } from '@/lib/pipeline/dashboard';
import { buildMarketOutlook } from '@/lib/ai/market-outlook';
import { loadCachedOutlook, saveOutlookCache, OUTLOOK_TTL_MS } from '@/lib/ai/outlook-cache';
import { hasOpenAI } from '@/lib/ai/client';
import { errorResponse } from '@/lib/api-auth';
import { configIdForRequest } from '@/lib/auth/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 180;

/**
 * AI 시장 요약·전망.
 *
 * 공식 발표·정책 기사·블로그·카페를 읽어 요약하고,
 * 주요 지수와 보유/목표 아파트를 기준으로 전망을 정리한다.
 *
 * 결과는 1시간 캐시한다. 데이터가 1시간 주기로 갱신되므로 그보다 자주 만들 이유가 없고,
 * 새로고침마다 새로 만들면 호출당 비용이 그대로 쌓인다.
 * ?refresh=1 을 주면 캐시를 무시하고 새로 만든다.
 */
export async function GET(request: Request) {
  try {
    if (!hasOpenAI()) {
      return NextResponse.json(
        { ok: false, error: 'OPENAI_API_KEY 가 설정되지 않았습니다.' },
        { status: 503 },
      );
    }

    const force = new URL(request.url).searchParams.get('refresh') === '1';
    const userId = await configIdForRequest();

    if (!force) {
      const cached = await loadCachedOutlook(userId);
      if (cached) {
        return NextResponse.json({
          ok: true,
          ...cached,
          cached: true,
          // 다음 갱신까지 남은 시간 (초)
          expiresInSec: Math.max(
            0,
            Math.round((OUTLOOK_TTL_MS - (Date.now() - Date.parse(cached.generatedAt))) / 1000),
          ),
        });
      }
    }

    const data = await buildDashboard({ userId });
    const outlook = await buildMarketOutlook(data);
    await saveOutlookCache(outlook, userId);

    return NextResponse.json({ ok: true, ...outlook, cached: false });
  } catch (e) {
    return errorResponse(e);
  }
}
