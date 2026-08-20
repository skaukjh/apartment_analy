'use client';

import { useMemo, useState } from 'react';
import { ArrowRight, ChevronDown, Info } from 'lucide-react';
import type { PriceQuote, UserConfig } from '@/lib/types';
import { formatArea, formatKrw, formatPct, todayKst } from '@/lib/format';
import { askingPremiumPct, tradePriceOf } from '@/lib/analysis/price-basis';
import { calcAcquisitionTaxFor } from '@/lib/tax/acquisition';
import { calcCapitalGainsTax } from '@/lib/tax/capital-gains';
import { calcTransactionCost } from '@/lib/tax/transaction-costs';
import { SectionCard, EmptyHint, Delta } from '@/components/ui-bits';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
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
      acq: ReturnType<typeof calcAcquisitionTaxFor>;
      sellCost: ReturnType<typeof calcTransactionCost>;
      buyCost: ReturnType<typeof calcTransactionCost>;
      netFromSale: number;
      realCashNeeded: number;
      friction: number;
    }> = [];

    for (const holding of config.holdings) {
      const holdingPrice = tradePriceOf(quotes[holding.id]);
      if (holdingPrice <= 0) continue;

      for (const target of [...config.targets].sort((a, b) => a.priority - b.priority)) {
        const targetPrice = tradePriceOf(quotes[target.id]);
        if (targetPrice <= 0) continue;

        const cgt = calcCapitalGainsTax({
          salePrice: holdingPrice,
          acquisitionPrice: holding.acquisitionPrice,
          expenses: holding.acquisitionCost + holding.capitalExpenditure,
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
        const sellCost = calcTransactionCost({ price: holdingPrice, side: 'sell' });
        const buyCost = calcTransactionCost({
          price: targetPrice,
          side: 'buy',
          withMortgage: true,
        });

        const netFromSale = holdingPrice - cgt.total - sellCost.total;
        const realCashNeeded = targetPrice + acq.total + buyCost.total - netFromSale;

        out.push({
          key: `${holding.id}-${target.id}`,
          holding,
          target,
          holdingPrice,
          targetPrice,
          gap: targetPrice - holdingPrice,
          ratio: targetPrice / holdingPrice,
          cgt,
          acq,
          sellCost,
          buyCost,
          netFromSale,
          realCashNeeded,
          friction: cgt.total + acq.total + sellCost.total + buyCost.total,
        });
      }
    }
    return out.sort((a, b) => a.realCashNeeded - b.realCashNeeded);
  }, [config, quotes]);

  if (pairs.length === 0) {
    return (
      <SectionCard
        title="① 보유 ↔ 목표 시세 갭"
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
      title="① 보유 ↔ 목표 시세 갭"
      description="갭은 단순 시세 차이이고, 실소요 자금은 양도세·취득세·중개보수까지 반영한 실제로 더 필요한 현금입니다."
      badge={<Badge variant="secondary">{pairs.length}개 조합</Badge>}
    >
      <div className="space-y-3">
        {pairs.map((p) => {
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
                  </div>
                  <div>
                    <div className="text-muted-foreground text-xs">목표 시세</div>
                    <div className="tabular font-semibold">{formatKrw(p.targetPrice)}</div>
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
                  </div>
                  <div>
                    <div className="text-muted-foreground text-xs">시세 갭</div>
                    <div className="tabular text-rise font-semibold">{formatKrw(p.gap)}</div>
                    <div className="text-muted-foreground text-[11px]">{p.ratio.toFixed(2)}배</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground text-xs">세후 실소요 자금</div>
                    <div className="tabular text-lg font-bold">{formatKrw(p.realCashNeeded)}</div>
                    <div className="text-muted-foreground text-[11px]">
                      갭 대비 +{formatKrw(p.realCashNeeded - p.gap)}
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
                    </div>
                    <div className="bg-background rounded-md border px-3 py-2">
                      <div className="text-muted-foreground text-xs">추가로 필요한 현금·대출</div>
                      <div className="tabular font-semibold">
                        {formatKrw(
                          p.realCashNeeded + p.holding.loanBalance + p.holding.leaseDeposit,
                        )}
                      </div>
                      <div className="text-muted-foreground text-[11px]">
                        기존 대출·보증금 상환분 포함
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
