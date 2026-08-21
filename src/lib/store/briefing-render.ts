/**
 * 이미지 브리핑 렌더링 소스 저장.
 *
 * 카카오 feed 템플릿은 이미지 "URL" 만 받는다 — 파일을 직접 첨부할 수 없다.
 * 그래서 발송 시점에 브리핑 내용을 토큰과 함께 저장해 두고,
 * 카카오가 이미지 URL 을 긁으러 오면 그 토큰으로 내용을 찾아 즉석 렌더링한다.
 *
 * 렌더링 라우트에서 대시보드를 다시 조립하면 20초 가까이 걸려
 * 카카오 수집기가 타임아웃 난다. 저장해 둔 JSON 을 그리기만 하면 1초 미만이다.
 * 토큰은 무작위 UUID 라 URL 을 추측해 남의 브리핑을 볼 수 없다.
 */

import { getAdminClient } from '@/lib/store/supabase';
import type { Briefing } from '@/lib/kakao/briefing';

const KIND = 'briefing-render';

interface RenderEnvelope {
  kind: typeof KIND;
  token: string;
  briefing: Briefing;
}

const memory = new Map<string, Briefing>();

export async function saveBriefingRender(token: string, briefing: Briefing): Promise<void> {
  memory.set(token, briefing);

  const client = getAdminClient();
  if (!client) return;

  const envelope: RenderEnvelope = { kind: KIND, token, briefing };
  const { error } = await client
    .from('dashboard_snapshot')
    .insert({ captured_at: new Date().toISOString(), payload: envelope });
  if (error) console.error('[briefing] 렌더 소스 저장 실패:', error.message);
}

export async function loadBriefingRender(token: string): Promise<Briefing | null> {
  const mem = memory.get(token);
  if (mem) return mem;

  const client = getAdminClient();
  if (!client) return null;

  // 이미지는 발송 직후에만 조회되므로 최근 것만 보면 된다
  const since = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  const { data, error } = await client
    .from('dashboard_snapshot')
    .select('payload')
    .gte('captured_at', since)
    .order('captured_at', { ascending: false })
    .limit(400);

  if (error || !data) return null;

  for (const row of data) {
    const p = row.payload as RenderEnvelope | null;
    if (p?.kind === KIND && p.token === token) {
      memory.set(token, p.briefing);
      return p.briefing;
    }
  }
  return null;
}
