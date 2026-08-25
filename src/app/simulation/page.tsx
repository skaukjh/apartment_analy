import { configIdForRequest, getSessionUser } from '@/lib/auth/server';
import { DemoNotice } from '@/components/demo-notice';
import { Suspense } from 'react';
import { buildDashboardCached } from '@/lib/pipeline/dashboard';
import { SimulationClient } from './simulation-client';
import { FirstPurchasePanel } from './first-purchase';

export const dynamic = 'force-dynamic';

export default async function SimulationPage() {
  // 시세 추정치를 초기값으로 쓰기 위해 대시보드를 조립하되 외부 라이브 호출은 생략한다
  const data = await buildDashboardCached(await configIdForRequest());
  const sessionUser = await getSessionUser();

  // 보유 아파트가 없으면 갈아타기가 성립하지 않으므로 무주택 신규 매수 계산으로 전환한다
  const hasHolding = data.config.holdings.length > 0;

  return (
    <Suspense fallback={<div className="text-muted-foreground p-8 text-sm">불러오는 중…</div>}>
      {sessionUser ? null : (
        <div className="mx-auto max-w-5xl px-4 pt-6">
          <DemoNotice />
        </div>
      )}
      {hasHolding ? (
        <SimulationClient config={data.config} quotes={data.quotes} />
      ) : (
        <FirstPurchasePanel config={data.config} quotes={data.quotes} />
      )}
    </Suspense>
  );
}
