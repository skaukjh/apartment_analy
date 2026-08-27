'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ExternalLink, Loader2, MessageSquare, Newspaper, Plus, Search, X } from 'lucide-react';
import type { ComplexFeed, ComplexFeedItem } from '@/lib/sources/complex-feed';
import { EmptyHint, SectionCard } from '@/components/ui-bits';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

/**
 * 지켜볼 단지 목록.
 *
 * 원본은 localStorage 다 — 서버 설정(보유·목표 단지)과 별개로
 * "지금 눈여겨보는 단지"를 적어두는 메모이기 때문이다.
 * React state 로 따로 복사해두면 복원 시점에 화면과 어긋나므로
 * useSyncExternalStore 로 저장소를 그대로 읽는다.
 */
const STORAGE_KEY = 'complex-news:names';
const MAX_NAMES = 10;

const listeners = new Set<() => void>();

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  // 다른 탭에서 목록을 고쳐도 따라간다
  window.addEventListener('storage', onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener('storage', onChange);
  };
}

/** 스냅샷은 문자열로 돌려준다 — 매번 새 배열을 만들면 무한 렌더가 된다 */
function readSnapshot(): string {
  try {
    return window.localStorage.getItem(STORAGE_KEY) ?? '[]';
  } catch {
    return '[]';
  }
}

/** 서버 렌더 시점에는 저장소가 없다. 빈 목록으로 그리고 복원은 하이드레이션 뒤에 한다 */
function serverSnapshot(): string {
  return '[]';
}

function writeNames(names: string[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(names));
  } catch {
    // 사파리 프라이빗 모드 등 — 저장이 안 돼도 이번 세션은 그대로 쓸 수 있다
  }
  listeners.forEach((l) => l());
}

function parseNames(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

/** 공백·대소문자 차이를 무시한 비교 키 */
function nameKey(s: string): string {
  return s.replace(/\s/g, '').toLowerCase();
}

interface FeedResponse {
  ok: boolean;
  error?: string;
  generatedAt?: string;
  truncated?: boolean;
  feeds?: ComplexFeed[];
}

const TONE_LABEL: Record<string, { label: string; className: string }> = {
  positive: { label: '호재', className: 'bg-rise/10 text-rise' },
  negative: { label: '악재', className: 'bg-fall/10 text-fall' },
};

/** 소식 한 건 */
function FeedRow({ item }: { item: ComplexFeedItem }) {
  const tone = item.tone ? TONE_LABEL[item.tone] : undefined;
  return (
    <li className="py-2">
      <a href={item.url} target="_blank" rel="noreferrer" className="group block">
        <div className="flex items-start gap-1.5">
          <span className="text-sm leading-snug group-hover:underline">{item.title}</span>
          <ExternalLink className="text-muted-foreground mt-0.5 size-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
        </div>
        {item.summary ? (
          <p className="text-muted-foreground mt-0.5 line-clamp-2 text-xs">{item.summary}</p>
        ) : null}
        <div className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px]">
          <span className="max-w-[14rem] truncate">{item.source}</span>
          {item.postedAt ? (
            <>
              <span>·</span>
              <span className="tabular">{item.postedAt}</span>
            </>
          ) : null}
          {tone ? (
            <Badge variant="outline" className={cn('h-4 px-1 text-[10px]', tone.className)}>
              {tone.label}
            </Badge>
          ) : null}
        </div>
      </a>
    </li>
  );
}

function FeedList({ items, empty }: { items: ComplexFeedItem[]; empty: string }) {
  if (items.length === 0) return <EmptyHint>{empty}</EmptyHint>;
  return (
    <ul className="divide-y">
      {items.map((it) => (
        <FeedRow key={it.url} item={it} />
      ))}
    </ul>
  );
}

/** 단지 한 곳의 카드 — 블로그 · 카페 · 기사 탭 */
function ComplexCard({ feed }: { feed: ComplexFeed }) {
  const [tab, setTab] = useState('blog');
  const total = feed.blogs.length + feed.cafes.length + feed.news.length;

  return (
    <SectionCard
      title={
        <>
          <Search className="size-4" /> {feed.name}
        </>
      }
      badge={<Badge variant="secondary">{total}건</Badge>}
      description={
        feed.errors.length > 0 ? (
          <span className="text-fall">수집 실패 — {feed.errors.join(' / ')}</span>
        ) : undefined
      }
    >
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="blog">블로그 {feed.blogs.length}</TabsTrigger>
          <TabsTrigger value="cafe">카페 {feed.cafes.length}</TabsTrigger>
          <TabsTrigger value="news">기사 {feed.news.length}</TabsTrigger>
        </TabsList>
        <TabsContent value="blog" className="mt-2">
          <FeedList items={feed.blogs} empty="최근 블로그 글이 없습니다." />
        </TabsContent>
        <TabsContent value="cafe" className="mt-2">
          <FeedList items={feed.cafes} empty="최근 카페 글이 없습니다." />
          {feed.cafes.length > 0 ? (
            <p className="text-muted-foreground mt-2 text-[11px]">
              카페 글은 네이버가 작성일을 주지 않아 날짜를 표시하지 않습니다. 순서는 최신순입니다.
            </p>
          ) : null}
        </TabsContent>
        <TabsContent value="news" className="mt-2">
          <FeedList items={feed.news} empty="최근 기사가 없습니다." />
        </TabsContent>
      </Tabs>
    </SectionCard>
  );
}

/**
 * 단지 소식 화면.
 *
 * 지켜보는 단지 이름을 목록으로 넣어두면 단지마다 블로그·카페·기사를
 * 최신순 10건씩 모아 보여준다. 목록은 브라우저에 저장돼 다음에도 그대로 뜬다.
 */
export function ComplexNewsClient({ suggestions }: { suggestions: string[] }) {
  const rawNames = useSyncExternalStore(subscribe, readSnapshot, serverSnapshot);
  const names = useMemo(() => parseNames(rawNames), [rawNames]);

  const [draft, setDraft] = useState('');
  const [feeds, setFeeds] = useState<ComplexFeed[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const autoRan = useRef(false);

  const run = useCallback(async (targets: string[]) => {
    if (targets.length === 0) {
      setFeeds([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/complex/feed?names=${encodeURIComponent(targets.join(','))}`);
      const json = (await res.json()) as FeedResponse;
      if (!json.ok) throw new Error(json.error ?? '소식을 가져오지 못했습니다.');
      setFeeds(json.feeds ?? []);
      setFetchedAt(json.generatedAt ?? new Date().toISOString());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  /* 목록이 처음 채워질 때 한 번만 자동으로 모은다.
     저장해 둔 목록을 들고 들어왔는데 매번 버튼을 눌러야 하면 번거롭기 때문이다.
     서버가 30분 캐시를 쓰므로 재방문 비용은 거의 없다. 그 뒤로는 사용자가 누른다. */
  useEffect(() => {
    if (autoRan.current || names.length === 0) return;
    autoRan.current = true;
    void run(names);
  }, [names, run]);

  const addName = useCallback(
    (raw: string) => {
      const name = raw.trim();
      if (!name) return;
      if (names.length >= MAX_NAMES) {
        setError(`한 번에 ${MAX_NAMES}개 단지까지 볼 수 있습니다.`);
        return;
      }
      setDraft('');
      if (names.some((n) => nameKey(n) === nameKey(name))) return;
      writeNames([...names, name]);
      setError(null);
    },
    [names],
  );

  const removeName = useCallback(
    (name: string) => {
      writeNames(names.filter((n) => n !== name));
      setFeeds((prev) => prev.filter((f) => f.name !== name));
    },
    [names],
  );

  const unused = suggestions.filter((s) => !names.some((n) => nameKey(n) === nameKey(s)));

  return (
    <div className="space-y-6">
      <SectionCard
        title={
          <>
            <Newspaper className="size-4" /> 지켜볼 단지
          </>
        }
        description="단지명을 넣고 [소식 모으기]를 누르면 단지마다 블로그·카페·기사를 최신순 10건씩 모읍니다. 목록은 이 브라우저에 저장됩니다."
        badge={
          <Badge variant="outline">
            {names.length} / {MAX_NAMES}
          </Badge>
        }
      >
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addName(draft);
                }
              }}
              placeholder="단지명 (예: 헬리오시티)"
              aria-label="단지명"
              className="min-w-[12rem] flex-1"
            />
            <Button type="button" variant="secondary" onClick={() => addName(draft)}>
              <Plus className="size-4" /> 추가
            </Button>
            <Button
              type="button"
              onClick={() => void run(names)}
              disabled={loading || names.length === 0}
            >
              {loading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Search className="size-4" />
              )}
              소식 모으기
            </Button>
          </div>

          {names.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {names.map((n) => (
                <span
                  key={n}
                  className="bg-secondary text-secondary-foreground inline-flex items-center gap-1 rounded-full py-1 pr-1 pl-2.5 text-sm"
                >
                  {n}
                  <button
                    type="button"
                    aria-label={`${n} 제거`}
                    onClick={() => removeName(n)}
                    className="hover:bg-background/70 rounded-full p-0.5"
                  >
                    <X className="size-3.5" />
                  </button>
                </span>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">
              아직 넣은 단지가 없습니다. 위에 단지명을 적고 추가하세요.
            </p>
          )}

          {unused.length > 0 ? (
            <div className="border-t pt-3">
              <h4 className="text-muted-foreground mb-1.5 text-xs font-semibold">
                설정에 저장된 내 단지
              </h4>
              <div className="flex flex-wrap gap-1.5">
                {unused.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => addName(s)}
                    className="text-muted-foreground hover:bg-secondary hover:text-foreground rounded-full border px-2.5 py-1 text-[11px] transition-colors"
                  >
                    + {s}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {error ? <p className="text-fall text-sm">{error}</p> : null}
          {fetchedAt && !loading ? (
            <p className="text-muted-foreground text-[11px]">
              수집 시각 {new Date(fetchedAt).toLocaleString('ko-KR')}
            </p>
          ) : null}
        </div>
      </SectionCard>

      {loading && feeds.length === 0 ? (
        <EmptyHint>
          <Loader2 className="mx-auto mb-2 size-5 animate-spin" />
          단지마다 블로그·카페·기사를 찾는 중입니다.
        </EmptyHint>
      ) : null}

      {feeds.length > 0 ? (
        <div className="grid gap-6 xl:grid-cols-2">
          {feeds.map((f) => (
            <ComplexCard key={f.name} feed={f} />
          ))}
        </div>
      ) : null}

      {!loading && feeds.length === 0 && names.length > 0 ? (
        <EmptyHint>
          <MessageSquare className="mx-auto mb-2 size-5" />
          [소식 모으기]를 누르면 결과가 여기에 표시됩니다.
        </EmptyHint>
      ) : null}
    </div>
  );
}
