import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import type { ScheduleEvent } from '@/lib/types';
import { EmptyHint, SectionCard } from '@/components/ui-bits';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { todayKst } from '@/lib/format';

const CATEGORY_CLASS: Record<ScheduleEvent['category'], string> = {
  금리: 'bg-rose-500/10 text-rose-600 dark:text-rose-400',
  지표발표: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  정책: 'bg-purple-500/10 text-purple-600 dark:text-purple-400',
  청약: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  세제: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  기타: 'bg-slate-500/10 text-slate-600 dark:text-slate-400',
};

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

export function ScheduleSection({ schedule }: { schedule: ScheduleEvent[] }) {
  const today = todayKst();
  const upcoming = schedule
    .filter((e) => e.date >= today)
    .filter((e) => e.importance !== 'low')
    .slice(0, 14);

  if (upcoming.length === 0) {
    return (
      <SectionCard title="주요 일정">
        <EmptyHint>향후 90일 내 주요 일정이 없습니다.</EmptyHint>
      </SectionCard>
    );
  }

  return (
    <SectionCard
      title="주요 일정"
      description={
        <>
          <strong className="text-primary font-semibold">일정을 누르면</strong> 그 결과에 따라
          부동산 시장이 어느 방향으로 움직이는지{' '}
          <strong className="text-primary font-semibold">시나리오별</strong>로 볼 수 있습니다.
        </>
      }
    >
      <ol className="relative space-y-1 border-l pl-5">
        {upcoming.map((e) => {
          const d = new Date(e.date);
          const daysAway = Math.round((d.getTime() - new Date(today).getTime()) / 86_400_000);
          return (
            <li key={e.id} className="relative">
              <span
                className={cn(
                  'border-background absolute top-3 -left-[25px] size-2.5 rounded-full border-2',
                  e.importance === 'high' ? 'bg-rise' : 'bg-muted-foreground/50',
                )}
              />
              <Link
                href={`/outlook/${encodeURIComponent(e.id)}`}
                className="group hover:bg-muted/60 -ml-2 block rounded-md px-2 py-1.5 transition-colors"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="tabular text-xs font-medium">
                    {e.date.slice(5).replace('-', '/')}({WEEKDAYS[d.getDay()]})
                  </span>
                  <Badge
                    variant="outline"
                    className={cn('text-[10px]', CATEGORY_CLASS[e.category])}
                  >
                    {e.category}
                  </Badge>
                  <span className="text-muted-foreground text-[11px]">
                    {daysAway === 0 ? '오늘' : `D-${daysAway}`}
                  </span>
                  {e.estimated ? (
                    <span className="text-muted-foreground text-[10px]">(일자 추정)</span>
                  ) : null}
                  <ChevronRight className="text-muted-foreground ml-auto size-4 opacity-0 transition-opacity group-hover:opacity-100" />
                </div>
                <div className="mt-0.5 text-sm leading-snug font-medium group-hover:underline">
                  {e.title}
                </div>
                <p className="text-muted-foreground text-[11px]">{e.description}</p>
              </Link>
            </li>
          );
        })}
      </ol>
    </SectionCard>
  );
}
