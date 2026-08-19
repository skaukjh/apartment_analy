/**
 * 지도 렌더링 유틸 — 투영, GeoJSON→SVG path 변환, 색상 스케일.
 *
 * 경계 데이터는 통계청 2013 간략화 행정경계(scripts/prepare-geo.mjs 로 전처리)를
 * public/geo/*.json 정적 파일로 서빙하고 클라이언트에서 지연 로드한다.
 */

/* ------------------------------------------------------------------ */
/* 투영                                                                */
/* ------------------------------------------------------------------ */

/**
 * 지도에 담을 위경도 범위.
 * 본토+제주 기준이며 백령도(124.6E)·울릉도(130.9E)는 화면 밖으로 잘린다.
 */
export const BOUNDS = {
  minLon: 125.7,
  maxLon: 129.75,
  minLat: 33.05,
  maxLat: 38.7,
} as const;

export interface Projection {
  width: number;
  height: number;
  project: (lat: number, lon: number) => { x: number; y: number };
}

/**
 * 등장방형 투영에 위도별 경도 압축(cos φ)을 반영한 간이 투영.
 * 한국처럼 좁은 범위에서는 이것만으로도 형태 왜곡이 거의 없다.
 */
export function createProjection(width: number): Projection {
  const midLat = ((BOUNDS.minLat + BOUNDS.maxLat) / 2) * (Math.PI / 180);
  const lonScale = Math.cos(midLat);

  const lonSpan = (BOUNDS.maxLon - BOUNDS.minLon) * lonScale;
  const latSpan = BOUNDS.maxLat - BOUNDS.minLat;

  const scale = width / lonSpan;
  const height = latSpan * scale;

  return {
    width,
    height,
    project(lat: number, lon: number) {
      return {
        x: (lon - BOUNDS.minLon) * lonScale * scale,
        // SVG 는 y가 아래로 증가하므로 위도를 뒤집는다
        y: (BOUNDS.maxLat - lat) * scale,
      };
    },
  };
}

/* ------------------------------------------------------------------ */
/* GeoJSON                                                             */
/* ------------------------------------------------------------------ */

export type Ring = Array<[number, number]>; // [lon, lat]

export interface GeoGeometry {
  type: 'Polygon' | 'MultiPolygon';
  coordinates: Ring[] | Ring[][];
}

export interface GeoFeature<P = Record<string, unknown>> {
  type: 'Feature';
  properties: P;
  geometry: GeoGeometry;
}

export interface FeatureCollection<P = Record<string, unknown>> {
  type: 'FeatureCollection';
  features: Array<GeoFeature<P>>;
}

export interface SigunguProps {
  /** 이 폴리곤에 해당하는 법정동코드들 (행정구역 개편으로 1:N 가능, 빈 배열 = 분석 대상 외) */
  codes: string[];
  name: string;
  sido: string;
}

export interface SidoProps {
  sido: string;
  name: string;
}

export interface DongProps {
  name: string;
}

function polygonRings(geometry: GeoGeometry): Ring[] {
  return geometry.type === 'Polygon'
    ? (geometry.coordinates as Ring[])
    : (geometry.coordinates as Ring[][]).flat();
}

/** GeoJSON 지오메트리를 SVG path d 문자열로 */
export function geometryToPath(geometry: GeoGeometry, projection: Projection): string {
  const parts: string[] = [];
  for (const ring of polygonRings(geometry)) {
    if (ring.length < 3) continue;
    const cmds = ring.map(([lon, lat], i) => {
      const { x, y } = projection.project(lat, lon);
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    });
    parts.push(cmds.join('') + 'Z');
  }
  return parts.join('');
}

export interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** 투영 좌표계 기준 바운딩 박스 */
export function geometryBBox(geometry: GeoGeometry, projection: Projection): BBox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const ring of polygonRings(geometry)) {
    for (const [lon, lat] of ring) {
      const { x, y } = projection.project(lat, lon);
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  return { minX, minY, maxX, maxY };
}

export function mergeBBox(a: BBox, b: BBox): BBox {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

export function bboxCenter(b: BBox): { x: number; y: number } {
  return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
}

/**
 * 폴리곤 대표점 — 가장 큰 링의 꼭짓점 평균.
 * (bbox 중심은 L자 모양에서 영역 밖으로 나갈 수 있어 평균이 라벨용으로는 낫다)
 */
export function geometryCentroid(
  geometry: GeoGeometry,
  projection: Projection,
): { x: number; y: number } {
  let best: Ring = [];
  for (const ring of polygonRings(geometry)) {
    if (ring.length > best.length) best = ring;
  }
  let sx = 0;
  let sy = 0;
  for (const [lon, lat] of best) {
    const { x, y } = projection.project(lat, lon);
    sx += x;
    sy += y;
  }
  const n = Math.max(1, best.length);
  return { x: sx / n, y: sy / n };
}

/* ------------------------------------------------------------------ */
/* 색상 스케일                                                          */
/* ------------------------------------------------------------------ */

/**
 * 변동률(%)을 색으로. 국내 관행대로 상승은 적색, 하락은 청색.
 * 농도(채도·명도)로 변동 폭을 표현한다.
 *
 * @param change 기준 시점 대비 변동률 (%)
 * @param span   최대 농도에 도달하는 변동률 (기본 ±20%)
 */
export function changeColor(change: number, span = 20): string {
  const t = Math.max(-1, Math.min(1, change / span));
  const magnitude = Math.abs(t);

  if (magnitude < 0.02) return 'oklch(0.88 0.005 250)';

  if (t > 0) {
    // 연한 분홍 → 진한 적색
    const l = 0.91 - magnitude * 0.36;
    const c = 0.02 + magnitude * 0.19;
    return `oklch(${l.toFixed(3)} ${c.toFixed(3)} 25)`;
  }
  // 연한 하늘 → 진한 청색
  const l = 0.91 - magnitude * 0.29;
  const c = 0.02 + magnitude * 0.16;
  return `oklch(${l.toFixed(3)} ${c.toFixed(3)} 250)`;
}

/** 색 위에 올릴 글자색 (대비 확보) */
export function contrastText(change: number, span = 20): string {
  return Math.abs(change) / span > 0.45 ? 'white' : 'oklch(0.25 0 0)';
}
