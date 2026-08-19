/**
 * 행정경계 GeoJSON 전처리 스크립트.
 *
 * 입력: scripts/ 아래에 받아둔 통계청(KOSTAT) 2013 간략화 경계
 *   - skorea_provinces_geo_simple.json        (시도 17)
 *   - skorea_municipalities_geo_simple.json   (시군구 251)
 *   - skorea_submunicipalities_geo_simple.json(읍면동 3,482)
 * 출력: public/geo/
 *   - sido.json                시도 경계 (sidoShort 부여)
 *   - sigungu.json             시군구 경계 (우리 법정동코드 codes[] 부여)
 *   - dong/{lawdCd}.json       시군구별 읍면동 경계 (드릴다운 시 지연 로드)
 *
 * KOSTAT 코드는 행정표준(법정동)코드와 다르므로 이름 기반으로 매핑하고,
 * 2013년 이후 바뀐 행정구역(청주 4구 개편, 부천 구 폐지, 인천 미추홀구 개명,
 * 군위군 대구 편입 등)은 특례 표로 처리한다.
 *
 * 실행: node scripts/prepare-geo.mjs
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const outDir = path.join(root, 'public', 'geo');
mkdirSync(path.join(outDir, 'dong'), { recursive: true });

/* ------------------------------------------------------------------ */
/* 우리 지역 사전 로드 — regions.ts 에서 R('code','sido','short','name'…) 호출을 긁는다 */
/* ------------------------------------------------------------------ */

const regionsTs = readFileSync(path.join(root, 'src', 'lib', 'regions.ts'), 'utf8');
const regionRe = /R\(\s*'(\d{5})'\s*,\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*'([^']+)'/g;
const OUR = []; // { code, sido, sidoShort, name }
for (let m; (m = regionRe.exec(regionsTs)); ) {
  OUR.push({ code: m[1], sido: m[2], sidoShort: m[3], name: m[4] });
}
if (OUR.length < 200) throw new Error(`regions.ts 파싱 실패: ${OUR.length}건만 읽음`);

const norm = (s) => s.replace(/\s+/g, '');

/* ------------------------------------------------------------------ */
/* KOSTAT 시도 코드 → 우리 sidoShort                                     */
/* ------------------------------------------------------------------ */

const SIDO_NAME_TO_SHORT = {
  서울특별시: '서울',
  부산광역시: '부산',
  대구광역시: '대구',
  인천광역시: '인천',
  광주광역시: '광주',
  대전광역시: '대전',
  울산광역시: '울산',
  세종특별자치시: '세종',
  경기도: '경기',
  강원도: '강원',
  충청북도: '충북',
  충청남도: '충남',
  전라북도: '전북',
  전라남도: '전남',
  경상북도: '경북',
  경상남도: '경남',
  제주특별자치도: '제주',
};

const provinces = JSON.parse(
  readFileSync(path.join(here, 'skorea_provinces_geo_simple.json'), 'utf8'),
);
const provCodeToShort = {};
for (const f of provinces.features) {
  const short = SIDO_NAME_TO_SHORT[f.properties.name];
  if (!short) throw new Error(`알 수 없는 시도명: ${f.properties.name}`);
  provCodeToShort[f.properties.code] = short;
}

/* ------------------------------------------------------------------ */
/* 특례: 2013 경계와 현행 법정코드가 어긋나는 지역                          */
/* key = `${kostat시도2자리}|${정규화된이름}` → 우리 코드 배열               */
/* ------------------------------------------------------------------ */

const SPECIAL = {
  '23|남구': ['28177'], // 인천 남구 → 미추홀구(2018 개명)
  '29|세종시': ['36110'],
  '31|부천시원미구': ['41190'], // 부천 구 폐지(2016) → 하나로 합침
  '31|부천시소사구': ['41190'],
  '31|부천시오정구': ['41190'],
  // 청주 통합·분구(2014): 대략적 매핑 (경계가 정확히 일치하지 않음)
  '33|청주시상당구': ['43111', '43112'],
  '33|청주시흥덕구': ['43113'],
  '33|청원군': ['43114'],
  '37|군위군': ['27720'], // 대구 편입(2023) — 경계는 2013 경북 위치 그대로
};

/* ------------------------------------------------------------------ */
/* 시군구 매핑                                                          */
/* ------------------------------------------------------------------ */

const munis = JSON.parse(
  readFileSync(path.join(here, 'skorea_municipalities_geo_simple.json'), 'utf8'),
);

const round = (n) => Math.round(n * 10_000) / 10_000;
const roundCoords = (c) => (typeof c[0] === 'number' ? [round(c[0]), round(c[1])] : c.map(roundCoords));

const matchedOurCodes = new Set();
const unmatchedFeatures = [];
const sigunguFeatures = [];

for (const f of munis.features) {
  const prov = f.properties.code.slice(0, 2);
  const short = provCodeToShort[prov];
  const key = `${prov}|${norm(f.properties.name)}`;

  let codes = SPECIAL[key];
  if (!codes) {
    const hit = OUR.filter((r) => r.sidoShort === short && norm(r.name) === norm(f.properties.name));
    codes = hit.map((r) => r.code);
  }

  if (codes.length === 0) unmatchedFeatures.push(`${f.properties.code} ${short} ${f.properties.name}`);
  codes.forEach((c) => matchedOurCodes.add(c));

  sigunguFeatures.push({
    type: 'Feature',
    properties: { codes, name: f.properties.name, sido: short },
    geometry: { type: f.geometry.type, coordinates: roundCoords(f.geometry.coordinates) },
  });
}

const unmatchedOurs = OUR.filter((r) => !matchedOurCodes.has(r.code)).map(
  (r) => `${r.code} ${r.sidoShort} ${r.name}`,
);

writeFileSync(
  path.join(outDir, 'sigungu.json'),
  JSON.stringify({ type: 'FeatureCollection', features: sigunguFeatures }),
);

/* ------------------------------------------------------------------ */
/* 시도 경계                                                            */
/* ------------------------------------------------------------------ */

writeFileSync(
  path.join(outDir, 'sido.json'),
  JSON.stringify({
    type: 'FeatureCollection',
    features: provinces.features.map((f) => ({
      type: 'Feature',
      properties: { sido: provCodeToShort[f.properties.code], name: f.properties.name },
      geometry: { type: f.geometry.type, coordinates: roundCoords(f.geometry.coordinates) },
    })),
  }),
);

/* ------------------------------------------------------------------ */
/* 읍면동: kostat 시군구 코드(앞 5자리) → 우리 코드별 파일로 분배            */
/* ------------------------------------------------------------------ */

const submunis = JSON.parse(
  readFileSync(path.join(here, 'skorea_submunicipalities_geo_simple.json'), 'utf8'),
);

// kostat 시군구코드 → 우리 codes[] (원본 munis 를 다시 훑어 매핑표를 만든다)
const kostatToOurs = new Map();
for (const f of munis.features) {
  const prov = f.properties.code.slice(0, 2);
  const short = provCodeToShort[prov];
  const key = `${prov}|${norm(f.properties.name)}`;
  let codes = SPECIAL[key];
  if (!codes) {
    codes = OUR.filter((r) => r.sidoShort === short && norm(r.name) === norm(f.properties.name)).map(
      (r) => r.code,
    );
  }
  kostatToOurs.set(f.properties.code, codes);
}

const dongByLawd = new Map(); // lawdCd → features[]
for (const f of submunis.features) {
  const sgg = f.properties.code.slice(0, 5);
  const codes = kostatToOurs.get(sgg) ?? [];
  const feature = {
    type: 'Feature',
    properties: { name: f.properties.name },
    geometry: { type: f.geometry.type, coordinates: roundCoords(f.geometry.coordinates) },
  };
  for (const lawd of codes) {
    if (!dongByLawd.has(lawd)) dongByLawd.set(lawd, []);
    dongByLawd.get(lawd).push(feature);
  }
}

let dongFiles = 0;
for (const [lawd, features] of dongByLawd) {
  writeFileSync(
    path.join(outDir, 'dong', `${lawd}.json`),
    JSON.stringify({ type: 'FeatureCollection', features }),
  );
  dongFiles += 1;
}

/* ------------------------------------------------------------------ */
/* 결과 요약                                                            */
/* ------------------------------------------------------------------ */

console.log(`시군구 폴리곤: ${sigunguFeatures.length}개 (우리 코드 매핑 ${matchedOurCodes.size}/${OUR.length})`);
console.log(`읍면동 파일: ${dongFiles}개 시군구, 총 ${submunis.features.length}개 동`);
if (unmatchedFeatures.length > 0) {
  console.log(`\n[경고] 우리 코드와 매핑되지 않은 폴리곤 ${unmatchedFeatures.length}개:`);
  unmatchedFeatures.forEach((s) => console.log('  - ' + s));
}
if (unmatchedOurs.length > 0) {
  console.log(`\n[경고] 폴리곤이 없는 우리 지역 ${unmatchedOurs.length}개:`);
  unmatchedOurs.forEach((s) => console.log('  - ' + s));
}
