/**
 * 국토부 실거래가 OpenAPI 반영 주기 측정 (서버 상주판).
 *
 * ── 왜 서버인가 ──────────────────────────────────────────────────
 * 같은 일을 하는 scripts/measure-molit-lag.mjs 는 PC 를 켜 둬야 한다.
 * 반영 시각은 하루 종일 관측해야 뜻이 있으므로, 30분마다 어차피 도는
 * tick 에 얹어 서버가 대신 보게 한다. PC 를 꺼도 계속 쌓인다.
 *
 * ── 무엇을 재나 ─────────────────────────────────────────────────
 * 같은 (시군구, 월)을 반복 조회하며 "직전에 없던 거래"가 나타난 순간을
 * 기록한다. 하루치가 쌓이면 다음이 드러난다:
 *   - 하루 몇 번 반영되는가 (정해진 배치인가, 수시인가)
 *   - 몇 시에 들어오는가 → 갱신 주기를 이 값으로 정한다
 *   - 계약일로부터 며칠 만에 공개되는가 (신고 지연)
 *
 * ── 왜 새 테이블을 안 만드나 ────────────────────────────────────
 * 마이그레이션을 손으로 돌려야 해서, 측정 하나 때문에 운영 절차를
 * 늘리고 싶지 않았다. dashboard_snapshot 은 이미 payload->>kind 로
 * 여러 종류를 나눠 쓰고 있어 그 방식을 그대로 따른다.
 *
 * 비용: 3지역 × 2개월 = 6호출/회, 30분 간격이면 하루 288건이다
 * (국토부 개발계정 한도 10,000건의 3%).
 */

import { fetchTrades } from '@/lib/sources/molit';
import { getAdminClient } from '@/lib/store/supabase';
import { nowKst, recentYearMonths } from '@/lib/format';
import type { TradeRecord } from '@/lib/types';

const KIND = 'molit-probe';

/** 관측 대상 — 사용자가 실제로 보는 지역. 거래가 꾸준해야 신호가 잡힌다. */
const PROBE_REGIONS = ['11215', '11710', '11200'];

/** 관측할 개월 수 — 신고 기한 30일이라 두 달이면 새 신고를 모두 덮는다 */
const PROBE_MONTHS = 2;

/** 페이로드가 무한정 커지지 않게 */
const MAX_EVENTS = 3000;

export interface ProbeEvent {
  /** 우리가 처음 본 시각 (ISO, UTC) */
  detectedAt: string;
  /** 그 시각의 KST 시(0~23) — 반영 시각 분포를 그리는 축 */
  hourKst: number;
  /** 계약일로부터 며칠 만에 보였나 */
  lagDays: number;
  lawdCd: string;
  dong: string;
  complexName: string;
  areaM2: number;
  floor: number;
  price: number;
  dealDate: string;
}

interface ProbeState {
  kind: typeof KIND;
  /** 기준선을 잡은 시각 — 이전 재고는 이벤트로 세지 않는다 */
  startedAt: string;
  /** 본 거래 키 목록 */
  seen: string[];
  events: ProbeEvent[];
  lastRunAt: string;
  lastError?: string;
}

export interface ProbeResult {
  ran: boolean;
  baseline: boolean;
  newCount: number;
  seenCount: number;
  reason?: string;
}

/* ------------------------------------------------------------------ */

function keyOf(lawdCd: string, t: TradeRecord): string {
  return `${lawdCd}|${t.dealDate}|${t.complexName}|${t.areaM2}|${t.floor}|${t.price}`;
}

/** 키에서 계약 연월(YYYYMM) — 창 밖으로 밀려난 달의 키를 버리는 데 쓴다 */
function ymOfKey(key: string): string {
  const date = key.split('|')[1] ?? '';
  return date.slice(0, 4) + date.slice(5, 7);
}

async function loadState(): Promise<ProbeState | null> {
  const client = getAdminClient();
  if (!client) return null;

  const { data, error } = await client
    .from('dashboard_snapshot')
    .select('payload')
    .eq('payload->>kind', KIND)
    .order('captured_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return data.payload as ProbeState;
}

async function saveState(state: ProbeState): Promise<void> {
  const client = getAdminClient();
  if (!client) return;

  const capturedAt = new Date().toISOString();
  const { error } = await client
    .from('dashboard_snapshot')
    .insert({ captured_at: capturedAt, payload: state });
  if (error) {
    console.error('[probe] 상태 저장 실패:', error.message);
    return;
  }

  // 최신 한 줄만 남긴다 — 30분마다 쌓으면 테이블이 금방 비대해진다
  await client
    .from('dashboard_snapshot')
    .delete()
    .eq('payload->>kind', KIND)
    .lt('captured_at', capturedAt);
}

/* ------------------------------------------------------------------ */

/**
 * 한 번 관측한다. tick 이 돌 때마다 호출한다.
 * 어떤 실패도 tick 을 멈추지 않는다 — 측정은 부가 기능이다.
 */
export async function runMolitProbe(): Promise<ProbeResult> {
  const client = getAdminClient();
  if (!client) return { ran: false, baseline: false, newCount: 0, seenCount: 0, reason: 'DB 없음' };

  const months = recentYearMonths(PROBE_MONTHS);
  const now = new Date().toISOString();
  // nowKst() 는 KST 벽시계 값을 담은 Date 라 getHours() 가 곧 KST 시다
  const hourKst = nowKst().getHours();

  const prev = await loadState().catch(() => null);
  const first = prev === null;
  const seen = new Set(prev?.seen ?? []);
  const events = [...(prev?.events ?? [])];

  const fresh: ProbeEvent[] = [];
  let failure: string | undefined;

  for (const lawdCd of PROBE_REGIONS) {
    for (const ym of months) {
      try {
        // 캐시를 타면 측정이 무의미하다 — 매번 원본을 본다
        const trades = await fetchTrades(lawdCd, ym, 0);
        for (const t of trades) {
          const k = keyOf(lawdCd, t);
          if (seen.has(k)) continue;
          seen.add(k);
          if (first) continue; // 첫 회차의 재고는 "새로 나타난 것"이 아니다
          fresh.push({
            detectedAt: now,
            hourKst,
            lagDays: Math.round(
              (Date.now() - new Date(`${t.dealDate}T00:00:00+09:00`).getTime()) / 86_400_000,
            ),
            lawdCd,
            dong: t.dong,
            complexName: t.complexName,
            areaM2: t.areaM2,
            floor: t.floor,
            price: t.price,
            dealDate: t.dealDate,
          });
        }
      } catch (e) {
        // 쿼터·키 문제는 남은 조합도 같으므로 기록만 하고 넘어간다
        failure = `${lawdCd} ${ym}: ${(e as Error).message}`;
      }
    }
  }

  // 관측 창 밖으로 밀려난 달의 키는 버린다 (달이 바뀌면 무한정 쌓인다)
  const window = new Set(months);
  const kept = [...seen].filter((k) => window.has(ymOfKey(k)));

  events.push(...fresh);

  await saveState({
    kind: KIND,
    startedAt: prev?.startedAt ?? now,
    seen: kept,
    events: events.slice(-MAX_EVENTS),
    lastRunAt: now,
    lastError: failure,
  }).catch((e) => console.error('[probe] 저장 실패:', (e as Error).message));

  return {
    ran: true,
    baseline: first,
    newCount: fresh.length,
    seenCount: kept.length,
    reason: failure,
  };
}

/* ------------------------------------------------------------------ */
/* 요약                                                                */
/* ------------------------------------------------------------------ */

export interface ProbeReport {
  startedAt: string | null;
  lastRunAt: string | null;
  observedCount: number;
  seenCount: number;
  /** KST 시(0~23) → 그 시각에 처음 보인 거래 수 */
  byHour: Record<number, number>;
  /** 반영이 관측된 (날짜, 시) 조합 수 ÷ 관측 일수 */
  slotsPerDay: number | null;
  /** 계약일 → 공개까지 걸린 일수 */
  lagDays: { min: number; median: number; max: number } | null;
  lastError?: string;
  events: ProbeEvent[];
}

export async function loadProbeReport(): Promise<ProbeReport> {
  const state = await loadState().catch(() => null);
  const events = state?.events ?? [];

  const byHour: Record<number, number> = {};
  for (const e of events) byHour[e.hourKst] = (byHour[e.hourKst] ?? 0) + 1;

  const slots = new Set(events.map((e) => `${e.detectedAt.slice(0, 10)}|${e.hourKst}`));
  const days = new Set(events.map((e) => e.detectedAt.slice(0, 10)));

  const lags = events.map((e) => e.lagDays).sort((a, b) => a - b);

  return {
    startedAt: state?.startedAt ?? null,
    lastRunAt: state?.lastRunAt ?? null,
    observedCount: events.length,
    seenCount: state?.seen.length ?? 0,
    byHour,
    slotsPerDay: days.size > 0 ? Math.round((slots.size / days.size) * 10) / 10 : null,
    lagDays:
      lags.length > 0
        ? { min: lags[0], median: lags[Math.floor(lags.length / 2)], max: lags[lags.length - 1] }
        : null,
    lastError: state?.lastError,
    events,
  };
}
