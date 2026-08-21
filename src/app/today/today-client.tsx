'use client';

/**
 * 오늘의 요약 — AI 부분만 클라이언트에서 따로 불러온다.
 *
 * AI 생성은 20초 넘게 걸린다. 서버 컴포넌트에서 같이 기다리면
 * 페이지 전체가 그만큼 늦어지므로, 숫자 요약을 먼저 보여주고
 * AI 는 도착하는 대로 채운다.
 */

import { useEffect, useState } from 'react';
import { Loader2, RefreshCw, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SectionCard } from '@/components/ui-bits';

interface OutlookSource {
  kind: 'official' | 'news' | 'blog' | 'cafe';
  title: string;
  url: string;
}

interface OutlookResponse {
  ok: boolean;
  error?: string;
  markdown?: string;
  sources?: OutlookSource[];
  gaps?: string[];
  model?: string;
  generatedAt?: string;
}

/** '8월 22일 14시' 형태 — 이 요약이 언제 기준인지 한눈에 */
function formatGeneratedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getMonth() + 1}월 ${d.getDate()}일 ${d.getHours()}시`;
}

const KIND_LABEL: Record<OutlookSource['kind'], string> = {
  official: '공식발표',
  news: '기사',
  blog: '블로그',
  cafe: '카페',
};

/** 아주 단순한 마크다운 렌더링 — 제목/목록/굵게만 처리한다 */
function renderMarkdown(md: string) {
  return md.split('\n').map((raw, i) => {
    const line = raw.trimEnd();

    if (line.startsWith('## ')) {
      return (
        <h3 key={i} className="mt-5 mb-2 text-base font-semibold first:mt-0">
          {line.slice(3)}
        </h3>
      );
    }
    if (line.startsWith('# ')) {
      return (
        <h2 key={i} className="mt-5 mb-2 text-lg font-semibold first:mt-0">
          {line.slice(2)}
        </h2>
      );
    }
    if (!line.trim()) return <div key={i} className="h-2" />;

    const bulleted = /^(\d+\.|[-*])\s+/.test(line);
    const body = bulleted ? line.replace(/^(\d+\.|[-*])\s+/, '') : line;

    // **굵게** 처리
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

export function AiOutlookPanel({
  enabled,
  canRefresh = false,
}: {
  enabled: boolean;
  /** 재생성(비용)은 관리자만 — 일반 사용자에게는 버튼을 숨긴다 */
  canRefresh?: boolean;
}) {
  const [data, setData] = useState<OutlookResponse | null>(null);
  const [loading, setLoading] = useState(false);

  async function load(force = false) {
    setLoading(true);
    try {
      const res = await fetch('/api/ai/outlook' + (force ? '?refresh=1' : ''));
      setData(await res.json());
    } catch (e) {
      setData({ ok: false, error: (e as Error).message });
    } finally {
      setLoading(false);
    }
  }

  // 최초 1회만 자동 생성한다 (호출당 비용이 든다).
  // 마운트 직후 곧바로 setState 하지 않도록 다음 틱으로 미룬다.
  useEffect(() => {
    if (!enabled) return;
    const id = setTimeout(() => void load(), 0);
    return () => clearTimeout(id);
  }, [enabled]);

  if (!enabled) {
    return (
      <p className="text-muted-foreground text-sm">
        AI 요약을 쓰려면 <code>OPENAI_API_KEY</code> 를 설정하세요.
      </p>
    );
  }

  return (
    <SectionCard
      title={
        <>
          <Sparkles className="size-4" /> AI 요약 · 전망
          {data?.generatedAt ? (
            <span className="text-muted-foreground ml-1 text-sm font-normal">
              ({formatGeneratedAt(data.generatedAt)} 생성 내용)
            </span>
          ) : null}
        </>
      }
      description="공식 발표와 정책, 커뮤니티 글을 읽고 보유·목표 아파트 기준으로 정리합니다. 새 자료(공식발표 1건+ 또는 기사·글 20건+)가 쌓일 때만 다시 만듭니다. 투자 자문이 아닙니다."
    >
      <div className="mb-3 flex items-center justify-end">
        {canRefresh ? (
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
        ) : null}
      </div>

      {loading && !data && (
        <div className="space-y-2">
          <div className="bg-muted h-4 w-1/3 animate-pulse rounded" />
          <div className="bg-muted/70 h-4 w-full animate-pulse rounded" />
          <div className="bg-muted/70 h-4 w-5/6 animate-pulse rounded" />
          <p className="text-muted-foreground pt-2 text-xs">
            자료를 읽고 정리하는 중입니다. 20~40초 걸립니다.
          </p>
        </div>
      )}

      {data && !data.ok && <p className="text-destructive text-sm">{data.error}</p>}

      {data?.ok && data.markdown && (
        <>
          <div className="space-y-1">{renderMarkdown(data.markdown)}</div>

          {data.gaps && data.gaps.length > 0 && (
            <p className="text-muted-foreground mt-4 text-xs">
              확보하지 못한 자료: {data.gaps.join(' · ')}
            </p>
          )}

          {data.sources && data.sources.length > 0 && (
            <details className="mt-4">
              <summary className="text-muted-foreground cursor-pointer text-xs">
                읽은 자료 {data.sources.length}건
              </summary>
              <ul className="mt-2 space-y-1">
                {data.sources.map((s, i) => (
                  <li key={i} className="text-xs">
                    <span className="text-muted-foreground">[{KIND_LABEL[s.kind]}]</span>{' '}
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
