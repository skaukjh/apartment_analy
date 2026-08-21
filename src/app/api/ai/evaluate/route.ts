import { NextResponse } from 'next/server';
import { configIdForRequest, getSessionUser, resolveOpenAIKey } from '@/lib/auth/server';
import { loadConfig as loadUserConfig } from '@/lib/store/config';
import { errorResponse } from '@/lib/api-auth';
import { buildDashboard } from '@/lib/pipeline/dashboard';
import { buildPropertyContext } from '@/lib/ai/property-context';
import { getOpenAI, hasOpenAI, OPENAI_MODEL, SYSTEM_PROMPT } from '@/lib/ai/client';
import type { ApartmentRef } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 180;

const EVALUATE_INSTRUCTION = `[컨텍스트]의 아파트를 다음 순서로 평가하세요.

## 한 줄 요약
이 물건의 성격을 한 문장으로.

## 강점
3가지 이내. 각 항목은 컨텍스트의 구체적 수치를 근거로.

## 약점·리스크
3가지 이내. 규제(특히 토지거래허가구역), 자금 부족, 시세 흐름, 입지 약점을 우선 검토.

## 자금 현실성
대출 가능액과 필요 현금을 짚고, 보유 현금으로 실행 가능한지 판단. 부족하면 얼마가 더 필요한지.

## 지금 확인해야 할 것
사용자가 직접 확인해야 하는 항목 3가지 (등기부, 관리사무소 문의, 규제 공고 등 구체적으로).

마크다운 헤딩(##)을 사용하고 전체 700자 이내로 쓰세요.`;

/**
 * 아파트 종합 평가.
 * body: { apartmentId: string } — 설정에 등록된 보유/목표 아파트 id
 */
export async function POST(request: Request) {
  try {
    // 비용 귀속: 관리자는 운영자 키, 회원은 자기 키(BYOK)
    const user = await getSessionUser();
    const cfgForKey = await loadUserConfig(await configIdForRequest());
    const ai = resolveOpenAIKey(user, cfgForKey.openaiApiKey);
    if (!ai.allowed) {
      return NextResponse.json(
        { ok: false, error: ai.reason ?? 'AI 기능 권한이 없습니다.' },
        { status: user ? 403 : 401 },
      );
    }

    if (!hasOpenAI()) {
      return NextResponse.json(
        { ok: false, error: 'OPENAI_API_KEY 가 설정되지 않았습니다.' },
        { status: 400 },
      );
    }

    const body = await request.json();
    const apartmentId = String(body?.apartmentId ?? '');

    const data = await buildDashboard();
    const apartment: ApartmentRef | undefined =
      data.config.holdings.find((h) => h.id === apartmentId) ??
      data.config.targets.find((t) => t.id === apartmentId);

    if (!apartment) {
      return NextResponse.json(
        { ok: false, error: '등록되지 않은 아파트입니다.' },
        { status: 404 },
      );
    }

    const context = await buildPropertyContext(apartment, data);

    const completion = await getOpenAI(ai.key).chat.completions.create({
      model: OPENAI_MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: `[컨텍스트]\n${context.markdown}\n\n---\n${EVALUATE_INSTRUCTION}`,
        },
      ],
    });

    return NextResponse.json({
      ok: true,
      apartment: { id: apartment.id, name: apartment.complexName, areaM2: apartment.areaM2 },
      evaluation: completion.choices[0]?.message?.content ?? '',
      context: context.markdown,
      nearby: context.nearby,
      bankRates: context.bankRates,
      gaps: context.gaps,
      model: OPENAI_MODEL,
      generatedAt: new Date().toISOString(),
    });
  } catch (e) {
    return errorResponse(e);
  }
}
