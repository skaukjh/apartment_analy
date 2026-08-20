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
 * 전용면적 표기 → "24평(79.07㎡)"
 *
 * 평을 앞에 둔다. 한국에서 집 크기를 먼저 가늠하는 단위가 평이고,
 * 화면·카카오톡·AI 프롬프트에서 표기가 제각각이면 같은 집인지 알아보기 어렵다.
 * 정확한 값은 괄호 안 ㎡ 이므로 둘 다 남긴다.
 */
export function formatArea(m2: number): string {
  if (!Number.isFinite(m2) || m2 <= 0) return '-';
  const pyeong = Math.round(m2 / 3.305785);
  return `${pyeong}평(${m2.toFixed(m2 % 1 === 0 ? 0 : 2)}㎡)`;
}

/** ㎡ → 평 */
export function toPyeong(m2: number): number {
  return m2 / 3.305785;
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
