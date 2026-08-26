import type { ReactNode } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { formatPct } from '@/lib/format';
import type { PeriodDelta } from '@/lib/types';

/** 대시보드 섹션 공통 껍데기 */
export function SectionCard({
  title,
  description,
  badge,
  action,
  children,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  badge?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn('overflow-hidden', className)}>
      <CardHeader className="gap-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex min-w-0 flex-wrap items-center gap-2 text-sm sm:text-base">
            {title}
            {badge}
          </CardTitle>
          {action}
        </div>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

/** 상승/하락 색이 붙는 퍼센트 텍스트 */
export function Delta({
  value,
  digits = 2,
  suffix = '',
  unit,
  className,
  invert = false,
}: {
  value: number | undefined;
  digits?: number;
  suffix?: string;
  /** '%' 가 아닌 단위(점·건 등)를 쓸 때. 주면 퍼센트 표기 대신 이 단위를 붙인다 */
  unit?: string;
  className?: string;
  /** true면 값이 클수록 나쁜 지표(금리 등) */
  invert?: boolean;
}) {
  if (value === undefined || !Number.isFinite(value)) {
    return <span className={cn('text-muted-foreground', className)}>-</span>;
  }
  const positive = value > 0;
  const color =
    Math.abs(value) < 0.005
      ? 'text-flat'
      : (positive ? !invert : invert)
        ? 'text-rise'
        : 'text-fall';
  return (
    <span className={cn('tabular font-medium', color, className)}>
      {unit ? `${value > 0 ? '+' : ''}${value.toFixed(digits)}${unit}` : formatPct(value, digits)}
      {unit ? '' : suffix}
    </span>
  );
}

/**
 * 전월·전분기 대비 한 줄.
 *
 * 지표마다 다른 문법으로 적으면 "이 −0.3이 지난달 대비인지 작년 대비인지"를
 * 매번 다시 읽어야 한다. 모든 지표가 같은 순서·같은 표기를 쓰도록 여기로 모은다.
 */
export function PeriodCompare({
  delta,
  digits = 1,
  unit,
  invert = false,
  className,
}: {
  delta?: PeriodDelta;
  digits?: number;
  /** '%' 가 아닌 단위(점 등) */
  unit?: string;
  invert?: boolean;
  className?: string;
}) {
  if (!delta || (delta.mom === undefined && delta.qoq === undefined)) return null;
  // 값 자체가 %인 지표는 차이를 %p 로 적는다 (2.50 → 2.75 를 "+10%" 로 쓰면 오해를 부른다)
  const suffix = delta.pointDiff ? 'p' : '';
  return (
    <span
      className={cn(
        'text-muted-foreground inline-flex flex-wrap items-center gap-x-1.5',
        className,
      )}
    >
      {delta.mom !== undefined ? (
        <span>
          전월{' '}
          <Delta value={delta.mom} digits={digits} suffix={suffix} unit={unit} invert={invert} />
        </span>
      ) : null}
      {delta.qoq !== undefined ? (
        <span>
          전분기{' '}
          <Delta value={delta.qoq} digits={digits} suffix={suffix} unit={unit} invert={invert} />
        </span>
      ) : null}
    </span>
  );
}

/** KPI 타일 */
export function Stat({
  label,
  value,
  sub,
  tone = 'default',
  emphasis = false,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: 'default' | 'rise' | 'fall' | 'muted';
  /** 화면의 결론이 되는 수치 — 테두리·크기·굵기로 눈에 먼저 들어오게 한다 */
  emphasis?: boolean;
}) {
  const toneClass =
    tone === 'rise'
      ? 'text-rise'
      : tone === 'fall'
        ? 'text-fall'
        : tone === 'muted'
          ? 'text-muted-foreground'
          : emphasis
            ? 'text-primary'
            : '';
  return (
    <div
      className={cn(
        'bg-card rounded-lg border px-4 py-3',
        emphasis && 'border-primary/50 bg-primary/5 ring-primary/20 ring-1',
      )}
    >
      <div
        className={cn(
          'text-xs',
          emphasis ? 'text-foreground font-medium' : 'text-muted-foreground',
        )}
      >
        {label}
      </div>
      <div
        className={cn(
          'tabular mt-1',
          emphasis ? 'text-2xl font-extrabold' : 'text-xl font-semibold',
          toneClass,
        )}
      >
        {value}
      </div>
      {sub ? <div className="text-muted-foreground mt-0.5 text-xs">{sub}</div> : null}
    </div>
  );
}

/** 데이터가 없을 때 안내 */
export function EmptyHint({ children }: { children: ReactNode }) {
  return (
    <div className="text-muted-foreground rounded-lg border border-dashed px-4 py-8 text-center text-sm">
      {children}
    </div>
  );
}
