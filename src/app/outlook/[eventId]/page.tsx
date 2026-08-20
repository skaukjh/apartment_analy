import { configIdForRequest } from '@/lib/auth/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, CalendarDays, TrendingDown, TrendingUp, Minus } from 'lucide-react';
import { buildDashboard, summarizeDashboard } from '@/lib/pipeline/dashboard';
import { buildSchedule } from '@/lib/analysis/schedule';
import {
  buildOutlook,
  DIRECTION_META,
  expectedDirection,
  MAGNITUDE_LABEL,
} from '@/lib/analysis/event-outlook';
import { formatShortDate, todayKst } from '@/lib/format';
import { SectionCard } from '@/components/ui-bits';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { REFRESH_INTERVAL_SECONDS } from '@/lib/refresh-policy';

export const revalidate = 3600;

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

export default async function OutlookPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const decoded = decodeURIComponent(eventId);

  const event = buildSchedule(180).find((e) => e.id === decoded);
  if (!event) notFound();

  const data = await buildDashboard({ userId: await configIdForRequest() });
  const { spread } = summarizeDashboard(data);
  const outlook = buildOutlook(event, {
    macro: data.macro,
    sentiment: data.sentiment,
    spread,
  });
  const dir = expectedDirection(outlook);

  const d = new Date(event.date);
  const daysAway = Math.round((d.getTime() - new Date(todayKst()).getTime()) / 86_400_000);

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-6">
      <Button
        render={<Link href="/" />}
        nativeButton={false}
        variant="ghost"
        size="sm"
        className="-ml-2"
      >
        <ArrowLeft className="size-4" /> 대시보드로
      </Button>

      {/* 헤더 */}
      <div>
        <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-sm">
          <CalendarDays className="size-4" />
          <span className="tabular">
            {event.date} ({WEEKDAYS[d.getDay()]})
          </span>
          <Badge variant="outline">{event.category}</Badge>
          {event.estimated ? (
            <Badge variant="secondary" className="text-[10px]">
              일자 추정
            </Badge>
          ) : null}
          <span className="tabular">
            {daysAway === 0 ? '오늘' : daysAway > 0 ? `D-${daysAway}` : `${-daysAway}일 경과`}
          </span>
        </div>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">{event.title}</h1>
        <p className="text-muted-foreground mt-1 text-sm">{event.description}</p>
      </div>

      {/* 기대 방향 */}
      <div className="rounded-lg border p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-muted-foreground text-xs">시나리오 확률 가중 기대 방향</div>
            <div
              className="flex items-center gap-2 text-xl font-bold"
              style={{ color: DIRECTION_META[dir.tilt].color }}
            >
              {dir.tilt === 'up' ? (
                <TrendingUp className="size-5" />
              ) : dir.tilt === 'down' ? (
                <TrendingDown className="size-5" />
              ) : (
                <Minus className="size-5" />
              )}
              {DIRECTION_META[dir.tilt].label}
            </div>
          </div>

          <div className="flex-1 sm:max-w-md">
            <div className="text-muted-foreground mb-1 flex justify-between text-[11px]">
              <span className="text-rise">상승 {dir.up}%</span>
              <span>중립 {dir.flat}%</span>
              <span className="text-fall">하락 {dir.down}%</span>
            </div>
            <div className="flex h-2.5 overflow-hidden rounded-full">
              <div style={{ width: `${dir.up}%`, background: 'var(--rise)' }} />
              <div style={{ width: `${dir.flat}%`, background: 'var(--flat)' }} />
              <div style={{ width: `${dir.down}%`, background: 'var(--fall)' }} />
            </div>
          </div>
        </div>
        <p className="mt-3 text-sm leading-relaxed">{outlook.why}</p>
      </div>

      {/* 시나리오 */}
      <SectionCard
        title="결과별 시나리오"
        description="확률은 아래 '판단 근거'의 현재 지표를 규칙에 넣어 계산한 가늠치입니다. 예측이 아니라 경우의 수를 정리한 것입니다."
      >
        <div className="space-y-4">
          {outlook.scenarios.map((s) => {
            const meta = DIRECTION_META[s.direction];
            return (
              <div key={s.label} className="rounded-lg border p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span style={{ color: meta.color }}>{meta.icon}</span>
                    <span className="font-semibold">{s.label}</span>
                    <Badge variant="secondary" className="text-[10px]">
                      {MAGNITUDE_LABEL[s.magnitude]}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="tabular text-lg font-bold">{s.probability}%</span>
                  </div>
                </div>

                <Progress value={s.probability} className="mt-2 h-1.5" />

                <div className="mt-3 grid gap-4 md:grid-cols-2">
                  <div>
                    <h4 className="text-muted-foreground mb-1.5 text-xs font-semibold">
                      파급 경로
                    </h4>
                    <ol className="space-y-1">
                      {s.transmission.map((t, i) => (
                        <li key={i} className="flex gap-2 text-xs leading-relaxed">
                          <span className="tabular text-muted-foreground shrink-0">{i + 1}.</span>
                          <span>{t}</span>
                        </li>
                      ))}
                    </ol>
                    <p className="text-muted-foreground mt-2 text-[11px]">
                      반영 시차: <span className="font-medium">{s.lag}</span>
                    </p>
                  </div>

                  <div className="space-y-2">
                    <div>
                      <h4 className="text-muted-foreground mb-1 text-xs font-semibold">
                        가장 크게 영향받는 곳
                      </h4>
                      <p className="text-xs leading-relaxed">{s.mostAffected}</p>
                    </div>
                    <div className="bg-muted/50 rounded-md p-2.5">
                      <h4 className="mb-1 text-xs font-semibold">내 갈아타기 관점</h4>
                      <p className="text-xs leading-relaxed">{s.action}</p>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </SectionCard>

      <div className="grid gap-6 md:grid-cols-2">
        <SectionCard title="판단 근거" description="확률 산정에 쓰인 현재 지표">
          <ul className="space-y-2">
            {outlook.basis.map((b, i) => (
              <li key={i} className="text-muted-foreground text-xs leading-relaxed">
                • {b}
              </li>
            ))}
          </ul>
        </SectionCard>

        <SectionCard
          title="발표 후 확인할 것"
          description="결과가 실제로 시장에 전달되는지 보는 지표"
        >
          <ul className="space-y-2">
            {outlook.watchNext.map((w, i) => (
              <li key={i} className="text-muted-foreground text-xs leading-relaxed">
                • {w}
              </li>
            ))}
          </ul>
        </SectionCard>
      </div>

      {/* 인접 일정 */}
      <SectionCard title="다른 일정" description="같은 기간의 주요 일정">
        <ul className="divide-y">
          {buildSchedule(90)
            .filter((e) => e.id !== event.id && e.importance !== 'low' && e.date >= todayKst())
            .slice(0, 8)
            .map((e) => (
              <li key={e.id}>
                <Link
                  href={`/outlook/${encodeURIComponent(e.id)}`}
                  className="flex items-center gap-3 py-2 text-sm hover:underline"
                >
                  <span className="tabular text-muted-foreground w-14 shrink-0 text-xs">
                    {formatShortDate(e.date)}
                  </span>
                  <Badge variant="outline" className="shrink-0 text-[10px]">
                    {e.category}
                  </Badge>
                  <span className="truncate">{e.title}</span>
                </Link>
              </li>
            ))}
        </ul>
      </SectionCard>

      <p className="text-muted-foreground text-center text-[11px]">
        이 분석은 규칙 기반 시나리오 정리이며 투자 자문이 아닙니다. 데이터는 최대
        {Math.round(REFRESH_INTERVAL_SECONDS / 60)}분 간격으로 갱신됩니다.
      </p>
    </div>
  );
}
