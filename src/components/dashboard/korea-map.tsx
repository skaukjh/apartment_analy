'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, Loader2, Minus, Plus, RotateCcw } from 'lucide-react';
import type { DongStat, ReboundAnalysis } from '@/lib/types';
import type { ComplexStat } from '@/app/api/complex/route';
import {
  changeColor,
  contrastText,
  createProjection,
  geometryBBox,
  geometryCentroid,
  geometryToPath,
  mergeBBox,
  type BBox,
  type DongProps,
  type FeatureCollection,
  type SidoProps,
  type SigunguProps,
} from '@/lib/geo';
import { formatPct } from '@/lib/format';
import { cn } from '@/lib/utils';

const WIDTH = 760;
const MIN_SCALE = 1;
const MAX_SCALE = 90;

/* ------------------------------------------------------------------ */
/* 경계 데이터 로드 (모듈 캐시 — 탭 전환/리렌더에 재요청하지 않음)          */
/* ------------------------------------------------------------------ */

interface Boundaries {
  sido: FeatureCollection<SidoProps>;
  sigungu: FeatureCollection<SigunguProps>;
}

let boundariesPromise: Promise<Boundaries> | null = null;

function loadBoundaries(): Promise<Boundaries> {
  if (!boundariesPromise) {
    boundariesPromise = Promise.all([
      fetch('/geo/sido.json').then((r) => {
        if (!r.ok) throw new Error(`sido.json HTTP ${r.status}`);
        return r.json();
      }),
      fetch('/geo/sigungu.json').then((r) => {
        if (!r.ok) throw new Error(`sigungu.json HTTP ${r.status}`);
        return r.json();
      }),
    ]).then(([sido, sigungu]) => ({ sido, sigungu }));
    boundariesPromise.catch(() => {
      boundariesPromise = null; // 실패 시 다음 마운트에서 재시도
    });
  }
  return boundariesPromise;
}

const dongGeoCache = new Map<string, Promise<FeatureCollection<DongProps> | null>>();

function loadDongGeo(lawdCd: string): Promise<FeatureCollection<DongProps> | null> {
  if (!dongGeoCache.has(lawdCd)) {
    dongGeoCache.set(
      lawdCd,
      fetch(`/geo/dong/${lawdCd}.json`)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    );
  }
  return dongGeoCache.get(lawdCd)!;
}

const dongStatsCache = new Map<string, Promise<DongStat[]>>();

function loadDongStats(lawdCd: string, from?: string, to?: string): Promise<DongStat[]> {
  const key = `${lawdCd}|${from ?? ''}|${to ?? ''}`;
  if (!dongStatsCache.has(key)) {
    const qs = new URLSearchParams({ lawd: lawdCd });
    if (from) qs.set('from', from);
    if (to) qs.set('to', to);
    dongStatsCache.set(
      key,
      fetch(`/api/dong?${qs.toString()}`)
        .then((r) => r.json())
        .then((j) => (j.ok ? (j.dongs as DongStat[]) : []))
        .catch(() => []),
    );
  }
  return dongStatsCache.get(key)!;
}

/**
 * 폴리곤 크기에 맞춰 라벨 글자 크기를 정한다.
 * 너무 작으면 읽을 수 없고, 너무 크면 옆 지역을 침범한다.
 * @param boxPx 화면상 폴리곤의 짧은 변 길이 (px)
 * @param nameLength 표시할 이름 길이
 * @returns SVG 좌표계 기준 font-size (뷰 배율로 나눈 값)
 */
function labelFontSize(boxPx: number, nameLength: number, scale: number): number {
  // 이름이 가로로 들어가려면 글자당 약 1.05배 폭이 필요하다
  const byWidth = (boxPx * 0.85) / Math.max(2, nameLength);
  // 이름 + 수치 2줄이 세로로 들어가야 한다
  const byHeight = boxPx / 2.8;
  const px = Math.min(byWidth, byHeight);
  // 화면상 9~15px 로 제한 후 SVG 좌표계로 환산
  return Math.min(15, Math.max(9, px)) / scale;
}

/**
 * 행정동(지도) 이름을 법정동(실거래) 이름에 잇는 정규화.
 * 방배1동→방배동, 일산3동→일산동, 가락본동→가락동 식의 관습적 변환이며 완벽하지 않다.
 */
function normalizeDong(name: string): string {
  return name.replace(/제?\d+(\.\d+)?동$/, '동').replace(/본동$/, '동');
}

/* ------------------------------------------------------------------ */
/* 컴포넌트                                                             */
/* ------------------------------------------------------------------ */

type Level =
  | { kind: 'nation' }
  | { kind: 'sido'; sido: string }
  | { kind: 'sigungu'; sido: string; code: string; name: string }
  | { kind: 'dong'; sido: string; code: string; name: string; dong: string };

const complexCache = new Map<string, Promise<ComplexStat[]>>();

/**
 * 동 안의 아파트 단지 목록.
 * 단지 경계 폴리곤은 공개 데이터가 없어, 카카오 지오코딩 좌표에 점으로 찍는다.
 */
function loadComplexes(
  lawdCd: string,
  dong: string,
  from?: string,
  to?: string,
): Promise<ComplexStat[]> {
  const key = `${lawdCd}|${dong}|${from ?? ''}|${to ?? ''}`;
  if (!complexCache.has(key)) {
    const qs = new URLSearchParams({ lawd: lawdCd, dong, geocode: '1' });
    if (from) qs.set('from', from);
    if (to) qs.set('to', to);
    complexCache.set(
      key,
      fetch(`/api/complex?${qs.toString()}`)
        .then((r) => r.json())
        .then((j) => (j.ok ? (j.complexes as ComplexStat[]) : []))
        .catch(() => []),
    );
  }
  return complexCache.get(key)!;
}

interface View {
  scale: number;
  x: number;
  y: number;
}

export interface KoreaMapProps {
  rebound: ReboundAnalysis[];
  selected: ReboundAnalysis | null;
  onSelect: (a: ReboundAnalysis | null) => void;
  /** 색 농도가 최대에 도달하는 변동률 (%) */
  span?: number;
  /** 동 단위 통계에도 같은 기간을 적용하기 위한 값 */
  fromMonth?: string;
  toMonth?: string;
  /** 동을 선택하면 부모(실제 지도 패널)에 알린다 */
  onDongChange?: (info: { lawdCd: string; region: string; dong: string } | null) => void;
  /** 단지 목록을 부모와 공유해 실제 지도에도 같은 데이터를 쓴다 */
  onComplexesChange?: (complexes: ComplexStat[] | null, loading: boolean) => void;
}

export function KoreaMap({
  rebound,
  selected,
  onSelect,
  span = 20,
  fromMonth,
  toMonth,
  onDongChange,
  onComplexesChange,
}: KoreaMapProps) {
  const [boundaries, setBoundaries] = useState<Boundaries | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [level, setLevel] = useState<Level>({ kind: 'nation' });
  const [view, setView] = useState<View>({ scale: 1, x: 0, y: 0 });
  const [animate, setAnimate] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [dongGeo, setDongGeo] = useState<FeatureCollection<DongProps> | null>(null);
  const [dongStats, setDongStats] = useState<DongStat[] | null>(null);
  const [dongLoading, setDongLoading] = useState(false);
  const [complexes, setComplexes] = useState<ComplexStat[] | null>(null);
  const [complexLoading, setComplexLoading] = useState(false);

  const svgRef = useRef<SVGSVGElement>(null);
  const dragOrigin = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);
  const movedRef = useRef(false);
  /** 모바일 핀치 줌 — 화면에 닿아 있는 포인터들과 시작 시점의 두 손가락 간격 */
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<{ distance: number; scale: number } | null>(null);

  const projection = useMemo(() => createProjection(WIDTH), []);
  const H = projection.height;

  useEffect(() => {
    let alive = true;
    loadBoundaries()
      .then((b) => alive && setBoundaries(b))
      .catch((e) => alive && setGeoError((e as Error).message));
    return () => {
      alive = false;
    };
  }, []);

  const byCode = useMemo(() => new Map(rebound.map((r) => [r.lawdCd, r])), [rebound]);

  /* ---------- 도형 전처리 ---------- */

  const clampBBox = useCallback(
    (b: BBox): BBox => ({
      minX: Math.max(0, b.minX),
      minY: Math.max(0, b.minY),
      maxX: Math.min(projection.width, b.maxX),
      maxY: Math.min(H, b.maxY),
    }),
    [projection, H],
  );

  const sidoShapes = useMemo(() => {
    if (!boundaries) return [];
    return boundaries.sido.features.map((f) => ({
      sido: f.properties.sido,
      name: f.properties.name,
      path: geometryToPath(f.geometry, projection),
      centroid: geometryCentroid(f.geometry, projection),
    }));
  }, [boundaries, projection]);

  const sigunguShapes = useMemo(() => {
    if (!boundaries) return [];
    return boundaries.sigungu.features.map((f, i) => ({
      key: `sg${i}`,
      codes: f.properties.codes,
      name: f.properties.name,
      sido: f.properties.sido,
      path: geometryToPath(f.geometry, projection),
      bbox: clampBBox(geometryBBox(f.geometry, projection)),
      centroid: geometryCentroid(f.geometry, projection),
    }));
  }, [boundaries, projection, clampBBox]);

  type SigunguShape = (typeof sigunguShapes)[number];

  /** 시도별 확대 영역 = 소속 시군구 bbox 합집합 */
  const sidoBBoxes = useMemo(() => {
    const m = new Map<string, BBox>();
    for (const s of sigunguShapes) {
      const prev = m.get(s.sido);
      m.set(s.sido, prev ? mergeBBox(prev, s.bbox) : s.bbox);
    }
    return m;
  }, [sigunguShapes]);

  /** 시도 단위 대표 변동률 — 소속 지역의 표본 가중 평균 */
  const sidoAgg = useMemo(() => {
    const m = new Map<string, { change: number; samples: number }>();
    for (const r of rebound) {
      if (r.stage === 'insufficient-data') continue;
      const prev = m.get(r.sido) ?? { change: 0, samples: 0 };
      m.set(r.sido, {
        change: prev.change + r.changeSinceBase * r.sampleSize,
        samples: prev.samples + r.sampleSize,
      });
    }
    const out = new Map<string, number>();
    for (const [sido, v] of m) if (v.samples > 0) out.set(sido, v.change / v.samples);
    return out;
  }, [rebound]);

  /** 시군구 폴리곤의 대표 변동률 (codes 가 여러 개면 표본 가중 평균) */
  const shapeChange = useCallback(
    (shape: SigunguShape): number | null => {
      let acc = 0;
      let samples = 0;
      for (const code of shape.codes) {
        const a = byCode.get(code);
        if (!a || a.stage === 'insufficient-data') continue;
        acc += a.changeSinceBase * a.sampleSize;
        samples += a.sampleSize;
      }
      return samples > 0 ? acc / samples : null;
    },
    [byCode],
  );

  /* ---------- 뷰 조작 ---------- */

  const clampView = useCallback(
    (v: View): View => {
      const maxX = projection.width * (v.scale - 1);
      const maxY = H * (v.scale - 1);
      return {
        scale: v.scale,
        x: Math.min(0, Math.max(-maxX, v.x)),
        y: Math.min(0, Math.max(-maxY, v.y)),
      };
    },
    [projection, H],
  );

  const zoomAt = useCallback(
    (factor: number, focusX: number, focusY: number) => {
      setAnimate(false);
      setView((prev) => {
        const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, prev.scale * factor));
        if (next === prev.scale) return prev;
        const k = next / prev.scale;
        return clampView({
          scale: next,
          x: focusX - (focusX - prev.x) * k,
          y: focusY - (focusY - prev.y) * k,
        });
      });
    },
    [clampView],
  );

  const zoomToBBox = useCallback(
    (b: BBox, padRatio = 0.12) => {
      const bw = Math.max(4, b.maxX - b.minX);
      const bh = Math.max(4, b.maxY - b.minY);
      const scale = Math.min(
        MAX_SCALE,
        Math.max(MIN_SCALE, Math.min(projection.width / bw, H / bh) * (1 - padRatio)),
      );
      const cx = (b.minX + b.maxX) / 2;
      const cy = (b.minY + b.maxY) / 2;
      setAnimate(true);
      setView(
        clampView({
          scale,
          x: projection.width / 2 - cx * scale,
          y: H / 2 - cy * scale,
        }),
      );
    },
    [projection, H, clampView],
  );

  // React 의 onWheel 은 passive 라 preventDefault 가 막히므로 네이티브 리스너를 단다
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const fx = ((e.clientX - rect.left) / rect.width) * projection.width;
      const fy = ((e.clientY - rect.top) / rect.height) * H;
      zoomAt(e.deltaY < 0 ? 1.25 : 1 / 1.25, fx, fy);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt, projection, H, boundaries]);

  /* ---------- 드릴다운 ---------- */

  /**
   * 동 단위 경계·통계 로드.
   * effect 대신 드릴다운 이벤트에서 직접 부른다 (effect 안 setState 는 연쇄 렌더를 만든다).
   * 요청이 겹칠 때 오래된 응답이 새 응답을 덮어쓰지 않도록 토큰으로 막는다.
   */
  const dongRequestRef = useRef(0);

  const loadDongLayer = useCallback(
    (lawdCd: string) => {
      const token = ++dongRequestRef.current;
      setDongGeo(null);
      setDongStats(null);
      setDongLoading(true);
      void Promise.all([loadDongGeo(lawdCd), loadDongStats(lawdCd, fromMonth, toMonth)])
        .then(([g, s]) => {
          if (dongRequestRef.current !== token) return;
          setDongGeo(g);
          setDongStats(s);
        })
        .finally(() => {
          if (dongRequestRef.current === token) setDongLoading(false);
        });
    },
    [fromMonth, toMonth],
  );

  const goNation = useCallback(() => {
    setLevel({ kind: 'nation' });
    setDongGeo(null);
    setDongStats(null);
    setComplexes(null);
    onDongChange?.(null);
    onSelect(null);
    setAnimate(true);
    setView({ scale: 1, x: 0, y: 0 });
  }, [onSelect, onDongChange]);

  const goSido = useCallback(
    (sido: string) => {
      setLevel({ kind: 'sido', sido });
      setDongGeo(null);
      setDongStats(null);
      setComplexes(null);
      onDongChange?.(null);
      const b = sidoBBoxes.get(sido);
      if (b) zoomToBBox(b);
    },
    [sidoBBoxes, zoomToBBox, onDongChange],
  );

  /** 동 클릭 → 그 안의 아파트 단지 마커 */
  const complexRequestRef = useRef(0);

  const goDong = useCallback(
    (dongName: string, bbox: BBox, lawdCd: string, sido: string, sigunguName: string) => {
      setLevel({ kind: 'dong', sido, code: lawdCd, name: sigunguName, dong: dongName });
      zoomToBBox(bbox, 0.2);

      onDongChange?.({ lawdCd, region: sigunguName, dong: dongName });

      const token = ++complexRequestRef.current;
      setComplexes(null);
      setComplexLoading(true);
      onComplexesChange?.(null, true);
      void loadComplexes(lawdCd, dongName, fromMonth, toMonth)
        .then((list) => {
          if (complexRequestRef.current !== token) return;
          setComplexes(list);
          onComplexesChange?.(list, false);
        })
        .finally(() => {
          if (complexRequestRef.current === token) setComplexLoading(false);
        });
    },
    [zoomToBBox, fromMonth, toMonth, onDongChange, onComplexesChange],
  );

  /** 폴리곤의 codes 중 표본이 가장 많은 코드를 대표로 */
  const pickCode = useCallback(
    (shape: SigunguShape): string | undefined => {
      return [...shape.codes].sort(
        (a, b) => (byCode.get(b)?.sampleSize ?? 0) - (byCode.get(a)?.sampleSize ?? 0),
      )[0];
    },
    [byCode],
  );

  const goSigungu = useCallback(
    (shape: SigunguShape) => {
      const code = pickCode(shape);
      if (!code) {
        // 분석 대상 외 지역(예: 울릉군) — 확대만
        zoomToBBox(shape.bbox);
        return;
      }
      setLevel({ kind: 'sigungu', sido: shape.sido, code, name: shape.name });
      onSelect(byCode.get(code) ?? null);
      loadDongLayer(code);
      zoomToBBox(shape.bbox, 0.18);
    },
    [pickCode, byCode, onSelect, zoomToBBox, loadDongLayer],
  );

  /*
   * 외부(순위 목록·검색 등)에서 지역을 선택하면 지도 카메라를 그쪽으로 옮긴다.
   *
   * 이건 "React 상태 → 명령형 지도 카메라" 동기화라 effect 가 맞는 자리인데,
   * 카메라 상태(level/view)도 React state 로 들고 있어 set-state-in-effect 규칙에 걸린다.
   * 렌더 중 동기화로 바꾸면 ref 접근 규칙에 걸리므로, 의도를 명시하고 규칙을 끈다.
   */
  useEffect(() => {
    if (!selected || sigunguShapes.length === 0) return;
    if (level.kind === 'sigungu' && level.code === selected.lawdCd) return;
    const shape = sigunguShapes.find((sg) => sg.codes.includes(selected.lawdCd));
    if (!shape) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLevel({ kind: 'sigungu', sido: shape.sido, code: selected.lawdCd, name: shape.name });
    loadDongLayer(selected.lawdCd);
    zoomToBBox(shape.bbox, 0.18);
    // level 을 넣으면 지도 클릭 때마다 재실행되므로 선택 변화만 본다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, sigunguShapes, loadDongLayer, zoomToBBox]);

  const dongShapes = useMemo(() => {
    if (!dongGeo) return [];
    return dongGeo.features.map((f, i) => ({
      key: `d${i}`,
      name: f.properties.name,
      path: geometryToPath(f.geometry, projection),
      bbox: geometryBBox(f.geometry, projection),
      centroid: geometryCentroid(f.geometry, projection),
    }));
  }, [dongGeo, projection]);

  const dongLookup = useMemo(() => {
    const exact = new Map<string, DongStat>();
    const normal = new Map<string, DongStat>();
    for (const d of dongStats ?? []) {
      exact.set(d.name, d);
      const n = normalizeDong(d.name);
      if (!normal.has(n)) normal.set(n, d);
    }
    return { exact, normal };
  }, [dongStats]);

  const findDongStat = useCallback(
    (name: string): DongStat | undefined =>
      dongLookup.exact.get(name) ??
      dongLookup.normal.get(normalizeDong(name)) ??
      dongLookup.exact.get(normalizeDong(name)),
    [dongLookup],
  );

  /* ---------- 렌더링 ---------- */

  if (geoError) {
    return (
      <div className="text-muted-foreground rounded-lg border border-dashed p-8 text-center text-sm">
        경계 데이터를 불러오지 못했습니다: {geoError}
        <br />
        <code className="text-xs">node scripts/prepare-geo.mjs</code> 실행 여부를 확인하세요.
      </div>
    );
  }

  if (!boundaries) {
    return (
      <div
        className="bg-muted/30 flex w-full animate-pulse items-center justify-center rounded-lg border"
        style={{ aspectRatio: `${WIDTH} / ${Math.round(H)}` }}
      >
        <span className="text-muted-foreground flex items-center gap-2 text-sm">
          <Loader2 className="size-4 animate-spin" /> 행정경계 불러오는 중…
        </span>
      </div>
    );
  }

  const s = view.scale;
  const activeSido = level.kind === 'nation' ? null : level.sido;
  const activeCode = level.kind === 'sigungu' || level.kind === 'dong' ? level.code : null;

  const hint =
    level.kind === 'nation'
      ? '시·도를 클릭하면 구·군 단위로 확대됩니다'
      : level.kind === 'sido'
        ? '구·군을 클릭하면 동 단위까지 내려갑니다'
        : level.kind === 'sigungu'
          ? '동을 클릭하면 그 안의 아파트 단지가 표시됩니다'
          : complexLoading
            ? '단지 위치를 불러오는 중…'
            : (complexes?.length ?? 0) === 0
              ? '이 동의 원본 실거래가 없습니다 (관심 지역으로 등록하면 수집)'
              : '점 하나가 아파트 단지입니다. 색은 기간 내 변동률입니다';

  return (
    <div className="relative w-full select-none">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${projection.width} ${H}`}
        role="img"
        aria-label="행정구역 경계 기반 아파트 실거래 지수 변동 지도"
        className={cn(
          'bg-background h-auto w-full overflow-hidden rounded-lg border',
          // 확대 전에는 세로 스크롤을 살려두고, 확대 후에는 팬·핀치를 위해 브라우저 제스처를 막는다
          view.scale > 1 ? 'touch-none' : 'touch-pan-y',
          dragging ? 'cursor-grabbing' : 'cursor-pointer',
        )}
        onPointerDown={(e) => {
          try {
            // 포인터가 이미 사라진 뒤 이벤트가 도착하면 NotFoundError 가 난다.
            // 캡처는 편의 기능이라 실패해도 드래그 자체는 계속 되게 둔다.
            (e.target as Element).setPointerCapture?.(e.pointerId);
          } catch {
            /* 캡처 실패는 무시 */
          }
          pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          // 두 손가락이 닿으면 핀치 줌 시작
          if (pointersRef.current.size === 2) {
            const [a, b] = [...pointersRef.current.values()];
            pinchRef.current = { distance: Math.hypot(a.x - b.x, a.y - b.y), scale: view.scale };
            dragOrigin.current = null;
            return;
          }
          dragOrigin.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
          movedRef.current = false;
        }}
        onPointerMove={(e) => {
          const rect = svgRef.current?.getBoundingClientRect();
          if (!rect) return;

          // 핀치 줌 (모바일)
          if (pointersRef.current.has(e.pointerId)) {
            pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          }
          if (pinchRef.current && pointersRef.current.size === 2) {
            const [a, b] = [...pointersRef.current.values()];
            const distance = Math.hypot(a.x - b.x, a.y - b.y);
            if (distance > 0 && pinchRef.current.distance > 0) {
              movedRef.current = true;
              const target = pinchRef.current.scale * (distance / pinchRef.current.distance);
              const cx = (((a.x + b.x) / 2 - rect.left) / rect.width) * projection.width;
              const cy = (((a.y + b.y) / 2 - rect.top) / rect.height) * H;
              setAnimate(false);
              setView((prev) => {
                const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, target));
                const k = next / prev.scale;
                return clampView({
                  scale: next,
                  x: cx - (cx - prev.x) * k,
                  y: cy - (cy - prev.y) * k,
                });
              });
            }
            return;
          }

          // 여기서 값을 지역 변수로 복사해 둔다.
          // setView 의 업데이터는 나중에 실행되는데, 그 사이 pointerup 이 나면
          // dragOrigin.current 가 null 이 되어 참조 시 터진다.
          const origin = dragOrigin.current;
          if (!origin) return;
          const dx = e.clientX - origin.x;
          const dy = e.clientY - origin.y;
          if (Math.abs(dx) + Math.abs(dy) > 4) {
            movedRef.current = true;
            setDragging(true);
          }
          if (!movedRef.current || s <= 1) return;
          const ratio = projection.width / rect.width;
          setAnimate(false);
          setView((prev) =>
            clampView({
              scale: prev.scale,
              x: origin.vx + dx * ratio,
              y: origin.vy + dy * ratio,
            }),
          );
        }}
        onPointerUp={(e) => {
          pointersRef.current.delete(e.pointerId);
          if (pointersRef.current.size < 2) pinchRef.current = null;
          dragOrigin.current = null;
          setDragging(false);
        }}
        onPointerCancel={(e) => {
          pointersRef.current.delete(e.pointerId);
          pinchRef.current = null;
          dragOrigin.current = null;
          setDragging(false);
        }}
        onPointerLeave={(e) => {
          pointersRef.current.delete(e.pointerId);
          if (pointersRef.current.size < 2) pinchRef.current = null;
          dragOrigin.current = null;
          setDragging(false);
        }}
      >
        <g
          style={{
            transform: `translate(${view.x}px, ${view.y}px) scale(${s})`,
            transformOrigin: '0 0',
            transition: animate ? 'transform 450ms cubic-bezier(0.22, 1, 0.36, 1)' : 'none',
          }}
        >
          {/* 1) 시도 바탕 — 전국 단계에서는 시도 추세 색, 하위 단계에서는 흐리게 */}
          {sidoShapes.map((sd) => {
            const agg = sidoAgg.get(sd.sido);
            const isActive = sd.sido === activeSido;
            return (
              <path
                key={sd.sido}
                d={sd.path}
                fill={
                  level.kind === 'nation'
                    ? agg !== undefined
                      ? changeColor(agg, span)
                      : 'var(--muted)'
                    : isActive
                      ? 'var(--muted)'
                      : 'var(--muted)'
                }
                opacity={level.kind === 'nation' ? 0.96 : isActive ? 0.4 : 0.35}
                stroke="var(--background)"
                strokeWidth={1.4 / s}
                strokeLinejoin="round"
                className="transition-[opacity]"
                onClick={() => {
                  if (movedRef.current) return;
                  goSido(sd.sido);
                }}
              >
                <title>
                  {sd.name}
                  {agg !== undefined ? ` · ${formatPct(agg, 1)}` : ''} — 클릭해 확대
                </title>
              </path>
            );
          })}

          {/* 2) 활성 시도의 구·군 폴리곤 */}
          {activeSido
            ? sigunguShapes
                .filter((sg) => sg.sido === activeSido)
                .map((sg) => {
                  const change = shapeChange(sg);
                  const isSelected = activeCode !== null && sg.codes.includes(activeCode);
                  const dimmed = level.kind === 'sigungu' && !isSelected;
                  return (
                    <path
                      key={sg.key}
                      d={sg.path}
                      fill={change !== null ? changeColor(change, span) : 'var(--muted)'}
                      opacity={dimmed ? 0.3 : isSelected && dongShapes.length > 0 ? 0.15 : 0.97}
                      stroke="var(--background)"
                      strokeWidth={0.9 / s}
                      strokeLinejoin="round"
                      onClick={() => {
                        if (movedRef.current) return;
                        goSigungu(sg);
                      }}
                    >
                      <title>
                        {sg.name}
                        {change !== null ? ` · ${formatPct(change, 1)}` : ' · 표본부족'} — 클릭해
                        동 단위 보기
                      </title>
                    </path>
                  );
                })
            : null}

          {/* 3) 선택 시군구의 동 폴리곤 */}
          {level.kind === 'sigungu' || level.kind === 'dong'
            ? dongShapes.map((d) => {
                const stat = findDongStat(d.name);
                const has = stat && stat.stage !== 'insufficient-data';
                const isActiveDong = level.kind === 'dong' && level.dong === d.name;
                const dimmed = level.kind === 'dong' && !isActiveDong;
                return (
                  <path
                    key={d.key}
                    d={d.path}
                    fill={has ? changeColor(stat.changeSinceBase, span) : 'var(--muted)'}
                    opacity={dimmed ? 0.25 : has ? 0.97 : 0.55}
                    stroke={isActiveDong ? 'var(--foreground)' : 'var(--background)'}
                    strokeWidth={(isActiveDong ? 1.6 : 0.5) / s}
                    strokeLinejoin="round"
                    className="cursor-pointer"
                    onClick={() => {
                      if (movedRef.current) return;
                      goDong(d.name, d.bbox, level.code, level.sido, level.name);
                    }}
                  >
                    <title>
                      {d.name}
                      {has
                        ? ` · ${stat.baseMonth} 대비 ${formatPct(stat.changeSinceBase, 1)} · 표본 ${stat.sampleSize}건`
                        : ' · 거래 표본 부족'}
                      {' — 클릭해 단지 보기'}
                    </title>
                  </path>
                );
              })
            : null}

          {/* 3-2) 선택 동의 아파트 단지 마커 */}
          {level.kind === 'dong' && complexes
            ? complexes
                .filter((c) => c.lat !== undefined && c.lon !== undefined)
                .map((c) => {
                  const { x, y } = projection.project(c.lat!, c.lon!);
                  const r = Math.max(2.5, 9 / s);
                  return (
                    <g key={`cx-${c.name}`}>
                      <circle
                        cx={x}
                        cy={y}
                        r={r}
                        fill={c.hasTrend ? changeColor(c.changeSinceBase, span) : 'var(--muted)'}
                        stroke="var(--foreground)"
                        strokeWidth={1.2 / s}
                      >
                        <title>
                          {`${c.name} · ${c.dong}`}
                          {c.hasTrend ? ` · ${formatPct(c.changeSinceBase, 1)}` : ''}
                          {` · 최근 ${(c.latestPrice / 100_000_000).toFixed(2)}억 · 거래 ${c.sampleSize}건`}
                        </title>
                      </circle>
                      <text
                        x={x}
                        y={y - r - 2 / s}
                        textAnchor="middle"
                        pointerEvents="none"
                        style={{
                          fontSize: 11 / s,
                          fontWeight: 600,
                          fill: 'var(--foreground)',
                          paintOrder: 'stroke',
                          stroke: 'var(--background)',
                          strokeWidth: 2.5 / s,
                          strokeLinejoin: 'round',
                        }}
                      >
                        {c.name.length > 10 ? `${c.name.slice(0, 9)}…` : c.name}
                      </text>
                    </g>
                  );
                })
            : null}

          {/* 4) 선택 시군구 외곽선 강조 */}
          {activeCode
            ? sigunguShapes
                .filter((sg) => sg.codes.includes(activeCode))
                .map((sg) => (
                  <path
                    key={`sel-${sg.key}`}
                    d={sg.path}
                    fill="none"
                    stroke="var(--foreground)"
                    strokeWidth={1.6 / s}
                    strokeLinejoin="round"
                    pointerEvents="none"
                  />
                ))
            : null}

          {/* 5) 라벨 — 전국 단계 라벨은 서울·인천처럼 작은 시도를 위해 클릭 대상이기도 하다 */}
          {level.kind === 'nation'
            ? sidoShapes.map((sd) => {
                const agg = sidoAgg.get(sd.sido);
                if (sd.sido === '세종') return null; // 대전과 겹쳐 생략 (색으로 표시)
                return (
                  <text
                    key={`lb-${sd.sido}`}
                    x={sd.centroid.x}
                    y={sd.centroid.y}
                    textAnchor="middle"
                    className="cursor-pointer"
                    onClick={() => {
                      if (movedRef.current) return;
                      goSido(sd.sido);
                    }}
                    style={{ fontSize: 15, fontWeight: 700, fill: contrastText(agg ?? 0, span) }}
                  >
                    {sd.sido}
                    <tspan x={sd.centroid.x} dy={15} style={{ fontSize: 12, fontWeight: 600 }}>
                      {agg !== undefined ? formatPct(agg, 1) : '-'}
                    </tspan>
                  </text>
                );
              })
            : null}

          {activeSido && level.kind === 'sido'
            ? sigunguShapes
                .filter((sg) => sg.sido === activeSido)
                .map((sg) => {
                  // 화면상 너무 작은 폴리곤은 라벨을 생략해 겹침을 줄인다 (호버 title 로 확인 가능)
                  const boxPx = Math.min(
                    (sg.bbox.maxX - sg.bbox.minX) * s,
                    (sg.bbox.maxY - sg.bbox.minY) * s,
                  );
                  if (boxPx < 26) return null;
                  const change = shapeChange(sg);
                  // '수원시장안구' → '장안구' 처럼 상위 시 이름을 떼어 짧게 만든다
                  const label = sg.name.replace(/^.+시(?=.+구$)/, '');
                  const fs = labelFontSize(boxPx, label.length, s);
                  return (
                    <text
                      key={`lb-${sg.key}`}
                      x={sg.centroid.x}
                      y={sg.centroid.y}
                      textAnchor="middle"
                      pointerEvents="none"
                      style={{
                        fontSize: fs,
                        fontWeight: 600,
                        fill: contrastText(change ?? 0, span),
                        paintOrder: 'stroke',
                        stroke: 'var(--background)',
                        strokeWidth: fs * 0.08,
                        strokeLinejoin: 'round',
                      }}
                    >
                      {label}
                      <tspan x={sg.centroid.x} dy={fs * 1.05} style={{ fontSize: fs * 0.85 }}>
                        {change !== null ? formatPct(change, 1) : '·'}
                      </tspan>
                    </text>
                  );
                })
            : null}

          {level.kind === 'sigungu' || level.kind === 'dong'
            ? dongShapes.map((d) => {
                // 단지 마커를 볼 때는 다른 동 라벨이 방해되므로 선택한 동만 남긴다
                if (level.kind === 'dong' && level.dong !== d.name) return null;
                const boxPx = Math.min(
                  (d.bbox.maxX - d.bbox.minX) * s,
                  (d.bbox.maxY - d.bbox.minY) * s,
                );
                if (boxPx < 24) return null;
                const stat = findDongStat(d.name);
                const has = stat && stat.stage !== 'insufficient-data';
                const fs = labelFontSize(boxPx, d.name.length, s);
                return (
                  <text
                    key={`lb-${d.key}`}
                    x={d.centroid.x}
                    y={d.centroid.y}
                    textAnchor="middle"
                    pointerEvents="none"
                    style={{
                      fontSize: fs,
                      fontWeight: 600,
                      fill: has
                        ? contrastText(stat.changeSinceBase, span)
                        : 'var(--muted-foreground)',
                      // 폴리곤 경계 위에 글자가 걸쳐도 읽히도록 배경색 외곽선을 깐다
                      paintOrder: 'stroke',
                      stroke: 'var(--background)',
                      strokeWidth: fs * 0.08,
                      strokeLinejoin: 'round',
                    }}
                  >
                    {d.name}
                    {has ? (
                      <tspan x={d.centroid.x} dy={fs * 1.05} style={{ fontSize: fs * 0.85 }}>
                        {formatPct(stat.changeSinceBase, 1)}
                      </tspan>
                    ) : null}
                  </text>
                );
              })
            : null}
        </g>
      </svg>

      {/* 단계 복귀 (우측 상단): 전국 › 시도 › 시군구 › 동 — 상위 단계를 눌러 되돌아간다 */}
      <div className="bg-background/90 absolute top-2 right-2 flex max-w-[calc(100%-1rem)] flex-wrap items-center justify-end gap-0.5 rounded-md border px-1.5 py-1 text-[11px] shadow-sm backdrop-blur sm:text-xs">
        <button
          type="button"
          onClick={goNation}
          className={cn(
            'rounded px-1.5 py-0.5 transition-colors',
            level.kind === 'nation'
              ? 'font-semibold'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground',
          )}
        >
          전국
        </button>
        {activeSido ? (
          <>
            <ChevronRight className="text-muted-foreground size-3" />
            <button
              type="button"
              onClick={() => goSido(activeSido)}
              className={cn(
                'rounded px-1.5 py-0.5 transition-colors',
                level.kind === 'sido'
                  ? 'font-semibold'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              {activeSido}
            </button>
          </>
        ) : null}
        {level.kind === 'sigungu' || level.kind === 'dong' ? (
          <>
            <ChevronRight className="text-muted-foreground size-3" />
            <button
              type="button"
              onClick={() => {
                const shape = sigunguShapes.find((sg) => sg.codes.includes(level.code));
                setLevel({ kind: 'sigungu', sido: level.sido, code: level.code, name: level.name });
                setComplexes(null);
                if (shape) zoomToBBox(shape.bbox, 0.18);
              }}
              className={cn(
                'rounded px-1.5 py-0.5 transition-colors',
                level.kind === 'sigungu'
                  ? 'font-semibold'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              {level.name}
            </button>
            {dongLoading ? <Loader2 className="text-muted-foreground size-3 animate-spin" /> : null}
          </>
        ) : null}
        {level.kind === 'dong' ? (
          <>
            <ChevronRight className="text-muted-foreground size-3" />
            <span className="px-1.5 py-0.5 font-semibold">{level.dong}</span>
            {complexLoading ? (
              <Loader2 className="text-muted-foreground size-3 animate-spin" />
            ) : null}
          </>
        ) : null}
      </div>

      {/* 확대/축소 (우측 하단) */}
      <div className="bg-background/90 absolute right-2 bottom-6 flex flex-col gap-1 rounded-md border p-1 shadow-sm backdrop-blur">
        <IconBtn label="확대" onClick={() => zoomAt(1.4, projection.width / 2, H / 2)}>
          <Plus className="size-3.5" />
        </IconBtn>
        <IconBtn label="축소" onClick={() => zoomAt(1 / 1.4, projection.width / 2, H / 2)}>
          <Minus className="size-3.5" />
        </IconBtn>
        <IconBtn label="처음으로" onClick={goNation}>
          <RotateCcw className="size-3.5" />
        </IconBtn>
      </div>

      <p className="text-muted-foreground bg-background/70 pointer-events-none absolute bottom-1.5 left-2 max-w-[calc(100%-4rem)] rounded px-1.5 text-[10px] backdrop-blur">
        {hint}
        <span className="hidden sm:inline"> · 휠: 확대·축소 · 드래그: 이동</span>
      </p>
    </div>
  );
}

function IconBtn({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="text-muted-foreground hover:bg-muted hover:text-foreground rounded p-1 transition-colors"
    >
      {children}
    </button>
  );
}

/** 색 농도 범례 */
export function ChangeLegend({ span = 20 }: { span?: number }) {
  const stops = [-span, -span / 2, 0, span / 2, span];
  return (
    <div className="text-muted-foreground flex flex-wrap items-center gap-3 text-xs">
      <span>기준월 대비</span>
      <div className="flex items-end gap-1">
        {stops.map((v) => (
          <div key={v} className="flex flex-col items-center gap-0.5">
            <div className="size-6 rounded-sm border" style={{ background: changeColor(v, span) }} />
            <span className="tabular">
              {v > 0 ? '+' : ''}
              {v}%
            </span>
          </div>
        ))}
      </div>
      <span className="flex items-center gap-1">
        <span className="bg-muted inline-block size-3 rounded-sm border" />
        표본부족
      </span>
    </div>
  );
}
