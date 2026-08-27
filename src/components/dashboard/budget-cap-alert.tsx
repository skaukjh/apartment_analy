import Link from 'next/link';
import { ArrowDownRight, TriangleAlert } from 'lucide-react';
import type { BudgetCapAlert } from '@/lib/types';
import { formatKrw, supplyPyeong } from '@/lib/format';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

/**
 * 예산 상한을 넘은 목표 아파트 배너.
 *
 * 화면을 열 때 가장 먼저 보이도록 홈 맨 위에 둔다. "넘었다"만 말하면 사용자가
 * 할 수 있는 건 단지를 지우는 것뿐이라, 같은 단지에서 아직 상한 안에 있는
 * 평형을 함께 붙여 "평형을 낮추는" 쪽으로 이어지게 한다.
 *
 * 값은 전부 대표가(가장 최근 실거래가)다 — 갭 계산과 같은 기준이라야
 * 배너의 경고와 아래 카드의 숫자가 어긋나지 않는다.
 */
/** 배너용 짧은 면적 표기 — 단지를 여러 줄 나열하므로 전체 표기(formatArea)는 너무 길다 */
function area(m2: number): string {
  return `${m2}㎡·${supplyPyeong(m2)}평형`;
}

export function BudgetCapAlertBanner({ alerts, cap }: { alerts: BudgetCapAlert[]; cap?: number }) {
  if (!cap || alerts.length === 0) return null;

  return (
    <Alert variant="destructive">
      <TriangleAlert className="size-4" />
      <AlertTitle>
        목표 {alerts.length}곳이 예산 상한({formatKrw(cap, { compact: true })})을 넘었습니다
      </AlertTitle>
      <AlertDescription>
        <div className="space-y-3">
          <p className="text-sm">
            최근 실거래가 기준입니다. 같은 단지에서 아직 상한 안에 있는 평형을 함께 적었습니다 —
            단지를 포기하는 대신 평형을 낮추는 선택지입니다.
          </p>

          <ul className="space-y-2.5">
            {alerts.map((a) => (
              <li key={a.targetId} className="text-sm">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className="font-medium">
                    {a.complexName} {area(a.areaM2)}
                  </span>
                  <span className="tabular">
                    {formatKrw(a.price, { compact: true })}
                    <span className="ml-1 text-xs">
                      (상한 +{formatKrw(a.over, { compact: true })})
                    </span>
                  </span>
                  {a.lastDealDate ? (
                    <span className="text-xs opacity-80">{a.lastDealDate} 체결</span>
                  ) : null}
                </div>

                {a.alternatives.length > 0 ? (
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 pl-1 text-xs">
                    <ArrowDownRight className="size-3.5 shrink-0" />
                    {a.alternatives.map((alt) => (
                      <span key={alt.areaM2} className="rounded border px-1.5 py-0.5">
                        {area(alt.areaM2)} {formatKrw(alt.price, { compact: true })}
                        <span className="ml-1 opacity-75">
                          {alt.lastDealDate}
                          {alt.recentTradeCount <= 2 ? ` · 표본 ${alt.recentTradeCount}건` : ''}
                        </span>
                      </span>
                    ))}
                  </div>
                ) : (
                  <div className="mt-1 pl-1 text-xs opacity-80">
                    이 단지에는 상한 안에 있는 평형이 없습니다 (최근 6개월 거래 기준).
                  </div>
                )}
              </li>
            ))}
          </ul>

          <Link href="/settings" className="inline-block text-sm underline underline-offset-2">
            설정에서 평형 바꾸기 →
          </Link>
        </div>
      </AlertDescription>
    </Alert>
  );
}
