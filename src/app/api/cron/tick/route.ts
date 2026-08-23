import { NextResponse } from 'next/server';
import { authorizeCron, errorResponse } from '@/lib/api-auth';
import { runBriefing } from '@/lib/pipeline/briefing-service';
import { refreshRecent } from '@/lib/pipeline/refresh';
import { analysisTargets, listConfigUserIds, loadConfig } from '@/lib/store/config';
import { CORE_WATCH_REGIONS } from '@/lib/regions';
import { latestPassedSlot, type BriefingSlot } from '@/lib/kakao/briefing';
import { nowKst } from '@/lib/format';
import { hasOpenAI } from '@/lib/ai/client';
import { buildDashboard } from '@/lib/pipeline/dashboard';
import { buildMarketOutlook } from '@/lib/ai/market-outlook';
import { loadLatestOutlook, saveOutlookCache } from '@/lib/ai/outlook-cache';
import { saveDashboardCache } from '@/lib/pipeline/dashboard-cache';
import { refreshSentimentNote } from '@/lib/ai/sentiment-note';
import { markBriefingSent, wasBriefingSent } from '@/lib/store/briefing-mark';
import { listAdminUserIds } from '@/lib/auth/server';
import {
  buildPolicyDigest,
  loadLatestPolicyDigest,
  savePolicyDigest,
} from '@/lib/ai/policy-digest';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * 매시간 도는 단일 cron.
 *
 * ── 왜 하나로 합쳤나 ──────────────────────────────────────────────
 * Vercel 은 요금제별로 등록 가능한 cron 개수가 제한된다.
 * 발송 시각마다 cron 을 따로 두면 4개가 필요하므로, 매시간 한 번만 깨어나
 * "지금이 발송 시각인가"를 스스로 판단하는 구조로 만들었다.
 *
 * 하는 일:
 *  1. 매시간 — 최근 실거래를 갱신한다 (오늘의 요약 페이지가 최신 데이터를 쓰도록)
 *  2. 05·11·18·22시(KST) 슬롯 — "지나간 슬롯 중 아직 안 보낸 것"을 보낸다.
 *     정각 일치 방식은 GitHub Actions cron 이 밀리거나 한 시간을 통째로 거르면
 *     그 슬롯이 영영 빠진다 (실제로 11시 브리핑이 빠진 날이 있었다).
 *     따라잡기 방식이면 다음 실행에서 자동 복구되고, 발송 표시로 중복도 막는다.
 *
 * 수동 실행:
 *  /api/cron/tick?secret=…            지금 시각 기준으로 판단
 *  /api/cron/tick?secret=…&slot=night 슬롯을 강제로 지정해 발송 (테스트용)
 *  /api/cron/tick?secret=…&refreshOnly=1  갱신만 하고 발송하지 않음
 */
export async function GET(request: Request) {
  const denied = authorizeCron(request);
  if (denied) return denied;

  try {
    const url = new URL(request.url);
    const forced = url.searchParams.get('slot') as BriefingSlot | null;
    const refreshOnly = url.searchParams.get('refreshOnly') === '1';

    const kst = nowKst();
    const hour = kst.getHours();
    const dateKst = `${kst.getFullYear()}-${String(kst.getMonth() + 1).padStart(2, '0')}-${String(kst.getDate()).padStart(2, '0')}`;
    const slot = forced ?? latestPassedSlot(hour);

    /* 1) 최근 실거래 갱신 — 12시간에 1번(05·17시 KST)만.
       실거래는 하루 두 번이면 충분하다 (신고 기한 30일, 당일 체결 즉시 반영도 아님).
       뉴스·AI 요약은 아래에서 매시간 그대로 돈다.
       대상 = 핵심 지역군(서울 전역+경기 남부) ∪ 사용자 설정 지역. */
    const userIds = await listConfigUserIds();
    const codeSet = new Set<string>(CORE_WATCH_REGIONS);
    const cfgByUser = new Map<string, Awaited<ReturnType<typeof loadConfig>>>();
    for (const uid of userIds) {
      const cfg = await loadConfig(uid);
      cfgByUser.set(uid, cfg);
      analysisTargets(cfg).forEach((c) => codeSet.add(c));
    }

    const isTradeRefreshHour =
      hour === 5 || hour === 17 || url.searchParams.get('refreshTrades') === '1';
    const refresh = isTradeRefreshHour
      ? await refreshRecent([...codeSet], 2, {
          budgetMs: 180_000,
          // 원본 거래까지 저장해 단지 목록·검색·시세가 쿼터와 무관하게 뜨도록
          cacheTradesFor: codeSet,
        })
      : { regionsProcessed: 0, monthsFetched: 0, tradesCollected: 0, errors: [] as string[] };

    /* 1-2) AI 요약을 미리 만들어 캐시에 넣는다.
       사용자가 페이지를 열 때 20~40초를 기다리지 않아도 되고,
       호출 횟수가 시간당 1회로 고정돼 비용이 예측 가능해진다. */
    let outlookCached = 0;
    {
      /* 관리자 uid 는 개인 키 없이 운영자 키를 쓴다. 여기서 빼먹으면 관리자가
         페이지를 열 때마다 캐시 미스로 20~40초 생성이 돈다 — 실제로 그랬다. */
      const adminIds = await listAdminUserIds().catch(() => new Set<string>());
      for (const uid of [...new Set([...userIds, ...adminIds])]) {
        try {
          /* 키 귀속: 레거시(default)·관리자는 운영자 키, 회원은 자기 키(BYOK).
             회원 키가 없으면 그 사용자 요약은 만들지 않는다 — 비용이 남에게
             전가되지 않게. */
          const useEnvKey = uid === 'default' || adminIds.has(uid);
          const cfgKey = useEnvKey ? undefined : (await loadConfig(uid)).openaiApiKey;
          if (!useEnvKey && !cfgKey?.trim()) continue;
          if (useEnvKey && !hasOpenAI()) continue;

          const data = await buildDashboard({ userId: uid });
          // 페이지가 즉시 읽을 수 있게 대시보드 캐시도 여기서 채운다
          await saveDashboardCache(uid, data).catch(() => {});

          // 전역 시황 코멘트 — 지표가 바뀌었을 때만 재생성 (default 1회)
          if (uid === 'default') await refreshSentimentNote(data).catch(() => null);

          // 수치·자료가 지난번과 같으면 OpenAI 를 부르지 않는다.
          // 같은 입력에 같은 요약이면 충분하고, 호출당 비용이 든다.
          const prev = await loadLatestOutlook(uid);
          const outlook = await buildMarketOutlook(data, {
            skipIfPromptHash: prev?.promptHash,
            previousSourceUrls: prev?.sources?.map((x) => x.url),
            apiKey: cfgKey?.trim() || undefined,
          });
          if (outlook) {
            await saveOutlookCache(outlook, uid);
            outlookCached += 1;
          } else if (prev) {
            /* 내용은 그대로 두고 "자료 점검 시각"만 갱신해 캐시 신선도를 유지한다.
               generatedAt 까지 덮어쓰면 매시간 새로 생성한 것처럼 보인다 —
               실제로는 "새 자료 부족으로 이전 요약 유지"인데도. */
            await saveOutlookCache({ ...prev, refreshedAt: new Date().toISOString() }, uid);
          }
        } catch (e) {
          console.error('[tick] AI 요약 생성 실패:', uid.slice(0, 8), (e as Error).message);
        }
      }
    }

    /* 1-3) 최신 부동산 정책 요약 — 전역 1건. 정책은 사용자별로 다르지 않다.
       새 자료가 기준에 못 미치면 이전 본문을 그대로 두고 점검 시각만 갱신한다. */
    if (hasOpenAI()) {
      try {
        const prev = await loadLatestPolicyDigest();
        const digest = await buildPolicyDigest({
          skipIfPromptHash: prev?.promptHash,
          previousSourceUrls: prev?.sources?.map((s) => s.url),
        });
        if (digest) await savePolicyDigest(digest);
        else if (prev) await savePolicyDigest({ ...prev, refreshedAt: new Date().toISOString() });
      } catch (e) {
        console.error('[tick] 정책 요약 생성 실패:', (e as Error).message);
      }
    }

    /* 2) 발송 시각이면 브리핑 */
    if (refreshOnly || !slot) {
      return NextResponse.json({
        ok: true,
        hourKst: hour,
        slot,
        sent: false,
        reason: refreshOnly ? '갱신만 요청됨' : '발송 시각이 아님 (05·11·18·22시)',
        outlookCached,
        refresh: {
          regions: refresh.regionsProcessed,
          trades: refresh.tradesCollected,
          errors: refresh.errors.length,
        },
      });
    }

    /* 사용자마다 자기 설정으로 만든 브리핑을 자기 수신자에게 보낸다.
       채널별 발송 주기가 다르다:
        - 텔레그램: 슬롯(05·11·18·22시) 4회, 브리핑 전문
        - 카카오  : 하루 1회(발송 시각 설정, 기본 08시), "내 갈아타기" 요약만
       (날짜, 슬롯|kakao-daily, 사용자)별 발송 표시로 중복을 막는다 — cron 이
       한 시간에 두 번 오든, 다음 시간에 따라잡든 같은 회차는 한 번만 나간다. */
    const KAKAO_MARK = 'kakao-daily';
    const perUser: Array<{ userId: string; ok: boolean; sent: boolean; error?: string }> = [];
    let firstPreview: string | undefined;

    for (const uid of userIds) {
      try {
        const kakaoHour = cfgByUser.get(uid)?.briefingHour ?? 8;
        // 강제 슬롯(테스트)은 표시를 무시하고 두 채널 모두 보낸다
        const wantTelegram = forced ? true : !(await wasBriefingSent(dateKst, slot, uid));
        const wantKakao = forced
          ? true
          : hour >= kakaoHour && !(await wasBriefingSent(dateKst, KAKAO_MARK, uid));

        if (!wantTelegram && !wantKakao) {
          perUser.push({ userId: uid, ok: true, sent: false, error: '이미 발송됨' });
          continue;
        }

        const channels: Array<'kakao' | 'telegram'> = [
          ...(wantKakao ? (['kakao'] as const) : []),
          ...(wantTelegram ? (['telegram'] as const) : []),
        ];

        const result = await runBriefing({ slot, userId: uid, channels });
        const sent = result.ok && !result.skippedReason;
        perUser.push({ userId: uid, ok: result.ok, sent });
        firstPreview ??= result.chunks[0]?.slice(0, 300);

        /* 채널별로 각각 표시 — 한쪽 실패가 다른 쪽 중복 발송으로 번지지 않게.
           빈 배열의 every()는 true 이므로, 설정에서 꺼진 채널(리포트 없음)과
           브리핑 전체가 꺼진 사용자(skippedReason)도 표시돼 매시간 재시도하지 않는다. */
        const reports = result.reports ?? [];
        const tgOk = reports.filter((r) => r.recipient === '텔레그램').every((r) => r.ok);
        const kkOk = reports.filter((r) => r.recipient !== '텔레그램').every((r) => r.ok);
        if (wantTelegram && (result.skippedReason || tgOk)) {
          await markBriefingSent(dateKst, slot, uid);
        }
        if (wantKakao && (result.skippedReason || kkOk)) {
          await markBriefingSent(dateKst, KAKAO_MARK, uid);
        }
      } catch (e) {
        // 수신자가 없는 사용자는 broadcast 가 던진다 — 다음 실행에서 재시도해도
        // 같은 결과이므로 표시해 두고 넘어간다
        perUser.push({ userId: uid, ok: false, sent: false, error: (e as Error).message });
        if (/발송 대상이 없습니다/.test((e as Error).message)) {
          await markBriefingSent(dateKst, slot, uid);
          await markBriefingSent(dateKst, KAKAO_MARK, uid);
        }
      }
    }

    const anySent = perUser.some((r) => r.sent);

    return NextResponse.json(
      {
        ok: true,
        hourKst: hour,
        slot,
        sent: anySent,
        users: perUser.map((r) => ({ ...r, userId: r.userId.slice(0, 8) })),
        preview: firstPreview,
        outlookCached,
        refresh: {
          regions: refresh.regionsProcessed,
          trades: refresh.tradesCollected,
          errors: refresh.errors.length,
        },
      },
      { status: 200 },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
