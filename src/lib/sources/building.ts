/**
 * 건축물대장 정보 — 국토교통부 「건축물대장정보 서비스」 (공공데이터포털)
 *
 * 신청: https://www.data.go.kr/data/15044713/openapi.do
 * 실거래가와 같은 DATA_GO_KR_SERVICE_KEY 를 쓴다 (활용신청은 별도로 해야 함).
 *
 * 여기서 얻는 것: 용적률 · 건폐율 · 대지면적 · 연면적 · 세대수 · 사용승인일 · 주차대수
 * 대지지분은 대장에 직접 나오지 않아 (대지면적 ÷ 세대수)로 추정한다 —
 * 실제 등기부상 대지권 비율과는 차이가 있을 수 있다.
 */

import { env } from '@/lib/env';
import { SOURCE_TTL } from '@/lib/refresh-policy';

const ENDPOINT =
  'https://apis.data.go.kr/1613000/BldRgstHubService/getBrTitleInfo';

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
