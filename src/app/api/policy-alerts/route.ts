/**
 * 정책 갱신 경고 — 코드에 하드코딩된 정책 기준(대출 한도·세율·규제지역)을
 * 갱신해야 할 수 있다는 신호를 관리자에게 보여주고, 확인(숨김) 처리한다.
 *
 * GET  : 미확인 경고 목록 (관리자·레거시 로컬만. 일반 회원은 빈 목록)
 * POST : { id } 확인 처리
 */

import { NextResponse } from 'next/server';
import { errorResponse } from '@/lib/api-auth';
import { getSessionUser } from '@/lib/auth/server';
import { loadLatestPolicyDigest, type PolicyUpdateAlert } from '@/lib/ai/policy-digest';
import { ackAlert, loadAckedAlertIds } from '@/lib/store/policy-ack';

export const dynamic = 'force-dynamic';

/** 관리자 또는 레거시(비로그인 로컬 운영)만 true */
async function isAdminOrLegacy(): Promise<{ allowed: boolean; who: string }> {
  const user = await getSessionUser();
  if (!user) return { allowed: true, who: 'legacy' }; // 비로그인 = 로컬 운영자
  return { allowed: user.isAdmin, who: user.id };
}

export async function GET() {
  try {
    const { allowed } = await isAdminOrLegacy();
    if (!allowed) return NextResponse.json({ ok: true, alerts: [] });

    const digest = await loadLatestPolicyDigest();
    if (!digest) return NextResponse.json({ ok: true, alerts: [] });

    /* 새 필드가 없는 이전 캐시는 regulationAlert 만 갖고 있다 — 변환해서 함께 본다 */
    const alerts: PolicyUpdateAlert[] =
      digest.updateAlerts ??
      (digest.regulationAlert
        ? [
            {
              ruleKey: 'regulated-zones',
              ruleLabel: '규제지역 지정',
              codeBasis: '코드 기준 확인 필요',
              file: 'src/lib/analysis/regulation.ts',
              title: digest.regulationAlert.title,
              url: digest.regulationAlert.url,
              publishedAt: digest.regulationAlert.publishedAt,
              official: true,
              id: `legacy-${digest.regulationAlert.url.slice(-16)}`,
            },
          ]
        : []);

    const acked = await loadAckedAlertIds();
    return NextResponse.json({
      ok: true,
      alerts: alerts.filter((a) => !acked.has(a.id)),
      checkedAt: digest.refreshedAt ?? digest.generatedAt,
    });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(request: Request) {
  try {
    const { allowed, who } = await isAdminOrLegacy();
    if (!allowed)
      return NextResponse.json({ ok: false, error: '관리자 전용입니다.' }, { status: 403 });

    const body = await request.json().catch(() => ({}));
    const id = typeof body?.id === 'string' ? body.id.trim() : '';
    if (!id) return NextResponse.json({ ok: false, error: 'id 가 필요합니다.' }, { status: 400 });

    await ackAlert(id, who);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
