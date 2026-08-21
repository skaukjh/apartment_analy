'use client';

import type { CatalystStatus, NewsItem, WatchRegion } from '@/lib/types';
import { STAGE_LABELS } from '@/lib/analysis/catalysts';
import { formatShortDate } from '@/lib/format';
import { SectionCard, EmptyHint } from '@/components/ui-bits';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { ExternalLink, TrainFront, Building, Landmark, Package, Newspaper } from 'lucide-react';
import Link from 'next/link';

const CATEGORY_META: Record<
  NewsItem['category'],
  { label: string; icon: typeof TrainFront; className: string }
> = {
  transport: {
    label: '교통',
    icon: TrainFront,
    className: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  },
  development: {
    label: '개발',
    icon: Building,
    className: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  },
  policy: {
    label: '정책',
    icon: Landmark,
    className: 'bg-purple-500/10 text-purple-600 dark:text-purple-400',
  },
  supply: {
    label: '공급',
    icon: Package,
    className: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  },
  market: {
    label: '시황',
    icon: Newspaper,
    className: 'bg-slate-500/10 text-slate-600 dark:text-slate-400',
  },
  etc: {
    label: '기타',
    icon: Newspaper,
    className: 'bg-slate-500/10 text-slate-600 dark:text-slate-400',
  },
};

const IMPACT_LABEL = { high: '영향 큼', medium: '보통', low: '작음' } as const;

interface Props {
  catalysts: CatalystStatus[];
  regions: WatchRegion[];
}

export function CatalystSection({ catalysts, regions }: Props) {
  if (regions.length === 0) {
    return (
      <SectionCard
        title="④ 관심 지역 호재 · 악재"
        description="관심 지역을 등록하면 해당 지역(보유·목표 아파트 지역 포함)에 걸린 교통·개발·공급 호재와 규제 악재를 추적합니다."
      >
        <EmptyHint>
          <p className="mb-3">관심 지역이 등록되지 않았습니다.</p>
          <Button render={<Link href="/settings" />} nativeButton={false} size="sm">
            설정에서 관심 지역 등록하기
          </Button>
        </EmptyHint>
      </SectionCard>
    );
  }

  if (catalysts.length === 0) {
    return (
      <SectionCard title="④ 관심 지역 호재 · 악재">
        <EmptyHint>등록된 관심 지역에 매칭되는 주요 호재·악재가 없습니다.</EmptyHint>
      </SectionCard>
    );
  }

  const positives = catalysts.filter((c) => c.polarity !== 'negative');
  const negatives = catalysts.filter((c) => c.polarity === 'negative');
  const coverage = regions.map((r) => r.name).join(' · ');

  return (
    <SectionCard
      title="④ 관심 지역 호재 · 악재"
      description={`추적 지역(보유·목표 포함): ${coverage}. 진행 단계는 최신 뉴스 헤드라인에서 자동 추론하며, '미확인'은 최근 관련 보도가 없다는 뜻입니다.`}
      badge={
        <Badge variant="secondary">
          호재 {positives.length} · 악재 {negatives.length}
        </Badge>
      }
    >
      <div className="grid gap-3 lg:grid-cols-2">
        {[...positives, ...negatives].map((c) => {
          const meta = CATEGORY_META[c.category];
          const Icon = meta.icon;
          const stageIndex = STAGE_LABELS.indexOf(c.stage);
          const unconfirmed = c.lastUpdate === '미확인';
          const negative = c.polarity === 'negative';

          return (
            <div key={c.id} className="rounded-lg border p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-2">
                  <span className={cn('mt-0.5 rounded p-1.5', meta.className)}>
                    <Icon className="size-4" />
                  </span>
                  <div>
                    <div className="flex items-center gap-1.5 leading-tight font-medium">
                      <span>{c.title}</span>
                      <Badge
                        variant="outline"
                        className={cn(
                          'px-1.5 py-0 text-[10px]',
                          negative
                            ? 'border-red-500/40 text-red-600 dark:text-red-400'
                            : 'border-emerald-500/40 text-emerald-600 dark:text-emerald-400',
                        )}
                      >
                        {negative ? '악재' : '호재'}
                      </Badge>
                    </div>
                    <div className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                      <span>{meta.label}</span>
                      <span>·</span>
                      <span>{IMPACT_LABEL[c.impact]}</span>
                      <span>·</span>
                      <span>
                        {unconfirmed
                          ? '최근 보도 없음'
                          : `업데이트 ${formatShortDate(c.lastUpdate.slice(0, 10))}`}
                      </span>
                      {c.matchedRegions && c.matchedRegions.length > 0 ? (
                        <>
                          <span>·</span>
                          <span>{c.matchedRegions.slice(0, 3).join(', ')}</span>
                        </>
                      ) : null}
                    </div>
                  </div>
                </div>
                {c.sourceUrl ? (
                  <a
                    href={c.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-muted-foreground hover:text-foreground shrink-0"
                    aria-label="출처 열기"
                  >
                    <ExternalLink className="size-4" />
                  </a>
                ) : null}
              </div>

              {/* 악재는 '착공→준공' 단계 개념이 없어 진행 바를 숨긴다 */}
              {!negative ? (
                <div className="mt-3">
                  <div className="mb-1.5 flex items-center justify-between text-[11px]">
                    <span className={cn('font-medium', unconfirmed && 'text-muted-foreground')}>
                      {unconfirmed ? '단계 미확인' : c.stage}
                    </span>
                    <span className="tabular text-muted-foreground">{c.progress}%</span>
                  </div>
                  <Progress value={c.progress} className="h-1.5" />
                  <div className="text-muted-foreground mt-1.5 flex justify-between text-[9px]">
                    {STAGE_LABELS.map((s, i) => (
                      <span
                        key={s}
                        className={cn(
                          i === stageIndex && !unconfirmed && 'text-foreground font-semibold',
                        )}
                      >
                        {s}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}

              {/* 근거 출처 — 공식 자료·뉴스, 최대 5개 */}
              {c.sourceLinks && c.sourceLinks.length > 0 ? (
                <div className="mt-2.5 space-y-1 border-t pt-2">
                  {c.sourceLinks.slice(0, 5).map((l) => (
                    <a
                      key={l.url}
                      href={l.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-[11px]"
                    >
                      <ExternalLink className="size-3 shrink-0" />
                      <span className="truncate">{l.title}</span>
                    </a>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </SectionCard>
  );
}
