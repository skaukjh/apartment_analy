import { errorResponse } from '@/lib/api-auth';
import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth/server';
import { buildDashboard } from '@/lib/pipeline/dashboard';
import { buildPropertyContext } from '@/lib/ai/property-context';
import { getOpenAI, hasOpenAI, OPENAI_MODEL, SYSTEM_PROMPT } from '@/lib/ai/client';
import type { ApartmentRef } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 180;

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * 부동산 챗봇 — 대시보드 컨텍스트를 붙여 스트리밍으로 답한다.
 * body: { apartmentId?: string, messages: ChatMessage[] }
 */
export async function POST(request: Request) {
  try {
    // OpenAI 비용이 드는 기능 — 관리자 전용
    const user = await getSessionUser();
    if (!user?.isAdmin) {
      return NextResponse.json(
        { ok: false, error: 'AI 상담·평가는 관리자만 쓸 수 있습니다.' },
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
    const apartmentId = body?.apartmentId ? String(body.apartmentId) : undefined;
    const history = (Array.isArray(body?.messages) ? body.messages : []) as ChatMessage[];

    if (history.length === 0) {
      return NextResponse.json({ ok: false, error: '메시지가 비어 있습니다.' }, { status: 400 });
    }

    const data = await buildDashboard();

    // 특정 아파트를 지정하면 그 물건 컨텍스트를, 아니면 시장 전반 컨텍스트를 붙인다
    let contextMd: string;
    const apartment: ApartmentRef | undefined = apartmentId
      ? (data.config.holdings.find((h) => h.id === apartmentId) ??
        data.config.targets.find((t) => t.id === apartmentId))
      : undefined;

    if (apartment) {
      contextMd = (await buildPropertyContext(apartment, data)).markdown;
    } else {
      const first = data.config.targets[0] ?? data.config.holdings[0];
      contextMd = first
        ? (await buildPropertyContext(first, data)).markdown
        : `# 등록된 아파트 없음\n사용자가 아직 보유·목표 아파트를 등록하지 않았습니다. 설정에서 등록하도록 안내하세요.\n\n# 시장 온도\n- 과열 점수: ${data.sentiment.heatScore}/100`;
    }

    // 컨텍스트가 길어 최근 12턴만 유지한다
    const trimmed = history.slice(-12);

    const stream = await getOpenAI().chat.completions.create({
      model: OPENAI_MODEL,
      temperature: 0.4,
      stream: true,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'system', content: `[컨텍스트]\n${contextMd}` },
        ...trimmed.map((m) => ({ role: m.role, content: m.content }) as const),
      ],
    });

    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of stream) {
            const delta = chunk.choices[0]?.delta?.content;
            if (delta) controller.enqueue(encoder.encode(delta));
          }
        } catch (e) {
          controller.enqueue(encoder.encode(`\n\n[오류] ${(e as Error).message}`));
        } finally {
          controller.close();
        }
      },
    });

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
