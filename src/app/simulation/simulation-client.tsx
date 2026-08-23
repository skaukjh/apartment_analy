'use client';

import { tradePriceOf } from '@/lib/analysis/price-basis';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { PriceQuote, UserConfig } from '@/lib/types';
import {
  DOWNTURN_SCENARIOS,
  breakEvenDrop,
  buildSimulationInput,
  runScenarioMatrix,
  simulateSwitch,
} from '@/lib/analysis/switch-simulation';
import {
  complexSpecLine,
  formatArea,
  formatEok,
  formatKrw,
  formatPct,
  todayKst,
} from '@/lib/format';
import { calcLoanLimit } from '@/lib/tax/loan-limit';
import { REGULATION_AS_OF, regulationOf } from '@/lib/analysis/regulation';
import { SectionCard, EmptyHint, Stat } from '@/components/ui-bits';
import { Field, MoneyInput } from '@/components/form-bits';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

interface Props {
  config: UserConfig;
  quotes: Record<string, PriceQuote>;
}

/** 판정 색 — 가격 방향이 아니라 "갈아타기에 유리한가"를 뜻하는 신호등 색 */
const VERDICT_COLOR: Record<string, string> = {
  '매우 유리': 'oklch(0.62 0.16 155)',
  유리: 'oklch(0.72 0.12 155)',
  중립: 'var(--flat)',
  불리: 'oklch(0.7 0.14 25)',
  '매우 불리': 'oklch(0.58 0.19 25)',
};

const VERDICT_CLASS: Record<string, string> = {
  '매우 유리': 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  유리: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  중립: 'bg-muted text-muted-foreground',
  불리: 'bg-rose-500/10 text-rose-600 dark:text-rose-400',
  '매우 불리': 'bg-rose-500/15 text-rose-600 dark:text-rose-400',
};

export function SimulationClient({ config, quotes }: Props) {
  const params = useSearchParams();

  const [holdingId, setHoldingId] = useState(params.get('holding') ?? config.holdings[0]?.id ?? '');
  const [targetId, setTargetId] = useState(params.get('target') ?? config.targets[0]?.id ?? '');

  const holding = config.holdings.find((h) => h.id === holdingId) ?? config.holdings[0];
  const target = config.targets.find((t) => t.id === targetId) ?? config.targets[0];

  // 목표 드롭다운은 가격 낮은 순 — 시세 없는(0원) 항목은 뒤로 보낸다
  const targetsByPrice = [...config.targets].sort((a, b) => {
    const pa = tradePriceOf(quotes[a.id]) || Number.MAX_SAFE_INTEGER;
    const pb = tradePriceOf(quotes[b.id]) || Number.MAX_SAFE_INTEGER;
    return pa - pb;
  });

  // 시뮬레이션 기본값도 실거래가 기준. 호가는 사용자가 직접 고칠 수 있다.
  const defaultSell = holding ? tradePriceOf(quotes[holding.id]) : 0;
  const defaultBuy = target ? tradePriceOf(quotes[target.id]) : 0;

  const [sellPrice, setSellPrice] = useState(defaultSell);
  const [buyPrice, setBuyPrice] = useState(defaultBuy);
  const [cashOnHand, setCashOnHand] = useState(0);
  const [newLoan, setNewLoan] = useState(holding?.loanBalance ?? 0);
  const [newLoanRate, setNewLoanRate] = useState(holding?.loanRate ?? 4);

  const base = useMemo(() => {
    if (!holding || !target) return null;
    return buildSimulationInput(
      holding,
      target,
      config.household,
      sellPrice || defaultSell,
      buyPrice || defaultBuy,
      { cashOnHand, newLoan, newLoanRate },
    );
  }, [
    holding,
    target,
    config.household,
    sellPrice,
    buyPrice,
    defaultSell,
    defaultBuy,
    cashOnHand,
    newLoan,
    newLoanRate,
  ]);

  const baseline = useMemo(() => (base ? simulateSwitch(base) : null), [base]);

  /**
   * 목표 주택 기준 대출 가능액.
   * 갈아타기는 기존 주택을 처분하는 전제이므로 보유 주택 수를 0으로 넣는다.
   */
  const loanLimit = useMemo(() => {
    if (!target) return null;
    const reg = regulationOf(target.lawdCd);
    return {
      reg,
      result: calcLoanLimit({
        price: buyPrice || defaultBuy,
        regulated: config.household.targetIsRegulated || reg.adjusted,
        metro: reg.metro,
        retainedHouseCount: 0,
        firstTimeBuyer: config.household.firstTimeBuyer,
        annualIncome: config.household.annualIncome,
        otherDebtAnnualPayment: config.household.otherDebtAnnualPayment,
        rate: newLoanRate,
      }),
    };
  }, [target, buyPrice, defaultBuy, config.household, newLoanRate]);
  /* 보유 2년 미만이면 "2년 채우고 팔 때"를 같은 가격 가정으로 함께 계산한다.
     단기세율 60%와 비과세의 차이가 수억이라, 지금 vs 기다림이 실질 의사결정이다.
     이미 2년 이상이면 null — 화면에 나오지 않는다. */
  const twoYear = useMemo(() => {
    if (!base || !holding?.acquiredAt) return null;
    const d = new Date(holding.acquiredAt);
    d.setFullYear(d.getFullYear() + 2);
    d.setDate(d.getDate() + 1);
    const dateStr = d.toISOString().slice(0, 10);
    if (todayKst() >= dateStr) return null;
    return { date: dateStr, result: simulateSwitch({ ...base, soldAt: dateStr }) };
  }, [base, holding]);

  /* 시나리오 표·차트의 매도 시점 — 2년 미만 보유자만 전환 버튼이 보인다 */
  const [sellTiming, setSellTiming] = useState<'now' | 'twoYear'>('now');
  const effectiveBase = useMemo(
    () => (base && twoYear && sellTiming === 'twoYear' ? { ...base, soldAt: twoYear.date } : base),
    [base, twoYear, sellTiming],
  );
  const matrix = useMemo(
    () => (effectiveBase ? runScenarioMatrix(effectiveBase) : []),
    [effectiveBase],
  );
  const breakEven = useMemo(
    () => (effectiveBase ? breakEvenDrop(effectiveBase) : null),
    [effectiveBase],
  );
  const timingBadge =
    twoYear && sellTiming === 'twoYear' ? (
      <Badge className="bg-emerald-500/15 font-normal text-emerald-700 dark:text-emerald-400">
        2년 도달({twoYear.date}) 후 매도 기준
      </Badge>
    ) : undefined;

  if (!holding || !target) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-10">
        <EmptyHint>
          <p className="mb-3">보유 아파트와 목표 아파트를 먼저 등록해야 시뮬레이션이 가능합니다.</p>
          <Button render={<Link href="/settings" />} nativeButton={false} size="sm">
            설정으로 이동
          </Button>
        </EmptyHint>
      </div>
    );
  }

  const chartData = matrix.map((m) => ({
    name: m.scenario.label.replace(/\s*\(.*\)/, ''),
    gap: Math.round(m.result.priceGap / 100_000_000),
    cash: Math.round((m.result.totalNeeded - m.result.netFromSale) / 100_000_000),
    verdict: m.verdict,
  }));

  return (
    <div className="mx-auto max-w-[1400px] space-y-6 px-4 py-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">하락장 갈아타기 시뮬레이션</h1>
        <p className="text-muted-foreground text-sm">
          하락장에서는 상급지의 절대 낙폭이 커서 갭이 줄어듭니다. 다만 세금·중개보수 같은 마찰비용은
          거의 그대로여서, 갭 축소분이 마찰비용을 넘어서는 지점부터 갈아타기가 실질적으로
          유리해집니다.
        </p>
      </div>

      {/* 입력 */}
      <SectionCard title="시뮬레이션 조건" description="값을 바꾸면 아래 결과가 즉시 갱신됩니다.">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Field label="보유 아파트">
            <Select
              value={holding.id}
              onValueChange={(raw) => {
                const v = String(raw ?? '');
                setHoldingId(v);
                const h = config.holdings.find((x) => x.id === v);
                setSellPrice(h ? tradePriceOf(quotes[h.id]) : 0);
                setNewLoan(h?.loanBalance ?? 0);
                setNewLoanRate(h?.loanRate ?? 4);
              }}
            >
              <SelectTrigger className="min-w-0">
                {/* 함수 자식은 항목 등록 전 id 를 노출하므로 선택된 라벨을 직접 렌더링한다 */}
                <SelectValue>
                  <span className="block min-w-0 truncate">
                    {holding.complexName} · {formatArea(holding.areaM2)}
                  </span>
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {config.holdings.map((h) => (
                  <SelectItem key={h.id} value={h.id}>
                    <span className="flex flex-col items-start gap-0.5">
                      <span>{h.complexName}</span>
                      <span className="text-muted-foreground text-xs">{formatArea(h.areaM2)}</span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-muted-foreground mt-1 text-[11px]">
              {formatArea(holding.areaM2)}
              {complexSpecLine(holding) ? ` · ${complexSpecLine(holding)}` : ''}
            </p>
          </Field>

          <Field label="목표 아파트">
            <Select
              value={target.id}
              onValueChange={(raw) => {
                const v = String(raw ?? '');
                setTargetId(v);
                const t = config.targets.find((x) => x.id === v);
                setBuyPrice(t ? tradePriceOf(quotes[t.id]) : 0);
              }}
            >
              <SelectTrigger className="min-w-0">
                <SelectValue>
                  <span className="block min-w-0 truncate">
                    {target.complexName} · {formatArea(target.areaM2)}
                  </span>
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {targetsByPrice.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    <span className="flex flex-col items-start gap-0.5">
                      <span>{t.complexName}</span>
                      <span className="text-muted-foreground text-xs">
                        {formatArea(t.areaM2)}
                        {tradePriceOf(quotes[t.id]) > 0
                          ? ` · ${formatEok(tradePriceOf(quotes[t.id]))}`
                          : ''}
                        {tradePriceOf(quotes[t.id]) > 0 && defaultSell > 0
                          ? ` · 보유 대비 ${(tradePriceOf(quotes[t.id]) / defaultSell).toFixed(2)}배`
                          : ''}
                      </span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-muted-foreground mt-1 text-[11px]">
              {formatArea(target.areaM2)}
              {complexSpecLine(target) ? ` · ${complexSpecLine(target)}` : ''}
            </p>
            {/* 보유 대비 배율 — 매수·매도 예상가를 바꾸면 함께 움직인다 */}
            {(sellPrice || defaultSell) > 0 ? (
              <p className="text-primary tabular mt-0.5 text-[11px] font-medium">
                보유 대비 {((buyPrice || defaultBuy) / (sellPrice || defaultSell)).toFixed(2)}배
              </p>
            ) : null}
          </Field>

          <Field label="매도 예상가">
            <MoneyInput value={sellPrice || defaultSell} onChange={setSellPrice} />
          </Field>
          <Field label="매수 예상가">
            <MoneyInput value={buyPrice || defaultBuy} onChange={setBuyPrice} />
          </Field>
          <Field label="동원 가능 현금">
            <MoneyInput value={cashOnHand} onChange={setCashOnHand} />
          </Field>
          <Field label="신규 대출 예정액">
            <MoneyInput value={newLoan} onChange={setNewLoan} />
          </Field>
          <Field label="신규 대출 금리 (%)">
            <Input
              type="number"
              step="0.01"
              value={newLoanRate}
              className="tabular"
              onChange={(e) => setNewLoanRate(Number(e.target.value))}
            />
          </Field>
        </div>
      </SectionCard>

      {/* 기준선 요약 */}
      {baseline ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Stat
            label="현재 시세 갭"
            value={formatKrw(baseline.priceGap, { compact: true })}
            sub={`보유 대비 ${(baseline.buyPrice / baseline.sellPrice).toFixed(2)}배`}
            tone="rise"
          />
          {/* 모바일에는 호버가 없어 클릭(탭)으로 여는 팝오버를 쓴다 */}
          <Popover>
            <PopoverTrigger render={<div className="cursor-pointer" />}>
              <Stat
                label="총 마찰비용 ⓘ"
                value={formatKrw(baseline.totalFriction, { compact: true })}
                sub={`매수가의 ${formatPct(baseline.frictionRate, 2)} · 눌러서 상세`}
                tone="fall"
              />
            </PopoverTrigger>
            <PopoverContent className="w-auto p-3 text-xs">
              <FrictionDetail r={baseline} />
            </PopoverContent>
          </Popover>
          <Stat
            label="매도 후 순현금"
            value={formatKrw(baseline.netFromSale, { compact: true })}
            sub="양도세·중개비·대출상환 반영"
          />
          <Stat
            label="자금 과부족"
            value={formatKrw(baseline.fundingGap, { compact: true })}
            sub={baseline.fundingGap >= 0 ? '여유' : '부족'}
            tone={baseline.fundingGap >= 0 ? 'rise' : 'fall'}
          />
          <Stat
            label="연 이자 증감"
            value={formatKrw(baseline.annualInterestDelta, { compact: true })}
            sub={`월 ${formatKrw(baseline.annualInterestDelta / 12, { compact: true })}`}
            tone={baseline.annualInterestDelta > 0 ? 'fall' : 'rise'}
          />
        </div>
      ) : null}

      {/* 보유 2년 미만일 때만 — 2년 채우고 팔면 얼마나 달라지는가 */}
      {baseline && twoYear
        ? (() => {
            const r2 = twoYear.result;
            const saving = baseline.capitalGainsTax.total - r2.capitalGainsTax.total;
            const need2 = Math.max(0, r2.totalNeeded - r2.netFromSale);
            const byLoan2 = loanLimit ? Math.min(loanLimit.result.limit, need2) : 0;
            return (
              <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-4">
                <div className="mb-2 text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                  🕐 2년 보유 도달({twoYear.date}) 후 매도 시 — 매도·매수가 동일 가정
                </div>
                <div className="grid gap-3 text-sm sm:grid-cols-4">
                  <div>
                    <div className="text-muted-foreground text-xs">양도세</div>
                    <div className="tabular font-semibold">
                      {r2.capitalGainsTax.exempt || r2.capitalGainsTax.total === 0
                        ? '비과세'
                        : formatKrw(r2.capitalGainsTax.total, { compact: true })}
                    </div>
                    <div className="text-xs text-emerald-700 dark:text-emerald-400">
                      지금보다 −{formatKrw(saving, { compact: true })}
                    </div>
                  </div>
                  <div>
                    <div className="text-muted-foreground text-xs">총 마찰비용</div>
                    <div className="tabular font-semibold">
                      {formatKrw(r2.totalFriction, { compact: true })}
                    </div>
                    <div className="text-muted-foreground text-xs">
                      현재 {formatKrw(baseline.totalFriction, { compact: true })}
                    </div>
                  </div>
                  <div>
                    <div className="text-muted-foreground text-xs">실소요 자금</div>
                    <div className="tabular font-semibold">
                      {formatKrw(need2, { compact: true })}
                    </div>
                    <div className="text-muted-foreground text-xs">
                      현재{' '}
                      {formatKrw(Math.max(0, baseline.totalNeeded - baseline.netFromSale), {
                        compact: true,
                      })}
                    </div>
                  </div>
                  <div>
                    <div className="text-muted-foreground text-xs">내 돈 (한도 대출 시)</div>
                    <div className="tabular font-semibold">
                      {formatKrw(Math.max(0, need2 - byLoan2), { compact: true })}
                    </div>
                    <div className="text-muted-foreground text-xs">
                      대출 {formatKrw(byLoan2, { compact: true })}
                    </div>
                  </div>
                </div>
                <p className="text-muted-foreground mt-2 text-[11px] leading-relaxed">
                  1세대1주택 비과세(12억 초과분만 과세)·장기보유특별공제가 적용된 값입니다. 그 사이
                  시세가 움직이면 결과가 달라지므로 위의 시나리오 표와 함께 보세요.
                </p>
              </div>
            );
          })()
        : null}

      {/* 대출 한도 · 규제 */}
      {loanLimit ? (
        <SectionCard
          title="목표 주택 대출 가능액 · 규제 현황"
          description={`LTV·DSR·정책 총액 한도 중 가장 작은 값이 실제 한도입니다. 기존 주택 처분을 전제로 계산했습니다. (규제 지정: ${REGULATION_AS_OF})`}
          badge={
            <div className="flex gap-1">
              {loanLimit.reg.badges.map((b) => (
                <Badge key={b} variant={b === '비규제지역' ? 'secondary' : 'destructive'}>
                  {b}
                </Badge>
              ))}
            </div>
          }
        >
          {baseline
            ? (() => {
                /* 실소요를 "대출로 충당"과 "현금으로 준비"로 나눈다.
                 사용자가 가장 궁금한 질문은 결국 "그래서 현금이 얼마 필요한가"다. */
                const need = Math.max(0, baseline.totalNeeded - baseline.netFromSale);
                const byLoan = Math.min(loanLimit.result.limit, need);
                const byCash = Math.max(0, need - byLoan);
                const cashGap = config.household.cashAssets - byCash;
                return (
                  <div className="mb-4 grid gap-3 sm:grid-cols-3">
                    <Stat
                      label="세후 실소요 자금"
                      value={formatKrw(need, { compact: true })}
                      sub="매도 순현금 반영 후 더 필요한 금액"
                    />
                    <Stat
                      label="대출로 충당 가능"
                      value={formatKrw(byLoan, { compact: true })}
                      sub={`한도 ${formatKrw(loanLimit.result.limit, { compact: true })} (${loanLimit.result.bindingFactor})`}
                    />
                    <Stat
                      label="내 돈으로 준비 (모아둔 현금)"
                      value={formatKrw(byCash, { compact: true })}
                      sub={
                        config.household.cashAssets > 0
                          ? cashGap >= 0
                            ? `보유 현금 대비 여유 ${formatKrw(cashGap, { compact: true })}`
                            : `보유 현금 대비 부족 ${formatKrw(-cashGap, { compact: true })}`
                          : '설정 > 자금·소득에 현금자산을 입력하세요'
                      }
                      tone={
                        config.household.cashAssets > 0
                          ? cashGap >= 0
                            ? 'rise'
                            : 'fall'
                          : undefined
                      }
                    />
                  </div>
                );
              })()
            : null}

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Stat
                  label={`대출 가능액 (${loanLimit.result.bindingFactor} 기준)`}
                  value={formatKrw(loanLimit.result.limit, { compact: true })}
                  sub={`LTV ${loanLimit.result.ltvRate}% · 월 ${formatKrw(loanLimit.result.monthlyPayment, { compact: true })}`}
                />
                <Stat
                  label="입력한 신규 대출액"
                  value={formatKrw(newLoan, { compact: true })}
                  sub={
                    newLoan > loanLimit.result.limit
                      ? `한도 초과 ${formatKrw(newLoan - loanLimit.result.limit, { compact: true })}`
                      : `한도 여유 ${formatKrw(loanLimit.result.limit - newLoan, { compact: true })}`
                  }
                  tone={newLoan > loanLimit.result.limit ? 'fall' : 'rise'}
                />
              </div>

              <table className="mt-3 w-full text-sm">
                <tbody>
                  <tr className="border-b border-dashed">
                    <td className="text-muted-foreground py-1">
                      LTV {loanLimit.result.ltvRate}% 한도
                    </td>
                    <td className="tabular py-1 text-right">
                      {formatKrw(loanLimit.result.ltvLimit)}
                    </td>
                  </tr>
                  <tr className="border-b border-dashed">
                    <td className="text-muted-foreground py-1">DSR 40% 한도</td>
                    <td className="tabular py-1 text-right">
                      {loanLimit.result.dsrLimit !== null
                        ? formatKrw(loanLimit.result.dsrLimit)
                        : '연소득 미입력'}
                    </td>
                  </tr>
                  <tr>
                    <td className="text-muted-foreground py-1">정책 총액 한도</td>
                    <td className="tabular py-1 text-right">
                      {loanLimit.result.policyCap !== null
                        ? formatKrw(loanLimit.result.policyCap)
                        : '해당 없음'}
                    </td>
                  </tr>
                </tbody>
              </table>

              {newLoan > loanLimit.result.limit ? (
                <div className="mt-2 flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setNewLoan(loanLimit.result.limit)}
                  >
                    한도에 맞춰 조정
                  </Button>
                </div>
              ) : null}
            </div>

            <div className="space-y-2">
              <h4 className="text-xs font-semibold">규제 효과</h4>
              <ul className="space-y-1.5">
                {loanLimit.reg.effects.map((e, i) => (
                  <li key={i} className="text-muted-foreground text-[11px] leading-relaxed">
                    • {e}
                  </li>
                ))}
              </ul>
              <ul className="space-y-1 border-t pt-2">
                {loanLimit.result.notes.map((n, i) => (
                  <li key={i} className="text-muted-foreground text-[11px] leading-relaxed">
                    • {n}
                  </li>
                ))}
              </ul>
              {config.household.annualIncome === 0 ? (
                <p className="text-[11px] text-amber-600 dark:text-amber-400">
                  설정에서 세전 연 소득을 입력하면 DSR 한도까지 함께 계산합니다.
                </p>
              ) : null}
            </div>
          </div>
        </SectionCard>
      ) : null}

      {/* 손익분기 */}
      {breakEven && Number.isFinite(breakEven.requiredTargetDrop) ? (
        <Alert>
          <AlertTitle>
            손익분기: 목표 아파트가 약 {breakEven.requiredTargetDrop.toFixed(1)}% 더 빠지면
            마찰비용을 상쇄
          </AlertTitle>
          <AlertDescription>
            보유 아파트가 목표 아파트 낙폭의 절반만 하락한다고 가정할 때, 목표 아파트가{' '}
            <strong>{breakEven.requiredTargetDrop.toFixed(1)}%</strong> 하락하면 갭 축소분(
            {formatKrw(breakEven.gapReductionPerPercent)}/1%p)이 총 마찰비용(
            {formatKrw(breakEven.friction)})과 같아집니다. 그 이상 하락하면 기다린 만큼 이득입니다.
            <br />
            단, 하락장에는 <strong>내 집이 안 팔리는 위험</strong>이 함께 커집니다. 거래량 지표와
            함께 보세요.
          </AlertDescription>
        </Alert>
      ) : null}

      {/* 시나리오 매도 시점 전환 — 2년 미만 보유자만 */}
      {twoYear ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground text-xs">아래 시나리오의 매도 시점:</span>
          <Button
            size="sm"
            variant={sellTiming === 'now' ? 'default' : 'outline'}
            onClick={() => setSellTiming('now')}
          >
            지금 매도 (단기세율 60%)
          </Button>
          <Button
            size="sm"
            variant={sellTiming === 'twoYear' ? 'default' : 'outline'}
            onClick={() => setSellTiming('twoYear')}
          >
            2년 도달 후 매도 ({twoYear.date} · 비과세)
          </Button>
        </div>
      ) : null}

      {/* 시나리오 차트 */}
      <SectionCard
        title="시나리오별 갭 · 실소요 자금"
        description="막대는 억원 단위입니다. 회색은 시세 갭, 색상은 세금·비용 포함 실제로 더 필요한 현금입니다."
        badge={timingBadge}
      >
        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis
                dataKey="name"
                tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }}
                tickLine={false}
                axisLine={false}
                interval={0}
              />
              <YAxis
                tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }}
                tickLine={false}
                axisLine={false}
                width={44}
                tickFormatter={(v: number) => `${v}억`}
              />
              <Tooltip
                cursor={{ fill: 'var(--muted)', opacity: 0.4 }}
                contentStyle={{
                  background: 'var(--popover)',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  fontSize: 12,
                  color: 'var(--popover-foreground)',
                }}
                formatter={(v, name) => [
                  `${Number(v)}억`,
                  name === 'gap' ? '시세 갭' : '실소요 자금',
                ]}
              />
              <ReferenceLine y={0} stroke="var(--border)" />
              <Bar
                dataKey="gap"
                fill="var(--muted-foreground)"
                opacity={0.35}
                radius={[3, 3, 0, 0]}
              />
              <Bar dataKey="cash" radius={[3, 3, 0, 0]}>
                {chartData.map((d, i) => (
                  // 여기 색은 가격 방향이 아니라 "갈아타기에 유리한가" 판정을 뜻하므로
                  // 국내 관행의 상승=적색 대신 초록/빨강 신호등 색을 쓴다
                  <Cell key={i} fill={VERDICT_COLOR[d.verdict]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </SectionCard>

      {/* 상세 테이블 */}
      <SectionCard
        title="시나리오 상세"
        description="양도세는 보유 아파트 매도 시, 취득세는 목표 아파트 매수 시 기준입니다. 실소요 자금 아래의 대출은 해당 시나리오 매수가 기준 한도(LTV·DSR·정책 총액 중 최소) 안에서 충당 가능한 금액, 내 돈은 그 나머지입니다."
        badge={timingBadge}
      >
        <div className="thin-scrollbar overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-40">시나리오</TableHead>
                <TableHead className="text-right">매도가</TableHead>
                <TableHead className="text-right">매수가</TableHead>
                <TableHead className="text-right">갭 · 배율</TableHead>
                <TableHead className="text-right">양도세</TableHead>
                <TableHead className="text-right">취득세</TableHead>
                <TableHead className="text-right">마찰비용 계</TableHead>
                <TableHead className="text-right">실소요 자금</TableHead>
                <TableHead className="text-right">기준 대비</TableHead>
                <TableHead className="text-center">판정</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {matrix.map((m) => {
                const cash = m.result.totalNeeded - m.result.netFromSale;
                /* 시나리오별 대출 한도 — LTV 가 매수가에 비례하므로 시나리오마다 다시 계산.
                   DSR·정책 총액 한도는 가격과 무관해 기준선과 같은 조건을 쓴다. */
                const scenarioLimit = loanLimit
                  ? calcLoanLimit({
                      price: m.result.buyPrice,
                      regulated: config.household.targetIsRegulated || loanLimit.reg.adjusted,
                      metro: loanLimit.reg.metro,
                      retainedHouseCount: 0,
                      firstTimeBuyer: config.household.firstTimeBuyer,
                      annualIncome: config.household.annualIncome,
                      otherDebtAnnualPayment: config.household.otherDebtAnnualPayment,
                      rate: newLoanRate,
                    }).limit
                  : 0;
                const byLoan = Math.min(scenarioLimit, Math.max(0, cash));
                const byCash = Math.max(0, cash - byLoan);
                return (
                  <TableRow key={m.scenario.label}>
                    <TableCell>
                      <div className="font-medium">{m.scenario.label}</div>
                      <div className="text-muted-foreground text-[11px]">
                        {m.scenario.description}
                      </div>
                    </TableCell>
                    <TableCell className="tabular text-right">
                      {formatEok(m.result.sellPrice)}
                    </TableCell>
                    <TableCell className="tabular text-right">
                      {formatEok(m.result.buyPrice)}
                    </TableCell>
                    <TableCell className="tabular text-right">
                      {formatEok(m.result.priceGap)}
                      {/* 시나리오마다 배율이 어떻게 줄고 느는지가 갈아타기 판단의 핵심이다 */}
                      <div className="text-muted-foreground text-[10px]">
                        {m.result.sellPrice > 0
                          ? `${(m.result.buyPrice / m.result.sellPrice).toFixed(2)}배`
                          : '-'}
                      </div>
                    </TableCell>
                    <TableCell className="tabular text-fall text-right">
                      {m.result.capitalGainsTax.exempt
                        ? '비과세'
                        : formatKrw(m.result.capitalGainsTax.total, { compact: true })}
                    </TableCell>
                    <TableCell className="tabular text-fall text-right">
                      {formatKrw(m.result.acquisitionTax.total, { compact: true })}
                    </TableCell>
                    <TableCell className="tabular text-fall text-right">
                      <Popover>
                        <PopoverTrigger
                          render={
                            <span className="cursor-pointer underline decoration-dotted underline-offset-2" />
                          }
                        >
                          {formatKrw(m.result.totalFriction, { compact: true })}
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-3 text-xs">
                          <FrictionDetail r={m.result} />
                        </PopoverContent>
                      </Popover>
                    </TableCell>
                    <TableCell className="tabular text-right font-semibold">
                      <div>{formatKrw(cash, { compact: true })}</div>
                      <div className="text-muted-foreground text-[11px] font-normal">
                        대출 {formatKrw(byLoan, { compact: true })} · 내 돈{' '}
                        {formatKrw(byCash, { compact: true })}
                      </div>
                    </TableCell>
                    <TableCell
                      className={cn(
                        'tabular text-right',
                        m.cashDelta < 0 ? 'text-rise' : 'text-fall',
                      )}
                    >
                      {m.cashDelta === 0 ? '-' : formatKrw(m.cashDelta, { compact: true })}
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge
                        className={cn('font-normal', VERDICT_CLASS[m.verdict])}
                        variant="secondary"
                      >
                        {m.verdict}
                      </Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

        <p className="text-muted-foreground mt-3 text-[11px] leading-relaxed">
          <strong className="text-foreground">실소요 자금 산식</strong> — 매수 총 소요(매수가 +
          취득세 + 매수비용) − 매도 후 순현금(매도가 − 양도세 − 중개보수 −{' '}
          <strong className="text-foreground">기존 대출 상환 − 보증금 반환</strong>). 갭 +
          마찰비용보다 큰 이유는 기존 대출·보증금 상환분이 더해지기 때문입니다. 그만큼은 신규 대출로
          다시 조달할 수 있어 위의 대출/현금 분해로 나눠 보여줍니다.
        </p>
        <p className="text-muted-foreground mt-2 text-[11px] leading-relaxed">
          시나리오 하락률은 2022~2023년 실제 조정기 패턴(상급지 낙폭이 하급지보다 큼)을 참고한
          가정치입니다. 지역별 실제 낙폭은 대시보드의 확산 지도에서 2023년초 대비 변동률로
          확인하세요.
        </p>
      </SectionCard>

      {/* 기준선 상세 내역 */}
      {baseline ? (
        <SectionCard title="기준 시나리오 상세 내역" description="현재 시세 그대로 갈아탈 경우">
          <div className="grid gap-6 lg:grid-cols-2">
            <div>
              <h4 className="mb-2 text-sm font-semibold">매도 — {holding.complexName}</h4>
              <dl className="space-y-1 text-sm">
                <Row label="매도가" value={formatKrw(baseline.sellPrice)} />
                <Row label="양도차익" value={formatKrw(baseline.capitalGainsTax.grossGain)} />
                <Row
                  label={`장기보유특별공제 (${baseline.capitalGainsTax.longTermRate}%)`}
                  value={`-${formatKrw(baseline.capitalGainsTax.longTermDeduction)}`}
                />
                <Row
                  label={`양도소득세 (${baseline.capitalGainsTax.rate}%)`}
                  value={`-${formatKrw(baseline.capitalGainsTax.incomeTax)}`}
                />
                <Row
                  label="지방소득세"
                  value={`-${formatKrw(baseline.capitalGainsTax.localTax)}`}
                />
                <Row label="중개보수" value={`-${formatKrw(baseline.sellCost.brokerFee)}`} />
                <Row label="대출 상환" value={`-${formatKrw(holding.loanBalance)}`} />
                <Row label="보증금 반환" value={`-${formatKrw(holding.leaseDeposit)}`} />
                <Row label="매도 후 순현금" value={formatKrw(baseline.netFromSale)} strong />
              </dl>
              <ul className="mt-2 space-y-0.5">
                {baseline.capitalGainsTax.notes.map((n, i) => (
                  <li key={i} className="text-muted-foreground text-[11px]">
                    • {n}
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h4 className="mb-2 text-sm font-semibold">매수 — {target.complexName}</h4>
              <dl className="space-y-1 text-sm">
                <Row label="매수가" value={formatKrw(baseline.buyPrice)} />
                <Row
                  label={`취득세 (${baseline.acquisitionTax.rate}%)`}
                  value={formatKrw(baseline.acquisitionTax.acquisitionTax)}
                />
                <Row
                  label="지방교육세"
                  value={formatKrw(baseline.acquisitionTax.localEducationTax)}
                />
                <Row label="농어촌특별세" value={formatKrw(baseline.acquisitionTax.ruralTax)} />
                <Row label="중개보수" value={formatKrw(baseline.buyCost.brokerFee)} />
                <Row label="법무사·등기" value={formatKrw(baseline.buyCost.registrationFee)} />
                <Row label="인지세" value={formatKrw(baseline.buyCost.stampTax)} />
                <Row label="국민주택채권 할인" value={formatKrw(baseline.buyCost.bondDiscount)} />
                <Row label="근저당 설정 등" value={formatKrw(baseline.buyCost.movingEtc)} />
                <Row label="매수 총 소요" value={formatKrw(baseline.totalNeeded)} strong />
              </dl>
              <ul className="mt-2 space-y-0.5">
                {baseline.acquisitionTax.notes.map((n, i) => (
                  <li key={i} className="text-muted-foreground text-[11px]">
                    • {n}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </SectionCard>
      ) : null}

      <div className="text-muted-foreground rounded-lg border border-dashed p-4 text-xs leading-relaxed">
        <strong className="text-foreground">시나리오 가정</strong>
        <ul className="mt-1 space-y-0.5">
          {DOWNTURN_SCENARIOS.map((s) => (
            <li key={s.label}>
              · {s.label}: 보유 {formatPct(s.holdingDrop, 0)} / 목표 {formatPct(s.targetDrop, 0)}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** 마찰비용 구성 상세 — 마우스 올리면 보이는 툴팁 내용 */
function FrictionDetail({ r }: { r: ReturnType<typeof simulateSwitch> }) {
  const rows: Array<[string, number]> = [
    ['양도세 (지방소득세 포함)', r.capitalGainsTax.total],
    ['매도 중개보수', r.sellCost.total],
    ['취득세·지방교육세·농특세', r.acquisitionTax.total],
    ['매수 부대비용 (중개·등기·인지·채권)', r.buyCost.total],
  ];
  return (
    <div className="min-w-56 space-y-0.5">
      {rows.map(([label, v]) => (
        <div key={label} className="flex justify-between gap-4">
          <span>{label}</span>
          <span className="tabular">{formatKrw(v, { compact: true })}</span>
        </div>
      ))}
      <div className="mt-1 flex justify-between gap-4 border-t pt-1 font-semibold">
        <span>총 마찰비용</span>
        <span className="tabular">{formatKrw(r.totalFriction, { compact: true })}</span>
      </div>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div
      className={cn(
        'flex justify-between border-b border-dashed py-0.5 last:border-0',
        strong && 'border-t-2 border-solid pt-1.5 font-semibold',
      )}
    >
      <dt className={strong ? '' : 'text-muted-foreground'}>{label}</dt>
      <dd className="tabular">{value}</dd>
    </div>
  );
}
