import { NextResponse } from 'next/server';
import { errorResponse } from '@/lib/api-auth';
import { loadTradeCache } from '@/lib/store/market-data';
import { analyzeRebound, BASE_MONTH } from '@/lib/analysis/rebound';
import { findSigungu } from '@/lib/regions';
import { geocodeComplex, hasPlaceApi } from '@/lib/sources/place';
import type { RegionPricePoint, TradeRecord } from '@/lib/types';
import { median } from '@/lib/format';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export interface ComplexStat {
  name: string;
  dong: string;
  /** 기준월 대비 변동률 (%) */
  changeSinceBase: number;
  recent3mChange: number;
  /** 최근 거래가 중앙값 (원) */
  latestPrice: number;
  /** ㎡당 최근 중앙값 (원) */
  latestPricePerM2: number;
  sampleSize: number;
  latestDealDate: string;
  builtYear?: number;
  /** 분석 가능 여부 */
  hasTrend: boolean;
  /** 지도 표시용 좌표 (지오코딩 성공 시) */
  lat?: number;
  lon?: number;
}

/**
 * 시군구(선택적으로 특정 동) 안의 아파트 단지별 시세 흐름.
 *
 * 원본 거래(trade_cache)가 있어야 하므로, 보유·목표·관심 지역으로 등록된
 * 시군구만 단지 단위까지 내려갈 수 있다.
 *
 * GET /api/complex?lawd=11710&dong=잠실동&from=2023-01&to=2026-08&geocode=1
 */
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const lawd = params.get('lawd') ?? '';
    if (!/^\d{5}$/.test(lawd)) {
      return NextResponse.json({ ok: false, error: 'lawd(5자리)가 필요합니다.' }, { status: 400 });
    }

    const dongFilter = params.get('dong')?.trim();
    const from = params.get('from') || BASE_MONTH;
    const to = params.get('to') || undefined;
    const wantGeocode = params.get('geocode') === '1' && hasPlaceApi();

    // trade_cache 는 YYYYMM 키를 쓴다
    const fromYm = from.replace('-', '');
    const trades = await loadTradeCache([lawd], fromYm);

    if (trades.length === 0) {
      return NextResponse.json({
        ok: true,
        lawd,
        dong: dongFilter ?? null,
        complexes: [],
        note: '이 시군구의 원본 실거래가 수집되지 않았습니다. 설정에서 관심 지역으로 등록하면 단지 단위까지 수집합니다.',
      });
    }

    /* 단지별로 월 시계열을 만든다 */
    const byComplex = new Map<
      string,
      { dong: string; builtYear?: number; months: Map<string, number[]>; all: TradeRecord[] }
    >();

    for (const t of trades) {
      if (t.canceled || t.price <= 0 || t.areaM2 <= 0) continue;
      if (dongFilter && t.dong !== dongFilter) continue;
      const month = t.dealDate.slice(0, 7);
      if (month < from || (to && month > to)) continue;

      const key = t.complexName;
      if (!key) continue;
      let entry = byComplex.get(key);
      if (!entry) {
        entry = { dong: t.dong, builtYear: t.builtYear, months: new Map(), all: [] };
        byComplex.set(key, entry);
      }
      const bucket = entry.months.get(month) ?? [];
      bucket.push(t.price / t.areaM2);
      entry.months.set(month, bucket);
      entry.all.push(t);
    }

    const complexes: ComplexStat[] = [];
    for (const [name, entry] of byComplex) {
      const series: RegionPricePoint[] = [...entry.months.entries()]
        .map(([month, perM2]) => ({
          month,
          pricePerM2: Math.round(median(perM2)),
          count: perM2.length,
        }))
        .sort((a, b) => a.month.localeCompare(b.month));

      // 단지 단위는 표본이 가장 적어 최소 거래건수를 1로 낮춘다
      const analysis = analyzeRebound(lawd, series, {
        minTrades: 1,
        baseMonth: from,
        endMonth: to,
      });
      const sorted = [...entry.all].sort((a, b) => b.dealDate.localeCompare(a.dealDate));
      const recent = sorted.slice(0, 5);

      complexes.push({
        name,
        dong: entry.dong,
        changeSinceBase: analysis.changeSinceBase,
        recent3mChange: analysis.recent3mChange,
        latestPrice: Math.round(median(recent.map((t) => t.price))),
        latestPricePerM2: Math.round(median(recent.map((t) => t.price / t.areaM2))),
        sampleSize: entry.all.length,
        latestDealDate: sorted[0]?.dealDate ?? '',
        builtYear: entry.builtYear,
        hasTrend: analysis.stage !== 'insufficient-data',
      });
    }

    complexes.sort((a, b) => b.sampleSize - a.sampleSize);

    /* 지도 표시용 좌표 — 거래가 많은 상위 단지만 지오코딩 (API 호출량 억제) */
    if (wantGeocode) {
      const region = findSigungu(lawd);
      const top = complexes.slice(0, 20);
      await Promise.all(
        top.map(async (c) => {
          const coord = await geocodeComplex(c.name, region?.name ?? '', c.dong).catch(() => null);
          if (coord) {
            c.lat = coord.lat;
            c.lon = coord.lon;
          }
        }),
      );
    }

    return NextResponse.json({
      ok: true,
      lawd,
      region: findSigungu(lawd)?.name ?? lawd,
      dong: dongFilter ?? null,
      complexes: complexes.slice(0, 120),
      geocoded: wantGeocode,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
