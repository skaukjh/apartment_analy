/**
 * 주요 일정의 결과별 부동산 시장 방향 예측.
 *
 * 이 엔진은 "맞히는" 도구가 아니라 "경우의 수를 정리하는" 도구다.
 * 각 이벤트에 대해 가능한 결과 시나리오를 두고, 그 결과가 부동산 가격에
 * 어떤 경로로 얼마나 걸려 전달되는지를 보여준다.
 * 확률은 현재 거시지표·시장 온도를 규칙에 넣어 계산한 대략적인 가늠이며,
 * 예측이 아니라 "지금 지표 조합이 어느 쪽에 기울어 있는가"의 표현이다.
 */

import type {
  EventOutlook,
  MacroIndicator,
  MarketSentiment,
  OutlookScenario,
  ScheduleEvent,
} from '@/lib/types';
import { formatPct } from '@/lib/format';
import type { SpreadSummary } from './rebound';

export interface OutlookContext {
  macro: MacroIndicator[];
  sentiment: MarketSentiment;
  spread: SpreadSummary;
}

function macroOf(context: OutlookContext, key: MacroIndicator['key']) {
  return context.macro.find((m) => m.key === key);
}

/** 확률 합이 100이 되도록 정규화 */
function normalize(scenarios: OutlookScenario[]): OutlookScenario[] {
  const total = scenarios.reduce((s, x) => s + x.probability, 0);
  if (total <= 0) return scenarios;
  const scaled = scenarios.map((s) => ({
    ...s,
    probability: Math.round((s.probability / total) * 100),
  }));
  // 반올림 오차를 가장 큰 항목에 흡수
  const diff = 100 - scaled.reduce((s, x) => s + x.probability, 0);
  if (diff !== 0) {
    const idx = scaled.reduce(
      (best, x, i) => (x.probability > scaled[best].probability ? i : best),
      0,
    );
    scaled[idx] = { ...scaled[idx], probability: scaled[idx].probability + diff };
  }
  return scaled;
}

/* ------------------------------------------------------------------ */
/* 이벤트별 시나리오                                                     */
/* ------------------------------------------------------------------ */

function mpcOutlook(event: ScheduleEvent, ctx: OutlookContext): EventOutlook {
  const base = macroOf(ctx, 'base-rate');
  const cpi = macroOf(ctx, 'cpi');
  const mortgage = macroOf(ctx, 'mortgage-rate');

  const cpiYoy = cpi?.yoy;
  const recentCut = (base?.change ?? 0) < 0;

  // 물가가 목표(2%) 아래일수록 인하 쪽으로, 시장이 과열일수록 동결·인상 쪽으로 기운다
  let cut = 30;
  let hold = 55;
  let hike = 15;

  const basis: string[] = [];

  if (cpiYoy !== undefined) {
    if (cpiYoy < 2.0) {
      cut += 20;
      hike -= 8;
      basis.push(`소비자물가 상승률 ${formatPct(cpiYoy, 1)} — 목표(2%) 하회로 인하 명분이 큽니다.`);
    } else if (cpiYoy > 2.8) {
      cut -= 15;
      hike += 12;
      basis.push(
        `소비자물가 상승률 ${formatPct(cpiYoy, 1)} — 목표를 크게 웃돌아 인하 여력이 제한적입니다.`,
      );
    } else {
      basis.push(
        `소비자물가 상승률 ${formatPct(cpiYoy, 1)} — 목표 부근으로 방향성이 뚜렷하지 않습니다.`,
      );
    }
  } else {
    basis.push('소비자물가 데이터를 불러오지 못해 중립 가정으로 계산했습니다.');
  }

  if (ctx.sentiment.heatScore >= 70) {
    cut -= 12;
    hold += 6;
    hike += 6;
    basis.push(
      `주택시장 과열점수 ${ctx.sentiment.heatScore}/100 — 집값 자극 우려로 금리 인하에 신중해집니다.`,
    );
  } else if (ctx.sentiment.heatScore <= 35) {
    cut += 10;
    basis.push(
      `주택시장 과열점수 ${ctx.sentiment.heatScore}/100 — 자산시장 부담이 낮아 인하 제약이 적습니다.`,
    );
  }

  if (recentCut) {
    hold += 12;
    basis.push(
      '직전 회의에서 이미 인하했습니다. 연속 인하보다 효과를 지켜보는 동결이 일반적입니다.',
    );
  }

  if (base) {
    basis.push(`현재 기준금리 ${base.latest}% (${base.latestPeriod} 기준).`);
  }
  if (mortgage && base) {
    basis.push(
      `주담대 금리 ${mortgage.latest}%, 기준금리와의 스프레드 ${(mortgage.latest - base.latest).toFixed(2)}%p.`,
    );
  }

  const scenarios: OutlookScenario[] = normalize([
    {
      label: '기준금리 인하 (-0.25%p)',
      probability: Math.max(5, cut),
      direction: 'up',
      magnitude: 'strong',
      lag: '3~6개월 (거래량) / 6~12개월 (가격)',
      transmission: [
        '기준금리 인하 → 은행 조달금리 하락',
        '주택담보대출 금리 하락 → 같은 소득으로 빌릴 수 있는 금액 증가',
        'DSR 한도 여유 확대 → 관망하던 실수요 매수 전환',
        '거래량 먼저 늘고, 2~3개 분기 뒤 가격에 반영',
      ],
      mostAffected:
        '대출 의존도가 높은 중저가 아파트와 수도권 외곽. 상급지는 이미 선반영되는 경우가 많습니다.',
      action:
        '갈아타기 대상이 상급지라면 인하 사이클 초입이 갭이 가장 좁은 구간입니다. 인하가 확인되면 갭은 다시 벌어지기 시작합니다.',
    },
    {
      label: '동결',
      probability: Math.max(10, hold),
      direction: 'flat',
      magnitude: 'weak',
      lag: '즉시 (기대 조정)',
      transmission: [
        '기준금리 동결 → 대출금리 큰 변화 없음',
        '시장의 관심이 금리에서 대출 규제(DSR·LTV)와 공급 대책으로 이동',
        '가격은 지역별 수급에 따라 차별화',
      ],
      mostAffected: '방향성보다 개별 단지 호재·공급 여건이 가격을 가르는 구간이 됩니다.',
      action:
        '거시 변수보다 확산 지도의 지역별 모멘텀과 관심 지역 호재 진행 상황을 우선해서 보세요.',
    },
    {
      label: '기준금리 인상 (+0.25%p)',
      probability: Math.max(2, hike),
      direction: 'down',
      magnitude: 'strong',
      lag: '1~3개월 (거래량) / 6개월 이상 (가격)',
      transmission: [
        '기준금리 인상 → 주담대 금리 상승',
        '월 상환액 증가 → 매수 여력 감소, 관망세 확대',
        '거래량 급감 → 급매 위주 시장으로 전환',
        '보유 부담이 큰 다주택·갭투자 물건부터 매물 증가',
      ],
      mostAffected: '고가 대출을 낀 물건과 전세가율이 낮은 지역이 먼저 흔들립니다.',
      action:
        '하락장 시뮬레이션의 "본격 하락" 이상 시나리오를 기준으로 자금 계획을 다시 확인하세요. 다만 내 집이 안 팔릴 위험도 함께 커집니다.',
    },
  ]);

  return {
    event,
    why: '기준금리는 주택담보대출 금리와 DSR 한도를 통해 매수 여력을 직접 바꾸는 변수입니다. 부동산 가격에 가장 강하게, 그러나 가장 느리게 전달됩니다.',
    scenarios,
    basis,
    watchNext: [
      '금통위 의결문의 "성장·물가 전망" 문구 변화와 소수의견 수',
      '발표 다음 주 은행권 주택담보대출 금리 고시 변화',
      '한국부동산원 주간 매매수급동향지수 (심리는 금리보다 빨리 움직입니다)',
      '월간 아파트 매매 거래량 (가격보다 먼저 반응)',
    ],
  };
}

function fomcOutlook(event: ScheduleEvent, ctx: OutlookContext): EventOutlook {
  const base = macroOf(ctx, 'base-rate');
  return {
    event,
    why: 'FOMC는 국내 부동산에 직접 작용하지 않지만, 한미 금리차 → 환율 → 수입물가 → 한국은행의 금리 운신 폭이라는 경로로 한 단계 건너 영향을 줍니다.',
    scenarios: normalize([
      {
        label: '미국 금리 인하',
        probability: 35,
        direction: 'up',
        magnitude: 'moderate',
        lag: '1~2개 분기',
        transmission: [
          '미 연준 인하 → 한미 금리차 축소',
          '원화 강세 압력 → 수입물가 안정',
          '한국은행의 인하 운신 폭 확대',
          '다음 금통위 인하 기대 → 시장금리 선반영',
        ],
        mostAffected: '국내 금리 기대에 민감한 재건축·고가 아파트가 먼저 반응합니다.',
        action: '국내 금통위 인하 기대가 커지는 구간이므로 갈아타기 실행을 앞당길지 검토하세요.',
      },
      {
        label: '동결',
        probability: 45,
        direction: 'flat',
        magnitude: 'weak',
        lag: '-',
        transmission: [
          '금리차 유지 → 환율·시장금리 큰 변화 없음',
          '국내 변수(대출규제·공급)가 주도',
        ],
        mostAffected: '국내 요인이 지배하는 구간입니다.',
        action: '국내 대출 규제와 지역별 수급에 집중하세요.',
      },
      {
        label: '미국 금리 인상 또는 매파적 신호',
        probability: 20,
        direction: 'down',
        magnitude: 'moderate',
        lag: '1~2개 분기',
        transmission: [
          '한미 금리차 확대 → 원화 약세',
          '수입물가 상승 → 국내 물가 부담',
          '한국은행 인하 지연 → 대출금리 하락 기대 후퇴',
          '매수 심리 위축',
        ],
        mostAffected: '대출 레버리지가 큰 매수 대기 수요가 위축됩니다.',
        action: '금리 인하를 전제로 세운 자금 계획이 있다면 보수적으로 다시 점검하세요.',
      },
    ]),
    basis: [
      base ? `국내 기준금리 ${base.latest}% (${base.latestPeriod}).` : '국내 기준금리 데이터 없음.',
      '확률은 일반적인 회의 결과 분포를 기준으로 한 기본값이며, 연준 점도표와 선물시장 반영률로 조정해 보세요.',
    ],
    watchNext: [
      '점도표(dot plot)의 연내 인하 횟수 전망',
      '원/달러 환율 (1,400원 부근은 한국은행 인하에 부담)',
      '국고채 3년물 금리 — 주담대 고정금리의 기준',
    ],
  };
}

function cpiOutlook(event: ScheduleEvent, ctx: OutlookContext): EventOutlook {
  const cpi = macroOf(ctx, 'cpi');
  const yoy = cpi?.yoy;

  let cool = 35;
  const inline = 45;
  let hot = 20;
  if (yoy !== undefined) {
    if (yoy < 2.0) {
      cool += 15;
      hot -= 8;
    } else if (yoy > 2.8) {
      cool -= 12;
      hot += 15;
    }
  }

  return {
    event,
    why: '소비자물가는 한국은행이 금리를 내릴 수 있는 "명분"을 결정합니다. 부동산에 직접 작용하지는 않지만, 금리 경로의 첫 단추입니다.',
    scenarios: normalize([
      {
        label: '물가 상승률 둔화 (2% 미만)',
        probability: Math.max(5, cool),
        direction: 'up',
        magnitude: 'moderate',
        lag: '다음 금통위까지 1~2개월',
        transmission: [
          '물가 둔화 확인 → 금리 인하 명분 확보',
          '채권금리 선반영 하락 → 주담대 고정금리 하락',
          '매수 여력 개선 기대 → 관망 수요의 매수 전환',
        ],
        mostAffected: '금리 민감도가 높은 중저가·대출 의존 매수층.',
        action:
          '인하 기대가 반영되기 시작하면 상급지 갭이 벌어집니다. 갈아타기 실행 시점을 앞당길 근거가 됩니다.',
      },
      {
        label: '예상 부합 (2%대 초중반)',
        probability: Math.max(10, inline),
        direction: 'flat',
        magnitude: 'weak',
        lag: '-',
        transmission: ['금리 경로에 변화 없음', '부동산은 수급·규제 요인이 계속 주도'],
        mostAffected: '별다른 방향 전환 없이 지역별 차별화가 이어집니다.',
        action: '거시보다 확산 지도와 관심 지역 호재를 중심으로 판단하세요.',
      },
      {
        label: '물가 재상승 (3% 이상)',
        probability: Math.max(3, hot),
        direction: 'down',
        magnitude: 'moderate',
        lag: '1~2개월',
        transmission: [
          '물가 반등 → 금리 인하 지연 또는 인상 논의',
          '시장금리 상승 → 주담대 금리 반등',
          '매수 대기 수요 이탈, 거래량 위축',
        ],
        mostAffected: '인하를 전제로 대출 계획을 세운 매수 대기층.',
        action:
          '대출 실행 시점을 늦추기 어려운 계약이라면 금리 상승 여지를 감안해 한도를 보수적으로 잡으세요.',
      },
    ]),
    basis: [
      yoy !== undefined
        ? `직전 소비자물가 전년 대비 ${formatPct(yoy, 1)} (${cpi?.latestPeriod}).`
        : '소비자물가 데이터를 불러오지 못했습니다.',
      '농산물·석유류 변동이 큰 달은 근원물가(식료품·에너지 제외)를 함께 봐야 방향이 보입니다.',
    ],
    watchNext: [
      '근원물가(식료품·에너지 제외) 상승률',
      '한국은행 총재 발언 톤 변화',
      '국고채 3년물 금리 반응',
    ],
  };
}

function rebOutlook(event: ScheduleEvent, ctx: OutlookContext, weekly: boolean): EventOutlook {
  const sd = ctx.sentiment.supplyDemandIndex;
  const rising = ctx.sentiment.weeklyPriceChange > 0;

  let expand = rising ? 45 : 25;
  const steady = 40;
  let shrink = rising ? 25 : 45;
  if (sd > 100) expand += 10;
  if (sd < 90) shrink += 10;

  return {
    event,
    why: `${weekly ? '주간' : '월간'} 가격동향은 시장의 현재 상태를 확인하는 지표입니다. 미래를 바꾸지는 않지만, 확산 국면이 이어지는지 꺾이는지를 가장 빨리 알려줍니다.`,
    scenarios: normalize([
      {
        label: '상승폭 확대 · 상승 지역 수 증가',
        probability: expand,
        direction: 'up',
        magnitude: 'moderate',
        lag: '즉시 (심리 반영)',
        transmission: [
          '상승 지역 수 증가 → 언론 보도 증가',
          '"지금 안 사면 늦는다" 심리 → 매도 호가 상향',
          '상급지에서 인접 지역으로 물결 확산',
        ],
        mostAffected: '확산 지도에서 "후행"으로 분류된 지역이 다음 차례가 됩니다.',
        action:
          '갈아타기 대상 상급지가 이미 "선도" 단계라면 갭은 계속 벌어집니다. 실행을 미룰수록 불리해집니다.',
      },
      {
        label: '보합 · 혼조',
        probability: steady,
        direction: 'flat',
        magnitude: 'weak',
        lag: '-',
        transmission: ['지역별 방향이 엇갈림', '개별 단지 재료가 가격을 가름'],
        mostAffected: '전체 방향보다 단지별 편차가 커집니다.',
        action: '관심 단지의 실거래를 개별로 추적하세요. 지수 평균은 의미가 줄어듭니다.',
      },
      {
        label: '상승폭 축소 또는 하락 전환',
        probability: shrink,
        direction: 'down',
        magnitude: 'moderate',
        lag: '즉시 (심리) / 1~2개월 (거래량)',
        transmission: [
          '상승폭 축소 → 매수 관망 확대',
          '호가와 실거래가 벌어짐 → 거래량 감소',
          '급매 위주로 가격대 형성',
        ],
        mostAffected: '최근 급등했던 지역이 되돌림 폭도 큽니다.',
        action:
          '상급지 급매가 나오기 시작하는 구간입니다. 하락장 시뮬레이션의 손익분기 하락률을 확인해 대기 여부를 정하세요.',
      },
    ]),
    basis: [
      `현재 매매수급지수 ${sd.toFixed(1)} (100 초과 = 매수우위).`,
      `최근 주간 가격 변동 ${formatPct(ctx.sentiment.weeklyPriceChange, 2)}.`,
      `상승 확산률 ${ctx.spread.spreadRate.toFixed(0)}% — 선도 ${ctx.spread.leading.length}곳, 확산 ${ctx.spread.spreading.length}곳, 미반등 ${ctx.spread.noRebound.length}곳.`,
    ],
    watchNext: [
      '매매수급동향지수가 100을 넘는지 (매수우위 전환 신호)',
      '상승 지역 수 대비 하락 지역 수의 비율',
      '전세가격지수 — 전세가 오르면 매매 전환 압력이 커집니다',
    ],
  };
}

function taxBaseDateOutlook(event: ScheduleEvent): EventOutlook {
  return {
    event,
    why: '6월 1일 소유자에게 그 해 재산세와 종합부동산세가 전부 부과됩니다. 하루 차이로 수백만 원이 갈리기 때문에 매년 5월 말 거래에 뚜렷한 왜곡이 생깁니다.',
    scenarios: normalize([
      {
        label: '5월 말 잔금 집중 (매도자 서두름)',
        probability: 70,
        direction: 'down',
        magnitude: 'weak',
        lag: '5월 하순 ~ 6월 초',
        transmission: [
          '매도자는 보유세를 피하려 5월 31일까지 잔금을 받으려 함',
          '잔금일 압박 → 일부 매도자가 가격을 양보',
          '6월 초에는 급할 이유가 사라져 호가가 되돌아옴',
        ],
        mostAffected: '보유세 부담이 큰 고가 주택과 다주택자 물건.',
        action:
          '매수자라면 5월 하순이 협상력이 가장 좋은 구간입니다. 반대로 매도자라면 6월 1일을 넘기면 그 해 보유세를 부담합니다.',
      },
      {
        label: '거래 위축 (매수자도 6월 이후 선호)',
        probability: 30,
        direction: 'flat',
        magnitude: 'weak',
        lag: '5월 ~ 6월',
        transmission: [
          '매수자도 6월 1일 이후 잔금을 원함',
          '양측 희망 잔금일이 엇갈려 계약 자체가 지연',
          '6월 거래량이 5월보다 늘어남',
        ],
        mostAffected: '잔금일 협의가 까다로운 거래 전반.',
        action: '갈아타기처럼 매도·매수가 연결된 거래는 잔금일 순서를 미리 설계해 두세요.',
      },
    ]),
    basis: [
      '재산세·종부세 모두 6월 1일 현재 소유자에게 부과됩니다 (지방세법 제114조, 종부세법 제3조).',
      '잔금일과 등기접수일 중 빠른 날이 취득일로 인정됩니다.',
    ],
    watchNext: [
      '5월 마지막 주 거래 신고 건수 (매년 급증)',
      '6월 첫 주 호가 회복 여부',
      '보유세 개편 논의 (공정시장가액비율·세율)',
    ],
  };
}

function officialPriceOutlook(event: ScheduleEvent, ctx: OutlookContext): EventOutlook {
  const rising = ctx.spread.spreadRate > 50;
  return {
    event,
    why: '공동주택 공시가격은 재산세·종부세·건강보험료의 과세표준입니다. 시세를 따라 움직이므로, 작년 시세 상승분이 올해 보유세 고지서로 돌아옵니다.',
    scenarios: normalize([
      {
        label: '공시가격 상승',
        probability: rising ? 60 : 35,
        direction: 'down',
        magnitude: 'weak',
        lag: '7월·9월(재산세), 12월(종부세)',
        transmission: [
          '공시가격 상승 → 재산세·종부세 과세표준 상승',
          '보유 부담 증가 → 다주택자 일부 매도 전환',
          '종부세 기준선 부근 물건에서 매물 증가',
        ],
        mostAffected: '공시가 9억(1주택 12억) 언저리 물건. 기준선을 넘는 순간 부담이 급증합니다.',
        action:
          '보유 아파트 공시가격을 확인하고 종부세 기준선 초과 여부를 점검하세요. 초과한다면 매도 시점 설계에 반영해야 합니다.',
      },
      {
        label: '공시가격 하락 또는 동결',
        probability: rising ? 40 : 65,
        direction: 'up',
        magnitude: 'weak',
        lag: '보유세 고지 시점',
        transmission: [
          '과세표준 하락 → 보유세 부담 완화',
          '버티기 여력 증가 → 급매 감소',
          '매물 잠김 → 거래량 감소, 호가 유지',
        ],
        mostAffected: '보유세 부담으로 매도를 고민하던 다주택자.',
        action:
          '급매가 줄어드는 구간이라 매수 협상력이 약해집니다. 서두를 이유는 없지만 기대치는 낮추세요.',
      },
    ]),
    basis: [
      `상승 확산률 ${ctx.spread.spreadRate.toFixed(0)}% — 공시가격은 전년도 시세를 반영합니다.`,
      '공시가격 현실화율 로드맵은 정책에 따라 변경돼 왔으므로 발표 시 확인이 필요합니다.',
    ],
    watchNext: [
      '공시가격 현실화율 적용 방침',
      '공정시장가액비율 (재산세 43~45%, 종부세 60% 등 시행령으로 조정)',
      '1주택자 특례 기준선 (현행 12억)',
    ],
  };
}

function taxPaymentOutlook(event: ScheduleEvent, comprehensive: boolean): EventOutlook {
  return {
    event,
    why: comprehensive
      ? '종합부동산세 고지서는 다주택자의 보유 의사를 시험하는 시점입니다. 매년 12월 전후로 매물이 늘어나는 계절성이 있습니다.'
      : '재산세는 종부세보다 부담이 작아 시장 영향은 제한적이지만, 보유 비용을 체감하게 만드는 시점입니다.',
    scenarios: normalize([
      {
        label: comprehensive ? '고지세액 증가 → 매물 증가' : '부담 체감 → 관망 지속',
        probability: comprehensive ? 55 : 60,
        direction: 'down',
        magnitude: comprehensive ? 'moderate' : 'weak',
        lag: comprehensive ? '12월 ~ 다음 해 1분기' : '즉시',
        transmission: comprehensive
          ? [
              '고지세액 증가 → 현금 부담 확인',
              '다주택자 일부가 절세 매도로 전환 (다음 해 6월 1일 전 처분 목표)',
              '연말~1분기 매물 증가 → 급매 출현',
            ]
          : ['보유세 납부 → 현금 유출 체감', '거래 결정에 소극적, 관망 지속'],
        mostAffected: comprehensive
          ? '합산 공시가격이 기준선을 넘는 다주택자와 고가 1주택자.'
          : '보유세 부담이 큰 고가 주택 보유자.',
        action: comprehensive
          ? '연말~1분기는 상급지 급매가 나오는 계절 구간입니다. 갈아타기 매수 타이밍으로 관찰할 만합니다.'
          : '시장 방향보다 개별 물건 협상에 집중하세요.',
      },
      {
        label: '세부담 완화 · 영향 제한적',
        probability: comprehensive ? 45 : 40,
        direction: 'flat',
        magnitude: 'weak',
        lag: '-',
        transmission: ['세율·공정시장가액비율 완화로 부담 감소', '매물 증가 유인 약화'],
        mostAffected: '큰 변화 없음.',
        action: '계절적 급매를 기대하기 어렵습니다. 다른 근거로 시점을 정하세요.',
      },
    ]),
    basis: [
      comprehensive
        ? '종부세는 12월 1일~15일 납부하며, 부담이 큰 경우 분납·물납 신청이 가능합니다.'
        : '재산세는 7월과 9월 두 번에 나눠 부과됩니다.',
      '절세 목적 매도는 다음 해 과세기준일(6월 1일) 전에 완료해야 효과가 있습니다.',
    ],
    watchNext: [
      '연말~1분기 매물 증가 여부',
      '급매 실거래가와 직전 거래가의 차이',
      '다음 해 보유세 개편안 발표',
    ],
  };
}

function genericOutlook(event: ScheduleEvent): EventOutlook {
  return {
    event,
    why: '이 일정은 시장 전반보다 개별 지역·상품에 영향을 줍니다.',
    scenarios: normalize([
      {
        label: '긍정적 결과',
        probability: 50,
        direction: 'up',
        magnitude: 'weak',
        lag: '수 주',
        transmission: ['해당 지역·상품에 국지적으로 반영'],
        mostAffected: '직접 관련된 지역.',
        action: '관심 지역에 해당한다면 호재 진행 상황 섹션을 함께 확인하세요.',
      },
      {
        label: '부정적 결과',
        probability: 50,
        direction: 'down',
        magnitude: 'weak',
        lag: '수 주',
        transmission: ['해당 지역·상품에 국지적으로 반영'],
        mostAffected: '직접 관련된 지역.',
        action: '관심 지역에 해당한다면 대체 후보를 함께 검토하세요.',
      },
    ]),
    basis: ['이 이벤트 유형에 대한 전용 분석 규칙이 아직 없습니다.'],
    watchNext: ['관련 보도와 공식 발표문'],
  };
}

/* ------------------------------------------------------------------ */
/* 진입점                                                              */
/* ------------------------------------------------------------------ */

export function buildOutlook(event: ScheduleEvent, ctx: OutlookContext): EventOutlook {
  switch (event.kind) {
    case 'mpc':
      return mpcOutlook(event, ctx);
    case 'fomc':
      return fomcOutlook(event, ctx);
    case 'cpi':
      return cpiOutlook(event, ctx);
    case 'reb-weekly':
      return rebOutlook(event, ctx, true);
    case 'reb-monthly':
      return rebOutlook(event, ctx, false);
    case 'tax-base-date':
      return taxBaseDateOutlook(event);
    case 'official-price':
      return officialPriceOutlook(event, ctx);
    case 'property-tax':
      return taxPaymentOutlook(event, false);
    case 'comprehensive-tax':
      return taxPaymentOutlook(event, true);
    default:
      return genericOutlook(event);
  }
}

/** 시나리오 확률을 방향별로 합산한 기대 방향 */
export function expectedDirection(outlook: EventOutlook): {
  up: number;
  flat: number;
  down: number;
  tilt: 'up' | 'flat' | 'down';
} {
  const acc = { up: 0, flat: 0, down: 0 };
  for (const s of outlook.scenarios) acc[s.direction] += s.probability;
  const tilt = acc.up > acc.down + 10 ? 'up' : acc.down > acc.up + 10 ? 'down' : 'flat';
  return { ...acc, tilt };
}

export const DIRECTION_META = {
  up: { label: '상승 압력', color: 'var(--rise)', icon: '▲' },
  flat: { label: '중립', color: 'var(--flat)', icon: '■' },
  down: { label: '하락 압력', color: 'var(--fall)', icon: '▼' },
} as const;

export const MAGNITUDE_LABEL = {
  strong: '영향 큼',
  moderate: '보통',
  weak: '제한적',
} as const;
