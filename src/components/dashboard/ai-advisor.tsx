'use client';

import { useEffect, useRef, useState } from 'react';
import { Bot, Loader2, Send, Sparkles, User } from 'lucide-react';
import type { ApartmentRef, UserConfig } from '@/lib/types';
import type { NearbySummary } from '@/lib/sources/place';
import type { BankRate } from '@/lib/sources/bank-rates';
import { formatArea } from '@/lib/format';
import { EmptyHint, SectionCard } from '@/components/ui-bits';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

interface Msg {
  role: 'user' | 'assistant';
  content: string;
}

interface EvaluateResponse {
  ok: boolean;
  error?: string;
  evaluation?: string;
  nearby?: NearbySummary | null;
  bankRates?: BankRate[];
  gaps?: string[];
  model?: string;
}

const SUGGESTIONS = [
  '이 단지 지금 사도 될까?',
  '대출 얼마나 받을 수 있어?',
  '토지거래허가구역이면 뭘 조심해야 해?',
  '더 기다리면 유리해질까?',
];

/** 아주 가벼운 마크다운 렌더 — ## 헤딩, - 목록, **강조**만 처리 */
function renderMarkdown(text: string) {
  return text.split('\n').map((raw, i) => {
    const line = raw.trimEnd();
    if (line.startsWith('## ')) {
      return (
        <h4 key={i} className="mt-3 mb-1 text-sm font-semibold first:mt-0">
          {line.slice(3)}
        </h4>
      );
    }
    if (line.startsWith('- ') || line.startsWith('* ')) {
      return (
        <p key={i} className="pl-3 -indent-3 text-sm leading-relaxed">
          • {inline(line.slice(2))}
        </p>
      );
    }
    if (line.trim() === '') return <div key={i} className="h-1.5" />;
    return (
      <p key={i} className="text-sm leading-relaxed">
        {inline(line)}
      </p>
    );
  });
}

function inline(text: string) {
  return text
    .split(/(\*\*[^*]+\*\*)/g)
    .map((part, i) =>
      part.startsWith('**') && part.endsWith('**') ? (
        <strong key={i}>{part.slice(2, -2)}</strong>
      ) : (
        <span key={i}>{part}</span>
      ),
    );
}

export function AiAdvisor({
  config,
  quotes,
  enabled,
}: {
  config: UserConfig;
  quotes?: Record<string, { price: number }>;
  enabled: boolean;
}) {
  // 보유 먼저, 목표는 가격 낮은 순 (시세 없는 항목은 뒤로)
  const priceOf = (id: string) => quotes?.[id]?.price || Number.MAX_SAFE_INTEGER;
  const apartments: ApartmentRef[] = [
    ...config.holdings,
    ...[...config.targets].sort((a, b) => priceOf(a.id) - priceOf(b.id)),
  ];
  const [apartmentId, setApartmentId] = useState(apartments[0]?.id ?? '');

  const [evaluating, setEvaluating] = useState(false);
  const [evaluation, setEvaluation] = useState<EvaluateResponse | null>(null);

  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, streaming]);

  async function evaluate() {
    setEvaluating(true);
    setEvaluation(null);
    try {
      const res = await fetch('/api/ai/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apartmentId }),
      });
      setEvaluation(await res.json());
    } catch (e) {
      setEvaluation({ ok: false, error: (e as Error).message });
    } finally {
      setEvaluating(false);
    }
  }

  async function send(text: string) {
    const question = text.trim();
    if (!question || streaming) return;

    const next = [...messages, { role: 'user' as const, content: question }];
    setMessages([...next, { role: 'assistant', content: '' }]);
    setInput('');
    setStreaming(true);

    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apartmentId, messages: next }),
      });

      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(err.error ?? '응답을 받지 못했습니다.');
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        setMessages([...next, { role: 'assistant', content: acc }]);
      }
    } catch (e) {
      setMessages([...next, { role: 'assistant', content: `⚠️ ${(e as Error).message}` }]);
    } finally {
      setStreaming(false);
    }
  }

  if (!enabled) {
    return (
      <SectionCard
        title={
          <>
            <Sparkles className="size-4" /> AI 매물 평가 · 상담
          </>
        }
        description="등록한 아파트의 시세·규제·대출·입지·호재를 한데 묶어 AI 평가를 받고, 이어서 질문할 수 있습니다."
      >
        <EmptyHint>
          <code className="text-xs">OPENAI_API_KEY</code> 가 설정되지 않았습니다.
          <br />
          <a
            className="underline"
            href="https://platform.openai.com/api-keys"
            target="_blank"
            rel="noreferrer"
          >
            OpenAI API 키 발급
          </a>{' '}
          후 환경변수에 추가하세요.
        </EmptyHint>
      </SectionCard>
    );
  }

  if (apartments.length === 0) {
    return (
      <SectionCard
        title={
          <>
            <Sparkles className="size-4" /> AI 매물 평가 · 상담
          </>
        }
      >
        <EmptyHint>보유 또는 목표 아파트를 등록하면 평가를 받을 수 있습니다.</EmptyHint>
      </SectionCard>
    );
  }

  const selected = apartments.find((a) => a.id === apartmentId) ?? apartments[0];

  return (
    <SectionCard
      title={
        <>
          <Sparkles className="size-4" /> AI 매물 평가 · 상담
        </>
      }
      description="시세·규제·대출 한도·주변 입지·호재·거시지표를 컨텍스트로 넘겨 평가받습니다. AI 는 이 컨텍스트 밖의 수치를 추측하지 않도록 제약돼 있습니다."
      action={
        <div className="flex items-center gap-2">
          <Select value={selected.id} onValueChange={(v) => setApartmentId(String(v ?? ''))}>
            <SelectTrigger size="sm" className="w-64">
              {/* SelectValue 의 함수 자식은 항목이 등록되기 전엔 id 를 그대로 노출하는
                  버그가 있어, 선택된 아파트의 라벨을 직접 렌더링한다 */}
              <SelectValue>
                {selected.complexName} {formatArea(selected.areaM2)}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {apartments.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.complexName} {formatArea(a.areaM2)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      }
    >
      <Tabs defaultValue="evaluate">
        <TabsList>
          <TabsTrigger value="evaluate">종합 평가</TabsTrigger>
          <TabsTrigger value="chat">추가 질문</TabsTrigger>
        </TabsList>

        {/* 종합 평가 */}
        <TabsContent value="evaluate" className="mt-3 space-y-3">
          <Button size="sm" onClick={evaluate} disabled={evaluating}>
            {evaluating ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Sparkles className="size-4" />
            )}
            {selected.complexName} 평가 받기
          </Button>

          {evaluation?.ok === false ? (
            <p className="text-destructive text-sm">{evaluation.error}</p>
          ) : null}

          {evaluation?.ok && evaluation.evaluation ? (
            <>
              <div className="bg-muted/30 rounded-lg border p-4">
                {renderMarkdown(evaluation.evaluation)}
              </div>

              {evaluation.nearby ? (
                <div className="rounded-lg border p-3">
                  <h4 className="mb-1.5 text-xs font-semibold">
                    주변 입지{' '}
                    <span className="text-muted-foreground font-normal">
                      (카카오맵 · {evaluation.nearby.coord.matched})
                    </span>
                  </h4>
                  <div className="grid gap-1.5 sm:grid-cols-2">
                    {(
                      [
                        ['지하철', evaluation.nearby.subway],
                        ['학교', evaluation.nearby.school],
                        ['마트', evaluation.nearby.mart],
                        ['병원', evaluation.nearby.hospital],
                      ] as const
                    ).map(([label, list]) => (
                      <div key={label} className="text-[11px]">
                        <span className="text-muted-foreground">{label}: </span>
                        {list.length > 0
                          ? list
                              .slice(0, 2)
                              .map((p) => `${p.name} ${p.distance}m(도보 ${p.walkMinutes}분)`)
                              .join(', ')
                          : '주변에 없음'}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {evaluation.bankRates && evaluation.bankRates.length > 0 ? (
                <div className="rounded-lg border p-3">
                  <h4 className="mb-1.5 text-xs font-semibold">
                    시중은행 주담대 최저금리{' '}
                    <span className="text-muted-foreground font-normal">
                      (금감원 공시 {evaluation.bankRates[0].disclosureMonth})
                    </span>
                  </h4>
                  <ul className="space-y-0.5">
                    {evaluation.bankRates.slice(0, 5).map((b, i) => (
                      <li key={i} className="flex justify-between text-[11px]">
                        <span>
                          {b.bank}{' '}
                          <span className="text-muted-foreground">
                            {b.product} · {b.rateType}
                          </span>
                        </span>
                        <span className="tabular font-medium">
                          {b.minRate}~{b.maxRate}%
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {evaluation.gaps && evaluation.gaps.length > 0 ? (
                <div className="rounded-lg border border-dashed p-3">
                  <h4 className="mb-1 text-xs font-semibold">확보하지 못한 정보</h4>
                  <ul className="space-y-0.5">
                    {evaluation.gaps.map((g, i) => (
                      <li key={i} className="text-muted-foreground text-[11px]">
                        • {g}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <p className="text-muted-foreground text-[11px]">
                모델 {evaluation.model} · AI 평가는 참고용이며 투자 자문이 아닙니다.
              </p>
            </>
          ) : null}
        </TabsContent>

        {/* 챗봇 */}
        <TabsContent value="chat" className="mt-3">
          <div
            ref={scrollRef}
            className="thin-scrollbar mb-3 max-h-96 min-h-40 space-y-3 overflow-y-auto rounded-lg border p-3"
          >
            {messages.length === 0 ? (
              <div className="space-y-2 py-4 text-center">
                <p className="text-muted-foreground text-sm">
                  {selected.complexName} 기준으로 답합니다. 무엇이든 물어보세요.
                </p>
                <div className="flex flex-wrap justify-center gap-1.5">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => send(s)}
                      className="text-muted-foreground hover:bg-muted hover:text-foreground rounded-full border px-2.5 py-1 text-[11px] transition-colors"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((m, i) => (
                <div
                  key={i}
                  className={cn('flex gap-2', m.role === 'user' ? 'justify-end' : 'justify-start')}
                >
                  {m.role === 'assistant' ? (
                    <Bot className="text-muted-foreground mt-0.5 size-4 shrink-0" />
                  ) : null}
                  <div
                    className={cn(
                      'max-w-[85%] rounded-lg px-3 py-2',
                      m.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted',
                    )}
                  >
                    {m.role === 'assistant' ? (
                      m.content ? (
                        renderMarkdown(m.content)
                      ) : (
                        <Loader2 className="size-4 animate-spin" />
                      )
                    ) : (
                      <p className="text-sm">{m.content}</p>
                    )}
                  </div>
                  {m.role === 'user' ? (
                    <User className="text-muted-foreground mt-0.5 size-4 shrink-0" />
                  ) : null}
                </div>
              ))
            )}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
            className="flex gap-2"
          >
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={`${selected.complexName}에 대해 물어보세요`}
              disabled={streaming}
            />
            <Button type="submit" size="icon" disabled={streaming || !input.trim()}>
              {streaming ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Send className="size-4" />
              )}
            </Button>
          </form>
        </TabsContent>
      </Tabs>
    </SectionCard>
  );
}
