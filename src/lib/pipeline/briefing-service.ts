/**
 * 브리핑 실행 서비스 — 대시보드 조립 → 문구 생성 → 카카오 전송 → 이력 기록.
 * 수동 발송(설정 화면 버튼)과 cron 이 같은 경로를 쓴다.
 */

import { buildDashboard } from '@/lib/pipeline/dashboard';
import {
  buildBriefing,
  briefingToKakaoTemplates,
  briefingToSingleTemplate,
  type BriefingSlot,
  briefingToText,
  previewChunks,
} from '@/lib/kakao/briefing';
import { broadcast, type SendReport } from '@/lib/kakao/client';
import { hasTelegram, sendTelegramText } from '@/lib/telegram/client';
import { saveSnapshot } from '@/lib/store/market-data';
import { buildBriefingDiff, loadPreviousBriefingSnapshot } from '@/lib/analysis/briefing-diff';
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
    /** @deprecated 채널별 켜짐 설정을 항상 따른다 — 꺼진 채널을 강제로 보내지 않는다 */
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

  /* 지난 브리핑 대비 변화 — 있으면 맨 앞 섹션으로 넣는다.
     text 계산 전에 넣어야 해시·본문에 함께 반영된다. */
  const prevSnap = await loadPreviousBriefingSnapshot().catch(() => null);
  if (prevSnap) {
    const diff = buildBriefingDiff(data, prevSnap.snap);
    if (diff.length > 0) {
      briefing.sections.unshift({ heading: '🔄 지난 브리핑 대비', lines: diff.slice(0, 6) });
    }
  }

  const text = briefingToText(briefing);
  // 'image' 는 요약(텍스트 2건)으로 통합됐다 — 본문 1건 + 링크 포함 마무리 1건.
  const rawFormat = data.config.briefingFormat ?? 'summary';
  const format = rawFormat === 'image' ? 'summary' : rawFormat;
  const chunks =
    format === 'full'
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

  /* 발송 채널 결정 — 카카오와 텔레그램은 독립적으로 켜고 끈다.
     force(수동 발송)도 꺼진 채널은 건드리지 않는다 — 사용자가 카카오를
     종료했는데 수동 발송이 카카오로 다시 나가는 사고를 막기 위함이다. */
  const kakaoOn = data.config.kakaoBriefingEnabled;
  const telegramOn =
    hasTelegram() && Boolean(data.config.telegramChatId) && data.config.telegramEnabled;

  if (!kakaoOn && !telegramOn) {
    await logBriefing('skipped', '카카오·텔레그램 브리핑이 모두 꺼져 있습니다.');
    return { ok: true, ...base, skippedReason: '설정에서 브리핑 발송이 비활성화되어 있습니다.' };
  }

  try {
    /* 직전 발송과 본문이 완전히 같으면 이미지·전문 대신 한 줄짜리 알림만 보낸다.
       실거래는 12시간 주기라 연속 슬롯의 내용이 자주 같은데,
       같은 이미지를 또 보내면 "뭐가 바뀌었지?" 하고 읽는 수고만 생긴다. */
    const contentHash = createHash('sha256').update(text).digest('hex').slice(0, 32);
    const uid = options.userId ?? 'default';
    const lastHash = await loadLastBriefingHash(uid);
    const unchanged = lastHash !== null && lastHash === contentHash;

    const todayUrl = `${env.appUrl.replace(/\/$/, '')}/today`;
    let templates;
    if (unchanged) {
      const link = { web_url: todayUrl, mobile_web_url: todayUrl };
      templates = [
        {
          object_type: 'text' as const,
          text: `[${briefing.title}]
직전 브리핑과 내용이 동일합니다 (변동 없음).`,
          link,
          button_title: '오늘의 요약 열기',
        },
      ];
    } else if (format === 'full') {
      templates = briefingToKakaoTemplates(briefing, env.appUrl);
    } else {
      templates = briefingToSingleTemplate(briefing, env.appUrl, data, options.slot);
    }

    const reports: SendReport[] = [];

    if (kakaoOn) {
      try {
        reports.push(
          ...(await broadcast(templates, {
            recipientIds: options.recipientIds,
            userId: options.userId ?? 'default',
          })),
        );
      } catch (e) {
        // 수신자가 없는 등 카카오 쪽 실패가 텔레그램 발송을 막지 않게 한다
        reports.push({ recipient: '카카오', ok: false, error: (e as Error).message });
      }
    }

    if (telegramOn) {
      /* 텔레그램은 카카오처럼 200자 제한이 없다 — 요약 대신 브리핑 전문을
         통째로 보내고 마지막에 접속 링크를 붙인다 (4096자 초과 시 자동 분할). */
      const tgText = unchanged
        ? `[${briefing.title}]\n직전 브리핑과 내용이 동일합니다 (변동 없음).\n${todayUrl}`
        : `${text}\n\n📱 전체 보기: ${todayUrl}`;
      try {
        await sendTelegramText(data.config.telegramChatId as string, tgText);
        reports.push({ recipient: '텔레그램', ok: true });
      } catch (e) {
        reports.push({ recipient: '텔레그램', ok: false, error: (e as Error).message });
      }
    }

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
