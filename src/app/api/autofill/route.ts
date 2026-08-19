import { NextResponse } from 'next/server';
import { errorResponse } from '@/lib/api-auth';
import { buildDashboard } from '@/lib/pipeline/dashboard';
import {
  autoFillHolding,
  autoFillHousehold,
  autoFillTarget,
  currentMortgageRate,
  isRegulated,
} from '@/lib/analysis/auto-fill';
import { userConfigSchema } from '@/lib/store/config';
import type { UserConfig } from '@/lib/types';

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
    const config = userConfigSchema.parse(body?.config) as UserConfig;
    const overwrite = Boolean(body?.overwrite);
    const scope = (body?.scope ?? 'all') as 'all' | 'holding' | 'target' | 'household';
    const targetId = body?.id as string | undefined;

    // 시세를 얻으려면 대시보드 조립이 필요하다 (뉴스·거시지표는 시세와 무관해 생략 가능하지만
    // 대출 금리 자동 입력에 ECOS 가 필요하므로 라이브 호출을 유지한다)
    const data = await buildDashboard();

    // 편집 중인 설정 기준으로 시세를 다시 매핑 — 아직 저장 전이라 id 가 다를 수 있다
    const ctx = {
      quotes: data.quotes,
      macro: data.macro,
      ownedHouseCount: config.holdings.length,
    };

    const next: UserConfig = structuredClone(config);
    const filled: Array<{ owner: string; field: string; label: string; basis: string }> = [];
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
