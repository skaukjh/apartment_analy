/**
 * "이 단지가 지금 갈아탈 후보인가"를 정하는 한 곳.
 *
 * 후보를 거르는 규칙이 화면마다 흩어지면 어떤 화면에는 남고 어떤 화면에서는 빠진다.
 * 서버(대시보드 조립)와 클라이언트(갭 카드·시뮬레이션)가 같은 함수를 쓰도록
 * 저장소(store)가 아니라 분석 계층에 둔다 — store 는 서버 전용 모듈을 끌고 온다.
 *
 * ── 왜 "자동 제외"가 아니라 "자동 끄기"인가 ─────────────────────────
 * 최근 실거래가 오래된 단지를 목록에서 조용히 빼면, 사용자는 자기가 등록한 단지가
 * 왜 사라졌는지 알 수 없다. 그래서 목록에는 그대로 두고 on/off 스위치만 꺼 둔다.
 * 사유를 함께 남기므로 화면에서 "왜 꺼졌는지"를 읽고 직접 다시 켤 수 있다.
 */

import type { PriceQuote, TargetApartment, UserConfig } from '@/lib/types';
import { TARGET_FRESHNESS_MONTHS, hasTradePrice, isStaleQuote } from './price-basis';

/** 스위치가 켜져 있는지 (필드가 없던 예전 데이터는 켜진 것으로 본다) */
export function isTargetEnabled(target: Pick<TargetApartment, 'enabled'>): boolean {
  return target.enabled !== false;
}

/** 갭·시뮬레이션·브리핑에서 후보가 되는 목표 아파트 (우선순위 순) */
export function activeTargets(config: UserConfig): TargetApartment[] {
  return config.targets.filter(isTargetEnabled).sort((a, b) => a.priority - b.priority);
}

/**
 * 계산에 들어가지 못하는 이유. 후보로 살아 있으면 null.
 * 화면들이 같은 문장을 쓰도록 여기서 한 번만 만든다.
 */
export function targetDisabledReason(
  target: Pick<TargetApartment, 'enabled' | 'autoDisabledReason'>,
  quote: PriceQuote | undefined,
): string | null {
  if (!isTargetEnabled(target)) {
    return target.autoDisabledReason ?? '목표 후보 스위치를 꺼 둔 단지';
  }
  if (!hasTradePrice(quote)) return '실거래 기록이 없어 대표가를 산출하지 못함';
  return null;
}

/** 켜져 있지만 대표가가 오래된 단지에 붙일 경고 문구. 문제 없으면 null */
export function staleQuoteWarning(quote: PriceQuote | undefined): string | null {
  if (!isStaleQuote(quote)) return null;
  const months = quote?.monthsSinceLastDeal;
  const last = quote?.lastDealDate;
  return (
    `최근 ${TARGET_FRESHNESS_MONTHS}개월 실거래 없음` +
    (last ? ` · 마지막 거래 ${last}${months ? ` (${months}개월 전)` : ''}` : '')
  );
}

export interface AutoDisableResult {
  targets: TargetApartment[];
  /** 무엇이든 바뀌었는지 (자동 끄기 + 자동 기록 지우기). false 면 저장하지 않는다 */
  changed: boolean;
  /** 이번에 자동으로 꺼진 항목 — 화면·상태 표시에 쓴다 */
  disabled: Array<{ id: string; complexName: string; reason: string }>;
}

/**
 * 대표가가 오래된 목표의 스위치를 자동으로 끈다.
 *
 * 규칙은 둘뿐이다.
 *  - 오래됐고, 켜져 있고, **아직 자동으로 꺼 본 적이 없으면** 끈다.
 *  - 다시 신선해지면 자동 기록을 지운다 (다음에 오래되면 또 꺼 줄 수 있게).
 *
 * "자동으로 꺼 본 적이 없으면"이 핵심이다. 사용자가 사유를 보고 일부러 다시 켰는데
 * 다음 조립에서 또 꺼 버리면 스위치가 사용자 것이 아니게 된다.
 */
export function autoDisableStaleTargets(
  targets: TargetApartment[],
  quotes: Record<string, PriceQuote>,
  now = new Date().toISOString(),
): AutoDisableResult {
  const disabled: AutoDisableResult['disabled'] = [];
  let changed = false;

  const next = targets.map((t) => {
    const quote = quotes[t.id];

    if (!isStaleQuote(quote)) {
      if (!t.autoDisabledAt && !t.autoDisabledReason) return t;
      // 새 거래가 들어와 다시 신선해졌다 — 자동 기록만 지우고 on/off 는 사용자 뜻대로 둔다
      changed = true;
      const cleared = { ...t };
      delete cleared.autoDisabledAt;
      delete cleared.autoDisabledReason;
      return cleared;
    }

    if (!isTargetEnabled(t) || t.autoDisabledAt) return t;

    const reason = staleQuoteWarning(quote) ?? `최근 ${TARGET_FRESHNESS_MONTHS}개월 실거래 없음`;
    changed = true;
    disabled.push({ id: t.id, complexName: t.complexName, reason });
    return {
      ...t,
      enabled: false,
      autoDisabledAt: now,
      autoDisabledReason: `${reason} — 자동으로 껐습니다`,
    };
  });

  return { targets: changed ? next : targets, changed, disabled };
}
