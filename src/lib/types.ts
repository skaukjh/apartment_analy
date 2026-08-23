/**
 * 부동산 매매 현황 분석 앱 공통 타입 정의
 */

/** 아파트 단지 식별 정보 */
export interface ApartmentRef {
  /** 내부 식별자 */
  id: string;
  /** 단지명 (예: 헬리오시티) */
  complexName: string;
  /** 시도 (예: 서울특별시) */
  sido: string;
  /** 시군구 (예: 송파구) */
  sigungu: string;
  /** 법정동 (예: 가락동) */
  dong: string;
  /** 법정동코드 앞 5자리(시군구코드). 실거래가 API 조회 키 */
  lawdCd: string;
  /** 전용면적 (㎡) */
  areaM2: number;
  /** 층 (선택) */
  floor?: number;
  /** 준공연도 (선택) */
  builtYear?: number;
}

/** 보유 아파트 */
export interface Holding extends ApartmentRef {
  kind: 'holding';
  /** 취득일 (YYYY-MM-DD) */
  acquiredAt: string;
  /** 취득가액 (원) */
  acquisitionPrice: number;
  /** 취득 부대비용 합계 (원) — 취득세·중개보수·법무비 등 필요경비 */
  acquisitionCost: number;
  /** 자본적 지출 (원) — 확장·새시 등 필요경비 인정분 */
  capitalExpenditure: number;
  /** 실거주 개월 수 */
  residenceMonths: number;
  /** 남은 대출 잔액 (원) */
  loanBalance: number;
  /** 대출 금리 (%) */
  loanRate: number;
  /** 전세/월세 보증금 (원) — 세입자에게 반환할 금액 */
  leaseDeposit: number;
  /** 사용자가 입력한 현재 호가/추정 시세 (원). 비우면 실거래가로 추정 */
  manualPrice?: number;
}

/** 갈아타기 목표 아파트 */
export interface TargetApartment extends ApartmentRef {
  kind: 'target';
  /** 사용자가 파악한 현재 호가 (원). 비우면 실거래가로 추정 */
  manualPrice?: number;
  /** 우선순위 (1이 가장 높음) */
  priority: number;
  /** 메모 */
  memo?: string;
}

/** 관심 지역 */
export interface WatchRegion {
  id: string;
  /** 표시 이름 (예: 성남시 분당구) */
  name: string;
  sido: string;
  sigungu: string;
  /** 법정동코드 앞 5자리 */
  lawdCd: string;
  /** 호재 추적용 키워드 (뉴스 검색어) */
  keywords: string[];
}

/** 세금 계산에 필요한 세대 단위 상태 */
export interface HouseholdProfile {
  /** 세대 보유 주택 수 (본 앱에서 자동 계산되나 수동 보정 가능) */
  ownedHouseCount: number;
  /** 취득 대상 지역이 조정대상지역인지 */
  targetIsRegulated: boolean;
  /** 보유 주택이 조정대상지역인지 */
  holdingIsRegulated: boolean;
  /** 생애최초 주택 구입 여부 */
  firstTimeBuyer: boolean;
  /** 일시적 2주택 특례 적용 여부 (기존 주택 처분 예정) */
  temporaryTwoHouse: boolean;
  /** 다주택자 양도세 중과 적용 여부 (한시 배제 정책에 따라 토글) */
  applyMultiHouseSurcharge: boolean;
  /** 연간 다른 양도소득 (원) — 기본공제 중복 방지용 */
  otherCapitalGainThisYear: number;
  /** 총 보유 현금·금융자산 (원) — 무주택 매수/갈아타기 자금 계산에 사용 */
  cashAssets: number;
  /** 세전 연 소득 (원) — DSR 한도 계산에 사용, 0이면 LTV 만 적용 */
  annualIncome: number;
  /** 기존 대출의 연간 원리금 상환액 (원) — DSR 에서 차감 */
  otherDebtAnnualPayment: number;
}

/** 사용자 설정 전체 */
export interface UserConfig {
  holdings: Holding[];
  targets: TargetApartment[];
  watchRegions: WatchRegion[];
  household: HouseholdProfile;
  /** 카카오 브리핑 수신 여부 */
  kakaoBriefingEnabled: boolean;
  /** 텔레그램 브리핑 수신 여부 */
  telegramEnabled: boolean;
  /** 텔레그램 발송 대상 chat_id (그룹 또는 1:1 대화) */
  telegramChatId?: string;
  /** 브리핑 발송 시각 (KST, 0~23) */
  briefingHour: number;
  /** 카카오톡 발송 형식. image = 전문 이미지 1장(기본), summary = 요약 2장, full = 전문 분할 */
  briefingFormat: 'summary' | 'full' | 'image';
  /** 개인 OpenAI 키 (BYOK). 있으면 AI 기능을 자기 비용으로 쓴다. 서버에서만 사용. */
  openaiApiKey?: string;
  updatedAt: string;
}

/* ------------------------------------------------------------------ */
/* 시세 · 실거래 데이터                                                 */
/* ------------------------------------------------------------------ */

/** 국토교통부 아파트 매매 실거래 1건 */
export interface TradeRecord {
  /** 거래일 (YYYY-MM-DD) */
  dealDate: string;
  sigungu: string;
  dong: string;
  complexName: string;
  /** 지번 (예: "579"). 행정동 판별에 쓴다 — 법정동만으로는 자양1~4동을 구분할 수 없다. */
  jibun?: string;
  /** 전용면적 (㎡) */
  areaM2: number;
  floor: number;
  /** 거래금액 (원) */
  price: number;
  builtYear?: number;
  /** 해제(취소) 거래 여부 */
  canceled: boolean;
  /**
   * 직거래(중개 미개입) 여부.
   * 가족 간 저가 이전이 많아 시세·지수 계산에서는 제외한다 —
   * 개포주공5단지 53.98㎡가 21.1억 "직거래"로 신고돼(호가 35억+) 시세로
   * 잡히던 왜곡이 실제로 있었다. true 일 때만 저장한다 (없으면 중개거래).
   */
  directDeal?: boolean;
}

/** 단지·면적 기준 시세 요약 */
export interface PriceQuote {
  /** 대표 시세 (원) — 직전 실거래가(가장 최근 체결가). 거래가 없으면 입력한 호가 */
  price: number;
  /** 최근 6개월 실거래 중앙값 (원) — 단발 거래에 흔들리지 않는 참고값 */
  medianPrice?: number;
  /** 사용자가 설정에 입력한 호가 (원) */
  askingPrice?: number;
  /** 시세 산출 근거 */
  basis: 'manual' | 'recent-trade' | 'region-index' | 'unknown';
  /** 참고한 실거래 건수 */
  sampleSize: number;
  /** 최근 실거래일 */
  lastDealDate?: string;
  /** 최고가 (원) */
  high?: number;
  /** 최저가 (원) */
  low?: number;
  /** 직전 대비 변동률 (%) */
  changeRate?: number;
}

/** 지역 월별 가격 시계열 포인트 */
export interface RegionPricePoint {
  /** YYYY-MM */
  month: string;
  /** ㎡당 평균 거래가 (원) */
  pricePerM2: number;
  /** 거래 건수 */
  count: number;
}

/** 반등 분석 결과 (요구사항 3) */
export interface ReboundAnalysis {
  lawdCd: string;
  regionName: string;
  sido: string;
  /** 2023-01 기준 지수(=100) 대비 현재 지수 */
  indexNow: number;
  /** 2023년 초 이후 저점 지수 */
  indexTrough: number;
  /** 저점 대비 반등률 (%) */
  reboundFromTrough: number;
  /** 2023년 초 대비 누적 변동률 (%) */
  changeSinceBase: number;
  /** 최근 3개월 변동률 (%) */
  recent3mChange: number;
  /** 반등 단계 분류 */
  stage: 'leading' | 'spreading' | 'lagging' | 'no-rebound' | 'insufficient-data';
  /** 거래 표본 수 */
  sampleSize: number;
  series: RegionPricePoint[];
  /** 실제로 지수 기준이 된 월 (YYYY-MM). 기준월에 거래가 없으면 뒤로 밀린다 */
  baseMonth: string;
  /** 지수의 최신 월 (YYYY-MM) */
  latestMonth: string;
  /** 기준월이 요청값보다 뒤로 밀렸는지 */
  baseShifted: boolean;
  /**
   * 월 중앙 거래건수 30건 미만 — 소표본이라 변동률이 거래 구성(신축 입주 등)에
   * 쉽게 휘둘린다. 순위에서 이 표시가 붙은 지역은 걸러 읽어야 한다.
   */
  thinSample: boolean;
  /**
   * 월별 ㎡단가가 널뛰는 지역 — 거래 구성(고가 단지가 거래된 달인지)에 따라
   * 지수 변동이 과장될 수 있다 (예: 종로구 942만~1513만원/㎡).
   */
  volatileMix: boolean;
}

/** 법정동 단위 반등 요약 (지도 드릴다운용) */
export interface DongStat {
  /** 법정동 이름 (실거래 umdNm 기준) */
  name: string;
  /** 기준월 대비 누적 변동률 (%) */
  changeSinceBase: number;
  /** 최근 3개월 변동률 (%) */
  recent3mChange: number;
  /** 저점 대비 반등률 (%) */
  reboundFromTrough: number;
  sampleSize: number;
  stage: ReboundAnalysis['stage'];
  baseMonth: string;
  latestMonth: string;
}

/* ------------------------------------------------------------------ */
/* 거시 지표 · 심리                                                     */
/* ------------------------------------------------------------------ */

export interface MacroSeriesPoint {
  /** YYYY-MM 또는 YYYY-MM-DD */
  period: string;
  value: number;
}

export interface MacroIndicator {
  key:
    | 'base-rate'
    | 'cpi'
    | 'm2'
    | 'mortgage-rate'
    | 'jeonse-index'
    | 'housing-index'
    | 'net-migration'
    // R-ONE 월간 공표 통계
    | 'reb-apt-sale-index'
    | 'reb-apt-jeonse-index'
    | 'reb-apt-rt-index'
    | 'reb-unsold'
    | 'reb-consumer-sentiment';
  label: string;
  unit: string;
  latest: number;
  latestPeriod: string;
  /** 전기 대비 변동 */
  change: number;
  /** 전년 동기 대비 변동률 (%) */
  yoy?: number;
  series: MacroSeriesPoint[];
  source: string;
  sourceUrl: string;
}

/** 과열 지표 / 매수심리 (요구사항 6) */
export interface MarketSentiment {
  /** 매매수급지수 (100 초과 = 매수우위) */
  supplyDemandIndex: number;
  supplyDemandChange: number;
  /** 주간 매매가격지수 변동률 (%) */
  weeklyPriceChange: number;
  /** 거래량 (건) — 최근월 */
  monthlyVolume: number;
  /** 거래량 전년 동월 대비 (%) */
  volumeYoy: number;
  /** 신고가 비중 (%) */
  newHighRatio: number;
  /** 종합 과열 점수 0~100 */
  heatScore: number;
  /** 과열 단계 */
  heatLevel: 'cold' | 'cooling' | 'neutral' | 'warming' | 'overheated';
  asOf: string;
  notes: string[];
}

/** 신고가/신저가 (요구사항 7) */
export interface PriceExtreme {
  complexName: string;
  sigungu: string;
  dong: string;
  areaM2: number;
  floor: number;
  price: number;
  dealDate: string;
  /** 직전 최고/최저가 대비 차이 (원) */
  gap: number;
  /** 직전 최고/최저가 대비 차이 (%) */
  gapRate: number;
  type: 'new-high' | 'new-low';
}

/* ------------------------------------------------------------------ */
/* 뉴스 · 호재                                                          */
/* ------------------------------------------------------------------ */

export interface NewsItem {
  title: string;
  summary: string;
  url: string;
  source: string;
  publishedAt: string;
  /** 관련 지역 id */
  regionId?: string;
  /** 분류 */
  category: 'development' | 'transport' | 'policy' | 'supply' | 'market' | 'etc';
  /** 긍/부정 톤 */
  tone: 'positive' | 'neutral' | 'negative';
  /** 정부 부처·공공기관 발표를 다룬 기사/보도자료 여부 */
  official?: boolean;
  /** 발표 주체 (국토교통부, 금융위원회 등) */
  agency?: string;
}

/**
 * 블로그·카페 글 (네이버 검색 API).
 * 개인 의견이므로 수치 판단에 쓰지 않고 참고용으로만 노출한다.
 */
export interface CommunityPost {
  title: string;
  summary: string;
  url: string;
  /** 블로거명 또는 카페명 */
  source: string;
  kind: 'blog' | 'cafe';
  /** 작성일 (블로그만 제공됨) */
  postedAt?: string;
  /** 연관도 상위 = 주요 인기 글로 분류 */
  popular: boolean;
  regionId?: string;
}

/** 호재 진행 상황 (요구사항 4) */
export interface CatalystStatus {
  id: string;
  regionId: string;
  title: string;
  category: NewsItem['category'];
  /** 진행 단계 */
  stage: '구상' | '계획수립' | '예타' | '설계' | '착공' | '공사중' | '준공/개통';
  /** 진행률 0~100 */
  progress: number;
  /** 예상 완료 시점 */
  expectedAt?: string;
  /** 최근 업데이트 */
  lastUpdate: string;
  /** 시세 영향도 (사용자 판단 또는 자동 추정) */
  impact: 'high' | 'medium' | 'low';
  sourceUrl?: string;
  /** 악재 여부. 생략하면 호재 */
  polarity?: 'positive' | 'negative';
  /** 이 항목이 걸린 지역 이름 (관심·보유·목표 지역) */
  matchedRegions?: string[];
  /** 근거 출처 링크 — 공식 자료·뉴스, 최대 5개 */
  sourceLinks?: Array<{ title: string; url: string }>;
  /** 특정 지역에 걸린 항목인지, 전국 공통 규제인지 */
  scope?: 'region' | 'nationwide';
  /** 첨부된 뉴스가 해당 지역을 언급하는지 — 'general' 이면 전국 일반 보도만 있음 */
  newsScope?: 'region' | 'general';
}

/** 주요 일정 (요구사항 8) */
export interface ScheduleEvent {
  /** URL 에 쓰는 안정적 식별자 (날짜 + 종류) */
  id: string;
  date: string;
  title: string;
  category: '금리' | '지표발표' | '정책' | '청약' | '세제' | '기타';
  description: string;
  importance: 'high' | 'medium' | 'low';
  /** 예측 엔진이 시나리오를 고를 때 쓰는 이벤트 종류 */
  kind: ScheduleEventKind;
  /** 일자가 추정치인지 (금통위·FOMC 등) */
  estimated?: boolean;
}

export type ScheduleEventKind =
  | 'mpc' // 한국은행 금융통화위원회
  | 'fomc' // 미국 FOMC
  | 'cpi' // 소비자물가동향
  | 'reb-monthly' // 부동산원 월간 주택가격동향
  | 'reb-weekly' // 부동산원 주간 아파트가격동향
  | 'tax-base-date' // 재산세·종부세 과세기준일
  | 'property-tax' // 재산세 납부
  | 'comprehensive-tax' // 종합부동산세 납부
  | 'official-price' // 공동주택 공시가격
  | 'etc';

/** 이벤트 결과 시나리오와 부동산 시장 영향 */
export interface OutlookScenario {
  /** 시나리오 이름 (예: "기준금리 0.25%p 인하") */
  label: string;
  /** 현재 지표 기준 발생 가능성 (%) */
  probability: number;
  /** 부동산 가격 방향 */
  direction: 'up' | 'flat' | 'down';
  /** 영향 강도 */
  magnitude: 'strong' | 'moderate' | 'weak';
  /** 영향이 나타나기까지 걸리는 시간 */
  lag: string;
  /** 파급 경로 (원인 → 결과 단계별) */
  transmission: string[];
  /** 가장 크게 영향받는 대상 */
  mostAffected: string;
  /** 갈아타기 관점의 행동 지침 */
  action: string;
}

export interface EventOutlook {
  event: ScheduleEvent;
  /** 이 이벤트가 부동산에 중요한 이유 */
  why: string;
  scenarios: OutlookScenario[];
  /** 현재 지표 상황 요약 (확률 산정 근거) */
  basis: string[];
  /** 발표 후 확인해야 할 지표 */
  watchNext: string[];
}

/* ------------------------------------------------------------------ */
/* 세금 계산                                                            */
/* ------------------------------------------------------------------ */

export interface AcquisitionTaxResult {
  /** 과세표준 (원) */
  base: number;
  /** 적용 취득세율 (%) */
  rate: number;
  /** 취득세 (원) */
  acquisitionTax: number;
  /** 지방교육세 (원) */
  localEducationTax: number;
  /** 농어촌특별세 (원) */
  ruralTax: number;
  /** 감면액 (원) */
  reduction: number;
  /** 합계 (원) */
  total: number;
  /** 실효세율 (%) */
  effectiveRate: number;
  notes: string[];
}

export interface CapitalGainsTaxResult {
  /** 양도차익 (원) */
  grossGain: number;
  /** 비과세 제외 후 과세대상 양도차익 (원) */
  taxableGain: number;
  /** 장기보유특별공제 (원) */
  longTermDeduction: number;
  /** 장특공 공제율 (%) */
  longTermRate: number;
  /** 양도소득금액 (원) */
  gainAfterDeduction: number;
  /** 기본공제 (원) */
  basicDeduction: number;
  /** 과세표준 (원) */
  taxBase: number;
  /** 적용 세율 (%) */
  rate: number;
  /** 양도소득세 (원) */
  incomeTax: number;
  /** 지방소득세 (원) */
  localTax: number;
  /** 합계 (원) */
  total: number;
  /** 비과세 여부 */
  exempt: boolean;
  /** 보유 개월 */
  holdingMonths: number;
  notes: string[];
}

/** 매매 부대비용 */
export interface TransactionCostResult {
  /** 중개보수 (원, VAT 포함) */
  brokerFee: number;
  /** 법무사·등기대행 (원) */
  registrationFee: number;
  /** 인지세 (원) */
  stampTax: number;
  /** 국민주택채권 할인 부담 (원) */
  bondDiscount: number;
  /** 이사·기타 (원) */
  movingEtc: number;
  total: number;
  notes: string[];
}

/** 갈아타기 시뮬레이션 (요구사항 1, 5) */
export interface SwitchSimulationInput {
  holding: Holding;
  target: TargetApartment;
  household: HouseholdProfile;
  /** 보유 아파트 매도 예상가 (원) */
  sellPrice: number;
  /** 목표 아파트 매수 예상가 (원) */
  buyPrice: number;
  /** 신규 대출 예정액 (원) */
  newLoan: number;
  /** 신규 대출 금리 (%) */
  newLoanRate: number;
  /** 보유 현금 (원) */
  cashOnHand: number;
  /** 목표 아파트 전용면적 85㎡ 초과 여부 */
  targetOver85: boolean;
  /** 보유 아파트 전용면적 85㎡ 초과 여부 */
  holdingOver85: boolean;
  /** 매도 시점 (YYYY-MM-DD). 생략하면 오늘 — "2년 채우고 팔면" 비교용 */
  soldAt?: string;
}

export interface SwitchSimulationResult {
  scenarioLabel: string;
  /** 매도가 (원) */
  sellPrice: number;
  /** 매수가 (원) */
  buyPrice: number;
  /** 갭 (매수가 - 매도가, 원) */
  priceGap: number;
  capitalGainsTax: CapitalGainsTaxResult;
  sellCost: TransactionCostResult;
  acquisitionTax: AcquisitionTaxResult;
  buyCost: TransactionCostResult;
  /** 매도로 손에 쥐는 순현금 (원) */
  netFromSale: number;
  /** 매수에 필요한 총 자금 (원) */
  totalNeeded: number;
  /** 부족/여유 자금 (원, 음수면 부족) */
  fundingGap: number;
  /** 연간 이자 부담 증가액 (원) */
  annualInterestDelta: number;
  /** 총 거래비용 (원) */
  totalFriction: number;
  /** 거래비용이 매수가에서 차지하는 비율 (%) */
  frictionRate: number;
}

/* ------------------------------------------------------------------ */
/* 대시보드 집계                                                        */
/* ------------------------------------------------------------------ */

export interface DashboardData {
  generatedAt: string;
  config: UserConfig;
  /** 보유/목표 아파트 시세 (아파트 id -> 시세) */
  quotes: Record<string, PriceQuote>;
  /** 요구사항 1: 갭 요약 */
  gaps: GapSummary[];
  /** 요구사항 3: 반등 확산 분석 */
  rebound: ReboundAnalysis[];
  /** 요구사항 4: 호재 */
  catalysts: CatalystStatus[];
  news: NewsItem[];
  /** 정부 부처·공공기관 공식 발표 (뉴스 표적 수집 + RSS) */
  press: NewsItem[];
  /** 블로그·카페 글 (참고용) */
  community: CommunityPost[];
  /** 요구사항 6 */
  sentiment: MarketSentiment;
  /** 요구사항 7 */
  extremes: PriceExtreme[];
  /** 요구사항 8 */
  macro: MacroIndicator[];
  schedule: ScheduleEvent[];
  /** 데이터 소스 상태 */
  sourceStatus: SourceStatus[];
}

export interface GapSummary {
  holdingId: string;
  holdingName: string;
  targetId: string;
  targetName: string;
  holdingPrice: number;
  targetPrice: number;
  /** 절대 갭 (원) */
  gap: number;
  /** 배율 (목표/보유) */
  ratio: number;
  /** 3개월 전 갭 (원) */
  gapBefore?: number;
  /** 갭 변화 (원, 음수면 갭 축소 = 갈아타기 유리) */
  gapDelta?: number;
  /** 세후 실제 필요 자금 (원) */
  realCashNeeded: number;
}

export interface SourceStatus {
  name: string;
  url: string;
  status: 'ok' | 'missing-key' | 'error' | 'stale';
  message: string;
  fetchedAt?: string;
}
