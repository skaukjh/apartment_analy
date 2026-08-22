import { NextResponse } from 'next/server';
import { buildDashboard } from '@/lib/pipeline/dashboard';
import { buildMarketOutlook } from '@/lib/ai/market-outlook';
import { loadCachedOutlook, saveOutlookCache, OUTLOOK_TTL_MS } from '@/lib/ai/outlook-cache';
import { hasOpenAI } from '@/lib/ai/client';
import { errorResponse } from '@/lib/api-auth';
import { ANON_CONFIG_ID, getSessionUser, resolveOpenAIKey } from '@/lib/auth/server';
import { loadConfig } from '@/lib/store/config';

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
    const user = await getSessionUser();
    const userId = user?.id ?? ANON_CONFIG_ID;

    /* 캐시 적중이 대부분이므로 캐시부터 본다.
       키 확인(loadConfig)까지 마치고 캐시를 보면 적중일 때도 DB 왕복이 하나 더 붙는다. */
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
            Math.round(
              (OUTLOOK_TTL_MS -
                (Date.now() - Date.parse(cached.refreshedAt ?? cached.generatedAt))) /
                1000,
            ),
          ),
        });
      }
    }

    // 생성 비용 귀속: 관리자는 운영자 키, 회원은 자기 키(BYOK). 없으면 캐시 열람만.
    const cfg = await loadConfig(userId);
    const ai = resolveOpenAIKey(user, cfg.openaiApiKey);
    const canGenerate = ai.allowed;

    if (force && !canGenerate) {
      return NextResponse.json(
        { ok: false, error: ai.reason ?? '요약 재생성 권한이 없습니다.' },
        { status: user ? 403 : 401 },
      );
    }

    if (!canGenerate) {
      // 캐시가 없어도 비용 드는 생성은 하지 않는다 — 매시간 tick 이 곧 채운다
      return NextResponse.json({
        ok: false,
        pending: true,
        error: '요약을 준비 중입니다. 잠시 후 다시 열어 주세요.',
      });
    }

    const data = await buildDashboard({ userId });
    // "다시 생성" 버튼은 강제 재생성이므로 중복 건너뛰기를 적용하지 않는다
    const outlook = await buildMarketOutlook(data, { apiKey: ai.key });
    if (!outlook) {
      return NextResponse.json({ ok: false, error: '요약 생성에 실패했습니다.' }, { status: 502 });
    }
    await saveOutlookCache(outlook, userId);

    return NextResponse.json({ ok: true, ...outlook, cached: false });
  } catch (e) {
    return errorResponse(e);
  }
}
