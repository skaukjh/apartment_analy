'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { MessageCircle, Send, Loader2 } from 'lucide-react';
import { SectionCard } from '@/components/ui-bits';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

interface Props {
  /** 서버에서 미리 만든 브리핑 원문 */
  text: string;
  chunkCount: number;
  kakaoConnected: boolean;
}

export function BriefingCard({ text, chunkCount, kakaoConnected }: Props) {
  const [sending, setSending] = useState(false);

  async function send() {
    setSending(true);
    try {
      const res = await fetch('/api/kakao/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: true }),
      });
      const json = await res.json();
      if (json.ok && !json.skippedReason) {
        toast.success(`카카오톡으로 ${json.messageCount}건 전송했습니다.`);
      } else if (json.skippedReason) {
        toast.warning(json.skippedReason);
      } else {
        toast.error(json.error ?? '전송에 실패했습니다.');
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  return (
    <SectionCard
      title={
        <>
          <MessageCircle className="size-4" /> 오늘의 카카오톡 브리핑
        </>
      }
      description={`카카오 text 템플릿 200자 제한에 맞춰 ${chunkCount}건으로 분할 전송됩니다.`}
      badge={
        kakaoConnected ? (
          <Badge variant="secondary">연결됨</Badge>
        ) : (
          <Badge variant="outline">미연결</Badge>
        )
      }
      action={
        <Button size="sm" onClick={send} disabled={sending || !kakaoConnected}>
          {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          지금 전송
        </Button>
      }
    >
      <pre className="thin-scrollbar bg-muted/40 max-h-80 overflow-auto rounded-lg border p-4 font-sans text-xs leading-relaxed whitespace-pre-wrap">
        {text}
      </pre>
      {!kakaoConnected ? (
        <p className="text-muted-foreground mt-2 text-xs">
          설정 화면에서 카카오 계정을 먼저 연결하세요.
        </p>
      ) : null}
    </SectionCard>
  );
}
