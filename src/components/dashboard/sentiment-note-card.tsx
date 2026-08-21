import { SectionCard } from '@/components/ui-bits';
import type { SentimentNote } from '@/lib/ai/sentiment-note';

/** '8월 22일 6시' — 이 코멘트가 언제 수치 기준인지 */
function stamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getMonth() + 1}월 ${d.getDate()}일 ${d.getHours()}시`;
}

/** **굵게** 만 처리하는 초소형 마크다운 */
function renderLine(line: string, i: number) {
  const parts = line.split(/(\*\*[^*]+\*\*)/g).map((p, j) =>
    p.startsWith('**') && p.endsWith('**') ? (
      <strong key={j} className="text-primary font-semibold">
        {p.slice(2, -2)}
      </strong>
    ) : (
      <span key={j}>{p}</span>
    ),
  );
  return (
    <p key={i} className="text-sm leading-relaxed">
      {parts}
    </p>
  );
}

/**
 * ⑥ 과열 지표 종합 시황 (AI).
 * 지표 수치가 바뀌었을 때만 다시 생성된다 — 생성 시각을 제목에 밝힌다.
 */
export function SentimentNoteCard({ note }: { note: SentimentNote | null }) {
  if (!note) return null;
  return (
    <SectionCard
      title={
        <>
          지표 종합 시황
          <span className="text-muted-foreground ml-1 text-sm font-normal">
            ({stamp(note.generatedAt)} 생성 내용)
          </span>
        </>
      }
    >
      <div className="space-y-2">
        {note.markdown
          .split('\n')
          .filter((l) => l.trim())
          .map((l, i) => renderLine(l.replace(/^[-*\d.]+\s*/, ''), i))}
      </div>
    </SectionCard>
  );
}
