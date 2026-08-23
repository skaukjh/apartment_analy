'use client';

import { useMemo, useState } from 'react';
import { ArrowRight, ChevronDown, Info } from 'lucide-react';
import type { PriceQuote, UserConfig } from '@/lib/types';
import { complexSpecLine, formatArea, formatKrw, formatPct, todayKst } from '@/lib/format';
import { askingPremiumPct, tradePriceOf } from '@/lib/analysis/price-basis';
import { calcAcquisitionTaxFor } from '@/lib/tax/acquisition';
import { calcCapitalGainsTax } from '@/lib/tax/capital-gains';
import { calcTransactionCost } from '@/lib/tax/transaction-costs';
import { calcLoanLimit } from '@/lib/tax/loan-limit';
import { regulationOf } from '@/lib/analysis/regulation';
import { SectionCard, EmptyHint, Delta } from '@/components/ui-bits';
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

export function GapSection({ config, quotes }: Props) {
  const [openId, setOpenId] = useState<string | null>(null);
  /* 2년 보유 도달 가정으로 전체 수치를 바꿔 보는 토글 — 2년 미만 보유자만 노출 */
  const [applyTwoYear, setApplyTwoYear] = useState(false);

  const pairs = useMemo(() => {
    const out: Array<{
      key: string;
      holding: UserConfig['holdings'][number];
      target: UserConfig['targets'][number];
      holdingPrice: number;
      targetPrice: number;
      gap: number;
      ratio: number;
      cgt: ReturnType<typeof calcCapitalGainsTax>;
      /** 2년 보유를 채우고 팔 때의 양도세 (이미 2년 이상이면 null) */
      cgt2y: ReturnType<typeof calcCapitalGainsTax> | null;
      twoYearDate: string;
      acq: ReturnType<typeof calcAcquisitionTaxFor>;
      sellCost: ReturnType<typeof calcTransactionCost>;
      buyCost: ReturnType<typeof calcTransactionCost>;
      netFromSale: number;
      realCashNeeded: number;
      friction: number;
      /** 목표 주택 기준 대출 한도 (기존 주택 처분 전제) */
      loanLimit: number;
      /** 기존 대출·보증금 상환 포함 총 필요액의 대출/현금 분해.
          "내 돈"은 항상 이 기준 하나만 쓴다 — 순 기준 분해를 같이 보여줬더니
          "내 돈"이 두 값으로 나와 헷갈린다는 피드백이 있었다. */
      grossNeed: number;
      grossByLoan: number;
      grossByCash: number;
      /** 2년 보유 도달 가정의 수치 (2년 미만일 때만) — 토글로 전환해 본다 */
      alt: {
        cgt: ReturnType<typeof calcCapitalGainsTax>;
        netFromSale: number;
        realCashNeeded: number;
        friction: number;
        grossNeed: number;
        grossByLoan: number;
        grossByCash: number;
      } | null;
    }> = [];

    for (const holding of config.holdings) {
      const holdingPrice = tradePriceOf(quotes[holding.id]);
      if (holdingPrice <= 0) continue;

      for (const target of [...config.targets].sort((a, b) => a.priority - b.priority)) {
        const targetPrice = tradePriceOf(quotes[target.id]);
        if (targetPrice <= 0) continue;

        // 매도 중개보수는 양도세 필요경비 — 서버(buildGaps)와 같은 순서로 먼저 계산
        const sellCost = calcTransactionCost({ price: holdingPrice, side: 'sell' });

        const cgt = calcCapitalGainsTax({
          salePrice: holdingPrice,
          acquisitionPrice: holding.acquisitionPrice,
          expenses: holding.acquisitionCost + holding.capitalExpenditure + sellCost.brokerFee,
          acquiredAt: holding.acquiredAt,
          soldAt: todayKst(),
          residenceMonths: holding.residenceMonths,
          isOneHouseExempt: config.household.ownedHouseCount <= 1,
          multiHouseSurcharge: false,
          isRegulated: config.household.holdingIsRegulated,
          usedBasicDeduction: 0,
        });
        const acq = calcAcquisitionTaxFor(targetPrice, target.areaM2, config.household, {
          replacesExisting: true,
        });
        const buyCost = calcTransactionCost({
          price: targetPrice,
          side: 'buy',
          withMortgage: true,
        });

        const netFromSale = holdingPrice - cgt.total - sellCost.total;
        const realCashNeeded = targetPrice + acq.total + buyCost.total - netFromSale;

        /* 보유 2년 미만이면 "2년 채우고 팔면 얼마나 달라지는지"를 함께 계산한다.
           단기양도세 60%와 1세대1주택 비과세의 차이가 수억이라, 지금 파는 것과
           기다렸다 파는 것의 비교가 실질적인 의사결정 정보다. 매도가는 현재가 유지 가정. */
        let cgt2y: ReturnType<typeof calcCapitalGainsTax> | null = null;
        let twoYearDate = '';
        if (holding.acquiredAt) {
          const d = new Date(holding.acquiredAt);
          d.setFullYear(d.getFullYear() + 2);
          d.setDate(d.getDate() + 1);
          twoYearDate = d.toISOString().slice(0, 10);
          if (todayKst() < twoYearDate) {
            cgt2y = calcCapitalGainsTax({
              salePrice: holdingPrice,
              acquisitionPrice: holding.acquisitionPrice,
              expenses: holding.acquisitionCost + holding.capitalExpenditure + sellCost.brokerFee,
              acquiredAt: holding.acquiredAt,
              soldAt: twoYearDate,
              residenceMonths: holding.residenceMonths,
              isOneHouseExempt: config.household.ownedHouseCount <= 1,
              multiHouseSurcharge: false,
              isRegulated: config.household.holdingIsRegulated,
              usedBasicDeduction: 0,
            });
          }
        }

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
        const grossNeed = realCashNeeded + holding.loanBalance + holding.leaseDeposit;
        const grossByLoan = Math.min(loanLimit, Math.max(0, grossNeed));

        /* 2년 도달 가정의 전체 수치 — 토글로 카드 전체를 이 기준으로 바꿔 볼 수 있게 */
        let alt: (typeof out)[number]['alt'] = null;
        if (cgt2y) {
          const netFromSale2 = holdingPrice - cgt2y.total - sellCost.total;
          const realCashNeeded2 = targetPrice + acq.total + buyCost.total - netFromSale2;
          const grossNeed2 = realCashNeeded2 + holding.loanBalance + holding.leaseDeposit;
          const grossByLoan2 = Math.min(loanLimit, Math.max(0, grossNeed2));
          alt = {
            cgt: cgt2y,
            netFromSale: netFromSale2,
            realCashNeeded: realCashNeeded2,
            friction: cgt2y.total + acq.total + sellCost.total + buyCost.total,
            grossNeed: grossNeed2,
            grossByLoan: grossByLoan2,
            grossByCash: Math.max(0, grossNeed2 - grossByLoan2),
          };
        }

        out.push({
          key: `${holding.id}-${target.id}`,
          holding,
          target,
          holdingPrice,
          targetPrice,
          gap: targetPrice - holdingPrice,
          ratio: targetPrice / holdingPrice,
          cgt,
          cgt2y,
          twoYearDate,
          acq,
          sellCost,
          buyCost,
          netFromSale,
          realCashNeeded,
          friction: cgt.total + acq.total + sellCost.total + buyCost.total,
          loanLimit,
          grossNeed,
          grossByLoan,
          grossByCash: Math.max(0, grossNeed - grossByLoan),
          alt,
        });
      }
    }
    return out.sort((a, b) => a.realCashNeeded - b.realCashNeeded);
  }, [config, quotes]);

  if (pairs.length === 0) {
    return (
      <SectionCard
        title="보유 ↔ 목표 시세 갭"
        description="보유 아파트와 목표 아파트를 등록하면 실거래 기준 갭과 세후 실소요 자금을 계산합니다."
      >
        <EmptyHint>
          <p className="mb-3">아직 등록된 아파트가 없습니다.</p>
          <Button render={<Link href="/settings" />} nativeButton={false} size="sm">
            설정에서 아파트 등록하기
          </Button>
        </EmptyHint>
      </SectionCard>
    );
  }

  return (
    <SectionCard
      title="보유 ↔ 목표 시세 갭"
      description={
        <>
          갭은 단순 시세 차이이고,{' '}
          <strong className="text-primary font-semibold">실소요 자금</strong>은
          양도세·취득세·중개보수까지 반영한{' '}
          <strong className="text-primary font-semibold">실제로 더 필요한 현금</strong>입니다.
        </>
      }
      badge={
        <div className="flex items-center gap-2">
          {applyTwoYear ? (
            <Badge className="bg-emerald-500/15 font-normal text-emerald-700 dark:text-emerald-400">
              2년 도달 후 매도 기준
            </Badge>
          ) : null}
          <Badge variant="secondary">{pairs.length}개 조합</Badge>
        </div>
      }
    >
      {pairs.some((p) => p.alt) ? (
        <label className="mb-3 flex cursor-pointer flex-wrap items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2">
          <Switch
            checked={applyTwoYear}
            onCheckedChange={setApplyTwoYear}
            aria-label="2년 보유 도달 가정으로 보기"
          />
          <span className="text-sm font-medium">
            2년 보유 도달({pairs.find((p) => p.alt)?.twoYearDate}) 가정으로 보기
          </span>
          <span className="text-muted-foreground text-xs">
            — 1세대1주택 비과세 적용, 시세는 현재와 동일 가정
          </span>
        </label>
      ) : null}

      <div className="space-y-3">
        {pairs.map((p0) => {
          // 토글이 켜져 있으면 카드 전체 수치를 2년 도달 가정으로 바꿔 보여준다
          const p = applyTwoYear && p0.alt ? { ...p0, ...p0.alt } : p0;
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
                    <div className="text-muted-foreground text-xs">보유 시세</div>
                    <div className="tabular font-semibold">{formatKrw(p.holdingPrice)}</div>
                    <div className="text-muted-foreground text-[11px]">
                      {basisLabel(hq?.basis ?? 'unknown')}
                      {hq?.changeRate !== undefined ? (
                        <>
                          {' '}
                          · <Delta value={hq.changeRate} digits={1} />
                        </>
                      ) : null}
                    </div>
                    <AskingHint quote={hq} />
                    {complexSpecLine(p.holding) ? (
                      <div className="text-muted-foreground text-[11px]">
                        {complexSpecLine(p.holding)}
                      </div>
                    ) : null}
                  </div>
                  <div>
                    <div className="text-muted-foreground text-xs">목표 시세</div>
                    <div className="tabular font-semibold">{formatKrw(p.targetPrice)}</div>
                    <div className="text-primary tabular text-[11px] font-medium">
                      보유 대비 {p.ratio.toFixed(2)}배
                    </div>
                    <div className="text-muted-foreground text-[11px]">
                      {basisLabel(tq?.basis ?? 'unknown')}
                      {tq?.changeRate !== undefined ? (
                        <>
                          {' '}
                          · <Delta value={tq.changeRate} digits={1} />
                        </>
                      ) : null}
                    </div>
                    <AskingHint quote={tq} />
                    {complexSpecLine(p.target) ? (
                      <div className="text-muted-foreground text-[11px]">
                        {complexSpecLine(p.target)}
                      </div>
                    ) : null}
                  </div>
                  <div>
                    <div className="text-muted-foreground text-xs">시세 갭</div>
                    <div className="tabular text-rise font-semibold">{formatKrw(p.gap)}</div>
                    <div className="text-muted-foreground text-[11px]">
                      보유 대비 {p.ratio.toFixed(2)}배
                    </div>
                  </div>
                  <div>
                    <div className="text-muted-foreground text-xs">세후 실소요 자금</div>
                    <div className="tabular text-primary text-lg font-bold underline decoration-dotted underline-offset-4">
                      {formatKrw(p.realCashNeeded)}
                    </div>
                    {/* 실소요(순 기준)에서 조달총액(기존 부채 상환 포함)으로 넘어가는 다리를
                        보여준다. 이 줄이 없으면 "6.4억"인데 아래에 "내 돈 8.5억 + 대출 4억"이
                        붙어 산수가 안 맞는 것처럼 보인다는 피드백이 있었다. */}
                    {p.holding.loanBalance + p.holding.leaseDeposit > 0 ? (
                      <div className="text-muted-foreground text-[11px]">
                        + 기존{' '}
                        {p.holding.loanBalance > 0
                          ? `대출 ${formatKrw(p.holding.loanBalance, { compact: true })}`
                          : ''}
                        {p.holding.loanBalance > 0 && p.holding.leaseDeposit > 0 ? ' · ' : ''}
                        {p.holding.leaseDeposit > 0
                          ? `보증금 ${formatKrw(p.holding.leaseDeposit, { compact: true })}`
                          : ''}{' '}
                        상환 = 조달 {formatKrw(p.grossNeed, { compact: true })}
                      </div>
                    ) : null}
                    <div className="text-[11px]">
                      <span className="text-primary font-semibold">
                        내 돈 {formatKrw(p.grossByCash, { compact: true })}
                      </span>
                      <span className="text-muted-foreground">
                        {' '}
                        + 신규 대출 {formatKrw(p.grossByLoan, { compact: true })}
                      </span>
                    </div>
                    <div className="text-muted-foreground text-[11px]">
                      갭 대비 +{formatKrw(p.realCashNeeded - p.gap)} ·{' '}
                      <strong className="text-primary font-semibold">
                        {open ? '접기' : '클릭해 세금·수수료 분해 보기'}
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
                      <h4 className="mb-2 text-sm font-semibold">매도 — {p.holding.complexName}</h4>
                      <CostTable
                        rows={[
                          ['매도 예상가', p.holdingPrice, 'plus'],
                          ['양도소득세', -p.cgt.incomeTax],
                          ['지방소득세', -p.cgt.localTax],
                          ['중개보수 (VAT 포함)', -p.sellCost.brokerFee],
                          ['상환할 대출 잔액', -p.holding.loanBalance],
                          ['반환할 보증금', -p.holding.leaseDeposit],
                        ]}
                        total={[
                          '매도 후 순현금',
                          p.netFromSale - p.holding.loanBalance - p.holding.leaseDeposit,
                        ]}
                      />
                      <NoteList
                        notes={[
                          p.cgt.exempt
                            ? '1세대1주택 비과세 적용'
                            : `양도차익 ${formatKrw(p.cgt.grossGain)} · 장특공 ${p.cgt.longTermRate}% · 세율 ${p.cgt.rate}%`,
                          ...p.cgt.notes.slice(0, 2),
                        ]}
                      />
                      {!applyTwoYear && p.cgt2y ? (
                        <div className="mt-2 rounded-md border border-emerald-500/40 bg-emerald-500/5 p-2.5 text-[11px] leading-relaxed">
                          <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                            🕐 2년 보유 도달({p.twoYearDate}) 후 매도 시
                          </span>
                          <div className="mt-1">
                            양도세{' '}
                            <span className="tabular font-medium">{formatKrw(p.cgt2y.total)}</span>
                            {p.cgt2y.exempt ? ' (1세대1주택 비과세, 12억 초과분만 과세)' : ''} —
                            지금 매도 대비{' '}
                            <span className="tabular font-semibold text-emerald-700 dark:text-emerald-400">
                              {formatKrw(p.cgt.total - p.cgt2y.total)} 절감
                            </span>
                            , 실소요{' '}
                            <span className="tabular font-medium">
                              {formatKrw(p.realCashNeeded - (p.cgt.total - p.cgt2y.total))}
                            </span>
                          </div>
                          <div className="text-muted-foreground mt-0.5">
                            매도가가 지금과 같다고 가정한 비교입니다.
                          </div>
                        </div>
                      ) : null}
                    </div>

                    {/* 매수 측 */}
                    <div>
                      <h4 className="mb-2 text-sm font-semibold">매수 — {p.target.complexName}</h4>
                      <CostTable
                        rows={[
                          ['매수 예상가', -p.targetPrice],
                          [`취득세 (${p.acq.rate}%)`, -p.acq.acquisitionTax],
                          ['지방교육세', -p.acq.localEducationTax],
                          ['농어촌특별세', -p.acq.ruralTax],
                          ['중개보수 (VAT 포함)', -p.buyCost.brokerFee],
                          ['법무사·등기', -p.buyCost.registrationFee],
                          ['인지세', -p.buyCost.stampTax],
                          ['국민주택채권 할인', -p.buyCost.bondDiscount],
                          ['근저당 설정 등', -p.buyCost.movingEtc],
                        ]}
                        total={['매수 총 소요', -(p.targetPrice + p.acq.total + p.buyCost.total)]}
                      />
                      <NoteList
                        notes={[...p.acq.notes.slice(0, 2), ...p.buyCost.notes.slice(0, 1)]}
                      />
                    </div>
                  </div>

                  <Separator className="my-4" />

                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="bg-background rounded-md border px-3 py-2">
                      <div className="text-muted-foreground text-xs">총 마찰비용 (세금+수수료)</div>
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
                      <div className="text-muted-foreground text-xs">내 돈 (자기자본 필요액)</div>
                      <div className="tabular text-primary font-semibold">
                        {formatKrw(p.grossByCash)}
                      </div>
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
