'use client';

import { useMemo, useState } from 'react';
import { ArrowRight, ChevronDown, Info } from 'lucide-react';
import type { Holding, PriceQuote, TargetApartment, UserConfig } from '@/lib/types';
import {
  complexSpecLine,
  formatArea,
  formatKrw,
  formatPct,
  formatSignedKrw,
  todayKst,
} from '@/lib/format';
import {
  TARGET_FRESHNESS_MONTHS,
  askingPremiumPct,
  tradePriceOf,
} from '@/lib/analysis/price-basis';
import { activeTargets, staleQuoteWarning, targetDisabledReason } from '@/lib/analysis/target-pool';
import { calcAcquisitionTaxFor } from '@/lib/tax/acquisition';
import {
  LONG_TERM_MIN_YEARS,
  calcCapitalGainsTax,
  longTermMilestone,
  twoYearMilestone,
} from '@/lib/tax/capital-gains';
import { calcTransactionCost } from '@/lib/tax/transaction-costs';
import { calcLoanLimit } from '@/lib/tax/loan-limit';
import { regulationOf } from '@/lib/analysis/regulation';
import { SectionCard, EmptyHint, Delta, PeriodCompare } from '@/components/ui-bits';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import Link from 'next/link';

interface Props {
  config: UserConfig;
  quotes: Record<string, PriceQuote>;
}

function basisLabel(basis: PriceQuote['basis']): string {
  return {
    manual: '직접 입력 호가',
    'recent-trade': '직전 실거래가',
    'region-index': '지역 지수 추정',
    unknown: '실거래 없음',
  }[basis];
}

/**
 * 호가는 참고용으로만 보여준다.
 * 갭·세금 계산에는 쓰지 않는다 — 검증할 수 없는 값이라 계산에 넣으면
 * 근거 없는 숫자가 근거 있는 것처럼 보인다.
 */
function AskingHint({ quote }: { quote?: PriceQuote }) {
  const premium = askingPremiumPct(quote);
  if (premium === undefined) return null;
  return (
    <div className="text-muted-foreground text-[11px]">
      호가 {formatKrw(quote?.askingPrice ?? 0)} · 실거래 대비 {formatPct(premium, 1)}
    </div>
  );
}

/** 한 시점(매도일 가정)의 갈아타기 비용 묶음 — 지금/2년 도달/3년 도달을 같은 산식으로 만든다 */
interface Scenario {
  cgt: ReturnType<typeof calcCapitalGainsTax>;
  netFromSale: number;
  realCashNeeded: number;
  friction: number;
  /** 기존 대출·보증금 상환까지 포함해 실제로 조달해야 하는 총액 */
  grossNeed: number;
  grossByLoan: number;
  grossByCash: number;
}

interface Pair extends Scenario {
  key: string;
  holding: Holding;
  target: TargetApartment;
  holdingPrice: number;
  targetPrice: number;
  gap: number;
  ratio: number;
  acq: ReturnType<typeof calcAcquisitionTaxFor>;
  sellCost: ReturnType<typeof calcTransactionCost>;
  buyCost: ReturnType<typeof calcTransactionCost>;
  /** 목표 주택 기준 대출 한도 (기존 주택 처분 전제) */
  loanLimit: number;
  /** 1세대1주택 비과세 요건(2년 보유) 도달 가정 — 이미 채웠으면 null */
  twoYear: { date: string; monthsLeft: number; scenario: Scenario } | null;
  /** 장기보유특별공제 최소 요건(3년 보유) 도달 가정 — 이미 채웠으면 null */
  longTerm: {
    date: string;
    monthsLeft: number;
    rate: number;
    note: string;
    scenario: Scenario;
  } | null;
}

export function GapSection({ config, quotes }: Props) {
  const [openId, setOpenId] = useState<string | null>(null);
  /* 2년 보유(비과세)와 3년 보유(장기보유특별공제)는 서로 다른 요건이라 토글도 따로 둔다.
     둘 다 켜면 더 늦은 시점인 3년 도달이 기준이 된다 — 3년을 채우면 2년은 당연히 채운다. */
  const [applyTwoYear, setApplyTwoYear] = useState(false);
  const [applyLongTerm, setApplyLongTerm] = useState(false);

  /** 계산에서 빠진 목표와 그 이유 — 왜 목록에 없는지 화면에서 설명해야 한다 */
  const disabled = useMemo(
    () =>
      config.targets
        .map((t) => ({ target: t, reason: targetDisabledReason(t, quotes[t.id]) }))
        .filter((x): x is { target: TargetApartment; reason: string } => x.reason !== null),
    [config.targets, quotes],
  );

  const pairs = useMemo(() => {
    const out: Pair[] = [];
    const today = todayKst();

    for (const holding of config.holdings) {
      const holdingPrice = tradePriceOf(quotes[holding.id]);
      if (holdingPrice <= 0) continue;

      for (const target of activeTargets(config)) {
        const targetPrice = tradePriceOf(quotes[target.id]);
        if (targetPrice <= 0) continue;

        // 매도 중개보수는 양도세 필요경비 — 서버(buildGaps)와 같은 순서로 먼저 계산
        const sellCost = calcTransactionCost({ price: holdingPrice, side: 'sell' });
        const acq = calcAcquisitionTaxFor(targetPrice, target.areaM2, config.household, {
          replacesExisting: true,
        });
        const buyCost = calcTransactionCost({
          price: targetPrice,
          side: 'buy',
          withMortgage: true,
        });

        /* 목표 주택 기준 대출 한도 — 실소요를 "대출로 충당 / 현금으로 준비"로 나눠 보여준다.
           갈아타기는 기존 주택 처분 전제이므로 보유 주택 수 0으로 계산한다. */
        const reg = regulationOf(target.lawdCd);
        const loanLimit = calcLoanLimit({
          price: targetPrice,
          regulated: config.household.targetIsRegulated || reg.adjusted,
          metro: reg.metro,
          retainedHouseCount: 0,
          firstTimeBuyer: config.household.firstTimeBuyer,
          annualIncome: config.household.annualIncome,
          otherDebtAnnualPayment: config.household.otherDebtAnnualPayment,
          rate: holding.loanRate || 4,
        }).limit;

        /** 매도일 가정 하나로 카드 수치 한 벌을 만든다 (지금 / 2년 도달 / 3년 도달) */
        const scenarioAt = (soldAt: string): Scenario => {
          const cgt = calcCapitalGainsTax({
            salePrice: holdingPrice,
            acquisitionPrice: holding.acquisitionPrice,
            expenses: holding.acquisitionCost + holding.capitalExpenditure + sellCost.brokerFee,
            acquiredAt: holding.acquiredAt,
            soldAt,
            residenceMonths: holding.residenceMonths,
            isOneHouseExempt: config.household.ownedHouseCount <= 1,
            multiHouseSurcharge: false,
            isRegulated: config.household.holdingIsRegulated,
            usedBasicDeduction: 0,
          });
          const netFromSale = holdingPrice - cgt.total - sellCost.total;
          const realCashNeeded = targetPrice + acq.total + buyCost.total - netFromSale;
          const grossNeed = realCashNeeded + holding.loanBalance + holding.leaseDeposit;
          const grossByLoan = Math.min(loanLimit, Math.max(0, grossNeed));
          return {
            cgt,
            netFromSale,
            realCashNeeded,
            friction: cgt.total + acq.total + sellCost.total + buyCost.total,
            grossNeed,
            grossByLoan,
            grossByCash: Math.max(0, grossNeed - grossByLoan),
          };
        };

        /* 보유 2년 미만이면 "2년 채우고 팔면 얼마나 달라지는지"를 함께 계산한다.
           단기양도세 60%와 1세대1주택 비과세의 차이가 수억이라, 지금 파는 것과
           기다렸다 파는 것의 비교가 실질적인 의사결정 정보다. 매도가는 현재가 유지 가정. */
        const two = twoYearMilestone({ acquiredAt: holding.acquiredAt, today });
        /* 장기보유특별공제는 비과세와 별개 요건(3년)이다. 2년을 채워 비과세가 돼도
           3년을 못 채우면 공제율은 0%이므로 도달 시점을 따로 보여준다. */
        const lt = longTermMilestone({
          acquiredAt: holding.acquiredAt,
          residenceMonths: holding.residenceMonths,
          isOneHouseExempt: config.household.ownedHouseCount <= 1,
          today,
        });

        out.push({
          key: `${holding.id}-${target.id}`,
          holding,
          target,
          holdingPrice,
          targetPrice,
          gap: targetPrice - holdingPrice,
          ratio: targetPrice / holdingPrice,
          acq,
          sellCost,
          buyCost,
          loanLimit,
          ...scenarioAt(today),
          twoYear: two
            ? { date: two.date, monthsLeft: two.monthsLeft, scenario: scenarioAt(two.date) }
            : null,
          longTerm: lt
            ? {
                date: lt.date,
                monthsLeft: lt.monthsLeft,
                rate: lt.longTermRate,
                note: lt.longTermNote,
                scenario: scenarioAt(lt.date),
              }
            : null,
        });
      }
    }
    return out.sort((a, b) => a.realCashNeeded - b.realCashNeeded);
  }, [config, quotes]);

  const twoYearDate = pairs.find((p) => p.twoYear)?.twoYear?.date;
  const longTermInfo = pairs.find((p) => p.longTerm)?.longTerm;

  if (pairs.length === 0) {
    return (
      <SectionCard
        title="내 집 ↔ 옮길 집 비교"
        description="보유 아파트와 목표 아파트를 등록하면 실거래 기준 갭과 세후 실소요 자금을 계산합니다."
      >
        <EmptyHint>
          <p className="mb-3">
            {disabled.length > 0
              ? '등록한 목표 아파트의 스위치가 모두 꺼져 있습니다. 설정에서 다시 켤 수 있습니다.'
              : '아직 등록된 아파트가 없습니다.'}
          </p>
          {disabled.length > 0 ? (
            <ul className="mx-auto mb-3 max-w-lg space-y-1 text-left text-[11px]">
              {disabled.map((x) => (
                <li key={x.target.id}>
                  · {x.target.complexName} — {x.reason}
                </li>
              ))}
            </ul>
          ) : null}
          <Button render={<Link href="/settings" />} nativeButton={false} size="sm">
            설정에서 아파트 등록하기
          </Button>
        </EmptyHint>
      </SectionCard>
    );
  }

  return (
    <SectionCard
      title="내 집 ↔ 옮길 집 비교"
      description={
        <>
          대출은 은행에서 빌리면 되니, 진짜 중요한 건{' '}
          <strong className="text-primary font-semibold">💰 내가 준비할 현금</strong>입니다.
          세금·수수료와 기존 대출 갚는 것까지 계산해서{' '}
          <strong className="text-primary font-semibold">앞으로 얼마를 모아야 하는지</strong>{' '}
          알려드립니다.
        </>
      }
      badge={
        <div className="flex items-center gap-2">
          {applyLongTerm && longTermInfo ? (
            <Badge className="bg-sky-500/15 font-normal text-sky-700 dark:text-sky-400">
              3년 도달 후 매도 기준 (장특공 {longTermInfo.rate}%)
            </Badge>
          ) : applyTwoYear && twoYearDate ? (
            <Badge className="bg-emerald-500/15 font-normal text-emerald-700 dark:text-emerald-400">
              2년 도달 후 매도 기준
            </Badge>
          ) : null}
          <Badge variant="secondary">{pairs.length}개 조합</Badge>
        </div>
      }
    >
      <div className="mb-3 space-y-2">
        {twoYearDate ? (
          <label className="flex cursor-pointer flex-wrap items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2">
            <Switch
              checked={applyTwoYear}
              onCheckedChange={setApplyTwoYear}
              aria-label="2년 보유 도달 가정으로 보기"
            />
            <span className="text-sm font-medium">2년 보유 도달({twoYearDate}) 가정으로 보기</span>
            <span className="text-muted-foreground text-xs">
              — 1세대1주택 비과세 적용, 시세는 현재와 동일 가정
            </span>
          </label>
        ) : null}

        {/* 장기보유특별공제는 비과세(2년)와 별개 요건이라 토글도 따로 둔다.
            3년을 못 채우면 공제율이 0%이므로, 채웠을 때의 공제율로 바꿔 볼 수 있게 한다. */}
        {longTermInfo ? (
          <label className="flex cursor-pointer flex-wrap items-center gap-2 rounded-md border border-sky-500/30 bg-sky-500/5 px-3 py-2">
            <Switch
              checked={applyLongTerm}
              onCheckedChange={setApplyLongTerm}
              aria-label="장기보유특별공제 3년 요건 도달 가정으로 보기"
            />
            <span className="text-sm font-medium">
              장기보유특별공제 {LONG_TERM_MIN_YEARS}년 요건 도달({longTermInfo.date}) 가정으로 보기
            </span>
            <span className="text-muted-foreground text-xs">
              — 공제율 {longTermInfo.rate}% 적용 · {longTermInfo.monthsLeft}개월 남음
            </span>
          </label>
        ) : null}

        {disabled.length > 0 ? (
          <div className="text-muted-foreground rounded-md border border-dashed px-3 py-2 text-[11px] leading-relaxed">
            <span className="text-foreground font-medium">계산에서 빠진 목표</span> —{' '}
            {disabled.map((x) => `${x.target.complexName}(${x.reason})`).join(' · ')} · 설정에서
            스위치를 켜면 다시 들어옵니다.
          </div>
        ) : null}
      </div>

      <div className="space-y-3">
        {pairs.map((p0) => {
          /* 토글이 켜져 있으면 카드 전체 수치를 그 가정으로 바꿔 보여준다.
             둘 다 켜져 있으면 더 늦은 시점(3년 도달)이 이긴다. */
          const assumed =
            applyLongTerm && p0.longTerm
              ? p0.longTerm.scenario
              : applyTwoYear && p0.twoYear
                ? p0.twoYear.scenario
                : null;
          const p: Pair = assumed ? { ...p0, ...assumed } : p0;
          const open = openId === p.key;
          const hq = quotes[p.holding.id];
          const tq = quotes[p.target.id];

          return (
            <div key={p.key} className="rounded-lg border">
              <button
                type="button"
                onClick={() => setOpenId(open ? null : p.key)}
                className="hover:bg-muted/40 flex w-full flex-col gap-3 p-4 text-left transition-colors"
              >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-medium">{p.holding.complexName}</span>
                  <span className="text-muted-foreground text-xs">
                    {formatArea(p.holding.areaM2)}
                  </span>
                  <ArrowRight className="text-muted-foreground size-4" />
                  <span className="font-medium">{p.target.complexName}</span>
                  <span className="text-muted-foreground text-xs">
                    {formatArea(p.target.areaM2)}
                  </span>
                  {/* 보유 대비 몇 배인지 — 갭 금액만으로는 체감이 안 돼 배율을 함께 둔다 */}
                  <Badge variant="secondary" className="tabular text-[10px]">
                    보유 대비 {p.ratio.toFixed(2)}배
                  </Badge>
                  {p.target.priority === 1 ? (
                    <Badge variant="default" className="text-[10px]">
                      1순위
                    </Badge>
                  ) : null}
                  <ChevronDown
                    className={cn(
                      'text-muted-foreground ml-auto size-4 transition-transform',
                      open && 'rotate-180',
                    )}
                  />
                </div>

                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div>
                    <div className="text-muted-foreground text-xs">내 집 값</div>
                    <div className="tabular font-semibold">{formatKrw(p.holdingPrice)}</div>
                    <div className="text-muted-foreground text-[11px]">
                      {basisLabel(hq?.basis ?? 'unknown')}
                      {hq?.lastDealDate ? ` · ${hq.lastDealDate}` : ''}
                      {hq?.changeRate !== undefined ? (
                        <>
                          {' '}
                          · <Delta value={hq.changeRate} digits={1} />
                        </>
                      ) : null}
                    </div>
                    {/* 시세도 다른 지표와 같은 문법으로 전월·전분기를 읽게 한다 */}
                    <PeriodCompare delta={hq?.compare} digits={1} className="text-[11px]" />
                    <AskingHint quote={hq} />
                    {complexSpecLine(p.holding) ? (
                      <div className="text-muted-foreground text-[11px]">
                        {complexSpecLine(p.holding)}
                      </div>
                    ) : null}
                  </div>
                  <div>
                    <div className="text-muted-foreground text-xs">옮길 집 값</div>
                    <div className="tabular font-semibold">{formatKrw(p.targetPrice)}</div>
                    <div className="text-primary tabular text-[11px] font-medium">
                      보유 대비 {p.ratio.toFixed(2)}배
                    </div>
                    <div className="text-muted-foreground text-[11px]">
                      {basisLabel(tq?.basis ?? 'unknown')}
                      {tq?.lastDealDate ? ` · ${tq.lastDealDate}` : ''}
                      {tq?.changeRate !== undefined ? (
                        <>
                          {' '}
                          · <Delta value={tq.changeRate} digits={1} />
                        </>
                      ) : null}
                    </div>
                    <PeriodCompare delta={tq?.compare} digits={1} className="text-[11px]" />
                    {/* 스위치를 직접 켜 둔 단지는 대표가가 묵었을 수 있다 — 그 사실을 숨기지 않는다 */}
                    {staleQuoteWarning(tq) ? (
                      <div className="text-[11px] text-amber-600 dark:text-amber-400">
                        ⚠ {staleQuoteWarning(tq)}
                      </div>
                    ) : null}
                    <AskingHint quote={tq} />
                    {complexSpecLine(p.target) ? (
                      <div className="text-muted-foreground text-[11px]">
                        {complexSpecLine(p.target)}
                      </div>
                    ) : null}
                  </div>
                  <div>
                    <div className="text-muted-foreground text-xs">두 집의 가격 차이</div>
                    <div className="tabular text-rise font-semibold">{formatKrw(p.gap)}</div>
                    <div className="text-muted-foreground text-[11px]">
                      보유 대비 {p.ratio.toFixed(2)}배
                    </div>
                  </div>
                  {/* 이 칸이 카드의 결론이다 — 대출은 은행이 주는 돈이고, 사용자가 실제로
                      모아야 하는 건 "내가 준비할 현금"뿐이다. 그래서 이 숫자를 가장 크게 둔다. */}
                  <div>
                    <div className="text-muted-foreground text-xs">💰 내가 준비할 현금</div>
                    <div className="tabular text-primary text-2xl leading-tight font-extrabold underline decoration-dotted underline-offset-4">
                      {formatKrw(p.grossByCash)}
                    </div>
                    {/* 보유 현금과의 차이 = 앞으로 얼마를 더 모아야 하는가 */}
                    {config.household.cashAssets > 0 ? (
                      <div
                        className={cn(
                          'text-[11px] font-semibold',
                          p.grossByCash > config.household.cashAssets ? 'text-fall' : 'text-rise',
                        )}
                      >
                        {p.grossByCash > config.household.cashAssets
                          ? `보유 ${formatKrw(config.household.cashAssets, { compact: true })} → ${formatKrw(p.grossByCash - config.household.cashAssets, { compact: true })} 더 모아야 함`
                          : `보유 현금으로 실행 가능 (여유 ${formatKrw(config.household.cashAssets - p.grossByCash, { compact: true })})`}
                      </div>
                    ) : null}
                    {/* "가격 차이는 5억인데 왜 10억이 필요하냐"가 가장 많이 나온 질문이다.
                        세 덩어리로 쪼개 보여주면 그 자리에서 납득된다.
                        대출 감소분 = 기존 대출을 갚는데 새로 그만큼 못 빌려서 생기는 몫. */}
                    <div className="text-muted-foreground text-[11px]">
                      = 가격 차이 {formatKrw(p.gap, { compact: true })} + 세금·수수료{' '}
                      {formatKrw(p.friction, { compact: true })}
                      {p.holding.loanBalance + p.holding.leaseDeposit - p.grossByLoan > 0
                        ? ` + 대출 줄어든 몫 ${formatKrw(p.holding.loanBalance + p.holding.leaseDeposit - p.grossByLoan, { compact: true })}`
                        : ''}
                    </div>
                    <div className="text-muted-foreground text-[11px]">
                      은행 대출 {formatKrw(p.grossByLoan, { compact: true })}
                      <span className="text-muted-foreground/70">
                        {' '}
                        (한도 {formatKrw(p.loanLimit, { compact: true })})
                      </span>{' '}
                      포함 총 {formatKrw(p.grossNeed, { compact: true })} 필요 ·{' '}
                      <strong className="text-primary font-semibold">
                        {open ? '접기' : '클릭해 상세'}
                      </strong>
                    </div>
                  </div>
                </div>
              </button>

              {open ? (
                <div className="bg-muted/30 border-t p-4">
                  <div className="grid gap-6 lg:grid-cols-2">
                    {/* 매도 측 */}
                    <div>
                      <h4 className="mb-2 text-sm font-semibold">
                        집 팔 때 — {p.holding.complexName}
                      </h4>
                      <CostTable
                        rows={[
                          ['내 집 파는 값', p.holdingPrice, 'plus'],
                          ['양도소득세 (집 팔 때 내는 세금)', -p.cgt.incomeTax],
                          ['지방소득세 (양도세의 10%)', -p.cgt.localTax],
                          ['부동산 중개수수료', -p.sellCost.brokerFee],
                          ['갚아야 할 기존 대출', -p.holding.loanBalance],
                          ['세입자에게 돌려줄 보증금', -p.holding.leaseDeposit],
                        ]}
                        total={[
                          '집 팔고 손에 남는 돈',
                          p.netFromSale - p.holding.loanBalance - p.holding.leaseDeposit,
                        ]}
                      />
                      {/* 장특공은 현금흐름이 아니라 과세표준을 깎는 공제라 표와 따로 보여준다 */}
                      <div className="mt-2 rounded-md border px-2.5 py-2 text-[11px] leading-relaxed">
                        <span className="font-medium">장기보유특별공제</span>{' '}
                        <span className="tabular">
                          {p.cgt.longTermRate}% · {formatKrw(p.cgt.longTermDeduction)} 공제
                        </span>
                        <div className="text-muted-foreground mt-0.5">
                          1세대1주택 비과세(2년 보유)와는 별개 요건입니다 — 보유{' '}
                          {LONG_TERM_MIN_YEARS}년을 채워야 공제가 시작됩니다.
                        </div>
                      </div>
                      <NoteList
                        notes={[
                          p.cgt.exempt
                            ? '1세대1주택 비과세 적용'
                            : `양도차익 ${formatKrw(p.cgt.grossGain)} · 장특공 ${p.cgt.longTermRate}% · 세율 ${p.cgt.rate}%`,
                          ...p.cgt.notes.slice(0, 2),
                        ]}
                      />
                      {!applyTwoYear && !applyLongTerm && p0.twoYear ? (
                        <MilestoneNote
                          tone="emerald"
                          title={`🕐 2년 보유 도달(${p0.twoYear.date}) 후 매도 시`}
                          now={p0}
                          later={p0.twoYear.scenario}
                          extra={
                            p0.twoYear.scenario.cgt.exempt
                              ? '1세대1주택 비과세, 12억 초과분만 과세'
                              : undefined
                          }
                        />
                      ) : null}
                      {!applyLongTerm && p0.longTerm ? (
                        <MilestoneNote
                          tone="sky"
                          title={`📐 장기보유특별공제 ${LONG_TERM_MIN_YEARS}년 요건 도달(${p0.longTerm.date}) 후 매도 시`}
                          now={p0}
                          later={p0.longTerm.scenario}
                          extra={p0.longTerm.note}
                        />
                      ) : null}
                    </div>

                    {/* 매수 측 */}
                    <div>
                      <h4 className="mb-2 text-sm font-semibold">
                        집 살 때 — {p.target.complexName}
                      </h4>
                      <CostTable
                        rows={[
                          ['옮길 집 사는 값', -p.targetPrice],
                          [`취득세 (${p.acq.rate}%)`, -p.acq.acquisitionTax],
                          ['지방교육세', -p.acq.localEducationTax],
                          ['농어촌특별세', -p.acq.ruralTax],
                          ['부동산 중개수수료', -p.buyCost.brokerFee],
                          ['등기 비용 (법무사)', -p.buyCost.registrationFee],
                          ['인지세 (계약서에 붙이는 세금)', -p.buyCost.stampTax],
                          ['국민주택채권 (등기 때 의무 매입)', -p.buyCost.bondDiscount],
                          ['대출 근저당 설정비 등', -p.buyCost.movingEtc],
                        ]}
                        total={[
                          '옮길 집에 드는 돈 합계',
                          -(p.targetPrice + p.acq.total + p.buyCost.total),
                        ]}
                      />
                      <NoteList
                        notes={[
                          staleQuoteWarning(tq) ??
                            `대표가는 마지막 실거래${tq?.lastDealDate ? ` (${tq.lastDealDate})` : ''}이며, 최근 ${TARGET_FRESHNESS_MONTHS}개월 안의 값입니다.`,
                          ...p.acq.notes.slice(0, 2),
                          ...p.buyCost.notes.slice(0, 1),
                        ]}
                      />
                    </div>
                  </div>

                  <Separator className="my-4" />

                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="bg-background rounded-md border px-3 py-2">
                      <div className="text-muted-foreground text-xs">세금·수수료 합계</div>
                      <div className="tabular text-fall font-semibold">{formatKrw(p.friction)}</div>
                      <div className="text-muted-foreground text-[11px]">
                        매수가의 {formatPct((p.friction / p.targetPrice) * 100, 2)}
                      </div>
                      {/* 매수 측만 보고 합이 안 맞다고 느끼기 쉬워 구성을 명시한다 */}
                      <div className="text-muted-foreground mt-1 text-[11px]">
                        = 양도세 {formatKrw(p.cgt.total)} + 매도비용 {formatKrw(p.sellCost.total)} +
                        취득세 {formatKrw(p.acq.total)} + 매수비용 {formatKrw(p.buyCost.total)}
                      </div>
                    </div>
                    <div className="bg-background rounded-md border px-3 py-2">
                      {/* 사용자가 실제로 준비해야 하는 건 "내 돈"이다 — 대출로 채워지는 몫을
                          뺀 자기자본을 헤드라인으로 올리고, 조달 총액은 보조 줄로 내린다 */}
                      <div className="text-muted-foreground text-xs">💰 내가 준비할 현금</div>
                      <div className="tabular text-primary text-xl font-extrabold">
                        {formatKrw(p.grossByCash)}
                      </div>
                      {config.household.cashAssets > 0 ? (
                        <div
                          className={cn(
                            'text-[11px] font-semibold',
                            p.grossByCash > config.household.cashAssets ? 'text-fall' : 'text-rise',
                          )}
                        >
                          {p.grossByCash > config.household.cashAssets
                            ? `보유 ${formatKrw(config.household.cashAssets, { compact: true })} → ${formatKrw(p.grossByCash - config.household.cashAssets, { compact: true })} 더 모아야 함`
                            : '보유 현금으로 실행 가능'}
                        </div>
                      ) : null}
                      <div className="text-muted-foreground text-[11px]">
                        신규 대출 {formatKrw(p.grossByLoan, { compact: true })}
                        <span className="text-muted-foreground/70">
                          {' '}
                          (한도 {formatKrw(p.loanLimit, { compact: true })})
                        </span>
                        까지 받는 가정
                      </div>
                      <div className="text-muted-foreground mt-1 text-[11px]">
                        조달 총액 {formatKrw(p.grossNeed, { compact: true })} = 실소요{' '}
                        {formatKrw(p.realCashNeeded, { compact: true })}
                        {p.holding.loanBalance > 0
                          ? ` + 기존 대출 상환 ${formatKrw(p.holding.loanBalance, { compact: true })}`
                          : ''}
                        {p.holding.leaseDeposit > 0
                          ? ` + 보증금 반환 ${formatKrw(p.holding.leaseDeposit, { compact: true })}`
                          : ''}
                      </div>
                    </div>
                    <div className="flex items-center">
                      <Button
                        render={
                          <Link
                            href={`/simulation?holding=${p.holding.id}&target=${p.target.id}`}
                          />
                        }
                        nativeButton={false}
                        size="sm"
                        variant="outline"
                        className="w-full"
                      >
                        하락장 시나리오 시뮬레이션 →
                      </Button>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </SectionCard>
  );
}

/**
 * "요건을 채우고 팔면 얼마나 달라지는가" 안내 블록.
 * 2년(비과세)·3년(장기보유특별공제) 두 요건이 같은 형식으로 읽히도록 한 컴포넌트로 묶는다.
 */
function MilestoneNote({
  tone,
  title,
  now,
  later,
  extra,
}: {
  tone: 'emerald' | 'sky';
  title: string;
  now: Scenario;
  later: Scenario;
  extra?: string;
}) {
  const saving = now.cgt.total - later.cgt.total;
  const toneClass =
    tone === 'emerald'
      ? 'border-emerald-500/40 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400'
      : 'border-sky-500/40 bg-sky-500/5 text-sky-700 dark:text-sky-400';

  return (
    <div className={cn('mt-2 rounded-md border p-2.5 text-[11px] leading-relaxed', toneClass)}>
      <span className="font-semibold">{title}</span>
      <div className="text-foreground mt-1">
        양도세 <span className="tabular font-medium">{formatKrw(later.cgt.total)}</span>
        {extra ? ` (${extra})` : ''} · 장특공{' '}
        <span className="tabular font-medium">
          {later.cgt.longTermRate}% · {formatKrw(later.cgt.longTermDeduction)}
        </span>{' '}
        — 지금 매도 대비{' '}
        <span className={cn('tabular font-semibold', saving > 0 ? 'text-rise' : 'text-fall')}>
          {formatSignedKrw(-saving)}
        </span>
        , 내가 준비할 현금{' '}
        <span className="tabular font-medium">{formatKrw(later.grossByCash)}</span>
      </div>
      <div className="text-muted-foreground mt-0.5">
        매도가가 지금과 같고 거주 개월 수도 그대로라고 가정한 비교입니다.
      </div>
    </div>
  );
}

function CostTable({
  rows,
  total,
}: {
  rows: Array<[string, number] | [string, number, 'plus']>;
  total: [string, number];
}) {
  return (
    <table className="w-full text-sm">
      <tbody>
        {rows.map(([label, value]) => (
          <tr key={label} className="border-b border-dashed last:border-0">
            <td className="text-muted-foreground py-1">{label}</td>
            <td
              className={cn('tabular py-1 text-right', value < 0 ? 'text-fall' : 'text-foreground')}
            >
              {value === 0 ? '-' : formatKrw(value)}
            </td>
          </tr>
        ))}
        <tr className="border-t-2">
          <td className="py-1.5 font-semibold">{total[0]}</td>
          <td className="tabular py-1.5 text-right font-bold">{formatKrw(total[1])}</td>
        </tr>
      </tbody>
    </table>
  );
}

function NoteList({ notes }: { notes: string[] }) {
  const filtered = notes.filter(Boolean);
  if (filtered.length === 0) return null;
  return (
    <ul className="mt-2 space-y-1">
      {filtered.map((n, i) => (
        <li key={i} className="text-muted-foreground flex gap-1.5 text-[11px] leading-relaxed">
          <Info className="mt-0.5 size-3 shrink-0" />
          <span>{n}</span>
        </li>
      ))}
    </ul>
  );
}
