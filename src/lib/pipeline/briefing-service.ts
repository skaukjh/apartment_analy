/**
 * 브리핑 실행 서비스 — 대시보드 조립 → 문구 생성 → 카카오 전송 → 이력 기록.
 * 수동 발송(설정 화면 버튼)과 cron 이 같은 경로를 쓴다.
 */

import { buildDashboard } from '@/lib/pipeline/dashboard';
import {
  buildBriefing,
  briefingToKakaoGapTemplate,
  type BriefingSlot,
  briefingToText,
} from '@/lib/kakao/briefing';
import { broadcast, type SendReport } from '@/lib/kakao/client';
import { hasTelegram, sendTelegramText } from '@/lib/telegram/client';
import { saveSnapshot } from '@/lib/store/market-data';
import {
  buildBriefingDiff,
  interpretDiffFallback,
  loadPreviousBriefingSnapshot,
  type BriefingSnapshot,
} from '@/lib/analysis/briefing-diff';
import { getOpenAI, hasOpenAI, OPENAI_MODEL, SYSTEM_PROMPT } from '@/lib/ai/client';
import { HEAT_META } from '@/lib/analysis/market-signals';
import type { DashboardData } from '@/lib/types';
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

/**
 * 변경 사항의 의미·전망 분석.
 * AI(gpt)가 있으면 컨텍스트 안에서만 해석하게 하고, 없거나 실패하면 규칙 기반으로.
 * 변경이 있을 때만 호출되므로 하루 몇 번 수준의 소액 비용이다.
 */
async function buildChangeAnalysis(
  diffLines: string[],
  data: DashboardData,
  prev: BriefingSnapshot,
): Promise<string> {
  const fallback = () => interpretDiffFallback(data, prev).join('\n');
  if (!hasOpenAI()) return fallback();

  try {
    const heat = HEAT_META[data.sentiment.heatLevel];
    const prompt = `다음은 부동산 브리핑에서 직전 발송 대비 달라진 수치입니다.

[달라진 것]
${diffLines.join('\n')}

[현재 시장 컨텍스트]
- 과열점수 ${data.sentiment.heatScore}/100 (${heat.label}) · 매매수급 ${data.sentiment.supplyDemandIndex}
- 신고가 비중 ${data.sentiment.newHighRatio.toFixed(1)}% · 거래량 YoY ${data.sentiment.volumeYoy.toFixed(0)}%

사용자는 보유 아파트를 팔고 상급지로 갈아타려는 1주택자입니다.
이 변경이 갈아타기 판단에 갖는 의미와 단기 전망을 3~5문장, 400자 이내로 정리하세요.
수치를 다시 나열하지 말고 해석 위주로 쓰세요. 위 컨텍스트에 없는 수치를 추측하지 마세요.`;

    const res = await getOpenAI().chat.completions.create({
      model: OPENAI_MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
    });
    const out = res.choices[0]?.message?.content?.trim();
    return out || fallback();
  } catch {
    return fallback();
  }
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
    /**
     * 이번 실행에서 시도할 채널. 생략하면 둘 다.
     * 카카오(하루 1회, 갈아타기 요약)와 텔레그램(하루 4회, 전문)의
     * 발송 주기가 달라 cron 이 채널을 골라 호출한다.
     */
    channels?: Array<'kakao' | 'telegram'>;
  } = {},
): Promise<BriefingRunResult> {
  const dryRun = options.dryRun ?? false;

  const uid = options.userId ?? 'default';
  const data = await buildDashboard({ userId: options.userId });
  const briefing = buildBriefing(data);

  /* 지난 브리핑 대비 변화 — 전문에 섞지 않고 별도의 "변경 분석" 메시지로 보낸다 */
  const prevSnap = await loadPreviousBriefingSnapshot(uid).catch(() => null);
  const diffLines = prevSnap ? buildBriefingDiff(data, prevSnap.snap) : [];

  const text = briefingToText(briefing);
  /* 카카오는 "내 갈아타기" 요약 1장만 보낸다 — 시장 전반 전문은 텔레그램 담당 */
  const kakaoTemplates = briefingToKakaoGapTemplate(env.appUrl, data);
  const chunks = kakaoTemplates.map((t) => ('text' in t ? t.text : '') ?? '');

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
  const channels = options.channels ?? ['kakao', 'telegram'];
  const kakaoOn = channels.includes('kakao') && data.config.kakaoBriefingEnabled;
  const telegramOn =
    channels.includes('telegram') &&
    hasTelegram() &&
    Boolean(data.config.telegramChatId) &&
    data.config.telegramEnabled;

  if (!kakaoOn && !telegramOn) {
    await logBriefing('skipped', '카카오·텔레그램 브리핑이 모두 꺼져 있습니다.');
    return { ok: true, ...base, skippedReason: '설정에서 브리핑 발송이 비활성화되어 있습니다.' };
  }

  try {
    /* "변동 없음" 판정은 핵심 수치 섹션만 본다.
       뉴스 헤드라인·일정·날짜는 매번 바뀌므로 전문 전체를 해시하면
       숫자가 그대로인데도 계속 "변경"으로 판정돼 같은 브리핑이 재발송된다. */
    const VOLATILE_SECTIONS = new Set(['📰 헤드라인', '📅 다가오는 일정']);
    const coreText = briefing.sections
      .filter((s) => !VOLATILE_SECTIONS.has(s.heading))
      .map((s) => `${s.heading}\n${s.lines.join('\n')}`)
      .join('\n');
    const contentHash = createHash('sha256').update(coreText).digest('hex').slice(0, 32);
    const lastHash = await loadLastBriefingHash(uid);
    const unchanged = lastHash !== null && lastHash === contentHash;

    const todayUrl = `${env.appUrl.replace(/\/$/, '')}/today`;

    const reports: SendReport[] = [];

    if (kakaoOn) {
      /* 카카오는 하루 1번뿐이라 "변동 없음"이어도 갈아타기 요약을 그대로 보낸다 */
      try {
        reports.push(
          ...(await broadcast(kakaoTemplates, {
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

        /* 변경이 있으면 두 번째 메시지로 "무엇이 왜 달라졌고 어떻게 볼지"를 보낸다 */
        if (!unchanged && diffLines.length > 0 && prevSnap) {
          const analysis = await buildChangeAnalysis(diffLines, data, prevSnap.snap);
          await sendTelegramText(
            data.config.telegramChatId as string,
            `🔍 변경 분석\n\n[달라진 것]\n${diffLines.map((l) => `· ${l}`).join('\n')}\n\n[의미와 전망]\n${analysis}`,
          );
        }
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

    /* 해시·스냅샷은 텔레그램 전용 기준이므로 텔레그램 성공 여부만 본다.
       예전에는 failed.length(전체 수신자)로 판단했는데, 카카오 수신자 한 명이
       권한 없음(403)으로 계속 실패하자 해시가 영영 갱신되지 않아 "변동 없음"
       판정이 죽고 같은 전문이 매 슬롯 재발송되던 실제 버그가 있었다. */
    const telegramFailed = reports.some((r) => r.recipient === '텔레그램' && !r.ok);

    /* 본문 해시 갱신 — 다음 슬롯의 "변동 없음" 판정 기준 */
    if (telegramOn && !telegramFailed) await saveLastBriefingHash(uid, contentHash);

    /* 갭 변화 추적용 스냅샷 — 변경 분석(텔레그램 2번째 메시지)의 비교 기준이므로
       카카오 단독 발송에서는 남기지 않는다. 기준이 앞서가면 텔레그램이
       보고하지 못한 변화가 "이미 본 것"으로 묻힌다. */
    if (telegramOn && !telegramFailed) {
      await saveSnapshot({
        userId: uid,
        generatedAt: data.generatedAt,
        gaps: data.gaps,
        sentiment: data.sentiment,
        quotes: data.quotes,
      });
    }

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
