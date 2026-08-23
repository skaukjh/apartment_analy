'use client';

/**
 * 전용면적 타입 선택 — 실거래에 실제로 존재하는 평형만 고를 수 있다.
 *
 * 목표 아파트 면적을 자유 입력으로 두면 실거래에 없는 값이 들어가
 * 시세 매칭이 통째로 비는 사고가 난다. 최근 24개월 실거래에서 그 단지의
 * 평형 목록을 불러와 드롭다운으로만 바꾸게 하고, 평형을 바꾸면
 * 호가(실거래 중앙값)·준공연도·법정동도 함께 갱신한다.
 */

import { useEffect, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatArea, formatKrw } from '@/lib/format';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface AreaRow {
  areaM2: number;
  price: number;
  latestPrice: number;
  latestDealDate: string;
  tradeCount: number;
}

export interface AreaTypePick extends AreaRow {
  builtYear?: number;
  dong?: string;
}

interface CacheEntry {
  builtYear?: number;
  dong?: string;
  areas: AreaRow[];
}

/* 같은 단지를 카드마다 다시 조회하지 않게 세션 동안 모듈 수준으로 캐시한다.
   렌더에서 캐시를 직접 읽고, 상태는 재렌더 트리거로만 쓴다 —
   effect 안의 동기 setState 를 피하기 위한 구조다. */
const cache = new Map<string, CacheEntry>();
const failed = new Set<string>();

export function AreaTypeSelect({
  lawdCd,
  complexName,
  value,
  onPick,
}: {
  lawdCd: string;
  complexName: string;
  value: number;
  onPick: (p: AreaTypePick) => void;
}) {
  const name = complexName.trim();
  const key = `${lawdCd}|${name}`;
  const valid = /^\d{5}$/.test(lawdCd) && name.length > 0;
  const [, bump] = useState(0);

  const entry = cache.get(key);
  const hasError = failed.has(key);
  const loading = valid && !entry && !hasError;

  useEffect(() => {
    if (!valid || cache.has(key) || failed.has(key)) return;
    let alive = true;
    fetch(`/api/complex/search?lawdCd=${lawdCd}&q=${encodeURIComponent(name)}`)
      .then((r) => r.json())
      .then((json) => {
        if (!json.ok) throw new Error(json.error ?? '조회 실패');
        const list = (json.complexes ?? []) as Array<{
          complexName: string;
          dong: string;
          builtYear?: number;
          areas: AreaRow[];
        }>;
        const exact = list.find((c) => c.complexName === name) ?? list[0];
        cache.set(
          key,
          exact
            ? {
                builtYear: exact.builtYear,
                dong: exact.dong,
                areas: [...exact.areas].sort((a, b) => a.areaM2 - b.areaM2),
              }
            : { areas: [] },
        );
        if (alive) bump((n) => n + 1);
      })
      .catch(() => {
        failed.add(key);
        if (alive) bump((n) => n + 1);
      });
    return () => {
      alive = false;
    };
  }, [key, lawdCd, name, valid]);

  if (!valid) {
    return (
      <p className="text-muted-foreground rounded-md border border-dashed px-3 py-2 text-xs">
        단지명과 시군구를 먼저 입력하면 실거래 평형을 불러옵니다.
      </p>
    );
  }

  if (hasError) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-destructive text-xs">평형 조회 실패</span>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            failed.delete(key);
            bump((n) => n + 1);
          }}
        >
          <RefreshCw className="size-3.5" /> 재시도
        </Button>
      </div>
    );
  }

  const areas = entry?.areas ?? [];

  return (
    <Select
      value={String(value)}
      onValueChange={(raw) => {
        const a = areas.find((x) => String(x.areaM2) === String(raw ?? ''));
        if (a) onPick({ ...a, builtYear: entry?.builtYear, dong: entry?.dong });
      }}
    >
      <SelectTrigger className="w-full min-w-0" disabled={loading}>
        <SelectValue>
          {loading ? (
            <span className="flex items-center gap-1.5">
              <Loader2 className="size-3.5 animate-spin" /> 평형 불러오는 중…
            </span>
          ) : (
            <span className="block min-w-0 truncate">{formatArea(value)}</span>
          )}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {areas.length === 0 ? (
          <div className="text-muted-foreground px-3 py-2 text-xs">
            최근 24개월 실거래에서 평형을 찾지 못했습니다. 단지명을 검색으로 다시 선택해 보세요.
          </div>
        ) : (
          areas.map((a) => (
            <SelectItem key={a.areaM2} value={String(a.areaM2)}>
              {/* 두 줄 — 첫 줄 평형, 둘째 줄 시세·표본. 잘리지 않게 항목에서 다 보여준다 */}
              <span className="flex flex-col items-start gap-0.5">
                <span>{formatArea(a.areaM2)}</span>
                <span className="text-muted-foreground text-xs">
                  중앙값 {formatKrw(a.price, { compact: true })} · 표본 {a.tradeCount}건 · 최근{' '}
                  {a.latestDealDate}
                </span>
              </span>
            </SelectItem>
          ))
        )}
      </SelectContent>
    </Select>
  );
}
