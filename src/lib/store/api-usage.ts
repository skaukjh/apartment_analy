/**
 * 외부 API 호출량 자체 집계.
 *
 * 국토부·네이버·ECOS 등 어느 API 도 "남은 쿼터"를 응답으로 주지 않는다.
 * 그래서 우리가 보낸 호출 수를 (소스, KST 날짜) 단위로 직접 세서
 * 설정 화면에 "오늘 N건 사용 / 한도 M건"을 보여준다.
 *
 * ── 정확도 한계 ──────────────────────────────────────────────────
 * 서버리스 인스턴스가 플러시 전에 얼어붙으면 마지막 배치가 유실될 수 있다.
 * 어차피 목적이 "쿼터가 얼마나 남았나 감 잡기"이므로 근사치면 충분하다.
 * 증가는 bump_api_usage RPC(원자적 upsert)로 해서 인스턴스 간 경쟁은 없다.
 */

import { getAdminClient } from './supabase';
import { nowKst } from '@/lib/format';

/** 집계 대상 소스 키 */
export type ApiUsageSource = 'molit' | 'naver' | 'ecos' | 'reb' | 'kosis' | 'kakao' | 'telegram';

const pending = new Map<string, number>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let tableMissing = false;

function kstDay(): string {
  const d = nowKst();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function flush(): Promise<void> {
  flushTimer = null;
  const client = getAdminClient();
  const batch = [...pending.entries()];
  pending.clear();
  if (!client || tableMissing || batch.length === 0) return;

  const day = kstDay();
  await Promise.all(
    batch.map(async ([source, n]) => {
      const { error } = await client.rpc('bump_api_usage', { src: source, d: day, n });
      if (error) {
        // 마이그레이션(0005_api_usage.sql) 전이면 함수가 없다 — 한 번만 알리고 조용히 끈다
        if (!tableMissing) {
          tableMissing = true;
          console.warn('[usage] 집계 저장 실패 (0005_api_usage.sql 적용 필요?):', error.message);
        }
      }
    }),
  );
}

/**
 * 호출 1건(또는 n건)을 기록한다. 호출 경로에 부담을 주지 않도록
 * 짧게 모았다가 배치로 저장한다 — await 하지 않아도 된다.
 */
export function bumpApiUsage(source: ApiUsageSource, n = 1): void {
  pending.set(source, (pending.get(source) ?? 0) + n);
  // 백필처럼 호출이 몰릴 때는 배치가 커지기 전에 미리 저장한다
  if ((pending.get(source) ?? 0) >= 50) {
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = null;
    void flush();
    return;
  }
  if (!flushTimer) flushTimer = setTimeout(() => void flush(), 2000);
}

export interface ApiUsageRow {
  source: string;
  count: number;
  updatedAt: string;
}

/** 오늘(KST) 사용량 — 테이블이 없으면 null (마이그레이션 미적용) */
export async function loadTodayApiUsage(): Promise<ApiUsageRow[] | null> {
  const client = getAdminClient();
  if (!client) return null;

  const { data, error } = await client
    .from('api_usage')
    .select('source, count, updated_at')
    .eq('day', kstDay());

  if (error) return null;
  return (data ?? []).map((r) => ({
    source: r.source as string,
    count: r.count as number,
    updatedAt: r.updated_at as string,
  }));
}
