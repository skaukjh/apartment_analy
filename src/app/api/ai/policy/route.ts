import { NextResponse } from 'next/server';
import {
  buildPolicyDigest,
  loadCachedPolicyDigest,
  loadLatestPolicyDigest,
  savePolicyDigest,
} from '@/lib/ai/policy-digest';
import { hasOpenAI } from '@/lib/ai/client';
import { errorResponse } from '@/lib/api-auth';
import { getSessionUser, resolveOpenAIKey } from '@/lib/auth/server';
import { loadConfig } from '@/lib/store/config';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * 최신 부동산 정책 요약 (전역).
 *
 * 크론이 매시간 자료를 점검해 미리 만들어 두므로 보통 캐시로 즉시 응답한다.
 * ?refresh=1 은 관리자·개인 키 회원만 (생성 비용).
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

    if (!force) {
      const cached = await loadCachedPolicyDigest();
      if (cached) return NextResponse.json({ ok: true, ...cached, cached: true });
    }

    const user = await getSessionUser();
    const cfg = await loadConfig(user?.id ?? 'default');
    const ai = resolveOpenAIKey(user, cfg.openaiApiKey);
    if (!ai.allowed) {
      if (force) {
        return NextResponse.json(
          { ok: false, error: ai.reason ?? '재생성 권한이 없습니다.' },
          { status: user ? 403 : 401 },
        );
      }
      return NextResponse.json({
        ok: false,
        pending: true,
        error: '정책 요약을 준비 중입니다. 잠시 후 다시 열어 주세요.',
      });
    }

    // 강제 재생성이 아니면 "새 자료가 충분할 때만" 규칙을 그대로 적용한다
    const prev = await loadLatestPolicyDigest();
    const digest = await buildPolicyDigest({
      skipIfPromptHash: force ? undefined : prev?.promptHash,
      previousSourceUrls: force ? undefined : prev?.sources?.map((s) => s.url),
      apiKey: ai.key,
    });

    if (!digest) {
      // 새 자료 부족 — 이전 본문을 그대로 쓴다
      if (prev) {
        const kept = { ...prev, refreshedAt: new Date().toISOString() };
        await savePolicyDigest(kept);
        return NextResponse.json({ ok: true, ...kept, cached: true });
      }
      return NextResponse.json(
        { ok: false, error: '정책 요약 생성에 실패했습니다.' },
        { status: 502 },
      );
    }

    await savePolicyDigest(digest);
    return NextResponse.json({ ok: true, ...digest, cached: false });
  } catch (e) {
    return errorResponse(e);
  }
}
