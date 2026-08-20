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
        account={{ email: user.email ?? '', canImportLegacy }}
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
