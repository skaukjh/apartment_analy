import type { SourceStatus } from '@/lib/types';
import { SectionCard } from '@/components/ui-bits';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, CheckCircle2, KeyRound, XCircle, ExternalLink } from 'lucide-react';

const STATUS_META = {
  ok: { label: '정상', icon: CheckCircle2, className: 'text-emerald-600 dark:text-emerald-400' },
  stale: { label: '지연', icon: AlertTriangle, className: 'text-amber-600 dark:text-amber-400' },
  'missing-key': { label: '키 없음', icon: KeyRound, className: 'text-muted-foreground' },
  error: { label: '오류', icon: XCircle, className: 'text-destructive' },
} as const;

export function SourceStatusSection({
  sources,
  generatedAt,
}: {
  sources: SourceStatus[];
  generatedAt: string;
}) {
  const problems = sources.filter((s) => s.status !== 'ok').length;

  return (
    <SectionCard
      title="데이터 소스 상태"
      description={`마지막 갱신 ${new Date(generatedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}`}
      badge={
        problems > 0 ? (
          <Badge variant="destructive">{problems}건 확인 필요</Badge>
        ) : (
          <Badge variant="secondary">전체 정상</Badge>
        )
      }
    >
      <ul className="divide-y">
        {sources.map((s) => {
          const meta = STATUS_META[s.status];
          const Icon = meta.icon;
          return (
            <li key={s.name} className="flex items-start gap-3 py-2.5">
              <Icon className={`mt-0.5 size-4 shrink-0 ${meta.className}`} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-medium">{s.name}</span>
                  {s.url !== '#' ? (
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <ExternalLink className="size-3" />
                    </a>
                  ) : null}
                </div>
                <p className="text-muted-foreground mt-0.5 text-xs break-words">{s.message}</p>
              </div>
              <span className={`shrink-0 text-xs ${meta.className}`}>{meta.label}</span>
            </li>
          );
        })}
      </ul>
    </SectionCard>
  );
}
