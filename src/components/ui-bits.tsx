import type { ReactNode } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { formatPct } from '@/lib/format';

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
  className,
  invert = false,
}: {
  value: number | undefined;
  digits?: number;
  suffix?: string;
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
      {formatPct(value, digits)}
      {suffix}
    </span>
  );
}

/** KPI 타일 */
export function Stat({
  label,
  value,
  sub,
  tone = 'default',
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: 'default' | 'rise' | 'fall' | 'muted';
}) {
  const toneClass =
    tone === 'rise'
      ? 'text-rise'
      : tone === 'fall'
        ? 'text-fall'
        : tone === 'muted'
          ? 'text-muted-foreground'
          : '';
  return (
    <div className="bg-card rounded-lg border px-4 py-3">
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className={cn('tabular mt-1 text-xl font-semibold', toneClass)}>{value}</div>
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
