/**
 * 단지 주변 입지 정보 — 카카오 로컬 API
 *
 * 브리핑용 카카오 메시지와 같은 REST API 키(KAKAO_REST_API_KEY)를 쓴다.
 * 별도 신청 없이 [카카오맵] 활성화만 하면 된다.
 *
 * 수집 항목: 지하철역 / 학교 / 대형마트 / 병원 / 공원 — 각각 반경 내 최근접 순
 * 카테고리 코드: SW8(지하철역) SC4(학교) MT1(대형마트) HP8(병원) CS2(편의점) PO3(공공기관)
 */

import { env } from '@/lib/env';
import { SOURCE_TTL } from '@/lib/refresh-policy';

const SEARCH_ADDRESS = 'https://dapi.kakao.com/v2/local/search/address.json';
const SEARCH_KEYWORD = 'https://dapi.kakao.com/v2/local/search/keyword.json';
const SEARCH_CATEGORY = 'https://dapi.kakao.com/v2/local/search/category.json';

export function hasPlaceApi(): boolean {
  return Boolean(env.kakaoRestKey);
}

async function kakaoGet<T>(url: string): Promise<T> {
  const key = env.kakaoRestKey;
  if (!key) throw new Error('KAKAO_REST_API_KEY 가 설정되지 않았습니다.');

  const res = await fetch(url, {
    headers: { Authorization: `KakaoAK ${key}` },
    next: { revalidate: SOURCE_TTL.ecos },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`카카오 로컬 API HTTP ${res.status} ${body.slice(0, 160)}`);
  }
  return (await res.json()) as T;
}

export interface Coord {
  lat: number;
  lon: number;
  /** 좌표를 얻은 방법 */
  via: 'address' | 'keyword';
  /** 매칭된 장소/주소 이름 */
  matched: string;
}

/** 단지명·지역으로 좌표를 찾는다 (주소 검색 → 키워드 검색 순) */
export async function geocodeComplex(
  complexName: string,
  sigungu: string,
  dong?: string,
  jibun?: string,
): Promise<Coord | null> {
  const addressQuery = [sigungu, dong].filter(Boolean).join(' ');

  // 1) 키워드 검색이 아파트 단지명에 가장 잘 맞는다
  const keyword = `${sigungu} ${complexName}`.trim();
  try {
    const json = await kakaoGet<{
      documents: Array<{ place_name: string; x: string; y: string }>;
    }>(`${SEARCH_KEYWORD}?query=${encodeURIComponent(keyword)}&size=1`);
    const d = json.documents[0];
    if (d) return { lat: Number(d.y), lon: Number(d.x), via: 'keyword', matched: d.place_name };
  } catch {
    /* 아래 주소 검색으로 넘어간다 */
  }

  // 2) 지번이 있으면 지번 주소가 정확하다.
  //    국토부 등록명("우성2")이 지도 검색에 안 잡히는 단지가 실제로 있었는데,
  //    지번은 국토부 응답에 항상 있고 주소 검색은 이름과 무관하게 맞는다.
  if (jibun && addressQuery) {
    try {
      const json = await kakaoGet<{
        documents: Array<{ address_name: string; x: string; y: string }>;
      }>(`${SEARCH_ADDRESS}?query=${encodeURIComponent(`${addressQuery} ${jibun}`)}&size=1`);
      const d = json.documents[0];
      if (d) return { lat: Number(d.y), lon: Number(d.x), via: 'address', matched: d.address_name };
    } catch {
      /* 아래 동 대표 좌표로 넘어간다 */
    }
  }

  // 3) 실패 시 법정동 주소로 대략적 좌표
  if (!addressQuery) return null;
  try {
    const json = await kakaoGet<{
      documents: Array<{ address_name: string; x: string; y: string }>;
    }>(`${SEARCH_ADDRESS}?query=${encodeURIComponent(addressQuery)}&size=1`);
    const d = json.documents[0];
    if (d) return { lat: Number(d.y), lon: Number(d.x), via: 'address', matched: d.address_name };
  } catch {
    /* 좌표 없음 */
  }
  return null;
}

export interface NearbyPlace {
  name: string;
  /** 미터 */
  distance: number;
  /** 도보 분 (80m/분 기준) */
  walkMinutes: number;
  category: string;
  url?: string;
}

export interface NearbySummary {
  coord: Coord;
  subway: NearbyPlace[];
  school: NearbyPlace[];
  mart: NearbyPlace[];
  hospital: NearbyPlace[];
  park: NearbyPlace[];
  /** 한 줄 입지 요약 */
  headline: string;
}

const CATEGORIES = [
  { key: 'subway', code: 'SW8', label: '지하철역', radius: 1500 },
  { key: 'school', code: 'SC4', label: '학교', radius: 1000 },
  { key: 'mart', code: 'MT1', label: '대형마트', radius: 2000 },
  { key: 'hospital', code: 'HP8', label: '병원', radius: 2000 },
] as const;

async function fetchCategory(
  coord: Coord,
  code: string,
  radius: number,
  label: string,
  size = 3,
): Promise<NearbyPlace[]> {
  const url =
    `${SEARCH_CATEGORY}?category_group_code=${code}` +
    `&x=${coord.lon}&y=${coord.lat}&radius=${radius}&sort=distance&size=${size}`;
  const json = await kakaoGet<{
    documents: Array<{
      place_name: string;
      distance: string;
      place_url?: string;
      category_name?: string;
    }>;
  }>(url);
  return json.documents.map((d) => {
    const distance = Number(d.distance) || 0;
    return {
      name: d.place_name,
      distance,
      walkMinutes: Math.max(1, Math.round(distance / 80)),
      category: d.category_name?.split('>').pop()?.trim() || label,
      url: d.place_url,
    };
  });
}

/** 단지 주변 입지 요약 */
export async function fetchNearby(
  complexName: string,
  sigungu: string,
  dong?: string,
): Promise<NearbySummary | null> {
  const coord = await geocodeComplex(complexName, sigungu, dong);
  if (!coord) return null;

  const [subway, school, mart, hospital] = await Promise.all(
    CATEGORIES.map((c) =>
      fetchCategory(coord, c.code, c.radius, c.label).catch(() => [] as NearbyPlace[]),
    ),
  );

  // 공원은 카테고리 코드가 없어 키워드로 찾는다
  const park = await kakaoGet<{
    documents: Array<{ place_name: string; distance: string; place_url?: string }>;
  }>(
    `${SEARCH_KEYWORD}?query=${encodeURIComponent('공원')}&x=${coord.lon}&y=${coord.lat}&radius=1500&sort=distance&size=2`,
  )
    .then((j) =>
      j.documents.map((d) => ({
        name: d.place_name,
        distance: Number(d.distance) || 0,
        walkMinutes: Math.max(1, Math.round((Number(d.distance) || 0) / 80)),
        category: '공원',
        url: d.place_url,
      })),
    )
    .catch(() => [] as NearbyPlace[]);

  const parts: string[] = [];
  if (subway[0]) parts.push(`${subway[0].name} 도보 ${subway[0].walkMinutes}분`);
  if (school[0]) parts.push(`${school[0].name} ${school[0].distance}m`);
  if (mart[0]) parts.push(`${mart[0].name} ${(mart[0].distance / 1000).toFixed(1)}km`);

  return {
    coord,
    subway,
    school,
    mart,
    hospital,
    park,
    headline: parts.length > 0 ? parts.join(' · ') : '주변 시설 정보를 찾지 못했습니다.',
  };
}
