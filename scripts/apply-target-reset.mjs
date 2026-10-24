/**
 * 2026-09-09 보고서 기준으로 목표 아파트 목록을 통째로 갈아 끼우는 일회성 스크립트.
 *
 * 하는 일
 *  1) 기존 목표를 전부 지운다 (끄는 게 아니라 삭제다 — 사용자가 "전부 지워줘"라고 했다)
 *  2) 아래 TARGETS 14곳을 보고서 순서대로 새로 넣는다
 *  3) targetBudgetCap 을 20억 → 23억으로 올린다
 *
 * 지우기 전에 지금 저장본을 config-history 로 남기므로, 설정 화면의 "이전 내역"에서
 * 예전 14곳(호가·대지지분 입력값 포함)을 되돌릴 수 있다.
 *
 * ── 단지명은 국토부 등록명으로 넣는다 ──────────────────────────────
 * 시세 매칭(filterComplex)이 실거래 신고서의 등록명을 보기 때문이다.
 * 사람이 부르는 이름과 다른 곳은 asKnownAs 에 적어 뒀다 (주석용, 저장하지 않는다).
 *
 * ── 평형은 "예산 안에서 최근 거래가 있는 평형"으로 골랐다 ──────────
 * areaM2 / builtYear / price 는 전부 trade_cache(2024-09~2026-09, 직거래·해제 제외)에서
 * 확인한 값이다. price 는 저장하지 않는다 — 앱이 실거래에서 다시 계산한다.
 * 호가(manualPrice)는 넣지 않는다. 보고서 숫자는 전부 실거래라 호가로 적으면
 * 사람이 직접 확인한 호가와 섞여 근거가 흐려진다.
 *
 * ── 대지지분·용적률은 확인된 값만 넣는다 ──────────────────────────
 * 보고서가 "확인되지 않은 숫자를 채우지 않겠다"고 못박은 항목이다.
 * 지금 저장본에서 같은 단지·같은 평형으로 이미 확인돼 있던 값만 옮겼고
 * (송파한양1차·옥수하이츠), 나머지는 비워 둔다.
 * 송파한양1차의 299.98% 는 정비계획상 계획용적률이라 넣지 않는다 —
 * floorAreaRatio 는 재건축 사업성을 보는 "현황" 용적률 자리다.
 *
 * 기본은 미리보기다. 실제로 저장하려면 --apply 를 붙인다.
 *
 *   node --env-file=.env.local scripts/apply-target-reset.mjs
 *   node --env-file=.env.local scripts/apply-target-reset.mjs --apply
 */

import { createClient } from '@supabase/supabase-js';

/** 목표를 바꿀 사용자 */
const USER_ID = '26522523-57c5-4bd6-8c20-7df7078685a7';

/**
 * 새 예산 상한 (원).
 *
 * 보고서의 매수 구간이 18~23억이고, 일일 관심가도 헬리오시티 23억이 가장 높다.
 * 20억으로 두면 목록의 절반이 상한 경고에 걸려 경고가 의미를 잃는다.
 * 22~23억이 자금상 빡빡하다는 사실은 상한이 아니라 부족액 계산이 알려 준다.
 */
const BUDGET_CAP = 2_300_000_000;

/**
 * 새 목표 — 배열 순서가 곧 우선순위다.
 * 앞 8곳이 준신축, 뒤 6곳이 재건축이며 재건축은 보고서의 "매수 기회" 순서를 따른다
 * (사업진행 순서가 아니다 — 사업이 앞선 곳일수록 기대가 이미 값에 들어가 있다).
 */
const TARGETS = [
  // ── 준신축 8곳 ────────────────────────────────────────────────
  {
    complexName: '센트라스',
    sido: '서울특별시',
    sigungu: '성동구',
    dong: '하왕십리동',
    lawdCd: '11200',
    areaM2: 59.93,
    builtYear: 2016,
    memo: '[준신축] 환금성 최강. 관심가 20.5억 이하',
    price: 2_080_000_000, // 2026-08-13 20.80억 (59.95㎡) · 6개월 중앙 19.9억
  },
  {
    complexName: '텐즈힐(2단지)',
    asKnownAs: '부르는 이름 "텐즈힐2"',
    sido: '서울특별시',
    sigungu: '성동구',
    dong: '상왕십리동',
    lawdCd: '11200',
    areaM2: 84.92,
    builtYear: 2014,
    memo: '[준신축] 가격 대비 면적 최고. 관심가 21.8억 이하 → 강한 관심',
    price: 2_220_000_000, // 2026-08-22 22.20억 · 6개월 5건
  },
  {
    complexName: '텐즈힐(1단지)',
    asKnownAs: '부르는 이름 "텐즈힐1"',
    sido: '서울특별시',
    sigungu: '성동구',
    dong: '하왕십리동',
    lawdCd: '11200',
    areaM2: 84.96,
    builtYear: 2015,
    memo: '[준신축] 대단지+84㎡. 관심가 22.3억 이하',
    price: 2_280_000_000, // 2026-08-19 22.80억 · 6개월 8건
  },
  {
    complexName: '헬리오시티',
    sido: '서울특별시',
    sigungu: '송파구',
    dong: '가락동',
    lawdCd: '11710',
    areaM2: 49.29,
    builtYear: 2018,
    floorAreaRatio: 286,
    totalHouseholds: 9510,
    memo: '[준신축] 예산 내 소형(14.9평)으로 추적. 23억 이하 매물 나오면 센트라스와 1위 비교',
    price: 2_375_000_000, // 2026-04-24 23.75억 · 49.21㎡ 포함 6개월 7건, 23억대 초반
  },
  {
    complexName: '래미안파크팰리스',
    sido: '서울특별시',
    sigungu: '송파구',
    dong: '가락동',
    lawdCd: '11710',
    areaM2: 59.968,
    builtYear: 2007,
    memo: '[준신축] 송파+평지+가격. 관심가 20억 이하',
    price: 2_040_000_000, // 2026-07-11 20.40억 · 6개월 5건 중앙 19.75억
  },
  {
    complexName: '신금호파크자이',
    sido: '서울특별시',
    sigungu: '성동구',
    dong: '금호동2가',
    lawdCd: '11200',
    areaM2: 59.98,
    builtYear: 2016,
    memo: '[준신축] 입지는 좋지만 경사. 19.5억 전후가 아니면 추격 안 함',
    price: 2_090_000_000, // 2026-07-14 20.90억 · 6개월 4건 중앙 20.5억
  },
  {
    complexName: '흑석한강푸르지오',
    sido: '서울특별시',
    sigungu: '동작구',
    dong: '흑석동',
    lawdCd: '11590',
    areaM2: 84.98,
    builtYear: 2012,
    memo: '[준신축] 한강·9호선. 22억 초반이면 재평가',
    price: 2_370_000_000, // 2026-06-20 23.70억 · 6개월 7건 중앙 22.05억
  },
  {
    complexName: '흑석한강센트레빌',
    asKnownAs: '부르는 이름 "흑석한강센트레빌1차" — 2차 등록명은 "흑석한강센트레빌Ⅱ"라 섞이지 않는다',
    sido: '서울특별시',
    sigungu: '동작구',
    dong: '흑석동',
    lawdCd: '11590',
    areaM2: 84.84,
    builtYear: 2011,
    memo: '[준신축] 입지 좋으나 경사. 푸르지오보다 가격 메리트가 명확할 때만',
    price: 2_350_000_000, // 2026-05-25 23.50억 · 6개월 7건
  },

  // ── 재건축 6곳 (보고서의 "매수 기회" 순서) ──────────────────────
  {
    complexName: '명수대현대',
    sido: '서울특별시',
    sigungu: '동작구',
    dong: '흑석동',
    lawdCd: '11590',
    areaM2: 70.2,
    builtYear: 1988,
    memo: '[재건축] 사업성 B+ / 입지·한강 A+ / 가격하락 집중관찰. 21평형 추적',
    price: 2_210_000_000, // 2026-04-17 22.10억 · 78.07㎡는 24.85억으로 상한 초과
  },
  {
    complexName: '극동2',
    asKnownAs: '부르는 이름 "광장극동(2차)" — 1차 등록명은 "극동1", 84.55㎡가 27.0억으로 더 비싸다',
    sido: '서울특별시',
    sigungu: '광진구',
    dong: '광장동',
    lawdCd: '11215',
    areaM2: 84.55,
    builtYear: 1989,
    memo: '[재건축] 사업성 A- / 입지·생활환경 A / 가격하락 집중관찰',
    price: 2_010_000_000, // 2026-08-11 20.10억 · 6개월 7건이나 중앙 24.6억으로 편차 큼
  },
  {
    complexName: '한양아파트',
    asKnownAs: '부르는 이름 "송파한양1차"',
    sido: '서울특별시',
    sigungu: '송파구',
    dong: '송파동',
    lawdCd: '11710',
    areaM2: 64.26,
    builtYear: 1983,
    landShareM2: 71.4, // 이전 저장본에서 같은 평형으로 확인돼 있던 값
    floorAreaRatio: 157, // 현황 용적률. 정비계획상 계획용적률 299.98% 와 혼동 금지
    totalHouseholds: 576, // 정비계획 수정가결로 954세대 예정
    memo: '[재건축] 사업성 A / 입지 A+ / 가격매력 C → 기다림. 서울시 정비계획 수정가결·재공람 완료',
    price: 2_100_000_000, // 2026-07-05 21.00억 · 6개월 7건 중앙 20.9억
  },
  {
    complexName: '올림픽훼밀리타운',
    sido: '서울특별시',
    sigungu: '송파구',
    dong: '문정동',
    lawdCd: '11710',
    areaM2: 84.705,
    builtYear: 1988,
    memo: '[재건축] 환금성 A+ / 현재가격 부담 → 장기 관찰. 최소 평형도 25억대라 상한 초과',
    price: 2_685_000_000, // 2026-08-14 26.85억 · 6개월 14건 중앙 25.0억 — 상한 초과가 정상
  },
  {
    complexName: '한양',
    asKnownAs: '부르는 이름 "자양한양" (자양동 등록명은 그냥 "한양")',
    sido: '서울특별시',
    sigungu: '광진구',
    dong: '자양동',
    lawdCd: '11215',
    areaM2: 107.31,
    builtYear: 1983,
    memo: '[재건축] 익숙한 광진 생활권 A+ / 상급지 이동효과 B → 큰 가격 메리트 필요',
    price: 2_050_000_000, // 2025-09-03 20.50억 · 최소 평형이 32.5평, 6개월 거래 없음
    stale: true,
  },
  {
    complexName: '옥수하이츠',
    sido: '서울특별시',
    sigungu: '성동구',
    dong: '옥수동',
    lawdCd: '11200',
    areaM2: 84.86,
    builtYear: 1998,
    landShareM2: 41.27, // 이전 저장본에서 같은 평형으로 확인돼 있던 값
    floorAreaRatio: 212.9,
    totalHouseholds: 853,
    memo: '[재건축] 입지·한강 A / 경사 C / 생활상권 C+ → 할인 필요',
    price: 2_715_000_000, // 2026-02-24 27.15억 · 6개월 거래 없음, 상한 초과
    stale: true,
  },
];

const apply = process.argv.includes('--apply');

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error(
    'NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 없습니다.\n' +
      '  node --env-file=.env.local scripts/apply-target-reset.mjs',
  );
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });

const eok = (n) => `${(n / 100_000_000).toFixed(2)}억`;
const pyeong = (m2) => (m2 / 3.3058).toFixed(1);

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

const usedIds = new Set();
const nextTargets = TARGETS.map((want, i) => {
  const id = newId(usedIds);
  usedIds.add(id);
  const item = {
    id,
    kind: 'target',
    complexName: want.complexName,
    sido: want.sido,
    sigungu: want.sigungu,
    dong: want.dong,
    lawdCd: want.lawdCd,
    areaM2: want.areaM2,
    builtYear: want.builtYear,
    priority: i + 1,
    enabled: true,
    memo: want.memo,
  };
  if (want.landShareM2) item.landShareM2 = want.landShareM2;
  if (want.floorAreaRatio) item.floorAreaRatio = want.floorAreaRatio;
  if (want.totalHouseholds) item.totalHouseholds = want.totalHouseholds;
  return item;
});

console.log(`[${USER_ID}]\n`);

console.log(`지울 목표 ${oldTargets.length}개`);
for (const t of oldTargets) {
  console.log(
    `  삭제  ${t.priority}. ${t.complexName} ${t.areaM2}㎡ (${t.sigungu} ${t.dong})` +
      (t.manualPrice ? ` — 호가 ${eok(t.manualPrice)} 함께 사라짐` : ''),
  );
}

console.log(`\n새 목표 ${nextTargets.length}개`);
TARGETS.forEach((want, i) => {
  const overCap = want.price > BUDGET_CAP;
  console.log(
    `  ${String(i + 1).padStart(2)}. ${want.complexName} ${want.areaM2}㎡(${pyeong(want.areaM2)}평)` +
      ` ${want.sigungu} ${want.dong} · ${want.builtYear}년 · 최근 ${eok(want.price)}` +
      (overCap ? ' ⚠상한초과' : '') +
      (want.stale ? ' ⚠6개월 거래없음' : ''),
  );
});

console.log(`\n  예산 상한: ${eok(config.targetBudgetCap ?? 0)} → ${eok(BUDGET_CAP)}`);

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

/* 덮어쓰기 전에 지금 저장본을 히스토리로 남긴다 — 목록을 통째로 지우는 작업이라
   되돌릴 길이 여기밖에 없다. 앱의 저장 경로와 같은 형식을 쓴다. */
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
