'use client';

/**
 * 최신 부동산 정책 요약 패널.
 *
 * 크론이 미리 만들어 둔 전역 요약을 보여준다. 언제 생성됐는지,
 * 언제 마지막으로 새 자료를 점검했는지, 무엇을 읽었는지를 함께 표시한다.
 * 변동이 없으면 재생성하지 않고 이전 본문을 그대로 쓴다.
 */

import { useEffect, useState } from 'react';
import { Landmark, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SectionCard } from '@/components/ui-bits';

interface DigestSource {
  kind: 'official' | 'news' | 'blog' | 'cafe';
  title: string;
  url: string;
}

interface DigestResponse {
  ok: boolean;
  error?: string;
  pending?: boolean;
  markdown?: string;
  sources?: DigestSource[];
  generatedAt?: string;
  refreshedAt?: string;
}

function formatAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getMonth() + 1}월 ${d.getDate()}일 ${d.getHours()}시`;
}

/** 아주 단순한 마크다운 렌더링 — 제목/목록/굵게만 */
function renderMarkdown(md: string) {
  return md.split('\n').map((raw, i) => {
    const line = raw.trimEnd();
    if (line.startsWith('## ')) {
      return (
        <h3 key={i} className="mt-4 mb-1.5 text-sm font-semibold first:mt-0">
          {line.slice(3)}
        </h3>
      );
    }
    if (!line.trim()) return <div key={i} className="h-1.5" />;
    const bulleted = /^(\d+\.|[-*])\s+/.test(line);
    const body = bulleted ? line.replace(/^(\d+\.|[-*])\s+/, '') : line;
    const parts = body
      .split(/(\*\*[^*]+\*\*)/g)
      .map((p, j) =>
        p.startsWith('**') && p.endsWith('**') ? (
          <strong key={j}>{p.slice(2, -2)}</strong>
        ) : (
          <span key={j}>{p}</span>
        ),
      );
    return (
      <p key={i} className={bulleted ? 'text-muted-foreground ml-4 text-sm' : 'text-sm'}>
        {bulleted ? '· ' : ''}
        {parts}
      </p>
    );
  });
}

export function PolicyDigestPanel({ canRefresh = false }: { canRefresh?: boolean }) {
  const [data, setData] = useState<DigestResponse | null>(null);
  const [loading, setLoading] = useState(false);

  async function load(force = false) {
    setLoading(true);
    try {
      const res = await fetch('/api/ai/policy' + (force ? '?refresh=1' : ''));
      setData(await res.json());
    } catch (e) {
      setData({ ok: false, error: (e as Error).message });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const id = setTimeout(() => void load(), 0);
    return () => clearTimeout(id);
  }, []);

  const officialCount = data?.sources?.filter((s) => s.kind === 'official').length ?? 0;
  const newsCount = data?.sources?.filter((s) => s.kind === 'news').length ?? 0;

  return (
    <SectionCard
      title={
        <>
          <Landmark className="size-4" /> 최신 부동산 정책 요약
          {data?.generatedAt ? (
            <span className="text-muted-foreground ml-1 text-sm font-normal">
              ({formatAt(data.generatedAt)} 생성 내용)
            </span>
          ) : null}
        </>
      }
      description="정부 공식 발표와 정책 보도를 정리한 것입니다. 확정·미확정을 구분해 읽으세요 — 국회 통과 전 개편안은 확정이 아닙니다."
    >
      {canRefresh ? (
        <div className="mb-2 flex justify-end">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={loading}
            onClick={() => void load(true)}
          >
            {loading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
            <span className="ml-1">다시 생성</span>
          </Button>
        </div>
      ) : null}

      {loading && !data && (
        <div className="space-y-2">
          <div className="bg-muted h-4 w-1/3 animate-pulse rounded" />
          <div className="bg-muted/70 h-4 w-full animate-pulse rounded" />
        </div>
      )}

      {data && !data.ok && (
        <p className={data.pending ? 'text-muted-foreground text-sm' : 'text-destructive text-sm'}>
          {data.error}
        </p>
      )}

      {data?.ok && data.markdown && (
        <>
          <div className="space-y-1">{renderMarkdown(data.markdown)}</div>

          <div className="text-muted-foreground mt-4 space-y-1 border-t pt-3 text-[11px] leading-relaxed">
            <p>
              <span className="text-foreground font-medium">생성 근거</span> — 공식발표{' '}
              {officialCount}건 · 정책 기사 {newsCount}건
            </p>
            <p>
              재생성 기준: 새 공식발표 1건 이상 또는 새 기사 10건 이상 쌓였을 때만. 기준 미달이면
              이전 요약을 그대로 둡니다
              {data.refreshedAt ? ` — 마지막 자료 점검 ${formatAt(data.refreshedAt)}` : ''}.
            </p>
          </div>

          {data.sources && data.sources.length > 0 && (
            <details className="mt-3">
              <summary className="text-muted-foreground cursor-pointer text-xs">
                읽은 자료 {data.sources.length}건
              </summary>
              <ul className="mt-2 space-y-1">
                {data.sources.map((s, i) => (
                  <li key={i} className="text-xs">
                    <span className="text-muted-foreground">
                      [{s.kind === 'official' ? '공식발표' : '기사'}]
                    </span>{' '}
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="hover:underline"
                    >
                      {s.title}
                    </a>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </SectionCard>
  );
}
