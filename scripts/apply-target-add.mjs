/**
 * 목표 목록에 단지를 끼워 넣는 일회성 스크립트 (2026-09-09 첫 추가, 2026-10-25 두 번째 추가).
 *
 * REMOVE 목록을 지우고 ADD 목록을 지정한 자리에 넣은 뒤 우선순위를 다시 매긴다.
 * (목록 전체를 갈아 끼우는 건 scripts/apply-target-reset.mjs 쪽이다.)
 *
 * 자리는 순번이 아니라 `insertAfter`(그 단지 바로 뒤)로 지정한다 —
 * 앞에서 한 곳을 넣으면 뒤 순번이 밀리므로 숫자로 적으면 어긋난다. 없으면 맨 뒤에 붙는다.
 * 같은 단지가 이미 있으면 새로 넣지 않고 평형(areaM2)만 바꾼다.
 *
 * ── 평형은 "예산 상한 안에서 최근 거래가 있는 평형"으로 골랐다 ──────
 * trade_cache(2024-09~2026-09, 직거래·해제 제외) 기준이며 price 는 저장하지 않는다.
 *
 * 기본은 미리보기다. 실제로 저장하려면 --apply 를 붙인다.
 *
 *   node --env-file=.env.local scripts/apply-target-add.mjs
 *   node --env-file=.env.local scripts/apply-target-add.mjs --apply
 */

import { createClient } from '@supabase/supabase-js';

/** 목표를 바꿀 사용자 */
const USER_ID = '26522523-57c5-4bd6-8c20-7df7078685a7';

/**
 * 목록에서 아예 지울 단지 (2026-10-25 사용자 요청 — 끄는 게 아니라 삭제).
 * 이름(공백·괄호 무시)과 법정동이 둘 다 맞아야 지운다 —
 * 송파동 "한양아파트"와 자양동 "한양"을 헷갈리지 않게.
 */
const REMOVE = [
  { complexName: '센트라스', dong: '하왕십리동' },
  { complexName: '텐즈힐(2단지)', dong: '상왕십리동' },
  { complexName: '텐즈힐(1단지)', dong: '하왕십리동' },
  { complexName: '헬리오시티', dong: '가락동' },
  { complexName: '신금호파크자이', dong: '금호동2가' },
  { complexName: '흑석한강푸르지오', dong: '흑석동' },
  { complexName: '흑석한강센트레빌', dong: '흑석동' },
  { complexName: '한양아파트', dong: '송파동' }, // 송파한양1차
];

const ADD = [
  /* 2026-10-25 추가분. 자리는 목록 맨 뒤. 평형은 23억 상한 안팎에서 거래가 꾸준한 30평형대로 골랐다. */
  {
    /* trade_cache 에 수정구는 2026-07 부터만 있어 국토부 API 로 2025-01~2026-06 을 따로 확인했다.
       평형별 최근: 51.89㎡ 16.35억(6/4) / 59.83㎡ 18.7억(5/18) / 74.99㎡ 19.5억(5/25) /
       84.94㎡ 22.0억(5/28)·22.6억(5/2). 74.99 가 핵심 구간(20~21.5억) 아래라 이걸로 잡는다. */
    complexName: '위례센트럴자이',
    sido: '경기도',
    sigungu: '성남시 수정구',
    dong: '창곡동',
    lawdCd: '41131',
    areaM2: 74.99,
    builtYear: 2017,
    memo: '[준신축] 위례 창곡동·74.99㎡. 최근 19.5억(2026-05-25). 84.94㎡는 22.0~22.6억',
    price: 1_950_000_000, // 2026-05-25
  },
  {
    /* 84.99㎡ 22.8억(7/22)·21.7억(8/15). ±3㎡ 창이라 84.93㎡ 타입도 함께 잡힌다. */
    complexName: '시범한양',
    asKnownAs: '서현역 시범단지 한양',
    sido: '경기도',
    sigungu: '성남시 분당구',
    dong: '서현동',
    lawdCd: '41135',
    areaM2: 84.99,
    builtYear: 1991,
    memo: '[재건축] 분당 서현동·84.99㎡. 최근 21.7억(2026-08-15)',
    price: 2_170_000_000, // 2026-08-15
  },
  {
    /* 부르는 이름 "시범삼성한신"은 국토부에 "시범삼성"과 "시범한신" 두 이름으로 나뉘어 신고된다(같은 지번 87).
       한 단지를 두 줄로 넣으면 갭·브리핑이 두 번 세므로, 84.69㎡ 거래가 훨씬 많은 "시범한신" 한 줄로 추적한다.
       84.69㎡ 최근 23.8억(10/22)·23.3억(9/23) — 상한 23억을 살짝 넘는다. */
    complexName: '시범한신',
    asKnownAs: '부르는 이름 "시범삼성한신" (삼성 쪽 등록명은 "시범삼성")',
    sido: '경기도',
    sigungu: '성남시 분당구',
    dong: '서현동',
    lawdCd: '41135',
    areaM2: 84.69,
    builtYear: 1991,
    memo: '[재건축] 분당 서현동 시범삼성한신·84.69㎡. 최근 23.8억(2026-10-22)으로 상한 초과. 등록명은 시범한신/시범삼성으로 갈림',
    price: 2_380_000_000, // 2026-10-22
  },
];

const apply = process.argv.includes('--apply');

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error(
    'NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 없습니다.\n' +
      '  node --env-file=.env.local scripts/apply-target-add.mjs',
  );
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });

const eok = (n) => `${(n / 100_000_000).toFixed(2)}억`;

/** 같은 단지인지 — 공백·괄호를 무시하고 이름으로 본다 */
const norm = (s) =>
  String(s ?? '')
    .replace(/\s+/g, '')
    .replace(/[()（）]/g, '')
    .toLowerCase();

/** 기존 id 형식(8자 소문자+숫자)에 맞춘 새 id */
function newId(existing) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  for (;;) {
    let id = '';
    for (let i = 0; i < 8; i += 1) id += chars[Math.floor(Math.random() * chars.length)];
    if (!existing.has(id)) return id;
  }
}

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
const oldTargets = [...(config.targets ?? [])].sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));

const usedIds = new Set(oldTargets.map((t) => t.id));
const isRemoved = (t) =>
  REMOVE.some((r) => norm(r.complexName) === norm(t.complexName) && r.dong === t.dong);
const removed = oldTargets.filter(isRemoved);
if (removed.length !== REMOVE.length) {
  console.error(`✖ 지울 단지 ${REMOVE.length}곳 중 ${removed.length}곳만 찾았습니다. 중단합니다.`);
  process.exit(1);
}
const nextTargets = oldTargets.filter((t) => !isRemoved(t)).map((t) => ({ ...t }));
const newIds = new Set();

for (const want of ADD) {
  /* 이미 있으면 넣지 않는다 — 같은 단지가 두 줄이면 갭·브리핑이 두 번 센다 */
  const dup = nextTargets.find(
    (t) => norm(t.complexName) === norm(want.complexName) && t.dong === want.dong,
  );
  if (dup) {
    console.log(`↻ 이미 목표에 있어 평형만 바꿉니다: ${dup.complexName} ${dup.areaM2}㎡ → ${want.areaM2}㎡`);
    dup.areaM2 = want.areaM2;
    continue;
  }

  const anchor = want.insertAfter
    ? nextTargets.findIndex((t) => norm(t.complexName) === norm(want.insertAfter))
    : nextTargets.length - 1;
  if (anchor < 0) {
    console.error(`✖ 기준 단지 "${want.insertAfter}" 를 찾지 못했습니다. 중단합니다.`);
    process.exit(1);
  }

  const id = newId(usedIds);
  usedIds.add(id);
  newIds.add(id);
  nextTargets.splice(anchor + 1, 0, {
    id,
    kind: 'target',
    complexName: want.complexName,
    sido: want.sido,
    sigungu: want.sigungu,
    dong: want.dong,
    lawdCd: want.lawdCd,
    areaM2: want.areaM2,
    builtYear: want.builtYear,
    priority: 0, // 아래에서 다시 매긴다
    enabled: true,
    memo: want.memo,
  });
}

nextTargets.forEach((t, i) => {
  t.priority = i + 1;
});

console.log(`[${USER_ID}]\n`);
console.log(`목표 ${oldTargets.length}개 → ${nextTargets.length}개`);
for (const t of removed) console.log(`  삭제    ${t.priority}. ${t.complexName} ${t.areaM2}㎡ (${t.sigungu} ${t.dong})`);
for (const t of nextTargets) {
  const isNew = newIds.has(t.id);
  const before = oldTargets.find((o) => o.id === t.id);
  const moved = before && before.priority !== t.priority ? ` (${before.priority}→${t.priority})` : '';
  const info = ADD.find((a) => norm(a.complexName) === norm(t.complexName));
  console.log(
    `  ${isNew ? '신규' : '    '} ${String(t.priority).padStart(2)}. ${t.complexName} ${t.areaM2}㎡ (${t.sigungu} ${t.dong})${moved}` +
      (isNew && info ? ` · ${info.builtYear}년 · 최근 ${eok(info.price)}` : ''),
  );
}
console.log(`\n  예산 상한 ${eok(config.targetBudgetCap ?? 0)} — 바꾸지 않는다`);

if (!apply) {
  console.log('\n미리보기입니다. 실제로 저장하려면 --apply 를 붙여 다시 실행하세요.');
  process.exit(0);
}

const updated = {
  ...config,
  targets: nextTargets,
  updatedAt: new Date().toISOString(),
};

/* 덮어쓰기 전에 지금 저장본을 히스토리로 남긴다 — 설정 화면의 "이전 내역"에서 되돌릴 수 있게. */
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

/* 대시보드 캐시를 버린다 — 안 버리면 다음 조립까지 이전 목표 목록 기준 화면이 그대로 보인다. */
const { error: cacheError } = await db
  .from('dashboard_snapshot')
  .delete()
  .eq('payload->>kind', 'dashboard-cache')
  .eq('payload->>userId', USER_ID);
console.log(
  cacheError ? `⚠ 대시보드 캐시 무효화 실패: ${cacheError.message}` : '✔ 대시보드 캐시를 비웠습니다.',
);
