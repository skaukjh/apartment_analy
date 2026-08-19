'use client';

import { useCallback, useMemo, useState } from 'react';
import { Loader2, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ReboundAnalysis } from '@/lib/types';
import { METRO_TILES, SEOUL_TILES, SIDO_LIST, findSigungu } from '@/lib/regions';
import { BASE_MONTH, STAGE_META, summarizeSpread } from '@/lib/analysis/rebound';
import { changeColor, contrastText } from '@/lib/geo';
import { formatPct } from '@/lib/format';
import { EmptyHint, SectionCard } from '@/components/ui-bits';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ChangeLegend, KoreaMap } from './korea-map';
import { cn } from '@/lib/utils';

interface Props {
  rebound: ReboundAnalysis[];
}

const SPAN = 20;

interface TileProps {
  tiles: Record<string, readonly [number, number]>;
  byCode: Map<string, ReboundAnalysis>;
  onSelect: (a: ReboundAnalysis | null) => void;
  selected: ReboundAnalysis | null;
}

function TileGrid({ tiles, byCode, onSelect, selected }: TileProps) {
  const entries = Object.entries(tiles);
  const cols = Math.max(...entries.map(([, c]) => c[0])) + 1;
  const rows = Math.max(...entries.map(([, c]) => c[1])) + 1;

  return (
    <div
      className="grid w-full max-w-[560px] gap-1"
      style={{
        gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
      }}
    >
      {entries.map(([code, [col, row]]) => {
        const analysis = byCode.get(code);
        const info = findSigungu(code);
        const hasData = Boolean(analysis && analysis.stage !== 'insufficient-data');
        const change = analysis?.changeSinceBase ?? 0;
        const isSelected = selected?.lawdCd === code;

        return (
          <button
            key={code}
            type="button"
            onMouseEnter={() => onSelect(analysis ?? null)}
            onFocus={() => onSelect(analysis ?? null)}
            onClick={() => onSelect(analysis ?? null)}
            style={{
              gridColumnStart: col + 1,
              gridRowStart: row + 1,
              background: hasData ? changeColor(change, SPAN) : 'var(--muted)',
              color: hasData ? contrastText(change, SPAN) : 'var(--muted-foreground)',
            }}
            className={cn(
              'aspect-square rounded-[4px] p-1 text-[9px] leading-tight transition-all sm:text-[10px]',
              'hover:z-10 hover:scale-110 hover:shadow-lg',
              isSelected && 'ring-foreground ring-offset-background ring-2 ring-offset-1',
              !hasData && 'opacity-50',
            )}
            title={
              analysis
                ? `${analysis.regionName}: 2023년초 대비 ${formatPct(change, 1)} · ${STAGE_META[analysis.stage].label}`
                : `${info?.name ?? code}: 데이터 없음`
            }
          >
            <div className="truncate font-medium">
              {(info?.name ?? code).replace(/(시|군|구)$/, '').slice(0, 4)}
            </div>
            <div className="tabular font-semibold">
              {hasData ? `${change > 0 ? '+' : ''}${change.toFixed(0)}` : '–'}
            </div>
          </button>
        );
      })}
    </div>
  );
}

/** YYYY-MM 형식 검사 */
const MONTH_RE = /^\d{4}-\d{2}$/;

export function SpreadMap({ rebound: initialRebound }: Props) {
  const [selected, setSelected] = useState<ReboundAnalysis | null>(null);
  const [sidoFilter, setSidoFilter] = useState<string>('전국');

  // 기간 선택 — 서버에서 다시 계산해 받아온다
  const defaultTo = initialRebound.find((r) => r.latestMonth)?.latestMonth ?? '';
  const [fromMonth, setFromMonth] = useState(BASE_MONTH);
  const [toMonth, setToMonth] = useState('');
  const [rebound, setRebound] = useState(initialRebound);
  const [rangeLoading, setRangeLoading] = useState(false);
  const [rangeError, setRangeError] = useState<string | null>(null);

  const isDefaultRange = fromMonth === BASE_MONTH && toMonth === '';

  const applyRange = useCallback(async (from: string, to: string) => {
    if (!MONTH_RE.test(from) || (to && !MONTH_RE.test(to))) {
      setRangeError('기간 형식은 YYYY-MM 입니다.');
      return;
    }
    if (to && to < from) {
      setRangeError('종료월이 시작월보다 빠릅니다.');
      return;
    }
    setRangeError(null);
    setRangeLoading(true);
    try {
      const qs = new URLSearchParams({ from });
      if (to) qs.set('to', to);
      const res = await fetch(`/api/rebound?${qs.toString()}`);
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? '기간 적용에 실패했습니다.');
      setRebound(json.rebound as ReboundAnalysis[]);
      setSelected(null);
    } catch (e) {
      setRangeError((e as Error).message);
    } finally {
      setRangeLoading(false);
    }
  }, []);

  const resetRange = useCallback(() => {
    setFromMonth(BASE_MONTH);
    setToMonth('');
    setRebound(initialRebound);
    setSelected(null);
    setRangeError(null);
  }, [initialRebound]);

  const byCode = useMemo(() => new Map(rebound.map((r) => [r.lawdCd, r])), [rebound]);
  const spread = useMemo(() => summarizeSpread(rebound), [rebound]);

  const filtered = useMemo(
    () => (sidoFilter === '전국' ? rebound : rebound.filter((r) => r.sido === sidoFilter)),
    [rebound, sidoFilter],
  );

  if (rebound.length === 0) {
    return (
      <SectionCard
        title="③ 상승장 확산 지도"
        description="2023년 1월을 100으로 둔 지역별 실거래 지수로 상승 물결의 진원지와 미반등 지역을 봅니다."
      >
        <EmptyHint>
          실거래 데이터가 아직 수집되지 않았습니다.
          <br />
          <code className="text-xs">/api/cron/backfill?secret=…</code> 를 먼저 실행해 과거 데이터를
          채우세요.
        </EmptyHint>
      </SectionCard>
    );
  }

  // 실제로 비교에 쓰인 기간 (표본 사정으로 기준월이 밀릴 수 있어 화면에 그대로 노출한다)
  const withData = rebound.filter((r) => r.stage !== 'insufficient-data');
  const baseMonths = withData.map((r) => r.baseMonth).sort();
  const latestMonths = withData.map((r) => r.latestMonth).sort();
  const periodLabel =
    withData.length > 0
      ? `${baseMonths[0]} → ${latestMonths[latestMonths.length - 1]}`
      : '데이터 없음';
  const shifted = withData.filter((r) => r.baseShifted).length;

  return (
    <SectionCard
      title="③ 상승장 확산 지도"
      description={`${periodLabel} 실거래 지수 비교 (기준월 = 100). 붉을수록 많이 올랐고 푸를수록 많이 내렸으며, 농도가 변동 폭입니다.`}
      badge={<Badge variant="secondary">확산률 {spread.spreadRate.toFixed(0)}%</Badge>}
      action={
        <div className="flex w-full flex-wrap items-center gap-1.5 sm:w-auto">
          <input
            type="month"
            value={fromMonth}
            max={toMonth || undefined}
            onChange={(e) => setFromMonth(e.target.value)}
            aria-label="비교 시작월"
            className="bg-background min-w-0 flex-1 rounded-md border px-2 py-1 text-xs sm:flex-none"
          />
          <span className="text-muted-foreground text-xs">→</span>
          <input
            type="month"
            value={toMonth}
            min={fromMonth}
            max={defaultTo || undefined}
            onChange={(e) => setToMonth(e.target.value)}
            aria-label="비교 종료월 (비우면 최신)"
            className="bg-background min-w-0 flex-1 rounded-md border px-2 py-1 text-xs sm:flex-none"
          />
          <Button
            size="sm"
            variant="outline"
            onClick={() => applyRange(fromMonth, toMonth)}
            disabled={rangeLoading || isDefaultRange}
          >
            {rangeLoading ? <Loader2 className="size-3.5 animate-spin" /> : null}
            적용
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={resetRange}
            disabled={rangeLoading || isDefaultRange}
            title={`기본 기간(${BASE_MONTH} → 최신)으로 되돌리기`}
          >
            <RotateCcw className="size-3.5" /> 기본
          </Button>
        </div>
      }
    >
      {rangeError ? <p className="text-destructive mb-3 text-xs">{rangeError}</p> : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <Tabs defaultValue="nation">
            <TabsList>
              <TabsTrigger value="nation">전국</TabsTrigger>
              <TabsTrigger value="seoul">서울 25개구</TabsTrigger>
              <TabsTrigger value="metro">경기·인천</TabsTrigger>
            </TabsList>

            <TabsContent value="nation" className="mt-3">
              <KoreaMap
                rebound={rebound}
                selected={selected}
                onSelect={setSelected}
                span={SPAN}
                fromMonth={isDefaultRange ? undefined : fromMonth}
                toMonth={isDefaultRange ? undefined : toMonth || undefined}
              />
              <p className="text-muted-foreground mt-1 text-right text-[11px]">
                시·도 → 구·군 → 동 순서로 클릭해 내려갑니다 · 경계: 통계청 행정구역(간략판)
              </p>
            </TabsContent>

            <TabsContent value="seoul" className="mt-3">
              <TileGrid
                tiles={SEOUL_TILES}
                byCode={byCode}
                onSelect={setSelected}
                selected={selected}
              />
              <p className="text-muted-foreground mt-2 text-[11px]">
                실제 면적이 아닌 격자 배치(카토그램)입니다
              </p>
            </TabsContent>

            <TabsContent value="metro" className="mt-3">
              <TileGrid
                tiles={METRO_TILES}
                byCode={byCode}
                onSelect={setSelected}
                selected={selected}
              />
              <p className="text-muted-foreground mt-2 text-[11px]">
                실제 면적이 아닌 격자 배치(카토그램)입니다
              </p>
            </TabsContent>
          </Tabs>

          <div className="mt-4">
            <ChangeLegend span={SPAN} />
          </div>

          {shifted > 0 ? (
            <p className="text-muted-foreground mt-2 text-[11px]">
              {shifted}개 지역은 {BASE_MONTH}에 거래 표본이 없어 기준월이 뒤로 밀렸습니다. 해당
              지역의 변동률은 다른 지역과 직접 비교하기 어렵습니다.
            </p>
          ) : null}
        </div>

        {/* 지도가 세로로 길어 스크롤해도 목록이 따라오도록 고정한다 */}
        <div className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          {selected ? (
            <div className="rounded-lg border p-3">
              <div className="flex items-center justify-between">
                <span className="font-semibold">{selected.regionName}</span>
                <Badge
                  style={{ backgroundColor: STAGE_META[selected.stage].color, color: 'white' }}
                >
                  {STAGE_META[selected.stage].label}
                </Badge>
              </div>
              <dl className="mt-2 space-y-1 text-sm">
                <Row
                  label={`${selected.baseMonth} 대비`}
                  value={formatPct(selected.changeSinceBase, 1)}
                />
                <Row label="저점 대비 반등" value={formatPct(selected.reboundFromTrough, 1)} />
                <Row label="최근 3개월" value={formatPct(selected.recent3mChange, 2)} />
                <Row label="최신 데이터" value={selected.latestMonth} />
                <Row
                  label="분석 거래 표본"
                  value={`${selected.sampleSize.toLocaleString('ko-KR')}건`}
                />
              </dl>
              {selected.baseShifted ? (
                <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">
                  {BASE_MONTH}에 거래 표본이 없어 {selected.baseMonth}을 기준으로 잡았습니다.
                </p>
              ) : null}
              <p className="text-muted-foreground mt-2 text-[11px] leading-relaxed">
                {STAGE_META[selected.stage].description}
              </p>
              <Sparkline series={selected.series.map((p) => p.pricePerM2)} />
            </div>
          ) : (
            <div className="text-muted-foreground rounded-lg border border-dashed p-3 text-sm">
              지도의 지역을 클릭하면 상세 지표가 표시됩니다.
            </div>
          )}

          {/* 시도별 순위 */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <h4 className="text-sm font-semibold">지역 순위</h4>
              <select
                value={sidoFilter}
                onChange={(e) => setSidoFilter(e.target.value)}
                className="bg-background rounded-md border px-2 py-1 text-xs"
              >
                <option value="전국">전국</option>
                {SIDO_LIST.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <RankList
              items={[...filtered]
                .filter((r) => r.stage !== 'insufficient-data')
                .sort((a, b) => b.changeSinceBase - a.changeSinceBase)}
              onSelect={setSelected}
              selected={selected}
            />
          </div>

          <div>
            <h4 className="mb-2 text-sm font-semibold">
              2023년초 이후 미반등 지역
              <span className="text-muted-foreground ml-1 font-normal">
                ({spread.neverRebounded.length}곳)
              </span>
            </h4>
            {spread.neverRebounded.length === 0 ? (
              <p className="text-muted-foreground text-xs">
                분석 대상 전 지역이 저점 대비 반등했습니다.
              </p>
            ) : (
              <ul className="thin-scrollbar max-h-72 space-y-1 overflow-y-auto pr-1">
                {spread.neverRebounded.slice(0, 40).map((r) => (
                  <li key={r.lawdCd}>
                    <button
                      type="button"
                      onClick={() => setSelected(r)}
                      className="hover:bg-muted flex w-full items-center justify-between rounded px-2 py-1 text-xs"
                    >
                      <span>{r.regionName}</span>
                      <span className="tabular text-fall">{formatPct(r.changeSinceBase, 1)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </SectionCard>
  );
}

function RankList({
  items,
  onSelect,
  selected,
}: {
  items: ReboundAnalysis[];
  onSelect: (a: ReboundAnalysis) => void;
  selected: ReboundAnalysis | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const top = items.slice(0, expanded ? 40 : 6);
  const bottom = expanded ? [] : items.slice(-4);

  const render = (r: ReboundAnalysis, rank: number) => (
    <li key={r.lawdCd}>
      <button
        type="button"
        onClick={() => onSelect(r)}
        className={cn(
          'hover:bg-muted flex w-full items-center gap-2 rounded px-2 py-1 text-xs',
          selected?.lawdCd === r.lawdCd && 'bg-muted',
        )}
      >
        <span className="tabular text-muted-foreground w-6 text-right">{rank}</span>
        <span
          className="size-2.5 shrink-0 rounded-full"
          style={{ background: changeColor(r.changeSinceBase, 20) }}
        />
        <span className="flex-1 truncate text-left">{r.regionName}</span>
        <span className={cn('tabular', r.changeSinceBase >= 0 ? 'text-rise' : 'text-fall')}>
          {formatPct(r.changeSinceBase, 1)}
        </span>
      </button>
    </li>
  );

  return (
    <>
      <ul className="thin-scrollbar max-h-[26rem] space-y-0.5 overflow-y-auto pr-1">
        {top.map((r, i) => render(r, i + 1))}
        {bottom.length > 0 ? (
          <>
            <li className="text-muted-foreground px-2 py-0.5 text-center text-[10px]">⋯</li>
            {bottom.map((r) => render(r, items.indexOf(r) + 1))}
          </>
        ) : null}
      </ul>
      {items.length > 10 ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="text-muted-foreground hover:bg-muted mt-1 w-full rounded py-1 text-[11px]"
        >
          {expanded ? '접기' : `전체 ${items.length}곳 보기`}
        </button>
      ) : null}
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tabular font-medium">{value}</dd>
    </div>
  );
}

/** 의존성 없는 초경량 스파크라인 */
function Sparkline({ series }: { series: number[] }) {
  if (series.length < 2) return null;
  const min = Math.min(...series);
  const max = Math.max(...series);
  const range = max - min || 1;
  const w = 280;
  const h = 48;
  const points = series
    .map((v, i) => {
      const x = (i / (series.length - 1)) * w;
      const y = h - ((v - min) / range) * (h - 6) - 3;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  const rising = series[series.length - 1] >= series[0];

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="mt-2 w-full" preserveAspectRatio="none">
      <polyline
        points={points}
        fill="none"
        stroke={rising ? 'var(--rise)' : 'var(--fall)'}
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
      />
      <line
        x1="0"
        y1={h - ((100 - min) / range) * (h - 6) - 3}
        x2={w}
        y2={h - ((100 - min) / range) * (h - 6) - 3}
        stroke="var(--border)"
        strokeDasharray="3 3"
        strokeWidth="1"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
