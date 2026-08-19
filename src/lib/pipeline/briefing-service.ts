/**
 * 브리핑 실행 서비스 — 대시보드 조립 → 문구 생성 → 카카오 전송 → 이력 기록.
 * 수동 발송(설정 화면 버튼)과 cron 이 같은 경로를 쓴다.
 */

import { buildDashboard } from '@/lib/pipeline/dashboard';
import {
  buildBriefing,
  briefingToKakaoTemplates,
  briefingToText,
  previewChunks,
} from '@/lib/kakao/briefing';
import { broadcast, type SendReport } from '@/lib/kakao/client';
import { saveSnapshot } from '@/lib/store/market-data';
import { getAdminClient } from '@/lib/store/supabase';
import { env } from '@/lib/env';
import type { Briefing } from '@/lib/kakao/briefing';

export interface BriefingRunResult {
  ok: boolean;
  dryRun: boolean;
  briefing: Briefing;
  text: string;
  chunks: string[];
  messageCount: number;
  error?: string;
  skippedReason?: string;
  /** 수신자별 전송 결과 */
  reports?: SendReport[];
}

async function logBriefing(
  status: 'sent' | 'failed' | 'skipped',
  message: string,
  error?: string,
): Promise<void> {
  const client = getAdminClient();
  if (!client) return;
  await client.from('briefing_log').insert({
    status,
    message: message.slice(0, 4000),
    error: error?.slice(0, 2000) ?? null,
  });
}

export async function runBriefing(
  options: { dryRun?: boolean; force?: boolean; recipientIds?: string[] } = {},
): Promise<BriefingRunResult> {
  const dryRun = options.dryRun ?? false;

  const data = await buildDashboard();
  const briefing = buildBriefing(data);
  const text = briefingToText(briefing);
  const chunks = previewChunks(briefing);

  const base: Omit<BriefingRunResult, 'ok'> = {
    dryRun,
    briefing,
    text,
    chunks,
    messageCount: chunks.length,
  };

  if (dryRun) {
    return { ok: true, ...base };
  }

  if (!data.config.kakaoBriefingEnabled && !options.force) {
    await logBriefing('skipped', '설정에서 카카오 브리핑이 꺼져 있습니다.');
    return { ok: true, ...base, skippedReason: '설정에서 카카오 브리핑이 비활성화되어 있습니다.' };
  }

  try {
    const templates = briefingToKakaoTemplates(briefing, env.appUrl);
    const reports = await broadcast(templates, { recipientIds: options.recipientIds });

    const failed = reports.filter((r) => !r.ok);
    const summary = reports
      .map((r) => `${r.recipient}: ${r.ok ? '성공' : `실패(${r.error})`}`)
      .join(', ');

    await logBriefing(
      failed.length === 0 ? 'sent' : 'failed',
      `${text}\n\n[수신자] ${summary}`,
      failed.length > 0 ? summary : undefined,
    );

    // 갭 변화 추적용 스냅샷
    await saveSnapshot({
      generatedAt: data.generatedAt,
      gaps: data.gaps,
      sentiment: data.sentiment,
      quotes: data.quotes,
    });

    return {
      ok: failed.length === 0,
      ...base,
      reports,
      error:
        failed.length > 0
          ? `${failed.length}명 전송 실패: ${failed.map((f) => `${f.recipient}(${f.error})`).join(', ')}`
          : undefined,
    };
  } catch (e) {
    const message = (e as Error).message;
    await logBriefing('failed', text, message);
    return { ok: false, ...base, error: message };
  }
}

/** 최근 발송 이력 */
export async function recentBriefings(limit = 10) {
  const client = getAdminClient();
  if (!client) return [];
  const { data } = await client
    .from('briefing_log')
    .select('id, sent_at, status, message, error')
    .order('sent_at', { ascending: false })
    .limit(limit);
  return data ?? [];
}
