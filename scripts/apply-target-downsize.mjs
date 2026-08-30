/**
 * 목표 아파트의 평형을 "바로 아래 한 칸"으로 내리는 일회성 스크립트.
 *
 * 왜: 갭투자를 하지 않으면 20억대 초반이 상한선이라, 단지를 포기하는 대신
 * 같은 단지에서 평형을 낮춰 들어가는 쪽을 목표로 삼는다.
 *
 * 평형과 가격은 국토부 실거래 캐시(trade_cache, 2025-03~2026-08, 직거래·해제 제외)에서
 * 단지별 평형 그룹을 뽑아 "지금 목표 바로 아래 그룹"을 고른 값이다.
 * 송파한양1차(64.3㎡)는 그 단지의 최소 평형이라 손대지 않는다.
 *
 * ── 주의 ────────────────────────────────────────────────────────────
 * 아래 표의 stale: true 인 세 곳은 새 평형에 최근 6개월 실거래가 없다.
 * 그래도 스위치는 꺼지지 않는다 — 자동 끄기를 꺼 뒀다
 * (lib/analysis/target-pool.ts 의 AUTO_DISABLE_ENABLED = false).
 * 평형을 내리면 거래가 뜸한 소형으로 가는데, 그때마다 스위치가 꺼지면
 * 후보를 좁히려고 내린 평형이 오히려 목록에서 사라지기 때문이다.
 * 값이 오래됐다는 사실은 화면의 ⚠ 문구(staleQuoteWarning)가 알려 준다.
 *
 * 기본은 미리보기다. 실제로 저장하려면 --apply 를 붙인다.
 *
 *   node --env-file=.env.local scripts/apply-target-downsize.mjs
 *   node --env-file=.env.local scripts/apply-target-downsize.mjs --apply
 */

import { createClient } from '@supabase/supabase-js';

/** 평형을 내릴 사용자 */
const USER_ID = '26522523-57c5-4bd6-8c20-7df7078685a7';

/**
 * 내릴 목표 — from 은 확인용(지금 저장된 평형), to 가 새 평형이다.
 * price 는 저장하지 않는다. 2026-08-29 기준 그 평형의 최근 실거래가다.
 */
const DOWNSIZE = [
  {
    complexName: '응봉대림1차',
    dong: '응봉동',
    from: 75.5,
    to: 63.2,
    price: 1_780_000_000, // 2025-12-06 · 6개월 내 거래 없음
    stale: true,
  },
  {
    complexName: '시범한신',
    dong: '서현동',
    from: 84.7,
    to: 60,
    price: 1_850_000_000, // 2026-02-02 · 6개월 내 거래 없음
    stale: true,
  },
  {
    complexName: '상록마을(우성)1',
    dong: '정자동',
    from: 85,
    to: 69.1,
    price: 2_050_000_000, // 2026-05-28 · 6개월 4건, 중앙 19.8억
    stale: false,
  },
  {
    complexName: '광장극동2차',
    dong: '광장동',
    from: 84.6,
    to: 75.6,
    price: 2_200_000_000, // 2025-09-25 · 6개월 내 거래 없음
    stale: true,
  },
  {
    complexName: '옥수 현대',
    dong: '옥수동',
    from: 84.9,
    to: 77.3,
    price: 1_830_000_000, // 2025-06-21 · 다만 대표가는 ±3㎡ 안의 75.4㎡ 2026-07-11 거래를 잡는다
    stale: false,
  },
  {
    complexName: '시범한양',
    dong: '서현동',
    from: 84.9,
    to: 59.4,
    price: 1_750_000_000, // 2026-05-29 · 6개월 2건
    stale: false,
  },
];

const apply = process.argv.includes('--apply');

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error(
    'NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 없습니다.\n' +
      '  node --env-file=.env.local scripts/apply-target-downsize.mjs',
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

const log = [];
const missing = [];
let changed = 0;

const nextTargets = oldTargets.map((t) => {
  const want = DOWNSIZE.find((d) => sameComplex(t, d));
  if (!want) return t;

  if (Math.abs((t.areaM2 ?? 0) - want.to) < 0.5) {
    log.push(`유지  ${t.complexName} ${t.areaM2}㎡ — 이미 새 평형`);
    return t;
  }

  changed += 1;
  const item = { ...t, areaM2: want.to };

  /* 평형이 바뀌면 예전 평형에 매겨둔 호가·대지지분은 더 이상 그 집 값이 아니다.
     남겨 두면 실거래가 없을 때 다른 평형 호가로 폴백해 조용히 틀린 값을 쓴다. */
  const dropped = [];
  if (item.manualPrice) {
    dropped.push(`호가 ${eok(item.manualPrice)}`);
    delete item.manualPrice;
  }
  if (item.landShareM2 !== undefined) {
    dropped.push('대지지분');
    delete item.landShareM2;
  }

  /* 이전 평형에서 "실거래 오래됨"으로 자동으로 꺼졌던 기록은 지운다 —
     평형이 바뀌면 판단 근거가 통째로 달라진다. 새 평형 기준으로 다시 보게 둔다. */
  if (item.autoDisabledAt || item.autoDisabledReason) {
    dropped.push('자동 끄기 기록');
    delete item.autoDisabledAt;
    delete item.autoDisabledReason;
  }

  log.push(
    `변경  ${t.complexName} ${want.from}㎡(${pyeong(want.from)}평) → ` +
      `${want.to}㎡(${pyeong(want.to)}평)  최근 실거래 ${eok(want.price)}` +
      (want.stale ? '  ⚠ 6개월 내 거래 없음 (스위치는 켜진 채로 둡니다)' : '') +
      (dropped.length > 0 ? `  · ${dropped.join(', ')} 삭제` : ''),
  );
  return item;
});

// 저장본에 없는 단지를 조용히 넘기지 않는다 — 이름이 어긋난 것일 수 있다
for (const want of DOWNSIZE) {
  if (!oldTargets.some((t) => sameComplex(t, want))) missing.push(want.complexName);
}

console.log(`[${USER_ID}]`);
log.forEach((l) => console.log(`  ${l}`));
if (missing.length > 0) {
  console.error(`\n✖ 저장본에서 찾지 못한 단지: ${missing.join(', ')}`);
  console.error('  이름·동이 어긋났을 수 있습니다. 확인 후 다시 실행하세요.');
  process.exit(1);
}
console.log(
  `\n  ${changed}개 목표의 평형을 내립니다. 예산 상한은 ${eok(config.targetBudgetCap ?? 0)} 그대로입니다.`,
);

if (changed === 0) {
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

/* 대시보드 캐시를 버린다 — 안 버리면 다음 조립까지 이전 평형 기준 화면이 그대로 보인다. */
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
