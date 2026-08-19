'use client';

import { useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { MacroIndicator, MarketSentiment } from '@/lib/types';
import { formatPct } from '@/lib/format';
import { SectionCard, EmptyHint, Delta } from '@/components/ui-bits';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { ExternalLink } from 'lucide-react';

interface Props {
  macro: MacroIndicator[];
  sentiment: MarketSentiment;
}

/** 지표 조합으로 한 줄 해설을 만든다 */
function buildCommentary(macro: MacroIndicator[], sentiment: MarketSentiment): string[] {
  const notes: string[] = [];
  const find = (k: MacroIndicator['key']) => macro.find((m) => m.key === k);

  const base = find('base-rate');
  const mortgage = find('mortgage-rate');
  const cpi = find('cpi');
  const m2 = find('m2');

  if (base) {
    const dir = base.change > 0 ? '인상' : base.change < 0 ? '인하' : '동결';
    notes.push(
      `기준금리 ${base.latest}% (${base.latestPeriod}, 직전 대비 ${dir}). ` +
        (base.change < 0
          ? '금리 하락 국면은 통상 6~12개월 시차를 두고 거래량 회복으로 이어집니다.'
          : base.change > 0
            ? '금리 상승은 매수 여력을 직접 깎아 거래량부터 위축시킵니다.'
            : '동결 기조에서는 금리보다 대출 규제(DSR)가 더 큰 변수입니다.'),
    );
  }

  if (mortgage && base) {
    const spread = mortgage.latest - base.latest;
    notes.push(
      `주담대 금리 ${mortgage.latest}% — 기준금리와의 스프레드 ${spread.toFixed(2)}%p. ` +
        (spread > 1.5
          ? '스프레드가 넓어 기준금리 인하가 실제 대출금리로 잘 전달되지 않는 구간입니다.'
          : '스프레드가 좁아 기준금리 변화가 대출금리에 비교적 빠르게 반영됩니다.'),
    );
  }

  if (cpi?.yoy !== undefined) {
    notes.push(
      `소비자물가 전년 대비 ${formatPct(cpi.yoy, 1)}. ` +
        (cpi.yoy > 2.5
          ? '목표(2%) 상회 구간이라 금리 인하 여력이 제한적입니다.'
          : '물가가 목표 부근으로 안정되어 금리 인하 명분이 쌓이는 구간입니다.'),
    );
  }

  if (m2?.yoy !== undefined) {
    notes.push(
      `M2 증가율 ${formatPct(m2.yoy, 1)}. ` +
        (m2.yoy > 6
          ? '유동성이 빠르게 늘고 있어 자산가격 상방 압력이 큽니다.'
          : m2.yoy < 3
            ? '유동성 증가세가 둔화돼 가격 상승 동력이 약합니다.'
            : '유동성 증가율은 중립 수준입니다.'),
    );
  }

  notes.push(
    `현재 시장은 과열점수 ${sentiment.heatScore}/100 구간이며, ` +
      `신고가 비중 ${sentiment.newHighRatio.toFixed(1)}%, 거래량은 전년 동월 대비 ${formatPct(sentiment.volumeYoy, 0)} 입니다.`,
  );

  return notes;
}

export function MacroSection({ macro, sentiment }: Props) {
  const [selected, setSelected] = useState(0);

  if (macro.length === 0) {
    return (
      <SectionCard
        title="⑧ 주요 지수 · 분석 브리핑"
        description="기준금리·물가지수·M2·주택담보대출금리 (한국은행 ECOS)"
      >
        <EmptyHint>
          ECOS_API_KEY 가 설정되지 않았거나 조회에 실패했습니다.
          <br />
          <a
            className="underline"
            href="https://ecos.bok.or.kr/api/#/AuthKeyApply"
            target="_blank"
            rel="noreferrer"
          >
            한국은행 ECOS 인증키 신청
          </a>{' '}
          후 환경변수에 추가하세요.
        </EmptyHint>
      </SectionCard>
    );
  }

  const active = macro[Math.min(selected, macro.length - 1)];
  const chartData = active.series.slice(-60);
  const commentary = buildCommentary(macro, sentiment);

  return (
    <SectionCard
      title="⑧ 주요 지수 · 분석 브리핑"
      description="한국은행 ECOS 원본 시계열. 지표를 클릭하면 차트가 바뀝니다."
      badge={<Badge variant="secondary">{macro.length}개 지표</Badge>}
    >
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {macro.map((m, i) => (
          <button
            key={m.key}
            type="button"
            onClick={() => setSelected(i)}
            className={cn(
              'hover:bg-muted/50 rounded-lg border p-3 text-left transition-colors',
              i === selected && 'border-foreground/40 bg-muted/60',
            )}
          >
            <div className="text-muted-foreground truncate text-xs">{m.label}</div>
            <div className="tabular text-lg font-semibold">
              {m.latest.toLocaleString('ko-KR', { maximumFractionDigits: 2 })}
              <span className="text-muted-foreground ml-1 text-xs font-normal">
                {m.unit === '%' ? '%' : ''}
              </span>
            </div>
            <div className="text-muted-foreground flex items-center gap-2 text-[11px]">
              <span>{m.latestPeriod}</span>
              {m.yoy !== undefined ? (
                <>
                  YoY <Delta value={m.yoy} digits={1} />
                </>
              ) : null}
            </div>
          </button>
        ))}
      </div>

      <div className="mt-4 h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis
              dataKey="period"
              tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }}
              tickLine={false}
              axisLine={false}
              minTickGap={40}
            />
            <YAxis
              tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }}
              tickLine={false}
              axisLine={false}
              width={52}
              domain={['auto', 'auto']}
              tickFormatter={(v: number) => v.toLocaleString('ko-KR', { maximumFractionDigits: 1 })}
            />
            <Tooltip
              contentStyle={{
                background: 'var(--popover)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                fontSize: 12,
                color: 'var(--popover-foreground)',
              }}
              formatter={(v) => [
                `${Number(v).toLocaleString('ko-KR', { maximumFractionDigits: 2 })} ${active.unit === '%' ? '%' : ''}`,
                active.label,
              ]}
            />
            <Line
              type="monotone"
              dataKey="value"
              stroke="var(--rise)"
              strokeWidth={2}
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-1 flex justify-end">
        <a
          href={active.sourceUrl}
          target="_blank"
          rel="noreferrer"
          className="text-muted-foreground flex items-center gap-1 text-[11px] hover:underline"
        >
          {active.source} 원본 <ExternalLink className="size-3" />
        </a>
      </div>

      <div className="bg-muted/30 mt-3 rounded-lg border p-4">
        <h4 className="mb-2 text-sm font-semibold">분석 브리핑</h4>
        <ul className="space-y-1.5">
          {commentary.map((c, i) => (
            <li key={i} className="text-muted-foreground text-xs leading-relaxed">
              • {c}
            </li>
          ))}
        </ul>
      </div>
    </SectionCard>
  );
}
