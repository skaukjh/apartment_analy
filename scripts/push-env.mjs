/**
 * .env.local 의 값을 Vercel 환경변수로 한 번에 올린다.
 *
 * 대시보드에서 하나씩 붙여넣는 것보다 빠르고, 오타가 나지 않는다.
 *
 * 사용법:
 *   1) .env.local 에 키를 채운다 (.env.example 참고)
 *   2) node scripts/push-env.mjs            → 무엇이 올라갈지 미리보기
 *   3) node scripts/push-env.mjs --apply    → 실제 등록
 *
 * 옵션:
 *   --apply            실제로 등록 (없으면 미리보기만)
 *   --env=production   대상 환경 (기본: production,preview,development)
 *   --only=A,B         지정한 키만
 *   --force            이미 있는 값을 지우고 다시 등록
 */

import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envFile = path.join(root, '.env.local');

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const force = args.includes('--force');
const targets = (args.find((a) => a.startsWith('--env='))?.split('=')[1] ??
  'production,preview,development')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const only = args
  .find((a) => a.startsWith('--only='))
  ?.split('=')[1]
  ?.split(',')
  .map((s) => s.trim());

if (!existsSync(envFile)) {
  console.error(`.env.local 이 없습니다: ${envFile}`);
  console.error('.env.example 을 복사해 값을 채우세요.');
  process.exit(1);
}

/** Vercel 이 자동 주입하는 값은 올리면 안 된다 */
const SKIP = new Set([
  'VERCEL_OIDC_TOKEN',
  'VERCEL',
  'VERCEL_ENV',
  'VERCEL_URL',
  'VERCEL_REGION',
  'NX_DAEMON',
  'TURBO_',
]);

const entries = [];
for (const rawLine of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
  const line = rawLine.trim();
  if (!line || line.startsWith('#')) continue;
  const eq = line.indexOf('=');
  if (eq <= 0) continue;

  const key = line.slice(0, eq).trim();
  // 따옴표로 감싼 값은 벗겨낸다
  const value = line
    .slice(eq + 1)
    .trim()
    .replace(/^["'](.*)["']$/s, '$1');

  if (!value) continue; // 빈 값은 건너뛴다
  if (SKIP.has(key) || [...SKIP].some((p) => p.endsWith('_') && key.startsWith(p))) continue;
  if (only && !only.includes(key)) continue;

  entries.push({ key, value });
}

if (entries.length === 0) {
  console.error('.env.local 에 올릴 값이 없습니다. 키를 채웠는지 확인하세요.');
  process.exit(1);
}

const mask = (v) => (v.length <= 8 ? '*'.repeat(v.length) : `${v.slice(0, 4)}…${v.slice(-3)}`);

console.log(`대상 환경: ${targets.join(', ')}`);
console.log(`올릴 항목 ${entries.length}개:\n`);
for (const { key, value } of entries) console.log(`  ${key.padEnd(32)} ${mask(value)}`);

if (!apply) {
  console.log('\n미리보기입니다. 실제로 올리려면 --apply 를 붙이세요.');
  process.exit(0);
}

console.log('\n등록 중…\n');
let ok = 0;
let failed = 0;

for (const { key, value } of entries) {
  for (const target of targets) {
    try {
      if (force) {
        try {
          execFileSync('cmd', ['/c', `vercel env rm ${key} ${target} --yes`], { stdio: 'ignore' });
        } catch {
          /* 없으면 그냥 넘어간다 */
        }
      }
      // 값에 개행이 없다는 전제로 stdin 을 통해 넘긴다
      execFileSync('cmd', ['/c', `vercel env add ${key} ${target}`], {
        input: value,
        stdio: ['pipe', 'ignore', 'pipe'],
      });
      console.log(`  ✓ ${key} → ${target}`);
      ok += 1;
    } catch (e) {
      const msg = String(e.stderr ?? e.message);
      if (/already exists/i.test(msg)) {
        console.log(`  · ${key} → ${target} (이미 있음, --force 로 덮어쓰기)`);
      } else {
        console.log(`  ✗ ${key} → ${target}: ${msg.split('\n')[0].slice(0, 90)}`);
        failed += 1;
      }
    }
  }
}

console.log(`\n완료: ${ok}건 등록${failed > 0 ? `, ${failed}건 실패` : ''}`);
console.log('배포에 반영하려면: vercel deploy --prod  (또는 git push)');
