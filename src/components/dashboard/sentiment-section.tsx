'use client';

import type { ReactNode } from 'react';
import { Info } from 'lucide-react';
import type { MarketSentiment } from '@/lib/types';
import { HEAT_META } from '@/lib/analysis/market-signals';
import {
  heatScoreGuide,
  newHighGuide,
  priceMomentumGuide,
  supplyDemandGuide,
  volumeGuide,
  type MetricGuide,
} from '@/lib/analysis/metric-guide';
import { formatPct } from '@/lib/format';
import { Delta, PeriodCompare, SectionCard } from '@/components/ui-bits';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/** 0~100 과열 점수를 반원 게이지로 */
function HeatGauge({ score, color }: { score: number; color: string }) {
  const r = 70;
  const cx = 90;
  const cy = 85;
  const angle = Math.PI * (1 - score / 100);
  // 서버·클라이언트의 부동소수점 문자열화가 미세하게 달라 하이드레이션 경고가 나므로 자릿수를 고정한다
  const round = (n: number) => Math.round(n * 1000) / 1000;
  const x = round(cx + r * Math.cos(angle));
  const y = round(cy - r * Math.sin(angle));
  const circumference = round(Math.PI * r);
  const filled = round((score / 100) * circumference);

  return (
    <svg viewBox="0 0 180 100" className="w-44">
      <path
        d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
        fill="none"
        stroke="var(--muted)"
        strokeWidth="14"
        strokeLinecap="round"
      />
      <path
        d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
        fill="none"
        stroke={color}
        strokeWidth="14"
        strokeLinecap="round"
        strokeDasharray={`${filled} ${circumference}`}
      />
      <circle cx={x} cy={y} r="6" fill="var(--background)" stroke={color} strokeWidth="3" />
      <text
        x={cx}
        y={cy - 12}
        textAnchor="middle"
        className="fill-foreground text-[28px] font-bold"
        style={{ fontVariantNumeric: 'tabular-nums' }}
      >
        {score}
      </text>
      <text x={cx} y={cy + 4} textAnchor="middle" className="fill-muted-foreground text-[10px]">
        / 100
      </text>
    </svg>
  );
}

/** 지표 위에 마우스를 올리면 뜨는 해설 카드 */
function GuideTooltip({
  title,
  guide,
  children,
}: {
  title: string;
  guide: MetricGuide;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <div className="hover:border-foreground/30 hover:bg-muted/40 cursor-help rounded-lg border p-3 transition-colors" />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent
        side="top"
        // 기본 툴팁은 한 줄짜리라 inline-flex + items-center 다. 여러 단락을 넣으려면 풀어줘야 한다
        className="bg-popover text-popover-foreground w-80 max-w-[90vw] flex-col items-stretch space-y-2 p-3 text-left shadow-lg"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold">{title}</span>
          <Badge variant="secondary" className="text-[10px]">
            {guide.level}
          </Badge>
        </div>

        {/* 값 위치 게이지 */}
        <div>
          <div className="bg-muted relative h-1.5 w-full rounded-full">
            <div
              className="border-background bg-foreground absolute top-1/2 size-2.5 -translate-y-1/2 rounded-full border-2"
              style={{ left: `calc(${(guide.position * 100).toFixed(1)}% - 5px)` }}
            />
          </div>
          <div className="text-muted-foreground mt-1 text-[10px]">{guide.scale}</div>
        </div>

        <p className="text-[11px] leading-relaxed">{guide.meaning}</p>
        <p className="text-muted-foreground text-[11px] leading-relaxed">
          <span className="text-foreground font-medium">추세 </span>
          {guide.trend}
        </p>
        <p className="bg-muted/60 rounded p-2 text-[11px] leading-relaxed">
          <span className="font-medium">갈아타기 관점 </span>
          {guide.implication}
        </p>
      </TooltipContent>
    </Tooltip>
  );
}

function MetricBody({
  label,
  value,
  sub,
  compare,
}: {
  label: string;
  value: string;
  sub: ReactNode;
  /** 전월·전분기 대비 — 지표마다 같은 자리에 같은 문법으로 붙인다 */
  compare?: ReactNode;
}) {
  return (
    <>
      <div className="text-muted-foreground flex items-center gap-1 text-xs">
        {label}
        <Info className="size-3 opacity-50" />
      </div>
      <div className="tabular text-lg font-semibold">{value}</div>
      <div className="text-muted-foreground text-[11px]">{sub}</div>
      {compare ? <div className="text-[11px]">{compare}</div> : null}
    </>
  );
}

export function SentimentSection({ sentiment }: { sentiment: MarketSentiment }) {
  const meta = HEAT_META[sentiment.heatLevel];
  const cmp = sentiment.compare;
  const heat = heatScoreGuide(sentiment);
  const sd = supplyDemandGuide(sentiment);
  const nh = newHighGuide(sentiment);
  const vol = volumeGuide(sentiment);
  const mom = priceMomentumGuide(sentiment);

  return (
    <SectionCard
      title="과열 지표 · 매수심리"
      description="매매수급지수·신고가 비중·거래량·가격 모멘텀을 가중 합성한 종합 과열 점수입니다. 각 수치에 마우스를 올리면 해석과 추세를 볼 수 있습니다."
      badge={<Badge style={{ backgroundColor: meta.color, color: 'white' }}>{meta.label}</Badge>}
    >
      <div className="grid gap-6 md:grid-cols-[auto_minmax(0,1fr)]">
        <Tooltip>
          <TooltipTrigger
            render={
              <div className="hover:bg-muted/40 flex cursor-help flex-col items-center rounded-lg p-1 transition-colors" />
            }
          >
            <HeatGauge score={sentiment.heatScore} color={meta.color} />
            {/* 점수 자체보다 "지난달보다 뜨거워졌는가"가 갈아타기 타이밍의 신호다 */}
            <PeriodCompare delta={cmp?.heatScore} digits={1} unit="점" className="text-[11px]" />
            <p className="text-muted-foreground mt-1 flex max-w-44 items-center justify-center gap-1 text-center text-[11px] leading-relaxed">
              {meta.advice}
            </p>
          </TooltipTrigger>
          <TooltipContent
            side="right"
            className="bg-popover text-popover-foreground w-80 max-w-[90vw] flex-col items-stretch space-y-2 p-3 text-left shadow-lg"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold">
                종합 과열 점수 {sentiment.heatScore}/100
              </span>
              <Badge variant="secondary" className="text-[10px]">
                {heat.level}
              </Badge>
            </div>
            <div>
              <div className="via-muted relative h-1.5 w-full rounded-full bg-gradient-to-r from-blue-500/40 to-rose-500/60">
                <div
                  className="border-background bg-foreground absolute top-1/2 size-2.5 -translate-y-1/2 rounded-full border-2"
                  style={{ left: `calc(${(heat.position * 100).toFixed(1)}% - 5px)` }}
                />
              </div>
              <div className="text-muted-foreground mt-1 text-[10px]">{heat.scale}</div>
            </div>
            <p className="text-[11px] leading-relaxed">{heat.meaning}</p>
            <p className="text-muted-foreground text-[11px] leading-relaxed">{heat.trend}</p>
            <p className="bg-muted/60 rounded p-2 text-[11px] leading-relaxed">
              <span className="font-medium">갈아타기 관점 </span>
              {heat.implication}
            </p>
          </TooltipContent>
        </Tooltip>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <GuideTooltip title="매매수급지수" guide={sd}>
              <MetricBody
                label="매매수급지수"
                value={sentiment.supplyDemandIndex.toFixed(1)}
                sub={
                  <>
                    전주 대비 <Delta value={sentiment.supplyDemandChange} digits={1} unit="p" />
                  </>
                }
                compare={<PeriodCompare delta={cmp?.supplyDemandIndex} digits={1} unit="p" />}
              />
            </GuideTooltip>

            <GuideTooltip title="신고가 비중" guide={nh}>
              <MetricBody
                label="신고가 비중"
                value={`${sentiment.newHighRatio.toFixed(1)}%`}
                sub="최근 3개월 거래 중"
                compare={<PeriodCompare delta={cmp?.newHighRatio} digits={1} />}
              />
            </GuideTooltip>

            <GuideTooltip title="월 거래량" guide={vol}>
              <MetricBody
                label="월 거래량"
                value={`${sentiment.monthlyVolume.toLocaleString('ko-KR')}건`}
                sub={
                  <>
                    전년 동월 <Delta value={sentiment.volumeYoy} digits={0} />
                  </>
                }
                compare={<PeriodCompare delta={cmp?.monthlyVolume} digits={1} />}
              />
            </GuideTooltip>

            <GuideTooltip title="주간 가격 변동" guide={mom}>
              <MetricBody
                label="주간 가격 변동"
                value={formatPct(sentiment.weeklyPriceChange, 2)}
                sub="전주 대비"
              />
            </GuideTooltip>
          </div>

          <ul className="bg-muted/30 space-y-1 rounded-lg border p-3">
            {sentiment.notes.map((n, i) => (
              <li
                key={i}
                className="text-muted-foreground flex gap-1.5 text-[11px] leading-relaxed"
              >
                <Info className="mt-0.5 size-3 shrink-0" />
                <span>{n}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </SectionCard>
  );
}
