/**
 * 지연 갱신 — 대시보드가 열릴 때 실거래 집계가 낡았으면 최근월만 다시 긁는다.
 *
 * Vercel Hobby 플랜은 Cron 을 하루 1회만 돌릴 수 있어서, 그것만으로는
 * "1시간마다 최신"을 만족하지 못한다. 그래서 요청이 들어온 김에 갱신을 태운다.
 * 단, 응답을 붙잡아 두지 않도록 백그라운드로 던지고 결과를 기다리지 않는다.
 */

import { refreshRecent } from './refresh';
import { analysisTargets, loadConfig } from '@/lib/store/config';
import { featureFlags } from '@/lib/env';
import { LAZY_REFRESH_THRESHOLD_MS } from '@/lib/refresh-policy';

interface RefreshState {
  lastStartedAt: number;
  lastFinishedAt: number;
  running: boolean;
  lastError?: string;
  lastRegionCount: number;
}

const KEY = Symbol.for('apartment-analy.lazy-refresh');
type GlobalWithState = typeof globalThis & { [KEY]?: RefreshState };

function state(): RefreshState {
  const g = globalThis as GlobalWithState;
  if (!g[KEY]) {
    g[KEY] = { lastStartedAt: 0, lastFinishedAt: 0, running: false, lastRegionCount: 0 };
  }
  return g[KEY];
}

export interface LazyRefreshStatus {
  /** 마지막으로 실거래 갱신이 끝난 시각 (ISO). 한 번도 없으면 null */
  lastRefreshedAt: string | null;
  running: boolean;
  triggered: boolean;
  reason: string;
}

/**
 * 필요하면 최근 실거래 갱신을 시작한다 (결과를 기다리지 않음).
 * 사용자 등록 지역만 대상으로 해 호출량을 억제한다 — 전국 갱신은 Cron 이 담당.
 */
export function maybeRefreshTrades(): LazyRefreshStatus {
  const s = state();
  const now = Date.now();

  const base = {
    lastRefreshedAt: s.lastFinishedAt > 0 ? new Date(s.lastFinishedAt).toISOString() : null,
    running: s.running,
  };

  if (!featureFlags.hasMolit) {
    return { ...base, triggered: false, reason: '실거래가 API 키가 없어 갱신하지 않습니다.' };
  }
  if (s.running) {
    return { ...base, triggered: false, reason: '이미 갱신이 진행 중입니다.' };
  }
  if (now - s.lastStartedAt < LAZY_REFRESH_THRESHOLD_MS) {
    const mins = Math.round((LAZY_REFRESH_THRESHOLD_MS - (now - s.lastStartedAt)) / 60_000);
    return { ...base, triggered: false, reason: `${mins}분 뒤 다시 갱신합니다.` };
  }

  s.running = true;
  s.lastStartedAt = now;

  // 응답을 지연시키지 않도록 기다리지 않는다
  void (async () => {
    try {
      const config = await loadConfig();
      const codes = analysisTargets(config);
      if (codes.length === 0) {
        s.lastError = '등록된 지역이 없습니다.';
        return;
      }
      const result = await refreshRecent(codes, 2, {
        cacheTradesFor: new Set(codes),
        budgetMs: 45_000,
      });
      s.lastRegionCount = result.regionsProcessed;
      s.lastError = result.errors[0];
      s.lastFinishedAt = Date.now();
    } catch (e) {
      s.lastError = (e as Error).message;
    } finally {
      s.running = false;
    }
  })();

  return { ...base, running: true, triggered: true, reason: '최근 실거래를 갱신하고 있습니다.' };
}

export function refreshStatus(): LazyRefreshStatus & { lastError?: string; regionCount: number } {
  const s = state();
  return {
    lastRefreshedAt: s.lastFinishedAt > 0 ? new Date(s.lastFinishedAt).toISOString() : null,
    running: s.running,
    triggered: false,
    reason: s.running ? '갱신 중' : '대기',
    lastError: s.lastError,
    regionCount: s.lastRegionCount,
  };
}
