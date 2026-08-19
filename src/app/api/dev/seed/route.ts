import { NextResponse } from 'next/server';
import { errorResponse } from '@/lib/api-auth';
import { saveConfig } from '@/lib/store/config';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { saveDongMonthly, saveRegionMonthly, saveTradeCache } from '@/lib/store/market-data';
import { DEFAULT_ANALYSIS_REGIONS, findSigungu } from '@/lib/regions';
import type { RegionPricePoint, TradeRecord } from '@/lib/types';
import { dashYearMonth, recentYearMonths } from '@/lib/format';
import { featureFlags } from '@/lib/env';

export const dynamic = 'force-dynamic';

/**
 * 개발 전용 샘플 데이터 시드.
 *
 * API 키를 발급받기 전에 대시보드의 모든 섹션이 어떻게 보이는지 확인하기 위한 것이다.
 * 여기서 만드는 수치는 전부 합성 데이터이며 실제 시세가 아니다.
 * 운영 환경(NODE_ENV=production)에서는 동작하지 않는다.
 */

/** 전처리된 경계 파일에서 해당 시군구의 행정동 이름 목록을 읽는다 (없으면 빈 배열) */
function readDongNames(lawdCd: string): string[] {
  try {
    const raw = readFileSync(path.join(process.cwd(), 'public', 'geo', 'dong', `${lawdCd}.json`), 'utf8');
    const fc = JSON.parse(raw) as { features: Array<{ properties: { name: string } }> };
    return [...new Set(fc.features.map((f) => f.properties.name))];
  } catch {
    return [];
  }
}

/** 결정론적 의사난수 — 새로고침해도 같은 그림이 나오도록 */
function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

export async function POST(request: Request) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json(
      { ok: false, error: '샘플 시드는 개발 환경에서만 사용할 수 있습니다.' },
      { status: 403 },
    );
  }

  // Supabase 가 연결돼 있으면 합성 데이터가 실제 DB 를 덮어쓰게 되므로 기본적으로 막는다
  const force = new URL(request.url).searchParams.get('force') === '1';
  if (featureFlags.hasSupabaseAdmin && !force) {
    return NextResponse.json(
      {
        ok: false,
        error:
          'Supabase 가 연결돼 있어 중단했습니다. 합성 데이터가 실제 설정과 실거래 캐시를 덮어씁니다. ' +
          '그래도 진행하려면 ?force=1 을 붙이세요.',
      },
      { status: 409 },
    );
  }

  try {
    const months = recentYearMonths(44); // 2022년 중반 ~ 현재
    const codes = DEFAULT_ANALYSIS_REGIONS;

    /*
     * 1) 지역별 월 시계열
     *
     * 실제 사이클을 흉내 낸다: 2022 하락 → 2023 중반 저점 → 2024 횡보 →
     * 2025~2026 상승. 상급지는 먼저·크게 오르고 지방은 늦거나 아예 못 오른다.
     * (전부 합성 데이터이며 실제 시세가 아니다. UI 검증용이다.)
     */
    const tierOf = (code: string): 'core' | 'seoul' | 'metro' | 'local' => {
      if (['11650', '11680', '11710', '11170', '11200', '41135'].includes(code)) return 'core';
      if (code.startsWith('11')) return 'seoul';
      if (code.startsWith('41') || code.startsWith('28')) return 'metro';
      return 'local';
    };

    for (const code of codes) {
      const rnd = seeded(Number(code) + 7);
      const tier = tierOf(code);

      const basePrice =
        tier === 'core'
          ? 22_000_000
          : tier === 'seoul'
            ? 13_000_000 + rnd() * 5_000_000
            : tier === 'metro'
              ? 8_000_000 + rnd() * 5_000_000
              : 4_000_000 + rnd() * 4_000_000;

      // 저점 시점(개월 인덱스)과 이후 상승폭 — 상급지일수록 빠르고 강하다
      const troughAt =
        tier === 'core' ? 10 : tier === 'seoul' ? 13 : tier === 'metro' ? 17 : 22 + rnd() * 8;
      const upside =
        tier === 'core'
          ? 0.45 + rnd() * 0.2 // 전고점 크게 돌파
          : tier === 'seoul'
            ? 0.25 + rnd() * 0.2
            : tier === 'metro'
              ? 0.05 + rnd() * 0.2
              : rnd() * 0.14 - 0.06; // 일부는 여전히 마이너스

      const points: RegionPricePoint[] = months.map((ym, idx) => {
        const drop = -0.2 * Math.min(1, idx / troughAt);
        // 저점 이후 S자 형태로 상승 (초기 완만 → 가속 → 둔화)
        const t = Math.max(0, (idx - troughAt) / (months.length - troughAt));
        const rebound = upside * (1 / (1 + Math.exp(-8 * (t - 0.45))));
        const noise = (rnd() - 0.5) * 0.012;
        return {
          month: dashYearMonth(ym),
          pricePerM2: Math.round(basePrice * (1 + drop + rebound + noise)),
          count: 20 + Math.floor(rnd() * 90),
        };
      });

      await saveRegionMonthly(code, points);

      // 동 단위 합성 데이터 — 실제 행정동 이름(전처리된 경계 파일)을 써서 지도 드릴다운이 색칠되게 한다
      const dongNames = readDongNames(code);
      if (dongNames.length > 0) {
        const byDong: Record<string, RegionPricePoint[]> = {};
        for (const dong of dongNames) {
          const dongFactor = 0.85 + rnd() * 0.35;
          const dongTrendDelta = (rnd() - 0.5) * 0.15;
          byDong[dong] = points.map((p, idx) => {
            const t = idx / points.length;
            return {
              month: p.month,
              pricePerM2: Math.round(p.pricePerM2 * dongFactor * (1 + dongTrendDelta * t)),
              count: 2 + Math.floor(rnd() * 10),
            };
          });
        }
        await saveDongMonthly(code, byDong);
      }
    }

    // 2) 샘플 설정 (보유/목표/관심 지역)
    const config = await saveConfig({
      holdings: [
        {
          kind: 'holding',
          id: 'sample-holding',
          complexName: '샘플 아파트',
          sido: '서울특별시',
          sigungu: '노원구',
          dong: '상계동',
          lawdCd: '11350',
          areaM2: 84.97,
          acquiredAt: '2018-05-20',
          acquisitionPrice: 550_000_000,
          acquisitionCost: 12_000_000,
          capitalExpenditure: 20_000_000,
          residenceMonths: 90,
          loanBalance: 150_000_000,
          loanRate: 4.1,
          leaseDeposit: 0,
          manualPrice: 880_000_000,
        },
      ],
      targets: [
        {
          kind: 'target',
          id: 'sample-target',
          complexName: '샘플 목표단지',
          sido: '서울특별시',
          sigungu: '송파구',
          dong: '가락동',
          lawdCd: '11710',
          areaM2: 84.99,
          manualPrice: 1_950_000_000,
          priority: 1,
          memo: '샘플 데이터입니다',
        },
      ],
      watchRegions: [
        {
          id: 'sample-region-1',
          name: '서울 송파구',
          sido: '서울특별시',
          sigungu: '송파구',
          lawdCd: '11710',
          keywords: ['재건축', '위례신사선'],
        },
        {
          id: 'sample-region-2',
          name: '경기 성남시 분당구',
          sido: '경기도',
          sigungu: '성남시 분당구',
          lawdCd: '41135',
          keywords: ['1기 신도시', '선도지구'],
        },
      ],
      household: {
        ownedHouseCount: 1,
        targetIsRegulated: true,
        holdingIsRegulated: false,
        firstTimeBuyer: false,
        temporaryTwoHouse: true,
        applyMultiHouseSurcharge: false,
        otherCapitalGainThisYear: 0,
      },
      kakaoBriefingEnabled: true,
      briefingHour: 8,
    });

    // 3) 원본 거래 캐시 — 신고가/신저가 분석용
    const userCodes = ['11350', '11710', '41135'];
    for (const code of userCodes) {
      const info = findSigungu(code);
      const rnd = seeded(Number(code) + 99);

      for (const ym of months.slice(-24)) {
        const trades: TradeRecord[] = [];
        const complexes = ['샘플1단지', '샘플2단지', '샘플3단지', '샘플리버뷰'];

        for (let i = 0; i < 12; i += 1) {
          const complexName = complexes[Math.floor(rnd() * complexes.length)];
          const areaM2 = [59.94, 84.97, 114.8][Math.floor(rnd() * 3)];
          const monthIdx = months.indexOf(ym);
          const trend =
            1 - 0.18 * Math.min(1, monthIdx / 18) + 0.2 * Math.max(0, (monthIdx - 18) / 20);
          const base = code === '11710' ? 20_000_000 : code === '41135' ? 15_000_000 : 10_000_000;
          const price =
            Math.round((base * areaM2 * trend * (0.92 + rnd() * 0.16)) / 1_000_000) * 1_000_000;

          trades.push({
            dealDate: `${ym.slice(0, 4)}-${ym.slice(4, 6)}-${String(1 + Math.floor(rnd() * 27)).padStart(2, '0')}`,
            sigungu: info?.name ?? '',
            dong: '샘플동',
            complexName,
            areaM2,
            floor: 1 + Math.floor(rnd() * 25),
            price,
            builtYear: 2005,
            canceled: false,
          });
        }
        await saveTradeCache(code, ym, trades);
      }
    }

    return NextResponse.json({
      ok: true,
      message:
        '샘플(합성) 데이터를 넣었습니다. 실제 시세가 아니며, 실거래 API 키를 연결하면 실제 데이터로 대체됩니다.',
      regions: codes.length,
      months: months.length,
      config: { holdings: config.holdings.length, targets: config.targets.length },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
