import { NextResponse } from 'next/server';
import { buildDashboard } from '@/lib/pipeline/dashboard';
import { buildMarketOutlook } from '@/lib/ai/market-outlook';
import { hasOpenAI } from '@/lib/ai/client';
import { errorResponse } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 180;

/**
 * AI 시장 요약·전망.
 *
 * 공식 발표·정책 기사·블로그·카페를 읽어 요약하고,
 * 주요 지수와 보유/목표 아파트를 기준으로 전망을 정리한다.
 */
export async function GET() {
  try {
    if (!hasOpenAI()) {
      return NextResponse.json(
        { ok: false, error: 'OPENAI_API_KEY 가 설정되지 않았습니다.' },
        { status: 503 },
      );
    }

    const data = await buildDashboard();
    const outlook = await buildMarketOutlook(data);

    return NextResponse.json({ ok: true, ...outlook });
  } catch (e) {
    return errorResponse(e);
  }
}
