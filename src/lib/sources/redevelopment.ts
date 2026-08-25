/**
 * 서울시 정비사업 정보몽땅 — 단지별 재건축 진행 단계 조회.
 *
 * 원천: https://cleanup.seoul.go.kr/cleanup/bsnssttus/lscrMainIndx.do
 * 서울시가 운영하는 정비사업 종합정보 포털이며, 사업장 목록에
 * 자치구·사업구분·사업장명·대표지번·진행단계가 그대로 실려 있다.
 *
 * ── 왜 여기인가 ──────────────────────────────────────────────────
 * 재건축 단계를 전국 단위로 주는 OpenAPI 는 없다. 부산 등 일부 지자체만
 * 개별 API 가 있고, 서울 열린데이터광장의 정비사업 데이터셋은 2025-12-04
 * 로 제공이 끝났다. 민간 부동산 앱은 이용약관이 자동 수집을 금지한다.
 * 정비몽땅은 서울시 공공 사이트이고 robots 도 index,follow 이며 일반 요청을
 * 차단하지 않아, 지금 자동으로 받을 수 있는 유일한 최신 원천이다.
 *
 * ── 왜 지번으로 맞추나 ───────────────────────────────────────────
 * 사업장명은 단지명과 다르다. "송파한양1차" 는 "한양1차아파트 재건축정비사업"
 * 으로 등록돼 있어 이름만으로는 못 찾는다. 반면 대표지번(송파동 119)은
 * 실거래의 jibun 과 그대로 맞아떨어진다. 이름은 후보를 좁히는 데만 쓰고,
 * 확정은 자치구 + 법정동 + 지번 본번으로 한다.
 */

import { SOURCE_TTL } from '@/lib/refresh-policy';
import { bumpApiUsage } from '@/lib/store/api-usage';
import { REDEVELOPMENT_STAGES, type RedevelopmentStage } from '@/lib/types';

export { REDEVELOPMENT_STAGES };
export type { RedevelopmentStage };

const LIST_URL = 'https://cleanup.seoul.go.kr/cleanup/bsnssttus/lscrMainIndx.do';

/** 재건축 사업성과 무관한 사업구분은 걸러낸다 (지역주택조합 등) */
const RELEVANT_KINDS = ['재건축', '재개발', '소규모재건축', '가로주택정비', '소규모주택정비'];

export interface RedevelopmentInfo {
  /** 진행 단계 (정비몽땅 표기 그대로) */
  stage: string;
  /** 0~1. 준공인가를 1 로 본 진척도 — 해산·청산은 사업이 끝난 상태라 1 */
  progress: number;
  /** 사업구분 (재건축/재개발/가로주택정비 …) */
  kind: string;
  /** 정비몽땅에 등록된 사업장명 */
  projectName: string;
  /** 대표지번 (예: 송파동 119) */
  address: string;
  /** 무엇으로 맞췄는지 — 지번이면 확실, 이름이면 확인 필요 */
  matchedBy: 'jibun' | 'name';
  sourceUrl: string;
}

/* ------------------------------------------------------------------ */
/* HTML 파싱                                                            */
/* ------------------------------------------------------------------ */

interface ListRow {
  gu: string;
  kind: string;
  projectName: string;
  address: string;
  stage: string;
}

function stripTags(s: string): string {
  return s
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 목록 표에서 행을 뽑는다. 컬럼: 번호·자치구·사업구분·사업장명·대표지번·진행단계… */
function parseRows(html: string): ListRow[] {
  const out: ListRow[] = [];
  for (const tr of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const tds = [...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => stripTags(m[1]));
    if (tds.length < 6) continue;
    const [, gu, kind, projectName, address, stage] = tds;
    if (!gu || !projectName) continue;
    out.push({ gu, kind, projectName, address, stage });
  }
  return out;
}

/** "송파동 119" → { dong: '송파동', bonbun: '119' } */
function parseAddress(address: string): { dong: string; bonbun: string } | null {
  const m = address.match(/^(\S+동\S*)\s+(\d+)/);
  if (!m) return null;
  return { dong: m[1], bonbun: m[2] };
}

/** 지번의 본번만 (예: "520-2" → "520") */
function bonbunOf(jibun: string | undefined): string {
  return (jibun ?? '').trim().split('-')[0].trim();
}

/* ------------------------------------------------------------------ */
/* 검색                                                                */
/* ------------------------------------------------------------------ */

/**
 * 검색어 후보를 짧아지는 순으로 만든다.
 *
 * 사업장명은 지역 접두어를 뺀 형태가 많다 ("송파한양1차" → "한양1차아파트…").
 * 그래서 전체 이름으로 시작해 앞 글자를 하나씩 떼며 다시 찾는다.
 * 필터가 자치구·동·지번으로 확정하므로 검색어는 후보만 넓게 잡으면 된다.
 */
function searchTerms(complexName: string): string[] {
  const base = complexName
    .replace(/\([^)]*\)/g, '')
    .replace(/\s+/g, '')
    .replace(/\d+(차|단지)?/g, '')
    .replace(/(아파트|apt)$/i, '');

  const terms: string[] = [];
  for (let cut = 0; cut < 3; cut += 1) {
    const t = base.slice(cut);
    if (t.length < 2) break;
    terms.push(t);
  }
  return terms.length > 0 ? terms : [complexName];
}

const PAGE_SIZE = 100;
/** 한 검색어당 최대 장수 — 300건이면 어떤 단지명이든 충분하다 */
const MAX_PAGES = 3;

async function fetchPage(term: string, page: number): Promise<ListRow[]> {
  const url =
    `${LIST_URL}?cpage=${page}&pageSize=${PAGE_SIZE}` +
    `&scupBsnsSttus.asscNm=${encodeURIComponent(term)}`;
  bumpApiUsage('cleanup');
  const res = await fetch(url, {
    next: { revalidate: SOURCE_TTL.redevelopment },
    headers: { Accept: 'text/html' },
  });
  if (!res.ok) throw new Error(`정비몽땅 조회 실패 (HTTP ${res.status})`);
  return parseRows(await res.text());
}

/**
 * 한 검색어의 목록 전체.
 *
 * 한 장이 꽉 차면(=100행) 다음 장이 더 있다는 뜻이다. "아파트"·"재건축" 처럼
 * 흔한 말은 실제로 2장을 넘겨서, 1장만 보면 뒤쪽 자치구가 통째로 빠진다.
 */
async function fetchList(term: string): Promise<ListRow[]> {
  const all: ListRow[] = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const rows = await fetchPage(term, page);
    all.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }
  return all;
}

/** 준공인가를 1 로 본 진척도 */
function progressOf(stage: string): number {
  const i = REDEVELOPMENT_STAGES.indexOf(stage as RedevelopmentStage);
  if (i < 0) return 0;
  const done = REDEVELOPMENT_STAGES.indexOf('준공인가');
  return Math.min(1, Math.round((i / done) * 100) / 100);
}

export interface StageQuery {
  complexName: string;
  /** 자치구 (예: 송파구) — 서울이 아니면 조회하지 않는다 */
  sigungu: string;
  /** 법정동 (예: 송파동) */
  dong?: string;
  /** 실거래에서 찾은 대표 지번 (예: 119) */
  jibun?: string;
}

/**
 * 단지의 재건축 진행 단계를 찾는다. 없으면 null (= 정비사업 등록 없음).
 *
 * 서울시 자료라 서울이 아닌 단지는 조회 자체를 하지 않는다.
 */
export async function fetchRedevelopmentStage(q: StageQuery): Promise<RedevelopmentInfo | null> {
  if (!q.complexName || !q.sigungu) return null;
  // 정비몽땅은 서울시 사업장만 다룬다
  if (!/구$|시$/.test(q.sigungu)) return null;

  /* 검색어 후보를 모두 돌려 후보 행을 한 번에 모은다.
     첫 검색어에서 같은 구 사업장이 나왔다고 거기서 멈추면, 더 짧은 검색어라야
     나오는 진짜 단지를 놓친다 — "송파한양" 은 2차만 잡고 "한양" 이라야 1차가 나온다. */
  const seen = new Map<string, ListRow>();
  for (const term of searchTerms(q.complexName)) {
    const rows = await fetchList(term).catch(() => [] as ListRow[]);
    for (const r of rows) seen.set(`${r.projectName}|${r.address}`, r);
  }

  const candidates = [...seen.values()].filter(
    (r) => r.gu === q.sigungu && RELEVANT_KINDS.some((k) => r.kind.includes(k)),
  );
  if (candidates.length === 0) return null;

  const wantBonbun = bonbunOf(q.jibun);

  /* 1순위 — 법정동 + 지번 본번. 사업장명이 달라도 이게 맞으면 그 단지다. */
  if (wantBonbun) {
    const hit = candidates.find((r) => {
      const a = parseAddress(r.address);
      if (!a) return false;
      if (q.dong && a.dong !== q.dong) return false;
      return a.bonbun === wantBonbun;
    });
    /* 지번을 알면서 일치하는 사업장이 없다는 건 "이 단지는 정비사업이 없다" 는 뜻이다.
       여기서 이름으로 물러서면 형제 단지를 잡는다 — 실제로 송파한양1차가 2차를,
       상계주공7단지가 8단지를, 옥수하이츠가 한남하이츠를 물어왔다. */
    return hit ? toInfo(hit, 'jibun') : null;
  }

  /* 2순위 — 지번을 모를 때만. 단지명이 차수까지 통째로 들어간 사업장만 인정한다. */
  const strictKeys: string[] = [];
  const flat = q.complexName.replace(/\s+/g, '');
  for (let cut = 0; cut + 4 <= flat.length; cut += 1) strictKeys.push(flat.slice(cut));

  const byName = candidates.find((r) => {
    const a = parseAddress(r.address);
    if (q.dong && a && a.dong !== q.dong) return false;
    const proj = r.projectName.replace(/\s+/g, '');
    return strictKeys.some((k) => proj.includes(k));
  });
  return byName ? toInfo(byName, 'name') : null;
}

function toInfo(r: ListRow, matchedBy: 'jibun' | 'name'): RedevelopmentInfo {
  return {
    stage: r.stage || '단계 미표기',
    progress: progressOf(r.stage),
    kind: r.kind,
    projectName: r.projectName,
    address: r.address,
    matchedBy,
    sourceUrl: LIST_URL,
  };
}
