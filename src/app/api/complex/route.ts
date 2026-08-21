import { NextResponse } from 'next/server';
import { errorResponse } from '@/lib/api-auth';
import { loadTradeCache, saveTradeCache } from '@/lib/store/market-data';
import { analyzeRebound, BASE_MONTH } from '@/lib/analysis/rebound';
import { findSigungu } from '@/lib/regions';
import { geocodeComplex, hasPlaceApi } from '@/lib/sources/place';
import type { RegionPricePoint, TradeRecord } from '@/lib/types';
import { median, recentYearMonths } from '@/lib/format';
import { baseDongName, dongMatches } from '@/lib/dong-name';
import { adminDongOf, canResolveAdminDong, resolveAdminDongs } from '@/lib/sources/admin-dong';
import { fetchTrades, fetchTradesForMonths, MolitError } from '@/lib/sources/molit';

/** 캐시가 없을 때 국토부에서 바로 받아올 개월 수 */
const LIVE_MONTHS = 24;

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export interface ComplexStat {
  name: string;
  dong: string;
  /** 기준월 대비 변동률 (%) */
  changeSinceBase: number;
  recent3mChange: number;
  /** 직전 실거래가 (원) — 가장 최근 체결 1건 */
  latestPrice: number;
  /** 그 거래의 ㎡당 가격 (원) */
  latestPricePerM2: number;
  /** 그 거래의 전용면적 (㎡) */
  latestAreaM2: number;
  /** 최근 5건 중앙값 (원) — 단발 거래에 흔들리지 않는 참고값 */
  medianPrice: number;
  sampleSize: number;
  latestDealDate: string;
  builtYear?: number;
  /** 분석 가능 여부 */
  hasTrend: boolean;
  /** 지도 표시용 좌표 (지오코딩 성공 시) */
  lat?: number;
  lon?: number;
  /** 지번 — 이름 검색이 실패하는 단지의 주소 지오코딩 폴백에 쓴다 */
  jibun?: string;
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
    let trades = await loadTradeCache([lawd], fromYm);
    let liveFetched = false;

    // 원본 거래는 보유·목표·관심 지역만 쌓아둔다.
    // 그 외 지역을 눌렀을 때 빈 화면을 주지 않도록 국토부에서 바로 받아온다.
    if (trades.length === 0) {
      const months = recentYearMonths(LIVE_MONTHS);
      try {
        const byMonth = await fetchTradesForMonths(lawd, months);
        trades = Object.values(byMonth).flat();
        liveFetched = true;

        // 받아온 것은 trade_cache 에 저장한다.
        // 안 하면 같은 지역을 볼 때마다 국토부를 24회씩 다시 부르고,
        // 일일 쿼터가 소진된 오후에는 빈 화면이 된다 (실제로 있었던 일).
        await Promise.all(
          Object.entries(byMonth)
            .filter(([, list]) => list.length > 0)
            .map(([ym, list]) => saveTradeCache(lawd, ym, list).catch(() => {})),
        );
      } catch (e) {
        // 일일 쿼터 초과(22) 등 — 죽은 화면 대신 이유를 말한다
        if (e instanceof MolitError) {
          return NextResponse.json({
            ok: true,
            lawd,
            dong: dongFilter ?? null,
            complexes: [],
            note: `국토교통부 API 오류: ${e.message} 저장된 지역(보유·목표·관심)은 계속 볼 수 있습니다.`,
            quotaExceeded: e.code === '22',
          });
        }
        throw e;
      }
    }

    if (trades.length === 0) {
      /* 전부 비어 있으면 "거래가 없는 지역"과 "쿼터/네트워크 문제"를 구분해야 한다.
         월별 조회는 개별 실패를 조용히 빈 배열로 처리하므로(한 달 실패로 전체를
         죽이지 않기 위해), 여기서 캐시를 우회한 1회 프로브로 원인을 확인한다. */
      let note = '최근 실거래가 없는 지역입니다.';
      let quotaExceeded = false;
      if (liveFetched) {
        try {
          await fetchTrades(lawd, recentYearMonths(1)[0], 0);
        } catch (probe) {
          if (probe instanceof MolitError) {
            quotaExceeded = probe.code === '22';
            note = `국토교통부 API 오류: ${probe.message} 저장된 지역(보유·목표·관심)은 계속 볼 수 있습니다.`;
          }
        }
      }
      return NextResponse.json({
        ok: true,
        lawd,
        dong: dongFilter ?? null,
        complexes: [],
        note,
        quotaExceeded,
      });
    }

    /* 단지별로 월 시계열을 만든다 */
    const byComplex = new Map<
      string,
      {
        dong: string;
        jibun?: string;
        builtYear?: number;
        months: Map<string, number[]>;
        all: TradeRecord[];
      }
    >();

    for (const t of trades) {
      if (t.canceled || t.price <= 0 || t.areaM2 <= 0) continue;
      // 지도는 행정동(자양2동), 실거래는 법정동(자양동)이라 이름이 다르다
      if (dongFilter && !dongMatches(t.dong, dongFilter)) continue;
      const month = t.dealDate.slice(0, 7);
      if (month < from || (to && month > to)) continue;

      const key = t.complexName;
      if (!key) continue;
      let entry = byComplex.get(key);
      if (!entry) {
        entry = {
          dong: t.dong,
          jibun: t.jibun,
          builtYear: t.builtYear,
          months: new Map(),
          all: [],
        };
        byComplex.set(key, entry);
      }
      entry.jibun ??= t.jibun;
      const bucket = entry.months.get(month) ?? [];
      bucket.push(t.price / t.areaM2);
      entry.months.set(month, bucket);
      entry.all.push(t);
    }

    /* 행정동으로 한 번 더 거른다.
       "자양2동" 처럼 번호가 붙은 이름을 눌렀다면 사용자는 그 행정동만 보고 싶은 것이다.
       법정동(자양동)만으로는 구분이 안 되므로 지번을 행정동으로 바꿔 비교한다. */
    const wantsAdminDong =
      Boolean(dongFilter) && baseDongName(dongFilter!) !== dongFilter && canResolveAdminDong();
    let adminDongResolved = false;

    if (wantsAdminDong) {
      const pairs = [...byComplex.values()]
        .filter((e) => e.jibun)
        .map((e) => ({ umdNm: e.dong, jibun: e.jibun! }));

      const map = await resolveAdminDongs(lawd, findSigungu(lawd)?.name ?? '', pairs);

      if (Object.keys(map).length > 0) {
        adminDongResolved = true;
        for (const [name, entry] of [...byComplex.entries()]) {
          if (!entry.jibun) continue; // 지번을 모르면 지우지 않는다 (빈 화면보다 낫다)
          const admin = adminDongOf(map, entry.dong, entry.jibun);
          if (admin && admin !== dongFilter) byComplex.delete(name);
        }
      }
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
      const latest = sorted[0];

      complexes.push({
        name,
        dong: entry.dong,
        changeSinceBase: analysis.changeSinceBase,
        recent3mChange: analysis.recent3mChange,
        /* 예전에는 거래가와 ㎡당 가격을 각각 따로 중앙값으로 냈다.
           면적이 섞인 단지에서는 두 값이 서로 다른 거래에서 나와
           "13.2억 ÷ 2,520만 = 52.4㎡" 처럼 존재하지 않는 면적이 계산됐다.
           같은 한 건(가장 최근 거래)에서 뽑아 서로 맞아떨어지게 한다. */
        latestPrice: latest?.price ?? 0,
        latestPricePerM2: latest ? Math.round(latest.price / latest.areaM2) : 0,
        latestAreaM2: latest?.areaM2 ?? 0,
        medianPrice: Math.round(median(recent.map((t) => t.price))),
        sampleSize: entry.all.length,
        latestDealDate: sorted[0]?.dealDate ?? '',
        builtYear: entry.builtYear,
        jibun: entry.jibun,
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
          const coord = await geocodeComplex(c.name, region?.name ?? '', c.dong, c.jibun).catch(
            () => null,
          );
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
      // 캐시가 없어 국토부에서 즉석 조회한 경우 (기간이 최근 24개월로 제한된다)
      liveFetched,
      // 행정동(자양2동)까지 좁혀서 걸렀는지. false 면 법정동(자양동) 전체다.
      adminDongResolved,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
