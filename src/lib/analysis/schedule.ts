/**
 * 주요 일정 생성 (요구사항 8)
 *
 * 발표 주기가 규칙적인 지표·세정 일정을 향후 N일 범위로 생성한다.
 * 금통위·FOMC처럼 매년 날짜가 바뀌는 일정은 estimated 로 표시하고,
 * 정확한 날짜는 공식 공지로 확인하도록 안내한다.
 */

import type { ScheduleEvent, ScheduleEventKind } from '@/lib/types';
import { nowKst } from '@/lib/format';

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 해당 월의 n번째 특정 요일 (weekday: 0=일 … 6=토) */
function nthWeekday(year: number, month: number, weekday: number, n: number): Date {
  const first = new Date(year, month, 1);
  const offset = (weekday - first.getDay() + 7) % 7;
  return new Date(year, month, 1 + offset + (n - 1) * 7);
}

/** 한국은행 금융통화위원회 통화정책방향 결정회의 개최 월 (연 8회) */
const MPC_MONTHS = [0, 1, 3, 4, 6, 7, 9, 10]; // 1,2,4,5,7,8,10,11월

/** FOMC 개최 월 (연 8회) */
const FOMC_MONTHS = [0, 2, 4, 5, 7, 8, 10, 11];

/** 날짜 + 종류로 안정적인 id 를 만든다 */
export function eventId(date: string, kind: ScheduleEventKind): string {
  return `${date}_${kind}`;
}

export function buildSchedule(daysAhead = 90): ScheduleEvent[] {
  const today = nowKst();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const end = new Date(start);
  end.setDate(end.getDate() + daysAhead);

  const events: ScheduleEvent[] = [];
  const push = (e: Omit<ScheduleEvent, 'id'>) => {
    if (e.date >= iso(start) && e.date <= iso(end)) {
      events.push({ ...e, id: eventId(e.date, e.kind) });
    }
  };

  const months: Array<{ y: number; m: number }> = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  while (cursor <= end) {
    months.push({ y: cursor.getFullYear(), m: cursor.getMonth() });
    cursor.setMonth(cursor.getMonth() + 1);
  }

  for (const { y, m } of months) {
    // 통계청 소비자물가동향 — 매월 초 (통상 2일, 주말이면 다음 영업일)
    const cpi = new Date(y, m, 2);
    while (cpi.getDay() === 0 || cpi.getDay() === 6) cpi.setDate(cpi.getDate() + 1);
    push({
      date: iso(cpi),
      title: '소비자물가동향 발표 (통계청)',
      category: '지표발표',
      kind: 'cpi',
      description: '전월 CPI. 금리 인하 명분을 좌우하는 핵심 지표',
      importance: 'high',
    });

    // 한국부동산원 월간 주택가격동향 — 매월 15일 전후
    push({
      date: iso(new Date(y, m, 15)),
      title: '전국주택가격동향조사 월간 발표 (한국부동산원)',
      category: '지표발표',
      kind: 'reb-monthly',
      description: '월간 매매·전세 가격지수 및 지역별 변동률',
      importance: 'medium',
    });

    if (MPC_MONTHS.includes(m)) {
      push({
        date: iso(nthWeekday(y, m, 4, 2)),
        title: '한국은행 금융통화위원회 (기준금리 결정)',
        category: '금리',
        kind: 'mpc',
        description: '기준금리 결정. 주택담보대출 금리와 매수 여력에 직결',
        importance: 'high',
        estimated: true,
      });
    }

    if (FOMC_MONTHS.includes(m)) {
      push({
        date: iso(nthWeekday(y, m, 3, 3)),
        title: '미국 FOMC 정례회의',
        category: '금리',
        kind: 'fomc',
        description: '한미 금리차와 환율을 통해 국내 금리 정책에 파급',
        importance: 'medium',
        estimated: true,
      });
    }

    // 세정 일정
    if (m === 5) {
      push({
        date: iso(new Date(y, 5, 1)),
        title: '재산세·종합부동산세 과세기준일',
        category: '세제',
        kind: 'tax-base-date',
        description: '6월 1일 소유자에게 그 해 보유세가 부과됩니다. 잔금일 조정의 분기점',
        importance: 'high',
      });
    }
    if (m === 6) {
      push({
        date: iso(new Date(y, 6, 16)),
        title: '재산세 1기분 납부 시작 (7/16~7/31)',
        category: '세제',
        kind: 'property-tax',
        description: '주택분 재산세 1/2 및 건축물분',
        importance: 'medium',
      });
    }
    if (m === 8) {
      push({
        date: iso(new Date(y, 8, 16)),
        title: '재산세 2기분 납부 시작 (9/16~9/30)',
        category: '세제',
        kind: 'property-tax',
        description: '주택분 재산세 나머지 1/2 및 토지분',
        importance: 'medium',
      });
    }
    if (m === 11) {
      push({
        date: iso(new Date(y, 11, 1)),
        title: '종합부동산세 납부 (12/1~12/15)',
        category: '세제',
        kind: 'comprehensive-tax',
        description: '합산 공시가격 기준 종부세 고지·납부',
        importance: 'high',
      });
    }
    if (m === 2) {
      push({
        date: iso(new Date(y, 2, 1)),
        title: '공동주택 공시가격 열람 시작',
        category: '지표발표',
        kind: 'official-price',
        description: '보유세 과세표준의 기준. 이의신청 기간 확인 필요',
        importance: 'high',
      });
    }

    // 부동산원 주간 아파트가격동향 — 매주 목요일
    for (let n = 1; n <= 5; n += 1) {
      const thu = nthWeekday(y, m, 4, n);
      if (thu.getMonth() !== m) break;
      push({
        date: iso(thu),
        title: '주간 아파트가격동향 발표 (한국부동산원)',
        category: '지표발표',
        kind: 'reb-weekly',
        description: '주간 매매·전세 가격지수 및 매매수급동향지수',
        importance: 'low',
      });
    }
  }

  return events.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
}

/** 중요도 높은 일정만 (브리핑용) */
export function keyEvents(events: ScheduleEvent[], limit = 6): ScheduleEvent[] {
  const rank = { high: 0, medium: 1, low: 2 } as const;
  return [...events]
    .sort((a, b) => a.date.localeCompare(b.date) || rank[a.importance] - rank[b.importance])
    .filter((e) => e.importance !== 'low')
    .slice(0, limit);
}

/** id 로 이벤트 찾기 (예측 페이지용) */
export function findEvent(id: string, daysAhead = 120): ScheduleEvent | undefined {
  return buildSchedule(daysAhead).find((e) => e.id === id);
}
