/**
 * Supabase 미설정 시 사용하는 프로세스 메모리 폴백.
 *
 * Next.js 는 라우트 핸들러와 페이지를 서로 다른 번들로 컴파일하기 때문에
 * 모듈 스코프 변수를 쓰면 같은 프로세스 안에서도 상태가 공유되지 않는다.
 * globalThis 에 붙여 하나의 인스턴스를 보장한다.
 *
 * ⚠️ 서버리스 환경에서는 인스턴스마다 별개이고 재시작 시 사라진다.
 *    실제 운영에는 Supabase 연결이 필요하다.
 */

import type { RegionPricePoint, TradeRecord, UserConfig } from '@/lib/types';

export interface MemoryState {
  config: UserConfig | null;
  regionMonthly: Map<string, RegionPricePoint>;
  /** key: `${lawdCd}|${dong}|${month}` */
  dongMonthly: Map<string, RegionPricePoint>;
  tradeCache: Map<string, TradeRecord[]>;
  snapshots: Array<{ capturedAt: string; payload: unknown }>;
  kakaoToken: {
    accessToken: string;
    refreshToken?: string;
    expiresAt: string;
    scope?: string;
  } | null;
}

const KEY = Symbol.for('apartment-analy.memory-store');

type GlobalWithStore = typeof globalThis & { [KEY]?: MemoryState };

export function memoryState(): MemoryState {
  const g = globalThis as GlobalWithStore;
  if (!g[KEY]) {
    g[KEY] = {
      config: null,
      regionMonthly: new Map(),
      dongMonthly: new Map(),
      tradeCache: new Map(),
      snapshots: [],
      kakaoToken: null,
    };
  }
  // dev 핫리로드 시 구버전 싱글턴이 살아남을 수 있으므로 누락 필드를 보정한다
  const s = g[KEY];
  s.regionMonthly ??= new Map();
  s.dongMonthly ??= new Map();
  s.tradeCache ??= new Map();
  s.snapshots ??= [];
  return s;
}
