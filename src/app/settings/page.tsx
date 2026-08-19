import { Suspense } from 'react';
import { SettingsClient } from './settings-client';
import { loadConfig } from '@/lib/store/config';
import { getConnectionStatus } from '@/lib/kakao/client';
import { featureFlags } from '@/lib/env';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const [config, kakao] = await Promise.all([
    loadConfig(),
    getConnectionStatus().catch(() => ({
      connected: false,
      reason: '상태 확인 실패',
      recipients: [],
    })),
  ]);

  return (
    <Suspense
      fallback={<div className="text-muted-foreground p-8 text-sm">설정을 불러오는 중…</div>}
    >
      <SettingsClient
        initialConfig={config}
        kakao={kakao}
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
