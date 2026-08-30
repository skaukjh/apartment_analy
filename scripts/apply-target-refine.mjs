/**
 * 예산 상한을 20억으로 내리고, 옥수 현대 목표 평형을 다시 잡는 일회성 스크립트.
 *
 *  1) targetBudgetCap 25억 → 20억. 갭투자를 하지 않으면 20억이 실질 상한이라,
 *     상한을 실제 판단과 맞춰야 홈 화면 경고가 의미를 가진다.
 *  2) 옥수 현대 77.32㎡ → 63.13㎡.
 *
 * ── 옥수 현대 면적을 63.13 으로 넣는 이유 ────────────────────────────
 * 사용자가 말한 "82.82"는 공급면적(25평형)이고, 그 평형의 전용면적이 63.13㎡다.
 * 2026-01-17 18.8억(12층) 계약이 국토부에 전용 63.13㎡로 신고돼 있다.
 * 앱의 시세 매칭은 전용면적으로만 이뤄지므로(quoteFromTrades → filterComplex),
 * 82.82 를 그대로 넣으면 ±3㎡ 창에 전용 84.9㎡(20.8억)가 걸려 엉뚱한 값을 잡는다.
 *
 * 63.13㎡의 최근 거래는 2026-01-17 한 건이라 6개월 신선도 기준을 벗어나 있다.
 * 화면에는 ⚠ 문구가 붙지만 스위치는 꺼지지 않는다 — 자동 끄기를 꺼 뒀다
 * (lib/analysis/target-pool.ts 의 AUTO_DISABLE_ENABLED).
 *
 * 기본은 미리보기다. 실제로 저장하려면 --apply 를 붙인다.
 *
 *   node --env-file=.env.local scripts/apply-target-refine.mjs
 *   node --env-file=.env.local scripts/apply-target-refine.mjs --apply
 */

import { createClient } from '@supabase/supabase-js';

/** 설정을 바꿀 사용자 */
const USER_ID = '26522523-57c5-4bd6-8c20-7df7078685a7';

/** 새 목표 아파트 예산 상한 (원) */
const BUDGET_CAP = 2_000_000_000;

/** 평형을 다시 잡을 목표 */
const RETARGET = [
  {
    complexName: '옥수 현대',
    dong: '옥수동',
    from: 77.32,
    to: 63.13, // 공급 82.82㎡(25평형)의 전용면적
    price: 1_880_000_000, // 2026-01-17 · 12층
  },
];

const apply = process.argv.includes('--apply');

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error(
    'NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 없습니다.\n' +
      '  node --env-file=.env.local scripts/apply-target-refine.mjs',
  );
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });

const eok = (n) => `${(n / 100_000_000).toFixed(2)}억`;
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
const oldCap = config.targetBudgetCap ?? 0;

const log = [];
const missing = [];
let changed = oldCap !== BUDGET_CAP;

const nextTargets = oldTargets.map((t) => {
  const want = RETARGET.find((r) => sameComplex(t, r));
  if (!want) return t;

  if (Math.abs((t.areaM2 ?? 0) - want.to) < 0.5) {
    log.push(`유지  ${t.complexName} ${t.areaM2}㎡ — 이미 새 평형`);
    return t;
  }

  changed = true;
  const item = { ...t, areaM2: want.to };

  /* 평형이 바뀌면 예전 평형에 매겨둔 호가·대지지분은 더 이상 그 집 값이 아니다. */
  const dropped = [];
  if (item.manualPrice) {
    dropped.push(`호가 ${eok(item.manualPrice)}`);
    delete item.manualPrice;
  }
  if (item.landShareM2 !== undefined) {
    dropped.push('대지지분');
    delete item.landShareM2;
  }
  if (item.autoDisabledAt || item.autoDisabledReason) {
    dropped.push('자동 끄기 기록');
    delete item.autoDisabledAt;
    delete item.autoDisabledReason;
  }

  log.push(
    `변경  ${t.complexName} ${t.areaM2}㎡(${pyeong(t.areaM2)}평) → ` +
      `${want.to}㎡(${pyeong(want.to)}평)  최근 실거래 ${eok(want.price)}` +
      (dropped.length > 0 ? `  · ${dropped.join(', ')} 삭제` : ''),
  );
  return item;
});

// 저장본에 없는 단지를 조용히 넘기지 않는다 — 이름이 어긋난 것일 수 있다
for (const want of RETARGET) {
  if (!oldTargets.some((t) => sameComplex(t, want))) missing.push(want.complexName);
}

console.log(`[${USER_ID}]`);
log.forEach((l) => console.log(`  ${l}`));
if (missing.length > 0) {
  console.error(`\n✖ 저장본에서 찾지 못한 단지: ${missing.join(', ')}`);
  process.exit(1);
}
console.log(`  예산 상한  ${eok(oldCap)} → ${eok(BUDGET_CAP)}`);

/* 상한을 내리면 지금 목표 중 무엇이 넘는지 미리 보여준다 —
   저장한 뒤에야 홈 화면에서 알게 되면 되돌릴지 판단할 기회가 없다. */
console.log('\n  새 상한 기준 (앱 대표가는 ±3㎡ 창을 함께 보므로 다를 수 있음):');
for (const t of nextTargets
  .filter((t) => t.enabled !== false)
  .sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99))) {
  console.log(`    ${t.priority}. ${t.complexName} ${t.areaM2}㎡ (${pyeong(t.areaM2)}평)`);
}

if (!changed) {
  console.log('\n바뀔 것이 없습니다.');
  process.exit(0);
}

if (!apply) {
  console.log('\n미리보기입니다. 실제로 저장하려면 --apply 를 붙여 다시 실행하세요.');
  process.exit(0);
}

const updated = {
  ...config,
  targets: nextTargets,
  targetBudgetCap: BUDGET_CAP,
  updatedAt: new Date().toISOString(),
};

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
