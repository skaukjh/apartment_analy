'use client';

import { tradePriceOf } from '@/lib/analysis/price-basis';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Info, Wallet } from 'lucide-react';
import type { PriceQuote, UserConfig } from '@/lib/types';
import { calcAcquisitionTax } from '@/lib/tax/acquisition';
import { calcTransactionCost } from '@/lib/tax/transaction-costs';
import { calcLoanLimit } from '@/lib/tax/loan-limit';
import { isRegulated } from '@/lib/analysis/auto-fill';
import { formatArea, formatKrw, formatPct } from '@/lib/format';
import { EmptyHint, SectionCard, Stat } from '@/components/ui-bits';
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
import { cn } from '@/lib/utils';

/** 수도권(주담대 총액 한도 대상) 여부 — 서울·경기·인천 */
function isMetroRegion(lawdCd: string): boolean {
  return /^(11|41|28)/.test(lawdCd);
}

/** 포장이사 평균 비용 (원) — 수도권 4인 가구 기준 개략치 */
const DEFAULT_MOVING_COST = 2_000_000;

interface Props {
  config: UserConfig;
  quotes: Record<string, PriceQuote>;
}

/**
 * 무주택(자산만 보유) 신규 매수 계산기.
 * 보유 현금·연소득을 넣으면 규제/비규제에 따른 대출 가능액과
 * 취득세·중개보수·법무비·이사비까지 포함한 "목표 집까지 필요한 현금"을 보여준다.
 */
export function FirstPurchasePanel({ config, quotes }: Props) {
  // 드롭다운은 가격 낮은 순 — 시세 없는(0원) 항목은 뒤로
  const targets = [...config.targets].sort((a, b) => {
    const pa = tradePriceOf(quotes[a.id]) || Number.MAX_SAFE_INTEGER;
    const pb = tradePriceOf(quotes[b.id]) || Number.MAX_SAFE_INTEGER;
    return pa - pb;
  });
  const [targetId, setTargetId] = useState(targets[0]?.id ?? '');
  const target = targets.find((t) => t.id === targetId) ?? targets[0];

  const quotePrice = target ? tradePriceOf(quotes[target.id]) : 0;

  const [buyPrice, setBuyPrice] = useState(0);
  const [cash, setCash] = useState(config.household.cashAssets);
  const [income, setIncome] = useState(config.household.annualIncome);
  const [otherDebt, setOtherDebt] = useState(config.household.otherDebtAnnualPayment);
  const [rate, setRate] = useState(4.2);
  const [movingEtc, setMovingEtc] = useState(DEFAULT_MOVING_COST);

  const price = buyPrice || quotePrice;
  const firstTime = config.household.firstTimeBuyer;

  const result = useMemo(() => {
    if (!target || price <= 0) return null;
    const regulated = config.household.targetIsRegulated || isRegulated(target.lawdCd);
    const metro = isMetroRegion(target.lawdCd);

    const loan = calcLoanLimit({
      price,
      regulated,
      metro,
      retainedHouseCount: 0,
      firstTimeBuyer: firstTime,
      annualIncome: income,
      otherDebtAnnualPayment: otherDebt,
      rate,
    });
    const acq = calcAcquisitionTax({
      price,
      areaM2: target.areaM2,
      houseCountAfter: 1,
      isRegulated: regulated,
      temporaryTwoHouse: false,
      firstTimeBuyer: firstTime,
    });
    const cost = calcTransactionCost({
      price,
      side: 'buy',
      withMortgage: loan.limit > 0,
      movingEtc,
    });

    const totalNeeded = price + acq.total + cost.total;
    const neededCash = totalNeeded - loan.limit;
    return { regulated, metro, loan, acq, cost, totalNeeded, neededCash, gap: cash - neededCash };
  }, [
    target,
    price,
    config.household.targetIsRegulated,
    firstTime,
    income,
    otherDebt,
    rate,
    movingEtc,
    cash,
  ]);

  /** 등록된 모든 목표를 같은 조건으로 비교 */
  const comparison = useMemo(() => {
    return targets
      .map((t) => {
        const p = tradePriceOf(quotes[t.id]);
        if (p <= 0) return null;
        const regulated = config.household.targetIsRegulated || isRegulated(t.lawdCd);
        const loan = calcLoanLimit({
          price: p,
          regulated,
          metro: isMetroRegion(t.lawdCd),
          retainedHouseCount: 0,
          firstTimeBuyer: firstTime,
          annualIncome: income,
          otherDebtAnnualPayment: otherDebt,
          rate,
        });
        const acq = calcAcquisitionTax({
          price: p,
          areaM2: t.areaM2,
          houseCountAfter: 1,
          isRegulated: regulated,
          temporaryTwoHouse: false,
          firstTimeBuyer: firstTime,
        });
        const cost = calcTransactionCost({
          price: p,
          side: 'buy',
          withMortgage: loan.limit > 0,
          movingEtc,
        });
        const neededCash = p + acq.total + cost.total - loan.limit;
        return { t, price: p, regulated, loan, neededCash, shortfall: neededCash - cash };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null)
      .sort((a, b) => a.neededCash - b.neededCash);
  }, [
    targets,
    quotes,
    config.household.targetIsRegulated,
    firstTime,
    income,
    otherDebt,
    rate,
    movingEtc,
    cash,
  ]);

  if (!target) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-10">
        <EmptyHint>
          <p className="mb-3">목표 아파트를 먼저 등록해야 계산할 수 있습니다.</p>
          <Button render={<Link href="/settings" />} nativeButton={false} size="sm">
            설정으로 이동
          </Button>
        </EmptyHint>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1400px] space-y-6 px-4 py-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <Wallet className="size-6" /> 신규 매수 자금 계산
        </h1>
        <p className="text-muted-foreground text-sm">
          보유 아파트가 없어 무주택 매수 기준으로 계산합니다. 보유 현금과 연소득을 넣으면
          규제/비규제에 따른 대출 가능액과 취득세·중개보수·법무비·이사비를 포함해 목표 집까지 필요한
          현금이 나옵니다.
        </p>
      </div>

      {/* 입력 */}
      <SectionCard title="조건 입력" description="값을 바꾸면 아래 결과가 즉시 갱신됩니다.">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Field label="목표 아파트">
            <Select
              value={target.id}
              onValueChange={(raw) => {
                setTargetId(String(raw ?? ''));
                setBuyPrice(0);
              }}
            >
              <SelectTrigger>
                {/* 함수 자식은 항목 등록 전 id 를 노출하므로 선택된 라벨을 직접 렌더링한다 */}
                <SelectValue>
                  {target.complexName} {formatArea(target.areaM2)}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {targets.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.complexName} {formatArea(t.areaM2)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="매수 예상가" hint="비우면 최근 실거래/호가를 사용합니다">
            <MoneyInput value={price} onChange={setBuyPrice} />
          </Field>
          <Field label="총 보유 현금·금융자산">
            <MoneyInput value={cash} onChange={setCash} />
          </Field>
          <Field label="세전 연 소득" hint="0이면 DSR 없이 LTV 한도만 적용">
            <MoneyInput value={income} onChange={setIncome} />
          </Field>
          <Field label="기존 대출 연 상환액" hint="신용대출·전세대출 등의 연간 원리금">
            <MoneyInput value={otherDebt} onChange={setOtherDebt} />
          </Field>
          <Field label="대출 금리 (%)">
            <Input
              type="number"
              step="0.01"
              value={rate}
              className="tabular"
              onChange={(e) => setRate(Number(e.target.value))}
            />
          </Field>
          <Field label="이사·기타 비용" hint="포장이사 평균 약 200만원">
            <MoneyInput value={movingEtc} onChange={setMovingEtc} />
          </Field>
        </div>
      </SectionCard>

      {result ? (
        <>
          {/* 요약 */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Stat
              label="총 필요 자금 (세금·비용 포함)"
              value={formatKrw(result.totalNeeded, { compact: true })}
              sub={`매수가 + 취득세 ${formatKrw(result.acq.total, { compact: true })} + 부대비 ${formatKrw(result.cost.total, { compact: true })}`}
            />
            <Stat
              label={`대출 가능액 (${result.loan.bindingFactor} 기준)`}
              value={formatKrw(result.loan.limit, { compact: true })}
              sub={`월 상환 ${formatKrw(result.loan.monthlyPayment, { compact: true })} · LTV ${result.loan.ltvRate}%`}
            />
            <Stat
              label="대출 제외 필요 현금"
              value={formatKrw(result.neededCash, { compact: true })}
              sub="총 필요 자금 − 대출 가능액"
            />
            <Stat
              label="내 현금"
              value={formatKrw(cash, { compact: true })}
              sub={result.regulated ? '목표: 조정대상지역' : '목표: 비규제지역'}
            />
            <Stat
              label={result.gap >= 0 ? '여유 자금' : '부족 자금'}
              value={formatKrw(Math.abs(result.gap), { compact: true })}
              sub={result.gap >= 0 ? '현재 현금으로 가능' : '더 모으거나 목표 조정 필요'}
              tone={result.gap >= 0 ? 'rise' : 'fall'}
            />
          </div>

          {/* 상세 */}
          <div className="grid gap-6 lg:grid-cols-2">
            <SectionCard
              title="비용 상세"
              description={`${target.complexName} ${formatArea(target.areaM2)} 기준`}
            >
              <table className="w-full text-sm">
                <tbody>
                  {(
                    [
                      ['매수가', price],
                      [`취득세 (${result.acq.rate}%)`, result.acq.acquisitionTax],
                      ['지방교육세', result.acq.localEducationTax],
                      ['농어촌특별세', result.acq.ruralTax],
                      ['중개보수 (VAT 포함)', result.cost.brokerFee],
                      ['법무사·등기', result.cost.registrationFee],
                      ['인지세', result.cost.stampTax],
                      ['국민주택채권 할인', result.cost.bondDiscount],
                      ['이사·근저당 등', result.cost.movingEtc],
                    ] as Array<[string, number]>
                  ).map(([label, v]) => (
                    <tr key={label} className="border-b border-dashed last:border-0">
                      <td className="text-muted-foreground py-1">{label}</td>
                      <td className="tabular py-1 text-right">{v === 0 ? '-' : formatKrw(v)}</td>
                    </tr>
                  ))}
                  <tr className="border-t-2">
                    <td className="py-1.5 font-semibold">총 필요 자금</td>
                    <td className="tabular py-1.5 text-right font-bold">
                      {formatKrw(result.totalNeeded)}
                    </td>
                  </tr>
                </tbody>
              </table>
              <ul className="mt-2 space-y-1">
                {result.acq.notes.slice(0, 2).map((n, i) => (
                  <li key={i} className="text-muted-foreground flex gap-1.5 text-[11px]">
                    <Info className="mt-0.5 size-3 shrink-0" />
                    {n}
                  </li>
                ))}
              </ul>
            </SectionCard>

            <SectionCard
              title="대출 한도 상세"
              description="LTV·DSR·정책 총액 한도 중 가장 작은 값이 실제 한도입니다."
            >
              <table className="w-full text-sm">
                <tbody>
                  <tr className="border-b border-dashed">
                    <td className="text-muted-foreground py-1">LTV {result.loan.ltvRate}% 한도</td>
                    <td className="tabular py-1 text-right">{formatKrw(result.loan.ltvLimit)}</td>
                  </tr>
                  <tr className="border-b border-dashed">
                    <td className="text-muted-foreground py-1">DSR 40% 한도</td>
                    <td className="tabular py-1 text-right">
                      {result.loan.dsrLimit !== null
                        ? formatKrw(result.loan.dsrLimit)
                        : '소득 미입력'}
                    </td>
                  </tr>
                  <tr className="border-b border-dashed">
                    <td className="text-muted-foreground py-1">정책 총액 한도</td>
                    <td className="tabular py-1 text-right">
                      {result.loan.policyCap !== null
                        ? formatKrw(result.loan.policyCap)
                        : '해당 없음'}
                    </td>
                  </tr>
                  <tr className="border-t-2">
                    <td className="py-1.5 font-semibold">
                      최종 대출 가능액{' '}
                      <Badge variant="secondary" className="ml-1 text-[10px]">
                        {result.loan.bindingFactor}
                      </Badge>
                    </td>
                    <td className="tabular py-1.5 text-right font-bold">
                      {formatKrw(result.loan.limit)}
                    </td>
                  </tr>
                  <tr>
                    <td className="text-muted-foreground py-1">월 원리금 (40년 원리금균등)</td>
                    <td className="tabular py-1 text-right">
                      {formatKrw(result.loan.monthlyPayment)}
                    </td>
                  </tr>
                </tbody>
              </table>
              <ul className="mt-2 space-y-1">
                {result.loan.notes.map((n, i) => (
                  <li
                    key={i}
                    className="text-muted-foreground flex gap-1.5 text-[11px] leading-relaxed"
                  >
                    <Info className="mt-0.5 size-3 shrink-0" />
                    {n}
                  </li>
                ))}
              </ul>
            </SectionCard>
          </div>

          {/* 목표 비교 */}
          {comparison.length > 1 ? (
            <SectionCard
              title="등록한 목표 전체 비교"
              description="같은 현금·소득 조건에서 각 목표까지 필요한 현금입니다."
            >
              <div className="thin-scrollbar overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>목표</TableHead>
                      <TableHead className="text-right">예상가</TableHead>
                      <TableHead className="text-center">규제</TableHead>
                      <TableHead className="text-right">대출 가능</TableHead>
                      <TableHead className="text-right">필요 현금</TableHead>
                      <TableHead className="text-right">내 현금 대비</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {comparison.map((r) => (
                      <TableRow key={r.t.id}>
                        <TableCell className="font-medium">
                          {r.t.complexName} {formatArea(r.t.areaM2)}
                        </TableCell>
                        <TableCell className="tabular text-right">
                          {formatKrw(r.price, { compact: true })}
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge
                            variant={r.regulated ? 'destructive' : 'secondary'}
                            className="text-[10px]"
                          >
                            {r.regulated ? '규제' : '비규제'}
                          </Badge>
                        </TableCell>
                        <TableCell className="tabular text-right">
                          {formatKrw(r.loan.limit, { compact: true })}
                        </TableCell>
                        <TableCell className="tabular text-right font-semibold">
                          {formatKrw(r.neededCash, { compact: true })}
                        </TableCell>
                        <TableCell
                          className={cn(
                            'tabular text-right font-medium',
                            r.shortfall <= 0 ? 'text-rise' : 'text-fall',
                          )}
                        >
                          {r.shortfall <= 0
                            ? `여유 ${formatKrw(-r.shortfall, { compact: true })}`
                            : `부족 ${formatKrw(r.shortfall, { compact: true })} (${formatPct((r.shortfall / Math.max(1, r.neededCash)) * 100, 0)})`}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </SectionCard>
          ) : null}
        </>
      ) : (
        <EmptyHint>
          목표 아파트의 시세를 알 수 없습니다. 설정에서 호가를 입력하거나 실거래 수집 후 다시
          확인하세요.
        </EmptyHint>
      )}

      <p className="text-muted-foreground text-center text-[11px]">
        대출 규제는 수시로 바뀝니다. 실제 한도는 은행 심사 기준이며, 실행 전 반드시 은행 상담으로
        확인하세요. 보유 아파트를 등록하면 갈아타기(양도세 포함) 시뮬레이션으로 전환됩니다.
      </p>
    </div>
  );
}
