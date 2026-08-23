/**
 * 단지 스펙 조회 — 총 세대수 · 용적률 · 대지지분(추정).
 *
 * 설정 화면에서 단지를 고르면 바로 호출해 값을 채운다.
 * 건축물대장(건축HUB)에서 읽으며, 대장 등록명이 인접 단지와 묶여 있으면
 * 실제와 다를 수 있어 응답에 근거(source·address)를 함께 돌려준다.
 *
 * GET /api/complex/spec?lawdCd=11200&name=현대&sido=서울특별시&sigungu=성동구&dong=옥수동
 */

import { NextResponse } from 'next/server';
import { errorResponse } from '@/lib/api-auth';
import { fetchComplexSpec } from '@/lib/sources/building';
import { findComplexJibun } from '@/lib/sources/complex-search';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const lawdCd = url.searchParams.get('lawdCd')?.trim() ?? '';
    const name = url.searchParams.get('name')?.trim() ?? '';
    if (!/^\d{5}$/.test(lawdCd) || !name) {
      return NextResponse.json(
        { ok: false, error: '법정동코드(lawdCd)와 단지명(name)이 필요합니다.' },
        { status: 400 },
      );
    }

    const sido = url.searchParams.get('sido')?.trim() ?? '';
    const sigungu = url.searchParams.get('sigungu')?.trim() ?? '';
    const dong = url.searchParams.get('dong')?.trim() ?? '';

    // 지번은 실거래 캐시의 최빈값으로 찾는다 (네트워크 호출 없음)
    const lot = await findComplexJibun(lawdCd, name).catch(() => null);
    const spec = await fetchComplexSpec({
      complexName: name,
      sido,
      sigungu,
      dong: dong || lot?.dong,
      jibun: lot?.jibun,
    }).catch(() => null);

    if (!spec) return NextResponse.json({ ok: true, spec: null });

    return NextResponse.json({
      ok: true,
      spec: {
        totalHouseholds: spec.households,
        floorAreaRatio: spec.floorAreaRatio ? Math.round(spec.floorAreaRatio * 10) / 10 : undefined,
        landShareM2: spec.landSharePerUnit
          ? Math.round(spec.landSharePerUnit * 100) / 100
          : undefined,
        source: spec.source,
        address: spec.address,
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
