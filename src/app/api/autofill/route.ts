import { NextResponse } from 'next/server';
import { errorResponse } from '@/lib/api-auth';
import { configIdForRequest } from '@/lib/auth/server';
import { buildDashboard } from '@/lib/pipeline/dashboard';
import {
  autoFillHolding,
  autoFillHousehold,
  autoFillTarget,
  currentMortgageRate,
  isRegulated,
} from '@/lib/analysis/auto-fill';
import { draftConfigSchema } from '@/lib/store/config';
import { findComplexJibun, findTradeNearDate } from '@/lib/sources/complex-search';
import { fetchComplexSpec } from '@/lib/sources/building';
import { fetchRedevelopmentStage } from '@/lib/sources/redevelopment';
import type { ApartmentRef, TradeRecord, UserConfig } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * 설정 자동 채움.
 *
 * 클라이언트가 편집 중인(아직 저장하지 않은) 설정을 보내면,
 * 현재 시세·금리·세율로 계산한 값을 돌려준다. 저장은 하지 않는다.
 *
 * body: { config: UserConfig, overwrite?: boolean, scope?: 'all' | 'holding' | 'target' | 'household', id?: string }
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    // 편집 중 설정에는 빈 카드가 섞여 있을 수 있어 느슨한 스키마로 받는다
    const config = draftConfigSchema.parse(body?.config) as UserConfig;
    const overwrite = Boolean(body?.overwrite);
    const scope = (body?.scope ?? 'all') as 'all' | 'holding' | 'target' | 'household';
    const targetId = body?.id as string | undefined;

    // 시세를 얻으려면 대시보드 조립이 필요하다 (뉴스·거시지표는 시세와 무관해 생략 가능하지만
    // 대출 금리 자동 입력에 ECOS 가 필요하므로 라이브 호출을 유지한다)
    // 요청 사용자의 설정 기준으로 조립 — 익명(default) 설정으로 조립하면
    // 로그인 사용자의 아파트 id 에 해당하는 시세가 없어 자동 채움이 빈다
    const data = await buildDashboard({ userId: await configIdForRequest() });

    /* 취득일 인근 실거래 — 취득가액 자동 채움용.
       본인의 매수 거래 자체가 국토부에 신고돼 있으므로, 취득일과 가장 가까운
       그 단지·면적 계약을 찾으면 취득가액을 채울 수 있다. */
    const acquisitionTrades: Record<string, TradeRecord> = {};
    if (scope === 'all' || scope === 'holding') {
      for (const h of config.holdings) {
        if (targetId && h.id !== targetId) continue;
        if (!h.acquiredAt || !h.complexName || !/^\d{5}$/.test(h.lawdCd)) continue;
        if (!overwrite && h.acquisitionPrice > 0) continue;
        const t = await findTradeNearDate(h.lawdCd, h.complexName, h.areaM2, h.acquiredAt).catch(
          () => null,
        );
        if (t) acquisitionTrades[h.id] = t;
      }
    }

    // 편집 중인 설정 기준으로 시세를 다시 매핑 — 아직 저장 전이라 id 가 다를 수 있다
    const ctx = {
      quotes: data.quotes,
      macro: data.macro,
      ownedHouseCount: config.holdings.length,
      acquisitionTrades,
    };

    const next: UserConfig = structuredClone(config);
    const filled: Array<{
      owner: string;
      field: string;
      label: string;
      value?: number;
      /** 숫자로 표현되지 않는 값 (예: 재건축 단계) */
      text?: string;
      basis: string;
    }> = [];
    const skipped: string[] = [];

    if (scope === 'all' || scope === 'holding') {
      next.holdings = next.holdings.map((h) => {
        if (targetId && h.id !== targetId) return h;
        const r = autoFillHolding(h, ctx, { overwrite });
        r.filled.forEach((f) => filled.push({ owner: h.complexName || '보유 아파트', ...f }));
        skipped.push(...r.skipped.map((s) => `${h.complexName || '보유 아파트'}: ${s}`));
        return { ...h, ...r.values };
      });
    }

    if (scope === 'all' || scope === 'target') {
      next.targets = next.targets.map((t) => {
        if (targetId && t.id !== targetId) return t;
        const r = autoFillTarget(t, ctx, { overwrite });
        r.filled.forEach((f) => filled.push({ owner: t.complexName || '목표 아파트', ...f }));
        skipped.push(...r.skipped.map((s) => `${t.complexName || '목표 아파트'}: ${s}`));
        return { ...t, ...r.values };
      });
    }

    /* 단지 스펙(총 세대수·용적률·대지지분) — 건축물대장에서 채운다.
       지번은 실거래 캐시의 최빈값으로 찾고, 카카오 주소검색으로 법정동코드를
       확정한 뒤 총괄표제부를 읽는다. 실패해도 다른 채움을 막지 않는다. */
    const fillSpec = async (apt: ApartmentRef, owner: string): Promise<Partial<ApartmentRef>> => {
      const needsStage = overwrite || !apt.redevelopmentStage;
      const needs =
        overwrite || !apt.totalHouseholds || !apt.floorAreaRatio || !apt.landShareM2 || needsStage;
      if (!needs || !apt.complexName || !/^\d{5}$/.test(apt.lawdCd)) return {};

      const lot = await findComplexJibun(apt.lawdCd, apt.complexName).catch(() => null);

      /* 재건축 진행 단계 — 서울시 정비몽땅. 자동 채움이 1순위이고,
         못 찾으면 사용자가 직접 고르는 수동 입력이 2순위로 남는다.
         지번으로 확정하므로 형제 단지(2차·8단지 등)를 잘못 물지 않는다. */
      const stageValues: Partial<ApartmentRef> = {};
      if (needsStage) {
        const redev = await fetchRedevelopmentStage({
          complexName: apt.complexName,
          sigungu: apt.sigungu,
          dong: apt.dong || lot?.dong,
          jibun: lot?.jibun,
        }).catch(() => null);

        if (redev) {
          stageValues.redevelopmentStage = redev.stage;
          stageValues.redevelopmentSource =
            redev.matchedBy === 'jibun'
              ? `정비몽땅 · ${redev.address} 지번 대조`
              : `정비몽땅 · 사업장명 대조(확인 권장)`;
          filled.push({
            owner,
            field: 'redevelopmentStage',
            label: '재건축 단계',
            value: Math.round(redev.progress * 100),
            text: redev.stage,
            basis: `서울시 정비몽땅 — ${redev.kind} \u00b7 ${redev.projectName} (${redev.address})${
              redev.matchedBy === 'name'
                ? ' · 지번이 아닌 사업장명으로 맞춘 결과라 확인하세요.'
                : ''
            }`,
          });
        } else if (!apt.redevelopmentStage) {
          skipped.push(
            `${owner}: 서울시 정비몽땅에 등록된 정비사업이 없습니다. 서울 밖이거나 아직 정비구역이 아닌 단지이며, 필요하면 재건축 단계를 직접 입력하세요.`,
          );
        }
      }
      const spec = await fetchComplexSpec({
        complexName: apt.complexName,
        sido: apt.sido,
        sigungu: apt.sigungu,
        dong: apt.dong || lot?.dong,
        jibun: lot?.jibun,
      }).catch(() => null);

      if (!spec) {
        skipped.push(
          `${owner}: 건축물대장에서 단지 정보를 찾지 못했습니다 (세대수·용적률·대지지분). 카카오/국토부 키와 건축물대장 API 활용신청 여부를 확인하세요.`,
        );
        return stageValues;
      }

      const values: Partial<ApartmentRef> = { ...stageValues };
      const basis = `건축물대장 ${spec.source} (${spec.address})`;
      if (spec.households && (overwrite || !apt.totalHouseholds)) {
        values.totalHouseholds = spec.households;
        filled.push({
          owner,
          field: 'totalHouseholds',
          label: '총 세대수',
          value: spec.households,
          basis: `${basis} — 대장 등록명 기준. 인접 단지와 묶여 등록된 경우 실제와 다를 수 있으니 확인하세요.`,
        });
      }
      if (spec.floorAreaRatio && (overwrite || !apt.floorAreaRatio)) {
        values.floorAreaRatio = Math.round(spec.floorAreaRatio * 10) / 10;
        filled.push({
          owner,
          field: 'floorAreaRatio',
          label: '용적률',
          value: values.floorAreaRatio,
          basis,
        });
      }
      if (spec.landSharePerUnit && (overwrite || !apt.landShareM2)) {
        values.landShareM2 = Math.round(spec.landSharePerUnit * 100) / 100;
        filled.push({
          owner,
          field: 'landShareM2',
          label: '대지지분(추정)',
          value: values.landShareM2,
          basis: `${basis} — 대지면적 ${spec.landArea?.toLocaleString('ko-KR')}㎡ ÷ ${spec.households?.toLocaleString('ko-KR')}세대 추정. 등기부 대지권과 다를 수 있습니다.`,
        });
      }
      return values;
    };

    if (scope === 'all' || scope === 'holding') {
      for (let i = 0; i < next.holdings.length; i += 1) {
        const h = next.holdings[i];
        if (targetId && h.id !== targetId) continue;
        const v = await fillSpec(h, h.complexName || '보유 아파트');
        next.holdings[i] = { ...h, ...v };
      }
    }
    if (scope === 'all' || scope === 'target') {
      for (let i = 0; i < next.targets.length; i += 1) {
        const t = next.targets[i];
        if (targetId && t.id !== targetId) continue;
        const v = await fillSpec(t, t.complexName || '목표 아파트');
        next.targets[i] = { ...t, ...v };
      }
    }

    let householdNotes: string[] = [];
    if (scope === 'all' || scope === 'household') {
      const h = autoFillHousehold(next);
      next.household = { ...next.household, ...h.values };
      householdNotes = h.notes;
    }

    const mortgage = currentMortgageRate(data.macro);

    return NextResponse.json({
      ok: true,
      config: next,
      filled,
      skipped: [...new Set(skipped)],
      householdNotes,
      context: {
        asOf: data.generatedAt,
        mortgageRate: mortgage.rate,
        mortgageBasis: mortgage.basis,
        regulatedHits: [
          ...next.holdings.filter((h) => isRegulated(h.lawdCd)).map((h) => h.complexName),
          ...next.targets.filter((t) => isRegulated(t.lawdCd)).map((t) => t.complexName),
        ],
      },
    });
  } catch (e) {
    return errorResponse(e, 400);
  }
}
