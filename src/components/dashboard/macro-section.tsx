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
import type { MacroIndicator } from '@/lib/types';
import { formatPct } from '@/lib/format';
import { SectionCard, EmptyHint, Delta, PeriodCompare } from '@/components/ui-bits';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { ExternalLink } from 'lucide-react';

interface Props {
  macro: MacroIndicator[];
}

/** 최근 6개월 추세 — 금리형(%)은 0.05%p, 지수형은 0.5% 이상 움직여야 방향으로 본다 */
function trendOf(m: MacroIndicator): 'up' | 'down' | 'flat' {
  const s = m.series.slice(-7);
  if (s.length < 2) return 'flat';
  const diff = s[s.length - 1].value - s[0].value;
  const threshold = m.unit === '%' ? 0.05 : Math.abs(s[0].value || 1) * 0.005;
  if (diff > threshold) return 'up';
  if (diff < -threshold) return 'down';
  return 'flat';
}

const TREND_LABEL: Record<'up' | 'down' | 'flat', string> = {
  up: '상승세',
  down: '하락세',
  flat: '횡보',
};

interface IndicatorGuide {
  /** 이 지수가 무엇이고 왜 갈아타기 판단에 중요한지 */
  meaning: string;
  /** 추세 방향별 해석 */
  interpret: Record<'up' | 'down' | 'flat', string>;
}

const INDICATOR_GUIDES: Partial<Record<MacroIndicator['key'], IndicatorGuide>> = {
  'base-rate': {
    meaning:
      '한국은행이 결정하는 정책금리로, 모든 대출금리의 바닥을 정합니다. 부동산 수요(매수 여력)에 가장 직접적으로 작용하는 거시 변수입니다.',
    interpret: {
      up: '금리 인상 국면 — 대출 이자 부담이 늘어 매수세가 먼저 위축됩니다. 갈아타기 시 신규 대출 금리도 오르므로 이자 증감 시뮬레이션을 보수적으로 보세요.',
      down: '금리 인하 국면 — 통상 6~12개월 시차를 두고 거래량 회복으로 이어집니다. 갭이 벌어지기 전 갈아타기를 검토할 타이밍 신호 중 하나입니다.',
      flat: '동결 기조 — 금리 자체보다 대출 규제(스트레스 DSR, 총액 한도)가 매수 여력을 좌우하는 구간입니다.',
    },
  },
  'mortgage-rate': {
    meaning:
      '예금은행이 신규 취급한 주택담보대출의 가중평균 금리입니다. 매수자가 실제로 체감하는 금리라 기준금리보다 시장에 먼저 반영됩니다.',
    interpret: {
      up: '실질 대출 부담 증가 — 같은 한도라도 월 상환액이 늘어 매수세가 약해집니다. 시뮬레이션의 신규 대출 금리를 최신 값으로 올려 확인하세요.',
      down: '대출 부담 완화 — 매수세 회복에 선행하는 경우가 많습니다. 갈아타기의 연 이자 증감이 유리해지는 방향입니다.',
      flat: '금리 안정 구간 — 대출 조건 변화보다 매물·수급이 가격을 움직입니다.',
    },
  },
  cpi: {
    meaning:
      '소비자물가지수. 물가가 목표(2%)를 웃돌면 한국은행이 금리를 내리기 어려워, 부동산에는 간접적인 긴축 요인이 됩니다.',
    interpret: {
      up: '물가 오름세 — 금리 인하가 지연될 가능성이 커집니다. 저금리 기대에 기댄 매수 전략은 위험합니다.',
      down: '물가 안정세 — 금리 인하 명분이 쌓이는 구간으로, 중기적으로 부동산 수요에 우호적입니다.',
      flat: '물가 횡보 — 금리 경로에 대한 불확실성이 유지됩니다.',
    },
  },
  m2: {
    meaning:
      '광의통화(M2) — 시중에 풀린 유동성 총량입니다. 역사적으로 서울 아파트 가격은 유동성 증가율과 동행성이 높았습니다.',
    interpret: {
      up: '유동성 확대 — 자산가격 상방 압력이 커집니다. 상급지일수록 유동성 장세의 수혜가 커서 갭이 벌어지기 쉽습니다.',
      down: '유동성 둔화 — 가격 상승 동력이 약해지는 구간입니다. 조정 시나리오의 실현 가능성이 상대적으로 높아집니다.',
      flat: '유동성 중립 — 통화량보다 규제·심리가 가격을 좌우합니다.',
    },
  },
  'net-migration': {
    meaning:
      '전입에서 전출을 뺀 순이동 인구입니다. 플러스면 사람이 들어오는 지역이라 실수요가 늘고, 마이너스면 빠져나가는 지역입니다.',
    interpret: {
      up: '인구 유입 확대 — 실수요 기반이 두터워져 가격 하방이 단단해집니다.',
      down: '인구 유출 — 중장기 수요 기반이 약해지는 신호입니다. 다만 서울은 고가화로 인한 경기 유출이 많아 가격 약세와 직결되지는 않습니다.',
      flat: '인구 이동 안정 — 수급에 중립적입니다.',
    },
  },
  'reb-apt-sale-index': {
    meaning:
      '한국부동산원 아파트 매매가격지수(전국). 호가·심리가 아닌 조사 기반 공표 통계로, 시장 방향의 공식 기준선입니다.',
    interpret: {
      up: '매매가 상승 국면 — 기다릴수록 상급지 갭이 벌어집니다. 갈아타기는 상승 초입일수록 유리합니다.',
      down: '매매가 조정 국면 — 상급지 절대 낙폭이 커서 갭이 줄어듭니다. 시뮬레이션의 조정 시나리오와 맞춰 보세요.',
      flat: '가격 보합 — 거래량과 심리 지표에서 방향 단서를 찾아야 하는 구간입니다.',
    },
  },
  'reb-apt-jeonse-index': {
    meaning:
      '아파트 전세가격지수. 전세가는 실사용 가치의 대리 지표로, 전세가 오르면 매매 전환 수요가 늘고 갭투자 부담이 줄어 매매가를 밀어 올리는 경향이 있습니다.',
    interpret: {
      up: '전세가 상승 — 매매가의 선행 지표로 작동하는 경우가 많습니다. 전세 낀 매물의 갭이 줄어 매수 수요가 유입됩니다.',
      down: '전세가 하락 — 역전세 위험이 커지고 매매 수요 전환도 약해집니다.',
      flat: '전세가 보합 — 매매·전세 모두 관망세인 구간입니다.',
    },
  },
  'reb-apt-rt-index': {
    meaning:
      '아파트 실거래가격지수. 실제 신고된 계약만으로 만든 지수라 호가 거품 없이 체결 가격의 방향을 보여줍니다. 조사 기반 지수보다 변동이 빠르고 큽니다.',
    interpret: {
      up: '실거래가 상승 — 실제 체결 가격이 오르고 있다는 뜻으로, 조사 지수보다 먼저 움직입니다.',
      down: '실거래가 하락 — 체결 기준으로 조정이 진행 중입니다. 급매 위주 체결일 수 있으니 거래량과 함께 보세요.',
      flat: '실거래가 보합 — 매도·매수 호가 간극이 유지되는 구간입니다.',
    },
  },
  'reb-unsold': {
    meaning:
      '전국 미분양 주택 수. 공급 부담의 대표 지표로, 미분양이 쌓이면 신축부터 가격이 눌리고 해소되면 공급 부족 신호입니다.',
    interpret: {
      up: '미분양 증가 — 공급 부담이 커져 가격 하방 압력으로 작동합니다. 다만 서울 핵심지는 미분양 영향이 제한적입니다.',
      down: '미분양 감소 — 공급이 소화되고 있다는 뜻으로, 이후 공급 부족 국면의 전조가 되기도 합니다.',
      flat: '미분양 정체 — 공급 변수는 중립입니다.',
    },
  },
  'reb-consumer-sentiment': {
    meaning:
      '부동산시장 소비심리지수. 100을 넘으면 가격 상승 기대가 우세, 100 미만이면 하락 기대가 우세하다는 뜻의 설문 기반 심리 지표입니다.',
    interpret: {
      up: '심리 개선 — 매수 대기 수요가 시장에 들어올 준비를 하는 구간입니다. 거래량 회복이 뒤따르는지 확인하세요.',
      down: '심리 위축 — 관망세가 짙어져 거래량부터 줄어듭니다. 급하지 않다면 매수를 서두를 이유가 약한 구간입니다.',
      flat: '심리 중립 — 관망 속 실수요 위주로 거래되는 구간입니다.',
    },
  },
};

/** 지표 조합으로 한 줄 해설을 만든다 */
function buildCommentary(macro: MacroIndicator[]): string[] {
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

  // 과열점수·신고가·거래량은 ⑥ 과열 지표 카드가 이미 보여준다 — 여기서 반복하지 않는다
  return notes;
}

export function MacroSection({ macro }: Props) {
  const [selected, setSelected] = useState(0);

  if (macro.length === 0) {
    return (
      <SectionCard
        title="주요 지수 · 분석 브리핑"
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
  const commentary = buildCommentary(macro);
  const guide = INDICATOR_GUIDES[active.key];
  const trend = trendOf(active);

  return (
    <SectionCard
      title="주요 지수 · 분석 브리핑"
      description="한국은행 ECOS 원본 시계열. 지표를 클릭하면 차트와 함께 그 지수의 의미·추세 해석이 아래에 표시됩니다."
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
                  {/* 금리형(%) 지표의 전년비는 %p 차이 — 비율이 아니다 */}
                  전년비{' '}
                  <Delta
                    value={m.yoy}
                    digits={m.unit === '%' ? 2 : 1}
                    suffix={m.unit === '%' ? 'p' : ''}
                  />
                </>
              ) : null}
            </div>
            {/* 전년비만으로는 최근 몇 달 사이의 방향 전환이 보이지 않는다 */}
            <PeriodCompare
              delta={m.compare}
              digits={m.unit === '%' ? 2 : 1}
              className="text-[11px]"
            />
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

      {guide ? (
        <div className="mt-3 rounded-lg border p-4">
          <div className="mb-1.5 flex items-center gap-2">
            <h4 className="text-sm font-semibold">{active.label}이란?</h4>
            <Badge variant="secondary" className="font-normal">
              최근 6개월 {TREND_LABEL[trend]}
            </Badge>
          </div>
          <p className="text-muted-foreground text-xs leading-relaxed">{guide.meaning}</p>
          <p className="mt-2 text-xs leading-relaxed">
            <span className="font-medium">추세 해석</span> — {guide.interpret[trend]}
          </p>
        </div>
      ) : null}

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
