/**
 * 목표 아파트 목록을 지정한 7곳으로 바꾸고, 예산 상한(25억)을 설정하는 일회성 스크립트.
 *
 * 하는 일
 *  1) 아래 KEEP 목록의 단지를 목표로 켠다 (없으면 새로 넣고, 있으면 평형·우선순위만 고친다)
 *  2) 그 외 목표는 전부 끈다 — 지우지 않으므로 입력값은 남고 언제든 다시 켤 수 있다
 *  3) targetBudgetCap 을 설정한다. 넘어서면 홈 화면이 경고하고 더 작은 평형을 제안한다
 *
 * 평형은 "전용 84~85㎡ 우선, 없으면 바로 아래"로 고르고, 전부 상한 이하인 것을
 * 국토부 실거래(최근 실거래가 = 앱의 대표가)로 확인한 값이다.
 *
 * complexName 은 **국토부 등록명 기준**으로 넣는다. 시세 매칭이 등록명을 쓰기 때문이다.
 * 사람이 부르는 이름과 다른 곳은 asKnownAs 에 적어 뒀다 (주석용, 저장하지 않는다).
 *
 * 기본은 미리보기다. 실제로 저장하려면 --apply 를 붙인다.
 *
 *   node --env-file=.env.local scripts/apply-target-list.mjs
 *   node --env-file=.env.local scripts/apply-target-list.mjs --apply
 */

import { createClient } from '@supabase/supabase-js';

/** 목표를 바꿀 사용자 */
const USER_ID = '26522523-57c5-4bd6-8c20-7df7078685a7';

/** 목표 아파트 예산 상한 (원) */
const BUDGET_CAP = 2_500_000_000;

/**
 * 켤 목표 — 사용자가 부른 순서가 곧 우선순위다.
 * price 는 저장하지 않는다. 확인용으로 적어 둔 2026-08-27 기준 최근 실거래가다.
 */
const KEEP = [
  {
    complexName: '송파한양1차',
    asKnownAs: '등록명 "한양아파트"',
    sido: '서울특별시',
    sigungu: '송파구',
    dong: '송파동',
    lawdCd: '11710',
    areaM2: 64.3,
    builtYear: 1983,
    price: 2_100_000_000, // 84㎡대가 없어 그 아래 평형
  },
  {
    complexName: '응봉대림1차',
    asKnownAs: '등록명 "대림(1차)"',
    sido: '서울특별시',
    sigungu: '성동구',
    dong: '응봉동',
    lawdCd: '11200',
    areaM2: 75.5,
    builtYear: 1986,
    price: 2_050_000_000, // 84㎡대가 없어 그 아래 평형
  },
  {
    complexName: '시범한신',
    asKnownAs: '부르는 이름 "삼성한신(서현)" — 국토부는 시범삼성·시범한신으로 나눠 신고',
    sido: '경기도',
    sigungu: '성남시 분당구',
    dong: '서현동',
    lawdCd: '41135',
    areaM2: 84.7,
    builtYear: 1991,
    price: 2_150_000_000,
  },
  {
    complexName: '상록마을(우성)1',
    asKnownAs: '부르는 이름 "상록우성(정자)"',
    sido: '경기도',
    sigungu: '성남시 분당구',
    dong: '정자동',
    lawdCd: '41135',
    areaM2: 85,
    builtYear: 1994,
    price: 2_380_000_000,
  },
  {
    complexName: '광장극동2차',
    asKnownAs: '등록명 "극동2"',
    sido: '서울특별시',
    sigungu: '광진구',
    dong: '광장동',
    lawdCd: '11215',
    areaM2: 84.6,
    builtYear: 1989,
    price: 2_010_000_000,
  },
  {
    complexName: '옥수 현대',
    asKnownAs: '등록명 "현대"(옥수동)',
    sido: '서울특별시',
    sigungu: '성동구',
    dong: '옥수동',
    lawdCd: '11200',
    areaM2: 84.9,
    builtYear: 1990,
    price: 2_080_000_000,
  },
  {
    complexName: '시범한양',
    asKnownAs: '부르는 이름 "시범한양(서현)"',
    sido: '경기도',
    sigungu: '성남시 분당구',
    dong: '서현동',
    lawdCd: '41135',
    areaM2: 84.9,
    builtYear: 1991,
    price: 2_280_000_000,
  },
];

const apply = process.argv.includes('--apply');

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 없습니다.');
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });

const eok = (n) => `${(n / 100_000_000).toFixed(2)}억`;

/** 같은 단지인지 — 공백·괄호를 무시하고 이름과 동으로 본다 */
const norm = (s) =>
  String(s ?? '')
    .replace(/\s+/g, '')
    .replace(/[()（）]/g, '')
    .toLowerCase();

const sameComplex = (a, b) => norm(a.complexName) === norm(b.complexName) && a.dong === b.dong;

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
const oldTargets = config.targets ?? [];
const usedIds = new Set(oldTargets.map((t) => t.id));

const nextTargets = [];
const log = [];

// 1) 켤 목표 — 기존 항목이 있으면 그 위에 덮어쓴다 (호가·대지지분 등 입력값 보존)
KEEP.forEach((want, i) => {
  const found = oldTargets.find((t) => sameComplex(t, want));
  const priority = i + 1;

  if (found) {
    /* 0.5㎡ 미만 차이는 같은 평형으로 본다 — 64.26 과 64.3 은 표기 차이일 뿐이라
       "평형을 바꿨다"고 보고 호가까지 지우면 멀쩡한 입력값이 날아간다. */
    const areaChanged = Math.abs((found.areaM2 ?? 0) - want.areaM2) >= 0.5;

    const changes = [];
    if (found.areaM2 !== want.areaM2) changes.push(`평형 ${found.areaM2}→${want.areaM2}㎡`);
    if (found.enabled === false) changes.push('켜기');
    if (found.priority !== priority) changes.push(`우선순위 ${found.priority}→${priority}`);

    const item = {
      ...found,
      areaM2: want.areaM2,
      enabled: true,
      priority,
      builtYear: found.builtYear ?? want.builtYear,
    };
    /* 자동 비활성화 기록은 지운다 — 사람이 방금 다시 켠 것이므로
       다음 조립이 "이미 자동으로 꺼 봤다"고 판단하면 안 된다. */
    delete item.autoDisabledAt;
    delete item.autoDisabledReason;

    /* 평형이 바뀌면 예전 평형에 매겨둔 호가는 더 이상 그 집 값이 아니다.
       남겨 두면 실거래가 없을 때 다른 평형 호가로 폴백해 조용히 틀린 값을 쓴다. */
    if (areaChanged && item.manualPrice) {
      changes.push(`호가 ${eok(item.manualPrice)} 삭제(평형 변경)`);
      delete item.manualPrice;
      delete item.landShareM2;
      delete item.totalHouseholds;
      delete item.floorAreaRatio;
    }

    nextTargets.push(item);
    log.push(
      `유지  ${priority}. ${want.complexName} ${want.areaM2}㎡` +
        (changes.length > 0 ? `  — ${changes.join(', ')}` : '  — 변경 없음'),
    );
  } else {
    const id = newId(usedIds);
    usedIds.add(id);
    nextTargets.push({
      id,
      kind: 'target',
      complexName: want.complexName,
      sido: want.sido,
      sigungu: want.sigungu,
      dong: want.dong,
      lawdCd: want.lawdCd,
      areaM2: want.areaM2,
      builtYear: want.builtYear,
      priority,
      enabled: true,
    });
    log.push(`신규  ${priority}. ${want.complexName} ${want.areaM2}㎡ (${want.sigungu} ${want.dong})`);
  }
});

// 2) 나머지는 전부 끈다
let offPriority = KEEP.length;
for (const t of oldTargets) {
  if (nextTargets.some((n) => n.id === t.id)) continue;
  offPriority += 1;
  nextTargets.push({ ...t, enabled: false, priority: offPriority });
  log.push(`끄기  ${t.complexName} ${t.areaM2}㎡`);
}

console.log(`[${USER_ID}]`);
log.forEach((l) => console.log(`  ${l}`));
console.log(`\n  예산 상한: ${eok(config.targetBudgetCap ?? 0)} → ${eok(BUDGET_CAP)}`);
console.log(`  목표 ${oldTargets.length}개 → ${nextTargets.length}개 (켜짐 ${KEEP.length}개)`);

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

/* 대시보드 캐시를 버린다 — 안 버리면 다음 조립까지 이전 목표 목록 기준 화면이 그대로 보인다. */
const { error: cacheError } = await db
  .from('dashboard_snapshot')
  .delete()
  .eq('payload->>kind', 'dashboard-cache')
  .eq('payload->>userId', USER_ID);
console.log(
  cacheError ? `⚠ 대시보드 캐시 무효화 실패: ${cacheError.message}` : '✔ 대시보드 캐시를 비웠습니다.',
);
