/**
 * 브리핑 실행 서비스 — 대시보드 조립 → 문구 생성 → 카카오 전송 → 이력 기록.
 * 수동 발송(설정 화면 버튼)과 cron 이 같은 경로를 쓴다.
 */

import { buildDashboard } from '@/lib/pipeline/dashboard';
import {
  buildBriefing,
  briefingToKakaoTemplates,
  briefingToImageTemplate,
  briefingToSingleTemplate,
  type BriefingSlot,
  briefingToText,
  previewChunks,
} from '@/lib/kakao/briefing';
import { broadcast, type SendReport } from '@/lib/kakao/client';
import { saveSnapshot } from '@/lib/store/market-data';
import { getAdminClient } from '@/lib/store/supabase';
import { env } from '@/lib/env';
import { loadLastBriefingHash, saveLastBriefingHash } from '@/lib/store/briefing-mark';
import { createHash } from 'node:crypto';
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
  options: {
    dryRun?: boolean;
    force?: boolean;
    recipientIds?: string[];
    /** 발송 시간대. 같은 데이터라도 시간대별로 먼저 보여줄 항목이 다르다. */
    slot?: BriefingSlot;
    /** 어느 사용자의 설정·수신자로 보낼지. 생략하면 레거시 'default' */
    userId?: string;
  } = {},
): Promise<BriefingRunResult> {
  const dryRun = options.dryRun ?? false;

  const data = await buildDashboard({ userId: options.userId });
  const briefing = buildBriefing(data);
  const text = briefingToText(briefing);
  const format = data.config.briefingFormat ?? 'image';
  const chunks =
    format === 'image'
      ? [text] // 이미지에는 전문이 통째로 들어간다 — 미리보기도 전문
      : format === 'full'
        ? previewChunks(briefing)
        : briefingToSingleTemplate(briefing, env.appUrl, data, options.slot).map(
            (t) => ('text' in t ? t.text : '') ?? '',
          );

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
    /* 직전 발송과 본문이 완전히 같으면 이미지·전문 대신 한 줄짜리 알림만 보낸다.
       실거래는 12시간 주기라 연속 슬롯의 내용이 자주 같은데,
       같은 이미지를 또 보내면 "뭐가 바뀌었지?" 하고 읽는 수고만 생긴다. */
    const contentHash = createHash('sha256').update(text).digest('hex').slice(0, 32);
    const uid = options.userId ?? 'default';
    const lastHash = await loadLastBriefingHash(uid);
    const unchanged = lastHash !== null && lastHash === contentHash;

    let templates;
    if (unchanged) {
      const target = `${env.appUrl.replace(/\/$/, '')}/today`;
      const link = { web_url: target, mobile_web_url: target };
      templates = [
        {
          object_type: 'text' as const,
          text: `[${briefing.title}]
직전 브리핑과 내용이 동일합니다 (변동 없음).`,
          link,
          button_title: '오늘의 요약 열기',
        },
      ];
    } else if (format === 'image') {
      // 컴팩트 feed (이미지 없음) — 상세는 오늘의 요약 페이지가 담당
      templates = [briefingToImageTemplate(briefing, env.appUrl, '', options.slot)];
    } else if (format === 'full') {
      templates = briefingToKakaoTemplates(briefing, env.appUrl);
    } else {
      templates = briefingToSingleTemplate(briefing, env.appUrl, data, options.slot);
    }
    const reports = await broadcast(templates, {
      recipientIds: options.recipientIds,
      userId: options.userId ?? 'default',
    });

    const failed = reports.filter((r) => !r.ok);
    const summary = reports
      .map((r) => `${r.recipient}: ${r.ok ? '성공' : `실패(${r.error})`}`)
      .join(', ');

    await logBriefing(
      failed.length === 0 ? 'sent' : 'failed',
      `${unchanged ? '(변동 없음 알림) ' : ''}${text}\n\n[수신자] ${summary}`,
      failed.length > 0 ? summary : undefined,
    );

    // 발송 성공 시에만 본문 해시 갱신 — 다음 슬롯의 "변동 없음" 판정 기준
    if (failed.length === 0) await saveLastBriefingHash(uid, contentHash);

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
