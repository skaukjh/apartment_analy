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
import { formatEok, formatKrw, formatPct, formatShortDate, nowKst, todayKst } from '@/lib/format';
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
        `▲ ${e.complexName} ${Math.round(e.areaM2)}㎡ ${formatKrw(e.price, { compact: true })} (${formatPct(e.gapRate, 1)}, ${formatShortDate(e.dealDate)})`,
      );
    });
    newLows.slice(0, 2).forEach((e) => {
      lines.push(
        `▼ ${e.complexName} ${Math.round(e.areaM2)}㎡ ${formatKrw(e.price, { compact: true })} (${formatPct(e.gapRate, 1)}, ${formatShortDate(e.dealDate)})`,
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
