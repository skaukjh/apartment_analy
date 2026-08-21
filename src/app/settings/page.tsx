import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { SettingsClient } from './settings-client';
import { isConfigEmpty, loadConfig } from '@/lib/store/config';
import { getConnectionStatus } from '@/lib/kakao/client';
import { getSessionUser, ANON_CONFIG_ID } from '@/lib/auth/server';
import { featureFlags } from '@/lib/env';

export const dynamic = 'force-dynamic';

/**
 * 설정은 로그인한 사용자만 바꿀 수 있다.
 * 로그인하지 않았으면 로그인 화면으로 보낸다.
 */
export default async function SettingsPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login?next=/settings');

  // 승인 대기 — 설정은 승인된 계정만. 계정은 유지되며 승인되면 바로 쓸 수 있다.
  if (!user.approved) {
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-3 px-4 text-center">
        <h1 className="text-xl font-semibold">가입 승인 대기 중</h1>
        <p className="text-muted-foreground text-sm">
          {user.email} 계정은 아직 관리자 승인 전입니다. 승인되면 설정·브리핑 기능을 바로 쓸 수
          있습니다. 그동안 대시보드 열람은 가능합니다.
        </p>
      </div>
    );
  }

  const [config, kakao, legacy] = await Promise.all([
    loadConfig(user.id),
    getConnectionStatus(user.id).catch(() => ({
      connected: false,
      reason: '상태 확인 실패',
      recipients: [],
    })),
    loadConfig(ANON_CONFIG_ID),
  ]);

  // 내 설정이 비어 있고 레거시 공용 설정이 남아 있으면 가져오기 버튼을 보여준다
  const canImportLegacy = isConfigEmpty(config) && !isConfigEmpty(legacy);

  return (
    <Suspense
      fallback={<div className="text-muted-foreground p-8 text-sm">설정을 불러오는 중…</div>}
    >
      <SettingsClient
        initialConfig={config}
        kakao={kakao}
        account={{ email: user.email ?? '', canImportLegacy, isAdmin: user.isAdmin }}
        flags={{
          supabase: featureFlags.hasSupabaseAdmin,
          molit: featureFlags.hasMolit,
          ecos: featureFlags.hasEcos,
          reb: featureFlags.hasReb,
          naver: featureFlags.hasNaver,
          kakao: featureFlags.hasKakao,
        }}
      />
    </Suspense>
  );
}
