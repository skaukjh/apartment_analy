/**
 * 2026-08-30 기준 호가를 목표 아파트에 넣는 일회성 스크립트.
 *
 * 호가는 자동으로 갱신되지 않는다 — 단지별 호가를 주는 공개 API 가 없어
 * 사람이 본 값을 그대로 넣는다. 그래서 값과 함께 **본 날짜(askingPriceAt)** 를
 * 반드시 남긴다. 날짜가 없으면 화면이 "호가 입력일 기록 없음"으로 경고한다.
 *
 * ── 평형 확인 ────────────────────────────────────────────────────────
 * 사용자가 부르는 "평"은 공급면적 기준이고 앱 매칭은 전용면적으로만 한다.
 * 그래서 넣기 전에 실거래 캐시에서 그 평형 그룹을 하나씩 확인했다.
 *
 *   서현 시범한양 24평  → 전용 59.13㎡ (등록된 59.4㎡ 가 ±3㎡ 창으로 잡는다)
 *   서현 시범한신 22평  → 전용 59.995㎡ (등록된 60㎡)
 *   상록우성 22평       → 전용 55.14㎡ — 등록된 69.12㎡(28평)와 다르다. 평형도 함께 내린다.
 *   응봉 대림1차        → 전용 63.18㎡ (등록된 63.2㎡)
 *
 * 상록우성만 평형을 바꾼다. 22평 호가 19억을 28평(직전 20.50억)에 붙이면
 * 급매처럼 보이는 조용히 틀린 값이 된다. 22평은 직전 18.80억(26-07-16, 23건)이라
 * 19억 호가가 자연스럽고, 예산 상한 20억에도 들어온다.
 *
 * "서현 삼성·한신"으로 함께 부른 호가지만 목표에 등록된 건 시범한신 하나뿐이라
 * 시범한신에만 넣는다 (시범삼성은 별개 단지이고 목표에 없다).
 *
 * 기본은 미리보기다. 실제로 저장하려면 --apply 를 붙인다.
 *
 *   node --env-file=.env.local scripts/apply-asking-prices.mjs
 *   node --env-file=.env.local scripts/apply-asking-prices.mjs --apply
 */

import { createClient } from '@supabase/supabase-js';

/** 호가를 넣을 사용자 */
const USER_ID = '26522523-57c5-4bd6-8c20-7df7078685a7';

/** 호가를 본 날 — 오늘 기준으로 사용자가 알려준 값이다 */
const SEEN_AT = '2026-08-30';

/**
 * 넣을 호가.
 *  - areaM2 가 있으면 그 전용면적으로 평형까지 바꾼다 (상록우성만 해당).
 *  - lastTrade 는 저장하지 않는다. 확인용으로 적어 둔 그 평형의 직전 실거래가다.
 */
const ASKING = [
  {
    complexName: '시범한양',
    dong: '서현동',
    price: 1_900_000_000,
    lastTrade: 1_750_000_000, // 전용 59.13㎡ · 26-05-29
    note: '24평(전용 59.13㎡)',
  },
  {
    complexName: '시범한신',
    dong: '서현동',
    price: 1_830_000_000,
    lastTrade: 1_850_000_000, // 전용 59.995㎡ · 26-02-02
    note: '22평(전용 59.995㎡) · "삼성·한신"으로 함께 부른 호가',
  },
  {
    complexName: '상록마을(우성)1',
    dong: '정자동',
    areaM2: 55.14, // 28평(69.12㎡) → 22평
    price: 1_900_000_000,
    lastTrade: 1_880_000_000, // 전용 55.14㎡ · 26-07-16
    note: '22평(전용 55.14㎡) — 평형도 함께 내린다',
  },
  {
    complexName: '응봉대림1차',
    dong: '응봉동',
    price: 1_900_000_000,
    lastTrade: 1_780_000_000, // 전용 63.18㎡ · 25-12-06
    note: '전용 63.18㎡',
  },
];

const apply = process.argv.includes('--apply');

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error(
    'NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 없습니다.\n' +
      '  node --env-file=.env.local scripts/apply-asking-prices.mjs',
  );
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });

const eok = (n) => `${(n / 100_000_000).toFixed(2)}억`;
const signedEok = (n) => `${n >= 0 ? '+' : '-'}${(Math.abs(n) / 100_000_000).toFixed(2)}억`;
const pyeong = (m2) => (m2 / 3.3058).toFixed(1);

/** 같은 단지인지 — 공백·괄호를 무시하고 이름과 동으로 본다 */
const norm = (s) =>
  String(s ?? '')
    .replace(/\s+/g, '')
    .replace(/[()（）]/g, '')
    .toLowerCase();

const sameComplex = (a, b) => norm(a.complexName) === norm(b.complexName) && a.dong === b.dong;

const { data: row, error } = await db
  .from('user_config')
  .select('id, data')
  .eq('id', USER_ID)
  .single();
if (error) {
  console.error(`설정 조회 실패: ${error.message}`);
  process.exit(1);
}

const config = row.data;
const oldTargets = config.targets ?? [];

const log = [];
const missing = [];
let changed = false;

const nextTargets = oldTargets.map((t) => {
  const want = ASKING.find((a) => sameComplex(t, a));
  if (!want) return t;

  changed = true;
  const item = { ...t, manualPrice: want.price, askingPriceAt: SEEN_AT };

  const notes = [];
  if (want.areaM2 !== undefined && Math.abs((t.areaM2 ?? 0) - want.areaM2) >= 0.5) {
    notes.push(
      `평형 ${t.areaM2}㎡(${pyeong(t.areaM2)}평) → ${want.areaM2}㎡(${pyeong(want.areaM2)}평)`,
    );
    item.areaM2 = want.areaM2;

    /* 평형이 바뀌면 예전 평형 기준 대지지분·자동 끄기 기록은 그 집 값이 아니다. */
    if (item.landShareM2 !== undefined) {
      notes.push('대지지분 삭제');
      delete item.landShareM2;
    }
    if (item.autoDisabledAt || item.autoDisabledReason) {
      notes.push('자동 끄기 기록 삭제');
      delete item.autoDisabledAt;
      delete item.autoDisabledReason;
    }
  }

  const before = t.manualPrice
    ? `${eok(t.manualPrice)}${t.askingPriceAt ? ` (${t.askingPriceAt})` : ' (입력일 없음)'}`
    : '없음';
  log.push(
    `${t.complexName}  호가 ${before} → ${eok(want.price)} (${SEEN_AT})\n` +
      `      직전 실거래 ${eok(want.lastTrade)} 대비 ${signedEok(want.price - want.lastTrade)} ` +
      `(${(((want.price - want.lastTrade) / want.lastTrade) * 100).toFixed(1)}%) · ${want.note}` +
      (notes.length > 0 ? `\n      ${notes.join(' · ')}` : ''),
  );
  return item;
});

// 저장본에 없는 단지를 조용히 넘기지 않는다 — 이름이 어긋난 것일 수 있다
for (const want of ASKING) {
  if (!oldTargets.some((t) => sameComplex(t, want))) missing.push(want.complexName);
}

console.log(`[${USER_ID}]`);
log.forEach((l) => console.log(`  ${l}`));
if (missing.length > 0) {
  console.error(`\n✖ 저장본에서 찾지 못한 단지: ${missing.join(', ')}`);
  process.exit(1);
}

if (!changed) {
  console.log('\n바뀔 것이 없습니다.');
  process.exit(0);
}

if (!apply) {
  console.log('\n미리보기입니다. 실제로 저장하려면 --apply 를 붙여 다시 실행하세요.');
  process.exit(0);
}

const updated = { ...config, targets: nextTargets, updatedAt: new Date().toISOString() };

/* 덮어쓰기 전에 지금 저장본을 히스토리로 남긴다 — 설정 화면의 "이전 내역"에서
   되돌릴 수 있게, 앱의 저장 경로와 같은 형식을 쓴다. */
const { error: historyError } = await db.from('dashboard_snapshot').insert({
  captured_at: new Date().toISOString(),
  payload: {
    kind: 'config-history',
    userId: USER_ID,
    savedAt: config.updatedAt ?? new Date().toISOString(),
    config,
  },
});
if (historyError) {
  console.error(`\n✖ 이전 내역 저장 실패로 중단합니다: ${historyError.message}`);
  process.exit(1);
}

const { error: saveError } = await db
  .from('user_config')
  .update({ data: updated, updated_at: updated.updatedAt })
  .eq('id', USER_ID);
if (saveError) {
  console.error(`\n✖ 저장 실패: ${saveError.message}`);
  process.exit(1);
}
console.log('\n✔ 저장했습니다.');

/* 대시보드 캐시를 버린다 — 안 버리면 다음 조립까지 이전 설정 기준 화면이 그대로 보인다. */
const { error: cacheError } = await db
  .from('dashboard_snapshot')
  .delete()
  .eq('payload->>kind', 'dashboard-cache')
  .eq('payload->>userId', USER_ID);
console.log(
  cacheError
    ? `⚠ 대시보드 캐시 무효화 실패: ${cacheError.message}`
    : '✔ 대시보드 캐시를 비웠습니다.',
);
