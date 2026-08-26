/**
 * 저장된 목표 아파트의 on/off 스위치를 손보는 일회성 스크립트.
 *
 *  1) 레거시 `excluded` 필드를 `enabled` 로 옮긴다 (앱은 읽을 때 자동 변환하지만,
 *     저장본에 두 필드가 함께 남아 있으면 어느 쪽이 참인지 헷갈린다).
 *  2) 지정한 단지의 스위치를 끈다. 지우지 않으므로 취득가·면적 입력은 그대로 남고
 *     설정 화면에서 언제든 다시 켤 수 있다.
 *
 * 최근 실거래가 오래된 단지는 여기서 끄지 않는다 — 그건 대시보드 조립이
 * (lib/analysis/target-pool.ts) 사유를 남기며 자동으로 처리한다.
 *
 * 기본은 미리보기다. 실제로 저장하려면 --apply 를 붙인다.
 *
 *   node --env-file=.env.local scripts/apply-target-tweaks.mjs
 *   node --env-file=.env.local scripts/apply-target-tweaks.mjs --apply
 */

import { createClient } from '@supabase/supabase-js';

/** 스위치를 끌 단지 이름 */
const DISABLE_NAMES = ['옥수삼성', '수서신동아', '옥수파크힐스'];

const apply = process.argv.includes('--apply');

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error(
    'NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 없습니다.\n' +
      '  node --env-file=.env.local scripts/apply-target-tweaks.mjs',
  );
  process.exit(1);
}

const db = createClient(url, key, { auth: { persistSession: false } });

/** 이름 비교용 정규화 — 공백·괄호·아파트 접미어를 떼고 본다 */
const norm = (s) =>
  String(s ?? '')
    .replace(/\s+/g, '')
    .replace(/\(.*?\)/g, '')
    .replace(/아파트$/, '');

const matches = (a, b) => {
  const x = norm(a);
  const y = norm(b);
  return x.length > 0 && y.length > 0 && (x.includes(y) || y.includes(x));
};

const { data: rows, error } = await db.from('user_config').select('id, data');
if (error) {
  console.error(`user_config 조회 실패: ${error.message}`);
  process.exit(1);
}

let changedRows = 0;

for (const row of rows ?? []) {
  const config = row.data;
  const targets = config?.targets ?? [];
  if (targets.length === 0) continue;

  const changes = [];
  const next = targets.map((t) => {
    const item = { ...t };

    // 1) 레거시 필드 이관
    if (item.excluded !== undefined) {
      if (item.enabled === undefined) item.enabled = item.excluded !== true;
      delete item.excluded;
      changes.push(`이관  ${t.complexName} — excluded → enabled=${item.enabled}`);
    }

    // 2) 지정 단지 끄기
    if (DISABLE_NAMES.some((name) => matches(t.complexName, name)) && item.enabled !== false) {
      item.enabled = false;
      changes.push(`끄기  ${t.complexName} ${t.areaM2}㎡`);
    }

    return item;
  });

  if (changes.length === 0) continue;
  changedRows += 1;
  console.log(`\n[${row.id}]`);
  changes.forEach((c) => console.log(`  ${c}`));

  if (apply) {
    const updated = { ...config, targets: next, updatedAt: new Date().toISOString() };

    /* 덮어쓰기 전에 지금 저장본을 히스토리로 남긴다 — 설정 화면의 "이전 내역"에서
       카드 단위로 되돌릴 수 있게 하려는 것으로, 앱의 저장 경로와 같은 형식을 쓴다. */
    const { error: historyError } = await db.from('dashboard_snapshot').insert({
      captured_at: new Date().toISOString(),
      payload: {
        kind: 'config-history',
        userId: row.id,
        savedAt: config?.updatedAt ?? new Date().toISOString(),
        config,
      },
    });
    if (historyError) {
      console.error(`  ✖ 이전 내역 저장 실패로 중단합니다: ${historyError.message}`);
      process.exitCode = 1;
      continue;
    }

    const { error: saveError } = await db
      .from('user_config')
      .update({ data: updated, updated_at: updated.updatedAt })
      .eq('id', row.id);
    if (saveError) {
      console.error(`  ✖ 저장 실패: ${saveError.message}`);
      process.exitCode = 1;
    } else {
      console.log('  ✔ 저장했습니다.');
      /* 대시보드 캐시(최대 65분)를 버린다 — 안 버리면 다음 tick 까지
         갭·시세가 이전 목표 목록 기준으로 그대로 보인다. */
      const { error: cacheError } = await db
        .from('dashboard_snapshot')
        .delete()
        .eq('payload->>kind', 'dashboard-cache')
        .eq('payload->>userId', row.id);
      console.log(
        cacheError
          ? `  ⚠ 대시보드 캐시 무효화 실패: ${cacheError.message}`
          : '  ✔ 대시보드 캐시를 비웠습니다.',
      );
    }
  }
}

if (changedRows === 0) {
  console.log('바꿀 항목이 없습니다.');
} else if (!apply) {
  console.log('\n미리보기입니다. 실제로 저장하려면 --apply 를 붙여 다시 실행하세요.');
}
