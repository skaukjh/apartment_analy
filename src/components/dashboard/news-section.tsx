'use client';

import { useMemo, useState } from 'react';
import type { NewsItem } from '@/lib/types';
import { SectionCard, EmptyHint } from '@/components/ui-bits';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ExternalLink } from 'lucide-react';

const CATEGORIES: Array<{ key: NewsItem['category'] | 'all'; label: string }> = [
  { key: 'all', label: '전체' },
  { key: 'transport', label: '교통' },
  { key: 'development', label: '개발' },
  { key: 'policy', label: '정책' },
  { key: 'supply', label: '공급' },
  { key: 'market', label: '시황' },
];

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const hours = Math.floor(diff / 3_600_000);
  if (hours < 1) return '방금';
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}일 전`;
  return new Date(iso).toISOString().slice(0, 10);
}

export function NewsSection({ news }: { news: NewsItem[] }) {
  const [filter, setFilter] = useState<NewsItem['category'] | 'all'>('all');
  const [limit, setLimit] = useState(10);

  const filtered = useMemo(
    () => (filter === 'all' ? news : news.filter((n) => n.category === filter)),
    [news, filter],
  );

  if (news.length === 0) {
    return (
      <SectionCard
        title="주요 이슈 · 뉴스"
        description="관심 지역 + 시장 전반 뉴스 (네이버 뉴스 검색 API)"
      >
        <EmptyHint>
          NAVER_CLIENT_ID / NAVER_CLIENT_SECRET 이 설정되지 않았거나 수집된 뉴스가 없습니다.
          <br />
          <a
            className="underline"
            href="https://developers.naver.com/apps/#/register"
            target="_blank"
            rel="noreferrer"
          >
            네이버 개발자센터에서 검색 API 신청
          </a>
        </EmptyHint>
      </SectionCard>
    );
  }

  return (
    <SectionCard
      title="주요 이슈 · 뉴스"
      description="관심 지역과 시장 전반 키워드로 수집한 최신 기사입니다."
      badge={<Badge variant="secondary">{news.length}건</Badge>}
    >
      <div className="mb-3 flex flex-wrap gap-1">
        {CATEGORIES.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => {
              setFilter(c.key);
              setLimit(10);
            }}
            className={cn(
              'rounded-full border px-3 py-1 text-xs transition-colors',
              filter === c.key
                ? 'border-foreground bg-foreground text-background'
                : 'text-muted-foreground hover:bg-muted',
            )}
          >
            {c.label}
            {c.key !== 'all' ? (
              <span className="ml-1 opacity-60">
                {news.filter((n) => n.category === c.key).length}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      <ul className="divide-y">
        {filtered.slice(0, limit).map((n) => (
          <li key={n.url} className="py-2.5">
            <a
              href={n.url}
              target="_blank"
              rel="noreferrer"
              className="group flex items-start gap-2"
            >
              <span
                className={cn(
                  'mt-1.5 size-1.5 shrink-0 rounded-full',
                  n.tone === 'positive'
                    ? 'bg-rise'
                    : n.tone === 'negative'
                      ? 'bg-fall'
                      : 'bg-muted-foreground/40',
                )}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-start gap-1.5">
                  <span className="text-sm leading-snug group-hover:underline">{n.title}</span>
                  <ExternalLink className="text-muted-foreground mt-0.5 size-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
                </div>
                <p className="text-muted-foreground mt-0.5 line-clamp-2 text-xs">{n.summary}</p>
                <div className="text-muted-foreground mt-1 flex items-center gap-2 text-[11px]">
                  <span>{n.source}</span>
                  <span>·</span>
                  <span>{relativeTime(n.publishedAt)}</span>
                </div>
              </div>
            </a>
          </li>
        ))}
      </ul>

      {filtered.length > limit ? (
        <Button
          variant="ghost"
          size="sm"
          className="mt-2 w-full"
          onClick={() => setLimit((l) => l + 15)}
        >
          더 보기 ({filtered.length - limit}건)
        </Button>
      ) : null}
    </SectionCard>
  );
}
