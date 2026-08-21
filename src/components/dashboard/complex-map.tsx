'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, Loader2, MapPin } from 'lucide-react';
import type { ComplexStat } from '@/app/api/complex/route';
import { changeColor } from '@/lib/geo';
import { formatKrw, formatPct } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * 동 단위 실제 지도 — 카카오맵 JS SDK 위에 아파트 단지 마커를 올린다.
 *
 * 왜 카카오맵인가:
 *  - 네이버 부동산은 공식 API 가 없고 크롤링은 이용약관 위반이라 쓸 수 없다.
 *  - 카카오맵은 JavaScript 키만 발급하면 무료(일 30만 회)로 지도 타일을 쓸 수 있고,
 *    이미 브리핑·주변시설에 쓰는 카카오 앱에서 키 하나만 더 받으면 된다.
 *
 * 시세는 국토교통부 실거래가(실제 체결가)다. 호가는 어느 플랫폼도 API 로 열지 않아
 * 설정에서 직접 입력하는 값을 쓴다.
 *
 * 키가 없으면 지도 없이 목록만 보여준다.
 */

declare global {
  interface Window {
    kakao?: {
      maps: {
        load: (cb: () => void) => void;
        Map: new (container: HTMLElement, options: unknown) => KakaoMap;
        LatLng: new (lat: number, lng: number) => unknown;
        LatLngBounds: new () => KakaoBounds;
        CustomOverlay: new (options: unknown) => KakaoOverlay;
      };
    };
  }
}

interface KakaoMap {
  setBounds: (bounds: KakaoBounds) => void;
  setCenter: (latlng: unknown) => void;
  setLevel: (level: number) => void;
}
interface KakaoBounds {
  extend: (latlng: unknown) => void;
}
interface KakaoOverlay {
  setMap: (map: KakaoMap | null) => void;
}

const SDK_ID = 'kakao-maps-sdk';

let sdkPromise: Promise<boolean> | null = null;

/** 카카오맵 SDK 를 한 번만 로드한다 */
function loadKakaoSdk(jsKey: string): Promise<boolean> {
  if (typeof window === 'undefined') return Promise.resolve(false);
  if (window.kakao?.maps) return Promise.resolve(true);

  if (!sdkPromise) {
    sdkPromise = new Promise<boolean>((resolve) => {
      const existing = document.getElementById(SDK_ID) as HTMLScriptElement | null;
      const script = existing ?? document.createElement('script');
      if (!existing) {
        script.id = SDK_ID;
        script.async = true;
        script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${jsKey}&autoload=false`;
        document.head.appendChild(script);
      }
      script.addEventListener('load', () => {
        window.kakao?.maps.load(() => resolve(true));
      });
      script.addEventListener('error', () => resolve(false));
      // 이미 로드된 경우
      if (existing && window.kakao?.maps) {
        window.kakao.maps.load(() => resolve(true));
      }
    });
  }
  return sdkPromise;
}

export interface ComplexMapProps {
  complexes: ComplexStat[];
  /** 카카오 JavaScript 키 (NEXT_PUBLIC_KAKAO_JS_KEY) */
  jsKey?: string;
  regionLabel: string;
  span?: number;
  loading?: boolean;
}

export function ComplexMap({
  complexes,
  jsKey,
  regionLabel,
  span = 20,
  loading = false,
}: ComplexMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<KakaoMap | null>(null);
  const overlaysRef = useRef<KakaoOverlay[]>([]);
  const [sdkReady, setSdkReady] = useState(false);
  const [sdkFailed, setSdkFailed] = useState(false);
  const [selected, setSelected] = useState<ComplexStat | null>(null);

  const located = useMemo(
    () => complexes.filter((c) => c.lat !== undefined && c.lon !== undefined),
    [complexes],
  );

  // SDK 로드
  useEffect(() => {
    if (!jsKey) return;
    let alive = true;
    loadKakaoSdk(jsKey).then((ok) => {
      if (!alive) return;
      if (ok) setSdkReady(true);
      else setSdkFailed(true);
    });
    return () => {
      alive = false;
    };
  }, [jsKey]);

  // 지도 생성 + 마커 렌더
  useEffect(() => {
    if (!sdkReady || !containerRef.current || located.length === 0) return;
    const kakao = window.kakao;
    if (!kakao) return;

    if (!mapRef.current) {
      mapRef.current = new kakao.maps.Map(containerRef.current, {
        center: new kakao.maps.LatLng(located[0].lat!, located[0].lon!),
        level: 5,
      });
    }
    const map = mapRef.current;

    // 이전 마커 제거
    overlaysRef.current.forEach((o) => o.setMap(null));
    overlaysRef.current = [];

    const bounds = new kakao.maps.LatLngBounds();

    for (const c of located) {
      const pos = new kakao.maps.LatLng(c.lat!, c.lon!);
      bounds.extend(pos);

      const color = c.hasTrend ? changeColor(c.changeSinceBase, span) : 'var(--muted-foreground)';
      const el = document.createElement('div');
      el.className = 'cursor-pointer select-none';
      el.innerHTML = `
        <div style="
          transform: translate(-50%, -100%);
          background:${color};
          color:#fff;
          border:2px solid #fff;
          border-radius:9999px;
          padding:3px 8px;
          font-size:11px;
          font-weight:700;
          white-space:nowrap;
          box-shadow:0 2px 6px rgba(0,0,0,.3);
        ">${c.name.length > 8 ? c.name.slice(0, 7) + '…' : c.name} ${(c.latestPrice / 100_000_000).toFixed(1)}억</div>
      `;
      el.addEventListener('click', () => setSelected(c));

      const overlay = new kakao.maps.CustomOverlay({ position: pos, content: el, yAnchor: 1 });
      overlay.setMap(map);
      overlaysRef.current.push(overlay);
    }

    map.setBounds(bounds);
  }, [sdkReady, located, span]);

  /* ---------- 키가 없거나 실패한 경우 ---------- */

  const showMap = jsKey && !sdkFailed;

  return (
    <div className="space-y-3">
      {showMap ? (
        <div className="relative">
          <div
            ref={containerRef}
            className="bg-muted/30 h-80 w-full overflow-hidden rounded-lg border"
          />
          {!sdkReady || loading ? (
            <div className="bg-background/70 absolute inset-0 flex items-center justify-center rounded-lg backdrop-blur-sm">
              <span className="text-muted-foreground flex items-center gap-2 text-sm">
                <Loader2 className="size-4 animate-spin" />
                {loading ? '단지 위치를 불러오는 중…' : '지도 불러오는 중…'}
              </span>
            </div>
          ) : null}
          {sdkReady && located.length === 0 && !loading ? (
            <div className="bg-background/70 absolute inset-0 flex items-center justify-center rounded-lg text-center text-sm backdrop-blur-sm">
              <span className="text-muted-foreground px-4">
                {regionLabel}의 단지 좌표를 찾지 못했습니다.
                <br />
                아래 목록에서 시세를 확인하세요.
              </span>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="text-muted-foreground rounded-lg border border-dashed p-4 text-center text-xs">
          <MapPin className="mx-auto mb-1 size-4" />
          {sdkFailed
            ? '카카오맵 SDK 를 불러오지 못했습니다. 개발자센터에서 JavaScript 키의 사이트 도메인이 등록됐는지 확인하세요.'
            : '실제 지도를 보려면 NEXT_PUBLIC_KAKAO_JS_KEY 를 설정하세요 (카카오 개발자센터 > 앱 키 > JavaScript 키).'}
        </div>
      )}

      {/* 선택 단지 상세 */}
      {selected ? (
        <div className="rounded-lg border p-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="font-medium">{selected.name}</div>
              <div className="text-muted-foreground text-[11px]">
                {selected.dong}
                {selected.builtYear ? ` · ${selected.builtYear}년 준공` : ''} · 거래{' '}
                {selected.sampleSize}건
              </div>
            </div>
            <a
              // 네이버부동산에는 공식 딥링크 스펙이 없어 검색 결과로 연다.
              // PC 용 new.land.naver.com/search?sk= 형식은 404 로 확인돼 모바일 URL 을 쓴다
              // (PC 브라우저에서도 정상 동작한다).
              href={`https://m.land.naver.com/search/result/${encodeURIComponent(`${regionLabel} ${selected.name}`)}`}
              target="_blank"
              rel="noreferrer"
              className="text-muted-foreground hover:text-foreground"
              title="네이버부동산에서 보기"
            >
              <ExternalLink className="size-4" />
            </a>
          </div>
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">최근 실거래</dt>
              <dd className="tabular font-medium">{formatKrw(selected.latestPrice)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">㎡당</dt>
              <dd className="tabular">{formatKrw(selected.latestPricePerM2)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">기간 변동</dt>
              <dd
                className={cn(
                  'tabular font-medium',
                  selected.changeSinceBase >= 0 ? 'text-rise' : 'text-fall',
                )}
              >
                {selected.hasTrend ? formatPct(selected.changeSinceBase, 1) : '표본부족'}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">최근 거래일</dt>
              <dd className="tabular">{selected.latestDealDate || '-'}</dd>
            </div>
          </dl>
        </div>
      ) : null}

      {/* 단지 목록 */}
      {complexes.length > 0 ? (
        <div>
          <h4 className="mb-1.5 text-xs font-semibold">
            {regionLabel} 단지별 실거래{' '}
            <span className="text-muted-foreground font-normal">({complexes.length}개)</span>
          </h4>
          <ul className="thin-scrollbar max-h-64 space-y-0.5 overflow-y-auto pr-1">
            {complexes.map((c) => (
              <li key={c.name}>
                <button
                  type="button"
                  onClick={() => setSelected(c)}
                  className={cn(
                    'hover:bg-muted flex w-full items-center gap-2 rounded px-2 py-1 text-xs transition-colors',
                    selected?.name === c.name && 'bg-muted',
                  )}
                >
                  <span
                    className="size-2.5 shrink-0 rounded-full"
                    style={{
                      background: c.hasTrend
                        ? changeColor(c.changeSinceBase, span)
                        : 'var(--muted)',
                    }}
                  />
                  <span className="flex-1 truncate text-left">{c.name}</span>
                  <span className="tabular text-muted-foreground">{c.sampleSize}건</span>
                  <span className="tabular w-16 text-right font-medium">
                    {formatKrw(c.latestPrice, { compact: true })}
                  </span>
                  <span
                    className={cn(
                      'tabular w-14 text-right',
                      c.changeSinceBase >= 0 ? 'text-rise' : 'text-fall',
                    )}
                  >
                    {c.hasTrend ? formatPct(c.changeSinceBase, 1) : '-'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <p className="text-muted-foreground mt-1.5 text-[10px]">
            시세는 국토교통부 실거래가(실제 체결가)입니다. 호가는 어느 플랫폼도 API 로 제공하지 않아
            설정에서 직접 입력한 값을 씁니다.
          </p>
        </div>
      ) : null}
    </div>
  );
}
