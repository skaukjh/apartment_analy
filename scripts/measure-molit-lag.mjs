/**
 * 국토부 실거래가 OpenAPI 반영 주기 측정.
 *
 * ── 왜 필요한가 ──────────────────────────────────────────────────
 * 우리가 쓰는 공공데이터포털 OpenAPI 는 국토부 실거래가 공개시스템보다 늦게
 * 갱신된다. 그런데 "얼마나" 늦는지, "언제" 들어오는지는 공개돼 있지 않다.
 * 갱신 간격을 1시간으로 할지 3시간으로 할지는 이 답에 달려 있는데,
 * 지금까지는 관측 1건으로 짐작만 했다.
 *
 * 이 스크립트는 같은 (시군구, 월)을 반복 조회하며 "새로 나타난 거래"를
 * 발견 시각과 함께 기록한다. 하루만 돌려도 다음이 드러난다:
 *   - 하루 몇 번 반영되는가 (정해진 배치인가, 수시인가)
 *   - 몇 시에 들어오는가 (발견 시각 히스토그램)
 *   - 계약일로부터 며칠 만에 공개되는가 (신고 지연)
 *
 * ── 쓰는 법 ─────────────────────────────────────────────────────
 *   node scripts/measure-molit-lag.mjs            # 30분 간격으로 계속
 *   node scripts/measure-molit-lag.mjs --once     # 한 번만 찍고 종료
 *   node scripts/measure-molit-lag.mjs --interval 15
 *   node scripts/measure-molit-lag.mjs --report   # 이 PC 에 쌓인 기록만 요약
 *   node scripts/measure-molit-lag.mjs --remote   # 서버(tick)가 모은 기록을 요약
 *
 * 평소에는 --remote 만 쓰면 된다. 같은 관측을 서버의 tick 이 30분마다 하고
 * 있어서 PC 를 꺼 두어도 계속 쌓인다. 이 스크립트를 직접 돌리는 건
 * 더 촘촘한 간격으로 보고 싶을 때뿐이다.
 *
 * 기록은 scripts/.molit-lag/ 에 쌓인다 (state.json = 본 거래, events.jsonl = 발견 이력).
 * 호출량은 지역 수 × 2개월 × (60/간격) × 24 이며, 기본값 기준 하루 288건이다.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT_DIR = path.join(HERE, '.molit-lag');
const STATE_FILE = path.join(OUT_DIR, 'state.json');
const EVENTS_FILE = path.join(OUT_DIR, 'events.jsonl');

/** 관측 대상 — 사용자가 실제로 보는 지역. 거래가 꾸준히 있어야 신호가 잡힌다. */
const REGIONS = [
  { lawdCd: '11215', name: '광진구' },
  { lawdCd: '11710', name: '송파구' },
  { lawdCd: '11200', name: '성동구' },
];

const ENDPOINT =
  'https://apis.data.go.kr/1613000/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade';

/* ------------------------------------------------------------------ */
/* 유틸                                                                */
/* ------------------------------------------------------------------ */

function readServiceKey() {
  const envPath = path.join(ROOT, '.env.local');
  if (!fs.existsSync(envPath)) {
    throw new Error('.env.local 을 찾지 못했습니다. 프로젝트 루트에서 실행하세요.');
  }
  const line = fs
    .readFileSync(envPath, 'utf8')
    .split(/\r?\n/)
    .find((l) => l.startsWith('DATA_GO_KR_SERVICE_KEY='));
  if (!line) throw new Error('.env.local 에 DATA_GO_KR_SERVICE_KEY 가 없습니다.');
  return line.slice('DATA_GO_KR_SERVICE_KEY='.length).trim().replace(/^["']|["']$/g, '');
}

/** KST 기준 시각 문자열 */
function kstNow() {
  return new Date(Date.now() + 9 * 3600_000).toISOString().replace('T', ' ').slice(0, 19);
}

function kstHour() {
  return new Date(Date.now() + 9 * 3600_000).getUTCHours();
}

/** 최근 n개월 YYYYMM (KST 기준) */
function recentMonths(n) {
  const d = new Date(Date.now() + 9 * 3600_000);
  const out = [];
  for (let i = n - 1; i >= 0; i -= 1) {
    const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1));
    out.push(`${m.getUTCFullYear()}${String(m.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

/* XML 은 태그가 단순해 인덱스로 자른다 — 정규식보다 빠르고 이스케이프 사고가 없다 */
function pick(s, tag) {
  const a = s.indexOf(`<${tag}>`);
  if (a < 0) return '';
  const b = s.indexOf(`</${tag}>`, a);
  return s.slice(a + tag.length + 2, b).trim();
}

function itemsOf(xml) {
  const out = [];
  let i = 0;
  for (;;) {
    const a = xml.indexOf('<item>', i);
    if (a < 0) break;
    const b = xml.indexOf('</item>', a);
    out.push(xml.slice(a + 6, b));
    i = b + 7;
  }
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ */
/* 조회                                                                */
/* ------------------------------------------------------------------ */

async function fetchDeals(key, lawdCd, ym) {
  const url =
    `${ENDPOINT}?serviceKey=${encodeURIComponent(key)}` +
    `&LAWD_CD=${lawdCd}&DEAL_YMD=${ym}&pageNo=1&numOfRows=1000`;
  // 측정이므로 캐시를 타면 안 된다 — 매번 원본을 본다
  const res = await fetch(url, { cache: 'no-store', headers: { Accept: 'application/xml' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const xml = await res.text();

  const code = pick(xml, 'resultCode') || pick(xml, 'returnReasonCode');
  if (code && code !== '00' && code !== '000') {
    if (code === '03' || code === '3') return [];
    throw new Error(`API 오류 ${code}: ${pick(xml, 'resultMsg')}`);
  }

  return itemsOf(xml)
    .filter((it) => pick(it, 'cdealType') !== 'O')
    .map((it) => ({
      dealDate: `${pick(it, 'dealYear')}-${pick(it, 'dealMonth').padStart(2, '0')}-${pick(it, 'dealDay').padStart(2, '0')}`,
      dong: pick(it, 'umdNm'),
      name: pick(it, 'aptNm'),
      areaM2: pick(it, 'excluUseAr'),
      floor: pick(it, 'floor'),
      amount: pick(it, 'dealAmount').replace(/[,\s]/g, ''),
    }));
}

const keyOf = (lawdCd, d) =>
  `${lawdCd}|${d.dealDate}|${d.dong}|${d.name}|${d.areaM2}|${d.floor}|${d.amount}`;

/* ------------------------------------------------------------------ */
/* 상태                                                                */
/* ------------------------------------------------------------------ */

function loadState() {
  if (!fs.existsSync(STATE_FILE)) return { seen: {}, firstRunAt: null };
  return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
}

function saveState(state) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state));
}

function appendEvents(events) {
  if (events.length === 0) return;
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.appendFileSync(EVENTS_FILE, events.map((e) => JSON.stringify(e)).join('\n') + '\n');
}

/* ------------------------------------------------------------------ */
/* 한 번 관측                                                          */
/* ------------------------------------------------------------------ */

async function runOnce(key) {
  const state = loadState();
  const first = state.firstRunAt === null;
  if (first) state.firstRunAt = kstNow();

  const months = recentMonths(2);
  const found = [];
  const errors = [];

  for (const region of REGIONS) {
    for (const ym of months) {
      try {
        const deals = await fetchDeals(key, region.lawdCd, ym);
        for (const d of deals) {
          const k = keyOf(region.lawdCd, d);
          if (state.seen[k]) continue;
          state.seen[k] = 1;
          // 첫 실행은 기존 재고를 전부 "신규"로 보므로 이벤트로 남기지 않는다
          if (!first) found.push({ region: region.name, ym, ...d });
        }
      } catch (e) {
        errors.push(`${region.name} ${ym}: ${e.message}`);
      }
      await sleep(200); // 초당 요청 제한 회피
    }
  }

  const at = kstNow();
  const events = found.map((f) => ({
    detectedAt: at,
    detectedHour: kstHour(),
    lagDays: Math.round((Date.now() - new Date(`${f.dealDate}T00:00:00+09:00`).getTime()) / 86400000),
    ...f,
  }));

  saveState(state);
  appendEvents(events);

  if (first) {
    console.log(`[${at}] 기준선 수집 완료 — 기존 거래 ${Object.keys(state.seen).length}건 기록.`);
    console.log('  이후 실행부터 새로 나타나는 거래만 잡습니다.');
    return;
  }

  if (events.length === 0) {
    console.log(`[${at}] 새 거래 없음${errors.length ? ` (오류 ${errors.length}건)` : ''}`);
    return;
  }

  console.log(`[${at}] 새 거래 ${events.length}건 —`);
  for (const e of events) {
    console.log(
      `   ${e.region} ${e.dong} ${e.name} ${e.areaM2}㎡ ${e.floor}층 ` +
        `${(Number(e.amount) / 10000).toFixed(2)}억 · 계약 ${e.dealDate} (${e.lagDays}일 전)`,
    );
  }
  for (const err of errors) console.log(`   ! ${err}`);
}

/* ------------------------------------------------------------------ */
/* 요약                                                                */
/* ------------------------------------------------------------------ */

function report() {
  if (!fs.existsSync(EVENTS_FILE)) {
    console.log('아직 기록이 없습니다. 먼저 몇 시간 돌려 두세요.');
    return;
  }
  const events = fs
    .readFileSync(EVENTS_FILE, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));

  if (events.length === 0) {
    console.log('기록된 신규 거래가 없습니다.');
    return;
  }

  summarize(events);
}

/** 관측 이벤트 배열을 사람이 읽는 요약으로 — 로컬·서버 기록이 같은 형식을 쓴다 */
function summarize(events) {
  const at = (e) => (e.detectedAt.length > 16 ? e.detectedAt.slice(0, 16).replace('T', ' ') : e.detectedAt);
  console.log(`\n관측 ${events.length}건 (${at(events[0])} ~ ${at(events.at(-1))})\n`);

  // 1) 몇 시에 들어오나 — 이게 갱신 간격을 정한다
  const byHour = new Map();
  const hourOf = (e) => e.detectedHour ?? e.hourKst;
  for (const e of events) byHour.set(hourOf(e), (byHour.get(hourOf(e)) ?? 0) + 1);
  console.log('■ 반영 시각 분포 (KST)');
  for (let h = 0; h < 24; h += 1) {
    const n = byHour.get(h) ?? 0;
    if (n === 0) continue;
    console.log(`   ${String(h).padStart(2, '0')}시  ${'█'.repeat(Math.min(40, n))} ${n}건`);
  }

  // 2) 하루에 몇 번 들어오나
  const slots = new Set(events.map((e) => `${e.detectedAt.slice(0, 10)} ${hourOf(e)}`));
  const days = new Set(events.map((e) => e.detectedAt.slice(0, 10)));
  console.log(`\n■ 반영이 관측된 시간대: 하루 평균 ${(slots.size / days.size).toFixed(1)}개`);

  // 3) 계약 → 공개까지 며칠
  const lags = events.map((e) => e.lagDays).sort((a, b) => a - b);
  const mid = lags[Math.floor(lags.length / 2)];
  console.log(
    `■ 계약일 → 공개까지: 중앙값 ${mid}일 (최소 ${lags[0]}일, 최대 ${lags.at(-1)}일)\n`,
  );

  console.log('해석: "반영 시각 분포"가 특정 시각에 몰려 있으면 그 직후에만 갱신하면 되고,');
  console.log('      하루 종일 흩어져 있으면 짧은 간격으로 도는 게 이득입니다.\n');
}

/* ------------------------------------------------------------------ */

/** 서버(tick)가 dashboard_snapshot 에 쌓아 둔 관측을 읽어 같은 형식으로 요약한다 */
async function remoteReport() {
  const envPath = path.join(ROOT, '.env.local');
  const env = Object.fromEntries(
    fs
      .readFileSync(envPath, 'utf8')
      .split(/\r?\n/)
      .filter((l) => l.includes('=') && !l.startsWith('#'))
      .map((l) => {
        const i = l.indexOf('=');
        return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
      }),
  );

  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('.env.local 에 Supabase 접속 정보가 없습니다.');

  const res = await fetch(
    `${url}/rest/v1/dashboard_snapshot?select=payload&payload->>kind=eq.molit-probe` +
      `&order=captured_at.desc&limit=1`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } },
  );
  if (!res.ok) throw new Error(`Supabase 조회 실패 (HTTP ${res.status})`);

  const rows = await res.json();
  const state = rows[0]?.payload;
  if (!state) {
    console.log('서버 관측 기록이 아직 없습니다. tick 이 한 번 돌면 기준선이 잡힙니다.');
    return;
  }

  const events = state.events ?? [];
  console.log(`\n서버 관측 — 기준선 ${state.startedAt?.slice(0, 16).replace('T', ' ')} UTC`);
  console.log(`마지막 실행 ${state.lastRunAt?.slice(0, 16).replace('T', ' ')} UTC · 추적 중인 거래 ${state.seen?.length ?? 0}건`);
  if (state.lastError) console.log(`마지막 오류: ${state.lastError}`);

  if (events.length === 0) {
    console.log('\n아직 새로 나타난 거래가 없습니다. 조금 더 기다려 주세요.\n');
    return;
  }
  summarize(events);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--remote')) return remoteReport();
  if (args.includes('--report')) return report();

  const key = readServiceKey();
  const once = args.includes('--once');
  const iAt = args.indexOf('--interval');
  const intervalMin = iAt >= 0 ? Number(args[iAt + 1]) : 30;

  if (once) return runOnce(key);

  console.log(
    `${intervalMin}분 간격으로 관측합니다. 중단하려면 Ctrl+C.\n` +
      `대상: ${REGIONS.map((r) => r.name).join(', ')} × 최근 2개월\n` +
      `요약: node scripts/measure-molit-lag.mjs --report\n`,
  );
  for (;;) {
    try {
      await runOnce(key);
    } catch (e) {
      console.error(`[${kstNow()}] 실패: ${e.message}`);
    }
    await sleep(intervalMin * 60_000);
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
