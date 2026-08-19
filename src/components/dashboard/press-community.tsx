'use client';

import { useState } from 'react';
import { ExternalLink, Landmark, MessageSquare, Star } from 'lucide-react';
import type { CommunityPost, NewsItem } from '@/lib/types';
import { OFFICIAL_LINKS } from '@/lib/sources/gov';
import { EmptyHint, SectionCard } from '@/components/ui-bits';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const hours = Math.floor(diff / 3_600_000);
  if (hours < 1) return '방금';
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}일 전`;
  return iso.slice(0, 10);
}

/** 정부 부처·공공기관 공식 발표 */
export function PressSection({ press }: { press: NewsItem[] }) {
  return (
    <SectionCard
      title={
        <>
          <Landmark className="size-4" /> 공식 발표 · 정책
        </>
      }
      description="국토교통부·금융위원회·기획재정부·한국은행·금감원 발표를 표적 수집합니다. 정책은 원문 확인이 가장 정확합니다."
      badge={<Badge variant="secondary">{press.length}건</Badge>}
    >
      {press.length === 0 ? (
        <EmptyHint>
          수집된 공식 발표가 없습니다. 네이버 검색 API 키를 확인하거나, 아래 원문 링크에서 직접
          확인하세요.
        </EmptyHint>
      ) : (
        <ul className="divide-y">
          {press.slice(0, 10).map((n) => (
            <li key={n.url} className="py-2">
              <a href={n.url} target="_blank" rel="noreferrer" className="group flex items-start gap-2">
                <Badge variant="outline" className="mt-0.5 shrink-0 text-[10px]">
                  {n.agency ?? '정부'}
                </Badge>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start gap-1.5">
                    <span className="text-sm leading-snug group-hover:underline">{n.title}</span>
                    <ExternalLink className="text-muted-foreground mt-0.5 size-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
                  </div>
                  <div className="text-muted-foreground mt-0.5 flex items-center gap-2 text-[11px]">
                    <span>{n.source}</span>
                    <span>·</span>
                    <span>{relativeTime(n.publishedAt)}</span>
                  </div>
                </div>
              </a>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 border-t pt-3">
        <h4 className="mb-1.5 text-xs font-semibold">원문 바로가기</h4>
        <div className="flex flex-wrap gap-1.5">
          {OFFICIAL_LINKS.map((l) => (
            <a
              key={l.url}
              href={l.url}
              target="_blank"
              rel="noreferrer"
              title={l.note}
              className="text-muted-foreground hover:bg-muted hover:text-foreground rounded-full border px-2.5 py-1 text-[11px] transition-colors"
            >
              {l.name}
            </a>
          ))}
        </div>
      </div>
    </SectionCard>
  );
}

/** 블로그·카페 — 참고용 */
export function CommunitySection({ posts }: { posts: CommunityPost[] }) {
  const [tab, setTab] = useState('popular');
  const popular = posts.filter((p) => p.popular);
  const recent = posts.filter((p) => !p.popular);

  const render = (list: CommunityPost[]) =>
    list.length === 0 ? (
      <EmptyHint>수집된 글이 없습니다.</EmptyHint>
    ) : (
      <ul className="divide-y">
        {list.slice(0, 12).map((p) => (
          <li key={p.url} className="py-2">
            <a href={p.url} target="_blank" rel="noreferrer" className="group block">
              <div className="flex items-start gap-1.5">
                <Badge
                  variant="outline"
                  className={cn(
                    'mt-0.5 shrink-0 text-[10px]',
                    p.kind === 'cafe'
                      ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                      : 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
                  )}
                >
                  {p.kind === 'cafe' ? '카페' : '블로그'}
                </Badge>
                <span className="text-sm leading-snug group-hover:underline">{p.title}</span>
              </div>
              <p className="text-muted-foreground mt-0.5 line-clamp-2 pl-1 text-xs">{p.summary}</p>
              <div className="text-muted-foreground mt-0.5 flex items-center gap-2 pl-1 text-[11px]">
                <span>{p.source}</span>
                {p.postedAt ? (
                  <>
                    <span>·</span>
                    <span>{p.postedAt}</span>
                  </>
                ) : null}
              </div>
            </a>
          </li>
        ))}
      </ul>
    );

  return (
    <SectionCard
      title={
        <>
          <MessageSquare className="size-4" /> 블로그 · 카페
        </>
      }
      description="개인이 쓴 글이라 수치 판단에는 쓰지 않고 분위기 참고용으로만 봅니다. 광고성 글은 자동으로 걸러냈습니다."
      badge={
        <Badge variant="outline" className="gap-1">
          <Star className="size-3" /> 참고용
        </Badge>
      }
    >
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="popular">주요 인기 글 {popular.length}</TabsTrigger>
          <TabsTrigger value="recent">관심 지역 최신 {recent.length}</TabsTrigger>
        </TabsList>
        <TabsContent value="popular" className="mt-2">
          {render(popular)}
        </TabsContent>
        <TabsContent value="recent" className="mt-2">
          {render(recent)}
        </TabsContent>
      </Tabs>
    </SectionCard>
  );
}
