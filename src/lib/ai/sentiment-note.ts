/**
 * 과열 지표 종합 시황 코멘트 (AI, 전역 1개)
 *
 * ⑥ 과열 지표의 수치(수급·신고가·거래량·확산·금리)를 종합해 "지금이 어떤
 * 국면이고 무엇을 조심할지" 6~8문장으로 정리한다. 보유·목표와 무관한
 * 시장 전반 얘기라 사용자 구분 없이 전역 1개만 유지한다.
 *
 * 비용 통제: 입력 수치의 해시가 지난 생성과 같으면 다시 만들지 않는다 —
 * 지표는 12시간(실거래)~1시간(뉴스 제외, 여긴 수치만) 주기로만 바뀐다.
 */

import { createHash } from 'node:crypto';
import { getOpenAI, hasOpenAI, OPENAI_MODEL } from '@/lib/ai/client';
import { getAdminClient } from '@/lib/store/supabase';
import type { DashboardData } from '@/lib/types';

const KIND = 'sentiment-note';

export interface SentimentNote {
  markdown: string;
  inputHash: string;
  generatedAt: string;
}

interface Envelope {
  kind: typeof KIND;
  note: SentimentNote;
}

let memory: SentimentNote | null = null;

export async function loadSentimentNote(): Promise<SentimentNote | null> {
  if (memory) return memory;

  const client = getAdminClient();
  if (!client) return null;

  const { data } = await client
    .from('dashboard_snapshot')
    .select('payload')
    .eq('payload->>kind', KIND)
    .order('captured_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const p = (data?.payload ?? null) as Envelope | null;
  if (p?.note) memory = p.note;
  return p?.note ?? null;
}

async function saveSentimentNote(note: SentimentNote): Promise<void> {
  memory = note;
  const client = getAdminClient();
  if (!client) return;
  const envelope: Envelope = { kind: KIND, note };
  await client
    .from('dashboard_snapshot')
    .insert({ captured_at: new Date().toISOString(), payload: envelope });
}

function inputsOf(data: DashboardData): string {
  const s = data.sentiment;
  const macro = (data.macro ?? []).map((m) => `${m.key}:${m.latest}(${m.latestPeriod})`).join(',');
  const spread = data.rebound.filter((r) => r.stage !== 'insufficient-data');
  const leading = spread.filter((r) => r.stage === 'leading').length;
  const spreadRate =
    spread.length > 0
      ? Math.round(
          ((leading + spread.filter((r) => r.stage === 'spreading').length) / spread.length) * 100,
        )
      : 0;
  return [
    `수급:${s.supplyDemandIndex}`,
    `주간변동:${s.weeklyPriceChange}`,
    `거래량:${s.monthlyVolume}(YoY ${s.volumeYoy}%)`,
    `신고가비중:${s.newHighRatio}%`,
    `과열점수:${s.heatScore}(${s.heatLevel})`,
    `확산률:${spreadRate}%`,
    macro,
  ].join(' | ');
}

/**
 * 시황 코멘트를 갱신한다. 입력이 그대로면 기존 것을 반환하고 호출하지 않는다.
 * tick(매시간)에서 부른다 — 운영자 키 전용(전역 콘텐츠이므로).
 */
export async function refreshSentimentNote(data: DashboardData): Promise<SentimentNote | null> {
  if (!hasOpenAI()) return loadSentimentNote();

  const inputs = inputsOf(data);
  const inputHash = createHash('sha256').update(inputs).digest('hex').slice(0, 32);

  const prev = await loadSentimentNote();
  if (prev && prev.inputHash === inputHash) return prev;

  const prompt = `아래 수치만 근거로 한국 아파트 시장의 현재 국면을 정리하세요. 수치에 없는 사실을 지어내지 마세요.

[지표]
${inputs}

형식: 한국어 6~8문장, 마크다운 굵게(**)로 핵심 수치 강조. 구성:
1) 지금 국면 한 줄 판정
2) 수급·거래량·신고가가 가리키는 방향 (서로 어긋나면 그 점을 짚기)
3) 금리·통화 환경이 주는 압력
4) 확산률로 본 지역 간 온도차
5) 앞으로 1~3개월 관전 포인트 1~2가지 (조건부로, 단정 금지)
투자 자문이 아니라 지표 해설임을 전제로, 문장은 간결하게.`;

  const res = await getOpenAI().chat.completions.create({
    model: OPENAI_MODEL,
    messages: [{ role: 'user', content: prompt }],
  });

  const markdown = res.choices[0]?.message?.content?.trim();
  if (!markdown) return prev;

  const note: SentimentNote = { markdown, inputHash, generatedAt: new Date().toISOString() };
  await saveSentimentNote(note);
  return note;
}
