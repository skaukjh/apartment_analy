/**
 * 일일 브리핑 문구 생성.
 * 웹 미리보기와 발송(텔레그램 전문·카카오 갈아타기 요약)이 같은 원문을 쓰도록
 * 한곳에서 만든다. 카카오 text 템플릿은 200자 제한이 있어 요약 1장만 보낸다.
 */

import type { DashboardData } from '@/lib/types';
import { summarizeDashboard } from '@/lib/pipeline/dashboard';
import { HEAT_META } from '@/lib/analysis/market-signals';
import { keyEvents } from '@/lib/analysis/schedule';
import {
  formatArea,
  formatEok,
  formatKrw,
  formatPct,
  formatShortDate,
  supplyPyeong,
  nowKst,
  todayKst,
} from '@/lib/format';
import type { KakaoTemplate } from './client';

export interface BriefingSection {
  heading: string;
  lines: string[];
}

export interface Briefing {
  title: string;
  headline: string;
  sections: BriefingSection[];
  generatedAt: string;
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

export function buildBriefing(data: DashboardData): Briefing {
  const { spread, primaryGap, newHighs, newLows } = summarizeDashboard(data);
  const kst = nowKst();
  const dateLabel = `${kst.getMonth() + 1}/${kst.getDate()}(${WEEKDAYS[kst.getDay()]})`;

  const sections: BriefingSection[] = [];

  /* 1) 갈아타기 갭 (요구사항 1·2) */
  if (primaryGap) {
    const lines = [
      `보유 ${primaryGap.holdingName}: ${formatKrw(primaryGap.holdingPrice, { compact: true })}`,
      `목표 ${primaryGap.targetName}: ${formatKrw(primaryGap.targetPrice, { compact: true })}`,
      `시세 갭: ${formatKrw(primaryGap.gap, { compact: true })} (보유 대비 ${primaryGap.ratio.toFixed(2)}배)`,
      `세금·중개비 반영 실소요: ${formatKrw(primaryGap.realCashNeeded, { compact: true })}`,
    ];
    if (data.gaps.length > 1) {
      /* 차순위 후보도 배율을 함께 — 갭 금액만으로는 상급지 체감이 안 온다 */
      const others = data.gaps.slice(1);
      const min = others.reduce((a, b) => (a.gap <= b.gap ? a : b));
      lines.push(
        `그 외 후보 ${others.length}건 · 최소 갭 ${formatEok(min.gap)} (보유 대비 ${min.ratio.toFixed(2)}배)`,
      );
    }
    sections.push({ heading: '🏠 갈아타기 갭', lines });
  } else {
    sections.push({
      heading: '🏠 갈아타기 갭',
      lines: ['보유/목표 아파트가 등록되지 않았습니다. 설정에서 먼저 입력해 주세요.'],
    });
  }

  /* 2) 과열 지표 (요구사항 6) */
  const heat = HEAT_META[data.sentiment.heatLevel];
  sections.push({
    heading: '🌡️ 시장 과열도',
    lines: [
      `${heat.label} · 과열점수 ${data.sentiment.heatScore}/100`,
      `매매수급 ${data.sentiment.supplyDemandIndex} (${formatPct(data.sentiment.supplyDemandChange, 1)})`,
      `신고가 비중 ${data.sentiment.newHighRatio.toFixed(1)}% · 거래량 YoY ${formatPct(data.sentiment.volumeYoy, 0)}`,
      heat.advice,
    ],
  });

  /* 3) 반등 확산 (요구사항 3) */
  if (spread.total > 0) {
    const lines = [
      `분석 ${spread.total}개 시군구 중 반등 확산 ${spread.spreadRate.toFixed(0)}%`,
      `선도 ${spread.leading.length} · 확산 ${spread.spreading.length} · 후행 ${spread.lagging.length} · 미반등 ${spread.noRebound.length}`,
    ];
    if (spread.topMomentum.length > 0) {
      lines.push(
        `모멘텀 상위: ${spread.topMomentum
          .slice(0, 3)
          .map((r) => `${r.regionName} ${formatPct(r.recent3mChange, 1)}`)
          .join(', ')}`,
      );
    }
    if (spread.neverRebounded.length > 0) {
      lines.push(
        `2023년초 대비 미반등: ${spread.neverRebounded
          .slice(0, 3)
          .map((r) => `${r.regionName} ${formatPct(r.changeSinceBase, 1)}`)
          .join(', ')}`,
      );
    }
    sections.push({ heading: '🗺️ 상승 확산', lines });
  }

  /* 4) 신고가 / 신저가 (요구사항 7) */
  if (newHighs.length > 0 || newLows.length > 0) {
    const lines: string[] = [
      `신고가 ${newHighs.length}건 · 신저가 ${newLows.length}건 (최근 2개월)`,
    ];
    newHighs.slice(0, 3).forEach((e) => {
      lines.push(
        `▲ ${e.complexName} ${formatArea(e.areaM2)} ${formatKrw(e.price, { compact: true })} (${formatPct(e.gapRate, 1)}, ${formatShortDate(e.dealDate)})`,
      );
    });
    newLows.slice(0, 2).forEach((e) => {
      lines.push(
        `▼ ${e.complexName} ${formatArea(e.areaM2)} ${formatKrw(e.price, { compact: true })} (${formatPct(e.gapRate, 1)}, ${formatShortDate(e.dealDate)})`,
      );
    });
    sections.push({ heading: '📈 신고가 · 신저가', lines });
  }

  /* 5) 거시 지표 (요구사항 8) */
  if (data.macro.length > 0) {
    sections.push({
      heading: '📊 주요 지표',
      lines: data.macro.map(
        (m) =>
          // 금리형(%) 지표의 전년비는 %p 차이로 표기한다 (비율로 쓰면 +10% 같은 오해가 생긴다)
          `${m.label.split(' (')[0]}: ${m.latest.toLocaleString('ko-KR')}${m.unit === '%' ? '%' : ''} (${m.latestPeriod}${m.yoy !== undefined ? `, 전년비 ${formatPct(m.yoy, m.unit === '%' ? 2 : 1)}${m.unit === '%' ? 'p' : ''}` : ''})`,
      ),
    });
  }

  /* 6) 호재 (요구사항 4) */
  const activeCatalysts = data.catalysts.filter((c) => c.lastUpdate !== '미확인').slice(0, 4);
  if (activeCatalysts.length > 0) {
    sections.push({
      heading: '🚧 관심지역 호재',
      lines: activeCatalysts.map((c) => `${c.title} — ${c.stage} (${c.progress}%)`),
    });
  }

  /* 7) 주요 일정 */
  const upcoming = keyEvents(data.schedule, 4).filter((e) => e.date >= todayKst());
  if (upcoming.length > 0) {
    sections.push({
      heading: '📅 다가오는 일정',
      lines: upcoming.map(
        (e) => `${formatShortDate(e.date)} ${e.title.replace(' — 예정', '(예정)')}`,
      ),
    });
  }

  /* 8) 헤드라인 뉴스 */
  const topNews = data.news.filter((n) => n.tone !== 'neutral').slice(0, 3);
  if (topNews.length > 0) {
    sections.push({
      heading: '📰 헤드라인',
      lines: topNews.map((n) => `${n.tone === 'positive' ? '🟢' : '🔴'} ${n.title.slice(0, 60)}`),
    });
  }

  const headline = primaryGap
    ? `갭 ${formatEok(primaryGap.gap)} · 과열 ${data.sentiment.heatScore}/100(${heat.label}) · 확산 ${spread.spreadRate.toFixed(0)}%`
    : `과열 ${data.sentiment.heatScore}/100(${heat.label}) · 확산 ${spread.spreadRate.toFixed(0)}%`;

  return {
    title: `${dateLabel} 부동산 브리핑`,
    headline,
    sections,
    generatedAt: data.generatedAt,
  };
}

/* ------------------------------------------------------------------ */
/* 출력 변환                                                            */
/* ------------------------------------------------------------------ */

export function briefingToText(briefing: Briefing): string {
  const body = briefing.sections
    .map((s) => `${s.heading}\n${s.lines.map((l) => `· ${l}`).join('\n')}`)
    .join('\n\n');
  return `[${briefing.title}]\n${briefing.headline}\n\n${body}`;
}

const KAKAO_TEXT_LIMIT = 190; // 200자 제한 + 여유

/**
 * 발송 시간대(텔레그램 전문 발송용). 같은 데이터라도 시간대마다 먼저 알고 싶은 게 다르다.
 *  - morning(05시) · noon(11시) · evening(18시) · night(22시)
 */
export type BriefingSlot = 'morning' | 'noon' | 'evening' | 'night';

/**
 * 지금(KST) 기준으로 가장 최근에 지나간 발송 슬롯.
 *
 * 스케줄러(GitHub Actions)는 정각에 오지 않는다 — 30~50분 밀리고 가끔
 * 한 시간을 통째로 거른다. 실제로 11시 브리핑이 통째로 빠진 날이 있었다.
 * 그래서 "정각 일치"가 아니라 "지나간 슬롯 중 미발송분을 따라잡기"로 판단한다.
 * 새벽(0~4시)에는 보낼 슬롯이 없으므로 null.
 */
export function latestPassedSlot(hourKst: number): BriefingSlot | null {
  if (hourKst >= 22) return 'night';
  if (hourKst >= 18) return 'evening';
  if (hourKst >= 11) return 'noon';
  if (hourKst >= 5) return 'morning';
  return null;
}

/**
 * 카카오 전용 "내 갈아타기" 요약 1장.
 *
 * 카카오는 하루 1번(발송 시각 설정, 기본 08시)만 보내기로 했고,
 * 시장 전반 브리핑 전문은 텔레그램이 담당한다. 그래서 카카오 메시지는
 * 시황을 빼고 갈아타기 현황(보유·목표·갭·실소요)만 담는다.
 */
export function briefingToKakaoGapTemplate(appUrl: string, data: DashboardData): KakaoTemplate[] {
  const { primaryGap } = summarizeDashboard(data);
  const base = appUrl.replace(/\/$/, '');
  // 홈(/)이 "내 갈아타기" 페이지다
  const link = { web_url: base, mobile_web_url: base };

  const kst = nowKst();
  const head = `[${kst.getMonth() + 1}/${kst.getDate()}(${WEEKDAYS[kst.getDay()]}) 내 갈아타기]`;

  /* 200자 안에서는 면적 표기를 줄인다. 화면에 쓰는 전체 표기
     "공급 약 26평형(전용 64.80㎡·19.6평)"는 한 줄에 30자를 먹어,
     그대로 쓰면 2순위 후보 줄이 길이 초과로 잘려나간다. */
  const label = (id: string, fallback: string) => {
    const apt =
      data.config.holdings.find((h) => h.id === id) ?? data.config.targets.find((t) => t.id === id);
    return apt ? `${apt.complexName} 공급 약 ${supplyPyeong(apt.areaM2)}평형` : fallback;
  };

  const lines: string[] = [];
  if (primaryGap) {
    lines.push(
      `🏠 보유 ${label(primaryGap.holdingId, primaryGap.holdingName)} ${formatKrw(primaryGap.holdingPrice, { compact: true })}`,
    );
    lines.push(
      `🎯 목표 ${label(primaryGap.targetId, primaryGap.targetName)} ${formatKrw(primaryGap.targetPrice, { compact: true })}`,
    );
    lines.push(
      `📐 갭 ${formatEok(primaryGap.gap)} (보유 대비 ${primaryGap.ratio.toFixed(2)}배) · 실소요 ${formatEok(primaryGap.realCashNeeded)}`,
    );
    if (primaryGap.gapDelta !== undefined) {
      lines.push(
        `${primaryGap.gapDelta < 0 ? '📉 전주 대비 갭 축소' : '📈 전주 대비 갭 확대'} ${formatEok(Math.abs(primaryGap.gapDelta))}`,
      );
    }
    if (data.gaps.length > 1) {
      const second = data.gaps[1];
      lines.push(
        `2순위 ${label(second.targetId, second.targetName)} 갭 ${formatEok(second.gap)}(${second.ratio.toFixed(2)}배)`,
      );
    }
  } else {
    lines.push('보유·목표 아파트가 등록되지 않았습니다. 설정에서 먼저 입력해 주세요.');
  }

  // 200자 제한 — 넘치면 뒤쪽(부가 정보)부터 뺀다
  const picks = [...lines];
  while (picks.length > 1 && [head, ...picks].join('\n').length > KAKAO_TEXT_LIMIT) picks.pop();

  return [
    {
      object_type: 'text' as const,
      text: [head, ...picks].join('\n'),
      link,
      button_title: '내 갈아타기 열기',
    },
  ];
}
