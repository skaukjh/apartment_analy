/**
 * 법정동 + 지번 → 행정동 판별
 *
 * ── 왜 필요한가 ──────────────────────────────────────────────────
 * 지도 경계(통계청)는 행정동(자양1~4동)인데 국토부 실거래는 법정동(자양동)만 준다.
 * 그래서 "자양2동"을 눌러도 자양동 전체가 나왔다.
 *
 * 다행히 국토부 응답에 지번(jibun)이 있다. 지번까지 있으면 위치가 특정되므로
 *   지번 주소 → (카카오 주소검색) 좌표 → (카카오 좌표→행정구역) 행정동
 * 순서로 행정동을 알아낼 수 있다. 실제로 "서울 광진구 자양동 579" → 자양3동 으로 확인했다.
 *
 * ── 비용 ─────────────────────────────────────────────────────────
 * 조회 단위는 거래 건수가 아니라 **지번 종류 수**다. 한 단지의 거래 수백 건이
 * 같은 지번을 쓰므로 실제 호출은 시군구당 수백 회에 그친다.
 * 카카오 로컬 API 는 일 100,000회 무료라 여유가 크다.
 * 결과는 시군구 단위로 묶어 Supabase 에 캐시한다 (마이그레이션 불필요).
 */

import { env } from '@/lib/env';
import { getAdminClient } from '@/lib/store/supabase';

const KIND = 'admin-dong-map';

/** 시군구별 지번→행정동 매핑. 키는 `법정동|지번`. */
type DongMap = Record<string, string>;

interface CacheEnvelope {
  kind: typeof KIND;
  lawdCd: string;
  map: DongMap;
}

const memory = new Map<string, DongMap>();

function keyOf(umdNm: string, jibun: string): string {
  return `${umdNm}|${jibun}`;
}

async function kakao<T>(url: string): Promise<T | null> {
  const key = env.kakaoRestKey;
  if (!key) return null;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `KakaoAK ${key}` },
      // 행정구역 경계는 거의 바뀌지 않는다. 길게 캐시한다.
      next: { revalidate: 60 * 60 * 24 * 30 },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** 지번 주소 하나를 행정동으로 바꾼다. 실패하면 null. */
async function lookupOne(sigungu: string, umdNm: string, jibun: string): Promise<string | null> {
  const address = `${sigungu} ${umdNm} ${jibun}`.trim();

  const addrRes = await kakao<{ documents?: Array<{ x: string; y: string }> }>(
    `https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(address)}`,
  );
  const doc = addrRes?.documents?.[0];
  if (!doc) return null;

  const regionRes = await kakao<{
    documents?: Array<{ region_type: string; region_3depth_name: string }>;
  }>(`https://dapi.kakao.com/v2/local/geo/coord2regioncode.json?x=${doc.x}&y=${doc.y}`);

  // region_type 'H' 가 행정동, 'B' 가 법정동
  const admin = regionRes?.documents?.find((d) => d.region_type === 'H');
  return admin?.region_3depth_name ?? null;
}

async function loadCache(lawdCd: string): Promise<DongMap> {
  const cached = memory.get(lawdCd);
  if (cached) return cached;

  const client = getAdminClient();
  if (!client) {
    const empty: DongMap = {};
    memory.set(lawdCd, empty);
    return empty;
  }

  const { data } = await client
    .from('dashboard_snapshot')
    .select('payload')
    .order('captured_at', { ascending: false })
    .limit(200);

  let map: DongMap = {};
  for (const row of data ?? []) {
    const payload = row.payload as CacheEnvelope | null;
    if (payload?.kind === KIND && payload.lawdCd === lawdCd) {
      map = payload.map ?? {};
      break;
    }
  }

  memory.set(lawdCd, map);
  return map;
}

async function saveCache(lawdCd: string, map: DongMap): Promise<void> {
  memory.set(lawdCd, map);

  const client = getAdminClient();
  if (!client) return;

  const envelope: CacheEnvelope = { kind: KIND, lawdCd, map };
  const { error } = await client
    .from('dashboard_snapshot')
    .insert({ captured_at: new Date().toISOString(), payload: envelope });

  if (error) console.error('[admin-dong] 캐시 저장 실패:', error.message);
}

/** 카카오 키가 있어야 행정동 판별이 가능하다 */
export function canResolveAdminDong(): boolean {
  return Boolean(env.kakaoRestKey);
}

/**
 * 여러 (법정동, 지번)을 한 번에 행정동으로 바꾼다.
 *
 * @param lawdCd  시군구 코드 (캐시 단위)
 * @param sigungu 시군구 이름 (주소 조립용, 예: "서울 광진구")
 * @param pairs   [법정동, 지번] 목록
 * @param budget  이번 호출에서 새로 조회할 최대 개수. 응답이 늘어지지 않게 제한한다.
 * @returns `법정동|지번` → 행정동
 */
export async function resolveAdminDongs(
  lawdCd: string,
  sigungu: string,
  pairs: Array<{ umdNm: string; jibun: string }>,
  budget = 40,
): Promise<DongMap> {
  if (!canResolveAdminDong()) return {};

  const map = { ...(await loadCache(lawdCd)) };

  const missing = pairs
    .filter((p) => p.umdNm && p.jibun && !map[keyOf(p.umdNm, p.jibun)])
    .slice(0, budget);

  if (missing.length === 0) return map;

  // 카카오도 초당 제한이 있어 한꺼번에 몰지 않고 조금씩 나눠 보낸다
  const CHUNK = 5;
  let added = 0;
  for (let i = 0; i < missing.length; i += CHUNK) {
    const slice = missing.slice(i, i + CHUNK);
    const results = await Promise.all(
      slice.map((p) => lookupOne(sigungu, p.umdNm, p.jibun).catch(() => null)),
    );
    slice.forEach((p, idx) => {
      const admin = results[idx];
      if (admin) {
        map[keyOf(p.umdNm, p.jibun)] = admin;
        added += 1;
      }
    });
  }

  if (added > 0) await saveCache(lawdCd, map);
  return map;
}

/** 매핑에서 행정동을 꺼낸다 */
export function adminDongOf(map: DongMap, umdNm: string, jibun: string): string | undefined {
  return map[keyOf(umdNm, jibun)];
}
