/** 숫자·금액·날짜 포맷 유틸 */

const EOK = 100_000_000;
const MAN = 10_000;

/** 원 단위 금액을 "12억 3,400만" 형태로 */
export function formatKrw(won: number, opts: { compact?: boolean } = {}): string {
  if (!Number.isFinite(won)) return '-';
  const sign = won < 0 ? '-' : '';
  const abs = Math.abs(Math.round(won));

  if (abs < MAN) return `${sign}${abs.toLocaleString('ko-KR')}원`;

  const eok = Math.floor(abs / EOK);
  const man = Math.floor((abs % EOK) / MAN);

  if (eok === 0) return `${sign}${man.toLocaleString('ko-KR')}만`;
  if (man === 0) return `${sign}${eok.toLocaleString('ko-KR')}억`;
  if (opts.compact) {
    // 12.34억 형태
    return `${sign}${(abs / EOK).toFixed(2)}억`;
  }
  return `${sign}${eok.toLocaleString('ko-KR')}억 ${man.toLocaleString('ko-KR')}만`;
}

/**
 * 부호를 붙인 금액 — 증감 표시용.
 * formatKrw 는 양수에 +를 붙이지 않아 "갭 1.2억 변동"이 늘어난 건지 준 건지 알 수 없다.
 */
export function formatSignedKrw(won: number, opts: { compact?: boolean } = {}): string {
  if (!Number.isFinite(won)) return '-';
  const rounded = Math.round(won);
  if (rounded === 0) return '변동 없음';
  return `${rounded > 0 ? '+' : '-'}${formatKrw(Math.abs(rounded), opts)}`;
}

/** 억 단위 소수 표기 (차트 축 등) */
export function formatEok(won: number, digits = 1): string {
  if (!Number.isFinite(won)) return '-';
  return `${(won / EOK).toFixed(digits)}억`;
}

/** 부호 포함 퍼센트 */
export function formatPct(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return '-';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(digits)}%`;
}

/**
 * 전용면적 → 통용 공급평형 추정.
 *
 * 국토부 실거래에는 전용면적만 있는데, 사람들은 집 크기를 공급평형(26평형·34평형)으로
 * 부른다. "전용 20평"이라고 쓰면 공급 26평형 보유자가 자기 집이 아닌 줄 안다 —
 * 실제로 그런 혼란이 있어 화면 표기를 공급평형으로 통일했다.
 *
 * 공급면적은 데이터가 없어 시장 관행 기준점(전용 59.9㎡=25평형, 84.8㎡=34평형 등)을
 * 선형 보간해 추정한다. 단지별 전용률 차이로 ±1~2평형 오차가 날 수 있다
 * (특히 전용률이 낮은 70년대 구축). 그래서 "약"을 붙이고 전용㎡를 병기한다.
 */
const SUPPLY_ANCHORS: Array<[number, number]> = [
  [33, 15],
  [39.9, 17],
  [49.9, 21],
  [59.9, 25],
  [64.8, 26],
  [74, 30],
  // 전용 84 타입의 시장 통칭은 "33평형"이다 (헬리오시티·엘스 등 확인)
  [84.8, 33],
  [99, 39],
  [114.9, 45],
  [134.9, 52],
  [148, 57],
  [178, 66],
];

/** 전용㎡ → 통용 공급평형 (추정) */
export function supplyPyeong(m2: number): number {
  const a = SUPPLY_ANCHORS;
  if (m2 <= a[0][0]) {
    const [[x1, y1], [x2, y2]] = [a[0], a[1]];
    return Math.max(1, Math.round(y1 + ((m2 - x1) * (y2 - y1)) / (x2 - x1)));
  }
  for (let i = 1; i < a.length; i += 1) {
    if (m2 <= a[i][0]) {
      const [[x1, y1], [x2, y2]] = [a[i - 1], a[i]];
      return Math.round(y1 + ((m2 - x1) * (y2 - y1)) / (x2 - x1));
    }
  }
  const [[x1, y1], [x2, y2]] = [a[a.length - 2], a[a.length - 1]];
  return Math.round(y2 + ((m2 - x2) * (y2 - y1)) / (x2 - x1));
}

/** 면적 표기 → "공급 약 26평형(전용 64.80㎡·19.6평)" — 공급 평형과 전용 평을 함께 보여준다 */
export function formatArea(m2: number): string {
  if (!Number.isFinite(m2) || m2 <= 0) return '-';
  return `공급 약 ${supplyPyeong(m2)}평형(전용 ${m2.toFixed(m2 % 1 === 0 ? 0 : 2)}㎡·${toPyeong(m2).toFixed(1)}평)`;
}

/** ㎡ → 평 */
export function toPyeong(m2: number): number {
  return m2 / 3.305785;
}

/**
 * 단지 개요 한 줄 — "1,234세대 · 용적률 178% · 대지지분 12.3평(40.66㎡)".
 * 입력된 항목만 보여주고, 하나도 없으면 null (줄 자체를 그리지 않게).
 */
export function complexSpecLine(ref: {
  totalHouseholds?: number;
  floorAreaRatio?: number;
  landShareM2?: number;
}): string | null {
  const parts: string[] = [];
  if (ref.totalHouseholds) parts.push(`${ref.totalHouseholds.toLocaleString('ko-KR')}세대`);
  if (ref.floorAreaRatio) parts.push(`용적률 ${ref.floorAreaRatio}%`);
  if (ref.landShareM2)
    parts.push(`대지지분 ${toPyeong(ref.landShareM2).toFixed(1)}평(${ref.landShareM2}㎡)`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

/** 국민주택규모(85㎡) 초과 여부 — 농특세 부과 기준 */
export function isOver85(m2: number): boolean {
  return m2 > 85;
}

/** YYYY-MM-DD → "8월 19일" */
export function formatShortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}

/**
 * KST 기준 연·월·일·시 부품.
 * 서버가 UTC(Vercel)든 KST(로컬 개발)든 같은 값이 나오도록 Intl 로 계산한다.
 * `Date.now() + 9시간` 방식은 로컬 타임존이 이미 KST 인 환경에서 하루가 밀린다.
 */
function kstParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    // 일부 ICU 버전은 자정을 24시로 준다
    hour: get('hour') % 24,
    minute: get('minute'),
    second: get('second'),
  };
}

/**
 * KST 벽시계 시각을 담은 Date.
 * getFullYear()/getMonth()/getDate()/getDay() 같은 로컬 게터가 KST 값을 돌려준다.
 * (절대 시각이 아니므로 toISOString() 으로 쓰지 말 것)
 */
export function nowKst(): Date {
  const p = kstParts();
  return new Date(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
}

/** KST 기준 YYYY-MM-DD */
export function todayKst(): string {
  const p = kstParts();
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** YYYYMM 문자열을 n개월 만큼 이동 */
export function shiftYearMonth(yyyymm: string, deltaMonths: number): string {
  const y = Number(yyyymm.slice(0, 4));
  const m = Number(yyyymm.slice(4, 6));
  const total = y * 12 + (m - 1) + deltaMonths;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}${String(nm).padStart(2, '0')}`;
}

/** 최근 n개월의 YYYYMM 배열 (과거 → 현재 순) */
export function recentYearMonths(count: number, from = nowKst()): string[] {
  const base = `${from.getFullYear()}${String(from.getMonth() + 1).padStart(2, '0')}`;
  return Array.from({ length: count }, (_, i) => shiftYearMonth(base, -(count - 1 - i)));
}

/** YYYYMM → YYYY-MM */
export function dashYearMonth(yyyymm: string): string {
  return `${yyyymm.slice(0, 4)}-${yyyymm.slice(4, 6)}`;
}

/** 두 날짜 사이 개월 수 */
export function monthsBetween(fromIso: string, toIso: string): number {
  const a = new Date(fromIso);
  const b = new Date(toIso);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 0;
  let months = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
  if (b.getDate() < a.getDate()) months -= 1;
  return Math.max(0, months);
}

/** 중앙값 */
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** 평균 */
export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** 0~100 범위로 자르기 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
