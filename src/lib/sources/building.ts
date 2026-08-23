/**
 * 건축물대장 정보 — 국토교통부 「건축물대장정보 서비스」 (공공데이터포털)
 *
 * 신청: https://www.data.go.kr/data/15134735/openapi.do (건축HUB_건축물대장정보 서비스)
 * 실거래가와 같은 DATA_GO_KR_SERVICE_KEY 를 쓴다 (활용신청은 별도로 해야 함).
 *
 * 여기서 얻는 것: 용적률 · 건폐율 · 대지면적 · 연면적 · 세대수 · 사용승인일 · 주차대수
 * 대지지분은 대장에 직접 나오지 않아 (대지면적 ÷ 세대수)로 추정한다 —
 * 실제 등기부상 대지권 비율과는 차이가 있을 수 있다.
 */

import { env } from '@/lib/env';
import { SOURCE_TTL } from '@/lib/refresh-policy';

const ENDPOINT = 'https://apis.data.go.kr/1613000/BldRgstHubService/getBrTitleInfo';
/** 총괄표제부 — 한 대지(단지) 전체의 세대수·용적률·대지면적을 한 행으로 준다 */
const RECAP_ENDPOINT = 'https://apis.data.go.kr/1613000/BldRgstHubService/getBrRecapTitleInfo';

export interface BuildingInfo {
  /** 건물명 */
  name: string;
  /** 용적률 (%) */
  floorAreaRatio?: number;
  /** 건폐율 (%) */
  buildingCoverage?: number;
  /** 대지면적 (㎡) */
  landArea?: number;
  /** 연면적 (㎡) */
  totalFloorArea?: number;
  /** 세대수 */
  households?: number;
  /** 지상 층수 */
  floorsAbove?: number;
  /** 사용승인일 (YYYY-MM-DD) */
  approvedAt?: string;
  /** 총 주차대수 */
  parking?: number;
  /** 세대당 대지지분 추정 (㎡) */
  landSharePerUnit?: number;
  /** 세대당 주차대수 */
  parkingPerUnit?: number;
  /** 재건축 사업성 힌트 */
  redevelopmentNote: string;
}

function pickTag(xml: string, tag: string): string | undefined {
  const m = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  if (!m) return undefined;
  const v = m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim();
  return v.length > 0 ? v : undefined;
}

function num(v: string | undefined): number | undefined {
  if (!v) return undefined;
  const n = Number(v.replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * 용적률·대지지분으로 재건축 사업성을 한 줄 평가한다.
 * 통념: 용적률 180% 이하 + 대지지분 넉넉 = 사업성 양호, 250% 초과 = 어려움
 */
function redevelopmentHint(far?: number, landShare?: number, approvedAt?: string): string {
  const age = approvedAt ? new Date().getFullYear() - Number(approvedAt.slice(0, 4)) : undefined;
  const parts: string[] = [];

  if (age !== undefined) parts.push(`준공 ${age}년차`);

  if (far === undefined) {
    parts.push('용적률 정보가 없어 사업성 판단이 어렵습니다');
  } else if (far <= 180) {
    parts.push(`용적률 ${far}% — 낮아 재건축 사업성이 좋은 편입니다`);
  } else if (far <= 250) {
    parts.push(`용적률 ${far}% — 사업성은 중간, 추가 분담금 가능성이 있습니다`);
  } else {
    parts.push(`용적률 ${far}% — 높아 재건축보다 리모델링이 현실적입니다`);
  }

  if (landShare !== undefined) {
    parts.push(
      landShare >= 50
        ? `세대당 대지지분 약 ${landShare.toFixed(1)}㎡ — 여유 있는 편`
        : `세대당 대지지분 약 ${landShare.toFixed(1)}㎡ — 작은 편`,
    );
  }

  if (age !== undefined && age >= 30 && far !== undefined && far <= 200) {
    parts.push('연한·용적률 모두 재건축 요건에 가깝습니다');
  }

  return parts.join(' · ');
}

/* ------------------------------------------------------------------ */
/* 단지 스펙 자동 조회 — 세대수 · 용적률 · 대지지분                        */
/* ------------------------------------------------------------------ */

export interface ComplexSpec {
  /** 총 세대수 */
  households?: number;
  /** 용적률 (%) */
  floorAreaRatio?: number;
  /** 대지면적 (㎡) */
  landArea?: number;
  /** 세대당 대지지분 추정 (㎡) = 대지면적 ÷ 세대수 */
  landSharePerUnit?: number;
  /** 조회에 쓴 지번 주소 */
  address: string;
  /** 총괄표제부(단지 단위) 또는 표제부 합산(동별 합계) */
  source: '총괄표제부' | '표제부 합산';
}

/** 지번 주소 → 법정동코드 10자리(b_code)·본번·부번 (카카오 주소검색) */
async function resolveLotCode(
  query: string,
): Promise<{ bcode: string; bun: string; ji: string; address: string } | null> {
  const key = env.kakaoRestKey;
  if (!key) return null;
  try {
    const res = await fetch(
      `https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(query)}&size=1`,
      { headers: { Authorization: `KakaoAK ${key}` }, cache: 'no-store' },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as {
      documents?: Array<{
        address_name: string;
        address?: { b_code?: string; main_address_no?: string; sub_address_no?: string };
      }>;
    };
    const doc = json.documents?.[0];
    const a = doc?.address;
    if (!a?.b_code || !a.main_address_no) return null;
    return {
      bcode: a.b_code,
      bun: a.main_address_no,
      ji: a.sub_address_no || '0',
      address: doc!.address_name,
    };
  } catch {
    return null;
  }
}

/** 단지명 키워드 검색으로 지번 주소를 찾는다 (지번을 모를 때의 폴백) */
async function findAddressByKeyword(
  keyword: string,
  mustInclude: string[],
): Promise<string | null> {
  const key = env.kakaoRestKey;
  if (!key) return null;
  try {
    const res = await fetch(
      `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(keyword)}&size=5`,
      { headers: { Authorization: `KakaoAK ${key}` }, cache: 'no-store' },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as { documents?: Array<{ address_name?: string }> };
    const hit = json.documents?.find((d) => {
      const addr = d.address_name ?? '';
      return addr && mustInclude.every((m) => !m || addr.includes(m));
    });
    return hit?.address_name ?? null;
  } catch {
    return null;
  }
}

function registerUrl(endpoint: string, bcode: string, bun: string, ji: string): string {
  const key = env.molitKey;
  return (
    `${endpoint}?serviceKey=${encodeURIComponent(key ?? '')}` +
    `&sigunguCd=${bcode.slice(0, 5)}&bjdongCd=${bcode.slice(5)}` +
    `&bun=${bun.padStart(4, '0')}&ji=${ji.padStart(4, '0')}` +
    `&numOfRows=50&pageNo=1`
  );
}

/** 건축물대장에서 지번 하나의 스펙을 읽는다 — 총괄표제부 우선, 없으면 표제부 합산 */
async function fetchSpecByLot(
  bcode: string,
  bun: string,
  ji: string,
  address: string,
): Promise<ComplexSpec | null> {
  if (!env.molitKey) return null;

  const items = async (endpoint: string): Promise<string[]> => {
    const res = await fetch(registerUrl(endpoint, bcode, bun, ji), {
      next: { revalidate: SOURCE_TTL.molitHistory },
    });
    if (!res.ok) return [];
    const xml = await res.text();
    const code = pickTag(xml, 'resultCode');
    if (code && code !== '00' && code !== '000') return [];
    return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => m[1]);
  };

  // 1) 총괄표제부 — 단지 전체가 한 행 (세대수·용적률·대지면적이 단지 합계)
  const recap = (await items(RECAP_ENDPOINT)).find((it) => num(pickTag(it, 'hhldCnt')));
  if (recap) {
    const households = num(pickTag(recap, 'hhldCnt'));
    const landArea = num(pickTag(recap, 'platArea'));
    return {
      households,
      floorAreaRatio: num(pickTag(recap, 'vlRat')),
      landArea,
      landSharePerUnit: landArea && households ? landArea / households : undefined,
      address,
      source: '총괄표제부',
    };
  }

  // 2) 표제부 — 동(棟)별 행이라 세대수를 합산한다. 용적률·대지면적은 대지 값이라 최댓값.
  const rows = await items(ENDPOINT);
  if (rows.length === 0) return null;
  let households = 0;
  let far: number | undefined;
  let landArea: number | undefined;
  for (const it of rows) {
    households += num(pickTag(it, 'hhldCnt')) ?? 0;
    const v = num(pickTag(it, 'vlRat'));
    if (v && (!far || v > far)) far = v;
    const p = num(pickTag(it, 'platArea'));
    if (p && (!landArea || p > landArea)) landArea = p;
  }
  if (households === 0 && !far) return null;
  return {
    households: households || undefined,
    floorAreaRatio: far,
    landArea,
    landSharePerUnit: landArea && households ? landArea / households : undefined,
    address,
    source: '표제부 합산',
  };
}

/**
 * 단지 스펙(세대수·용적률·대지지분 추정) 자동 조회.
 *
 * 경로: 지번(실거래 캐시에서 온 것) 또는 단지명 키워드 검색 → 카카오 주소검색으로
 * 법정동코드 10자리·본번·부번 확정 → 건축물대장 총괄표제부.
 * 대지지분은 (대지면적 ÷ 세대수) 추정이라 등기부 대지권과 다를 수 있다.
 */
export async function fetchComplexSpec(opts: {
  complexName: string;
  sido?: string;
  sigungu?: string;
  dong?: string;
  jibun?: string;
}): Promise<ComplexSpec | null> {
  const region = [opts.sido, opts.sigungu].filter(Boolean).join(' ').trim();
  const guName = opts.sigungu?.split(' ').pop() ?? '';

  let lot: Awaited<ReturnType<typeof resolveLotCode>> = null;
  if (opts.jibun && (region || opts.dong)) {
    lot = await resolveLotCode([region, opts.dong, opts.jibun].filter(Boolean).join(' '));
  }
  if (!lot) {
    const addr = await findAddressByKeyword(
      [region, opts.dong, opts.complexName].filter(Boolean).join(' '),
      [guName, opts.dong ?? ''],
    );
    if (addr) lot = await resolveLotCode(addr);
  }
  if (!lot) return null;

  return fetchSpecByLot(lot.bcode, lot.bun, lot.ji, lot.address);
}

/**
 * 건축물대장 표제부 조회.
 * @param lawdCd 법정동코드 앞 5자리
 * @param bun 번 (지번 본번, 4자리 0패딩)
 * @param ji 지 (지번 부번, 4자리 0패딩)
 */
export async function fetchBuildingInfo(
  lawdCd: string,
  bun: string,
  ji = '0000',
): Promise<BuildingInfo | null> {
  const key = env.molitKey;
  if (!key) throw new Error('DATA_GO_KR_SERVICE_KEY 가 설정되지 않았습니다.');

  const url =
    `${ENDPOINT}?serviceKey=${encodeURIComponent(key)}` +
    `&sigunguCd=${lawdCd}&bjdongCd=00000&bun=${bun.padStart(4, '0')}&ji=${ji.padStart(4, '0')}` +
    `&numOfRows=10&pageNo=1`;

  const res = await fetch(url, { next: { revalidate: SOURCE_TTL.molitHistory } });
  if (!res.ok) throw new Error(`건축물대장 HTTP ${res.status}`);

  const xml = await res.text();
  const code = pickTag(xml, 'resultCode');
  if (code && code !== '00' && code !== '000') {
    throw new Error(`건축물대장 오류(${code}): ${pickTag(xml, 'resultMsg') ?? ''}`);
  }

  const item = xml.match(/<item>([\s\S]*?)<\/item>/)?.[1];
  if (!item) return null;

  const landArea = num(pickTag(item, 'platArea'));
  const households = num(pickTag(item, 'hhldCnt'));
  const far = num(pickTag(item, 'vlRat'));
  const approved = pickTag(item, 'useAprDay');
  const approvedAt =
    approved && approved.length === 8
      ? `${approved.slice(0, 4)}-${approved.slice(4, 6)}-${approved.slice(6, 8)}`
      : undefined;

  const landSharePerUnit = landArea && households ? landArea / households : undefined;
  const parking =
    (num(pickTag(item, 'indrAutoUtcnt')) ?? 0) + (num(pickTag(item, 'oudrAutoUtcnt')) ?? 0) ||
    undefined;

  return {
    name: pickTag(item, 'bldNm') ?? '',
    floorAreaRatio: far,
    buildingCoverage: num(pickTag(item, 'bcRat')),
    landArea,
    totalFloorArea: num(pickTag(item, 'totArea')),
    households,
    floorsAbove: num(pickTag(item, 'grndFlrCnt')),
    approvedAt,
    parking,
    landSharePerUnit,
    parkingPerUnit: parking && households ? parking / households : undefined,
    redevelopmentNote: redevelopmentHint(far, landSharePerUnit, approvedAt),
  };
}
