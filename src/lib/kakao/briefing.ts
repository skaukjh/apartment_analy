/**
 * 일일 브리핑 문구 생성.
 * 웹 미리보기와 카카오톡 전송이 같은 원문을 쓰도록 한곳에서 만든다.
 *
 * 카카오 text 템플릿은 200자 제한이 있어 섹션 단위로 쪼개 순차 전송한다.
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
      `시세 갭: ${formatKrw(primaryGap.gap, { compact: true })} (${primaryGap.ratio.toFixed(2)}배)`,
      `세금·중개비 반영 실소요: ${formatKrw(primaryGap.realCashNeeded, { compact: true })}`,
    ];
    if (data.gaps.length > 1) {
      lines.push(
        `그 외 후보 ${data.gaps.length - 1}건 · 최소 갭 ${formatEok(Math.min(...data.gaps.map((g) => g.gap)))}`,
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
          `${m.label.split(' (')[0]}: ${m.latest.toLocaleString('ko-KR')}${m.unit === '%' ? '%' : ''} (${m.latestPeriod}${m.yoy !== undefined ? `, YoY ${formatPct(m.yoy, 1)}` : ''})`,
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

/** 섹션들을 200자 이내 메시지 단위로 묶는다 */
function chunkSections(briefing: Briefing): string[] {
  const chunks: string[] = [];
  let current = `[${briefing.title}]\n${briefing.headline}`;

  for (const section of briefing.sections) {
    const block = `${section.heading}\n${section.lines.map((l) => `· ${l}`).join('\n')}`;

    if (block.length > KAKAO_TEXT_LIMIT) {
      // 섹션 자체가 길면 라인 단위로 쪼갠다
      if (current.trim()) chunks.push(current.trim());
      current = '';
      let piece = section.heading;
      for (const line of section.lines) {
        const candidate = `${piece}\n· ${line}`;
        if (candidate.length > KAKAO_TEXT_LIMIT) {
          chunks.push(piece.trim());
          piece = `${section.heading} (계속)\n· ${line}`;
        } else {
          piece = candidate;
        }
      }
      if (piece.trim()) chunks.push(piece.trim());
      continue;
    }

    if (`${current}\n\n${block}`.length > KAKAO_TEXT_LIMIT) {
      chunks.push(current.trim());
      current = block;
    } else {
      current = current ? `${current}\n\n${block}` : block;
    }
  }

  if (current.trim()) chunks.push(current.trim());
  return chunks.filter((c) => c.length > 0);
}

/**
 * 한 통짜리 요약을 만든다.
 *
 * 카카오 text 템플릿은 200자 제한이라 전문(약 1,300자)이 안 들어간다.
 * 그래서 알림을 여러 번 울리지 않도록 핵심만 200자 안에 담고,
 * 나머지는 "대시보드 열기" 버튼으로 웹에서 보게 한다.
 */
/**
 * 200자 안에 서로 겹치지 않는 정보만 담는다.
 *
 * 예전 방식은 헤드라인에 이미 있는 갭·과열·확산을 본문에서 또 반복해
 * 200자를 중복으로 낭비했다. 그래서 헤드라인은 쓰지 않고,
 * 우선순위가 높은 항목부터 한 줄씩 채운다.
 */
/**
 * 발송 시간대. 같은 데이터라도 시간대마다 먼저 알고 싶은 게 다르다.
 *  - morning(05시): 오늘 일정과 내 갭 — 하루를 계획할 때
 *  - noon(11시)   : 과열도·수급 — 장중 분위기
 *  - evening(18시): 신고가/신저가·확산 — 오늘 시장이 어땠나
 *  - night(22시)  : 갭 변화·거래량 — 하루 마감 정리
 */
export type BriefingSlot = 'morning' | 'noon' | 'evening' | 'night';

const SLOT_LABEL: Record<BriefingSlot, string> = {
  morning: '아침',
  noon: '오전',
  evening: '저녁',
  night: '마감',
};

/** KST 시각 → 발송 슬롯. 지정 시각이 아니면 null. */
export function slotForHour(hourKst: number): BriefingSlot | null {
  if (hourKst === 5) return 'morning';
  if (hourKst === 11) return 'noon';
  if (hourKst === 18) return 'evening';
  if (hourKst === 22) return 'night';
  return null;
}

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
 * 요약을 카카오 text 메시지 여러 장으로 만든다 (기본 2장).
 *
 * text 템플릿은 장당 200자 제한이라 한 장으로는 "정보가 너무 적다"는 피드백이
 * 있었다. 두 장이면 알림은 두 번이지만 내용이 두 배다.
 * 시간대별 우선순위 순서로 후보를 채우되, 같은 정보는 한 번만 넣는다.
 */
function briefingToSummaryTexts(
  data: DashboardData,
  title: string,
  appUrl?: string,
  slot: BriefingSlot = 'morning',
  pages = 2,
): string[] {
  const { spread, primaryGap, newHighs, newLows } = summarizeDashboard(data);
  const heat = HEAT_META[data.sentiment.heatLevel];

  /* 조각들 — 시간대별로 순서만 바꿔 쓴다 */

  const myGap = primaryGap
    ? `🏠 ${primaryGap.holdingName}→${primaryGap.targetName} 갭 ${formatEok(primaryGap.gap)}(실소요 ${formatEok(primaryGap.realCashNeeded)})`
    : '🏠 보유·목표 아파트 미등록';

  const gapDelta =
    primaryGap?.gapDelta !== undefined
      ? `📉 3개월 갭 ${primaryGap.gapDelta < 0 ? '축소' : '확대'} ${formatEok(Math.abs(primaryGap.gapDelta))}`
      : null;

  const otherGap =
    data.gaps.length > 1
      ? `🏠 차순위 ${data.gaps[1].targetName} 갭 ${formatEok(data.gaps[1].gap)}`
      : null;

  const heatLine = `🌡️ ${heat?.label ?? ''} ${data.sentiment.heatScore}/100 · 수급 ${data.sentiment.supplyDemandIndex.toFixed(0)} · 신고가비중 ${data.sentiment.newHighRatio.toFixed(0)}%`;
  const extremeLine = `📈 신고가 ${newHighs.length} · 신저가 ${newLows.length}건`;
  const topHigh = newHighs[0]
    ? `▲ ${newHighs[0].complexName} ${formatKrw(newHighs[0].price, { compact: true })} (${formatPct(newHighs[0].gapRate, 1)})`
    : null;
  const spreadLine = `🗺️ 상승확산 ${spread.spreadRate.toFixed(0)}% (${spread.leading.length + spread.spreading.length}/${spread.total}곳) · 미반등 ${spread.neverRebounded.length}곳`;
  const momentum =
    spread.topMomentum.length > 0
      ? `🚀 모멘텀 ${spread.topMomentum
          .slice(0, 2)
          .map((r) => `${r.regionName} ${formatPct(r.recent3mChange, 1)}`)
          .join(', ')}`
      : null;
  const volumeLine = `🔁 거래량 전년비 ${data.sentiment.volumeYoy.toFixed(0)}%`;

  const baseRate = data.macro?.find((m) => m.key === 'base-rate');
  const mortRate = data.macro?.find((m) => m.key === 'mortgage-rate');
  const rateLine =
    baseRate || mortRate
      ? `💰 ${[
          baseRate ? `기준금리 ${baseRate.latest}%` : null,
          mortRate ? `주담대 ${mortRate.latest}%` : null,
        ]
          .filter(Boolean)
          .join(' · ')}`
      : null;

  const events = (data.schedule ?? []).slice(0, 2);
  const scheduleLine =
    events.length > 0
      ? `📅 ${events.map((e) => `${e.date.slice(5)} ${e.title.slice(0, 18)}`).join(' / ')}`
      : null;

  const newsPicks = (data.news ?? []).filter((n) => n.tone !== 'neutral').slice(0, 2);
  const newsLines = newsPicks.map(
    (n) => `📰 ${n.tone === 'positive' ? '🟢' : '🔴'} ${n.title.slice(0, 44)}`,
  );

  // 시간대별 우선순위 — 앞에 오는 것부터 채운다
  const ORDER: Record<BriefingSlot, Array<string | null>> = {
    // 아침: 오늘 무엇을 볼지
    morning: [
      myGap,
      scheduleLine,
      heatLine,
      rateLine,
      spreadLine,
      gapDelta,
      extremeLine,
      momentum,
      newsLines[0] ?? null,
      volumeLine,
      otherGap,
    ],
    // 오전: 지금 시장 온도
    noon: [
      heatLine,
      extremeLine,
      topHigh,
      volumeLine,
      myGap,
      spreadLine,
      momentum,
      rateLine,
      newsLines[0] ?? null,
      scheduleLine,
      gapDelta,
    ],
    // 저녁: 오늘 시장이 어땠나
    evening: [
      extremeLine,
      topHigh,
      spreadLine,
      newsLines[0] ?? null,
      heatLine,
      myGap,
      momentum,
      newsLines[1] ?? null,
      volumeLine,
      rateLine,
      gapDelta,
    ],
    // 마감: 하루 정리와 내 위치
    night: [
      myGap,
      gapDelta,
      spreadLine,
      volumeLine,
      heatLine,
      otherGap,
      momentum,
      extremeLine,
      newsLines[0] ?? null,
      rateLine,
      scheduleLine,
    ],
  };

  const pool = ORDER[slot].filter((v): v is string => Boolean(v));
  const tail = appUrl
    ? `
▶ ${appUrl}`
    : '';

  const messages: string[] = [];
  let cursor = 0;
  for (let page = 0; page < pages && cursor < pool.length; page += 1) {
    const isLast = page === pages - 1 || cursor >= pool.length - 1;
    const head =
      page === 0 ? `[${title} · ${SLOT_LABEL[slot]}]` : `[${title} · ${SLOT_LABEL[slot]} ②]`;
    // 링크는 마지막 장에만 (본문 자리를 아끼고, 버튼도 마지막 장에 달린다)
    const budget = KAKAO_TEXT_LIMIT - (isLast ? tail.length : 0);

    const picks: string[] = [];
    while (cursor < pool.length) {
      const line = pool[cursor];
      if ([head, ...picks, line].join('\n').length > budget) {
        // 이 줄이 안 들어가면 다음 장으로 넘긴다 (건너뛰지 않는다 — 우선순위 보존)
        break;
      }
      picks.push(line);
      cursor += 1;
    }
    if (picks.length === 0) break;
    messages.push(`${[head, ...picks].join('\n')}${isLast ? tail : ''}`);
    if (isLast) break;
  }

  return messages.length > 0 ? messages : [`[${title} · ${SLOT_LABEL[slot]}]${tail}`];
}

/** 요약 템플릿 (기본 2장 — 마지막 장에만 버튼) */
export function briefingToSingleTemplate(
  briefing: Briefing,
  appUrl: string,
  data: DashboardData,
  slot: BriefingSlot = 'morning',
): KakaoTemplate[] {
  // 브리핑 전문과 AI 요약이 함께 있는 "오늘의 요약" 으로 보낸다
  const target = `${appUrl.replace(/\/$/, '')}/today`;
  const link = { web_url: target, mobile_web_url: target };
  const texts = briefingToSummaryTexts(data, briefing.title, target, slot);
  return texts.map((text, i) => ({
    object_type: 'text' as const,
    text,
    link,
    ...(i === texts.length - 1 ? { button_title: '오늘의 요약 열기' } : {}),
  }));
}

/**
 * 카카오 메시지 템플릿 생성.
 * 첫 메시지는 대시보드 링크 버튼이 달린 feed, 나머지는 text.
 */
export function briefingToKakaoTemplates(briefing: Briefing, appUrl: string): KakaoTemplate[] {
  const link = { web_url: appUrl, mobile_web_url: appUrl };
  const chunks = chunkSections(briefing);
  const templates: KakaoTemplate[] = [];

  chunks.forEach((text, i) => {
    const isLast = i === chunks.length - 1;
    templates.push({
      object_type: 'text',
      text,
      link,
      // 마지막 메시지에만 대시보드 버튼을 달아 알림이 과하지 않게 한다
      ...(isLast ? { button_title: '대시보드 열기' } : {}),
    });
  });

  return templates;
}

/** 전송할 메시지 수 미리보기 */
export function previewChunks(briefing: Briefing): string[] {
  return chunkSections(briefing);
}
