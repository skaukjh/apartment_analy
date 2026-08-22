'use client';

/**
 * 단지 검색 → 평형 선택 → 값 자동 채우기
 *
 * 시군구를 먼저 고르고 단지명을 검색하면, 최근 24개월 실거래에서
 * 그 단지의 평형 목록과 평형별 시세를 뽑아 보여준다.
 * 평형을 고르면 단지명·법정동·전용면적·시세를 한 번에 채운다.
 *
 * 채워지는 시세는 **실거래가(실제 체결가)** 다. 호가가 아니다.
 * 호가를 공개하는 공식 API 가 국내에 없어서, 호가는 사용자가 직접 손보게 둔다.
 */

import { useState } from 'react';
import { Loader2, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface AreaOption {
  areaM2: number;
  price: number;
  latestPrice: number;
  latestDealDate: string;
  tradeCount: number;
  minPrice: number;
  maxPrice: number;
}

interface ComplexOption {
  complexName: string;
  dong: string;
  sigungu: string;
  lawdCd: string;
  builtYear?: number;
  areas: AreaOption[];
  tradeCount: number;
}

/** 자동 채우기로 넘길 값 */
export interface ComplexPick {
  complexName: string;
  dong: string;
  areaM2: number;
  builtYear?: number;
  /** 최근 실거래 중앙값 (원) */
  price: number;
  /** 가장 최근 체결가 (원) */
  latestPrice: number;
  latestDealDate: string;
  tradeCount: number;
}

function eok(won: number): string {
  return `${(won / 1e8).toFixed(2)}억`;
}

/** 전용면적 → 평 (1평 = 3.3058㎡). 흔히 부르는 공급평형과는 다르다 */
function pyeong(areaM2: number): string {
  return `${(areaM2 / 3.3058).toFixed(1)}평`;
}

export function ComplexSearch({
  lawdCd,
  onPick,
}: {
  lawdCd: string;
  onPick: (pick: ComplexPick) => void;
}) {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<ComplexOption[] | null>(null);
  const [openName, setOpenName] = useState<string | null>(null);

  const disabled = !/^\d{5}$/.test(lawdCd);

  async function run() {
    if (disabled) return;
    setLoading(true);
    setError(null);
    setResults(null);
    setOpenName(null);
    try {
      const res = await fetch(
        `/api/complex/search?lawdCd=${lawdCd}&q=${encodeURIComponent(query.trim())}`,
      );
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? '검색에 실패했습니다.');
      setResults(json.complexes ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-md border border-dashed p-3">
      <div className="flex items-center gap-2">
        <Input
          value={query}
          placeholder={disabled ? '먼저 시군구를 선택하세요' : '단지명 검색 (예: 헬리오시티)'}
          disabled={disabled}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void run();
            }
          }}
        />
        <Button type="button" variant="secondary" disabled={disabled || loading} onClick={run}>
          {loading ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
          <span className="ml-1">검색</span>
        </Button>
      </div>

      <p className="text-muted-foreground mt-2 text-xs">
        최근 24개월 국토교통부 실거래가 기준입니다. 그 기간에{' '}
        <strong>거래가 있었던 단지·평형만</strong> 나옵니다. 호가가 아니므로 필요하면 직접
        조정하세요.
      </p>

      {error && <p className="text-destructive mt-2 text-xs">{error}</p>}

      {results && results.length === 0 && (
        <p className="text-muted-foreground mt-2 text-xs">
          최근 24개월 거래가 없습니다. 단지명을 줄여서 다시 검색해 보세요.
        </p>
      )}

      {results && results.length > 0 && (
        <ul className="mt-3 space-y-2">
          {results.map((c) => {
            const key = `${c.complexName}|${c.dong}`;
            const open = openName === key;
            return (
              <li key={key} className="rounded border">
                <button
                  type="button"
                  className="hover:bg-accent flex w-full items-center justify-between px-3 py-2 text-left text-sm"
                  onClick={() => setOpenName(open ? null : key)}
                >
                  <span>
                    <strong>{c.complexName}</strong>
                    <span className="text-muted-foreground ml-2 text-xs">
                      {c.dong}
                      {c.builtYear ? ` · ${c.builtYear}년` : ''} · 거래 {c.tradeCount}건
                    </span>
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {open ? '접기' : `평형 ${c.areas.length}개`}
                  </span>
                </button>

                {open && (
                  <ul className="border-t">
                    {c.areas.map((a) => (
                      <li key={a.areaM2}>
                        <button
                          type="button"
                          className="hover:bg-accent flex w-full items-center justify-between px-3 py-2 text-left text-sm"
                          onClick={() =>
                            onPick({
                              complexName: c.complexName,
                              dong: c.dong,
                              areaM2: a.areaM2,
                              builtYear: c.builtYear,
                              price: a.price,
                              latestPrice: a.latestPrice,
                              latestDealDate: a.latestDealDate,
                              tradeCount: a.tradeCount,
                            })
                          }
                        >
                          <span className="tabular">
                            {a.areaM2}㎡
                            <span className="text-muted-foreground ml-1 text-xs">
                              (전용 {pyeong(a.areaM2)})
                            </span>
                            <span className="text-muted-foreground ml-2 text-xs">
                              표본 {a.tradeCount}건
                            </span>
                          </span>
                          <span className="tabular text-xs">
                            중앙값 <strong>{eok(a.price)}</strong>
                            <span className="text-muted-foreground ml-2">
                              최근 {eok(a.latestPrice)} ({a.latestDealDate})
                            </span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
