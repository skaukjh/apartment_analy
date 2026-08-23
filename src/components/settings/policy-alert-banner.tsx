'use client';

/**
 * 정책 갱신 경고 배너 (관리자용).
 *
 * 정책 다이제스트가 매시간 공식 발표를 훑다가 코드에 하드코딩된 기준
 * (대출 한도·LTV/DSR·취득세·양도세·규제지역)과 관련된 새 발표를 감지하면
 * 여기 배너로 띄운다. 코드를 자동으로 바꾸지는 않는다 — 관리자가 발표를
 * 확인하고 해당 파일을 갱신한 뒤 "확인했음"으로 숨긴다.
 *
 * 일반 회원에게는 API 가 빈 목록을 주므로 아무것도 그리지 않는다.
 */

import { useEffect, useState } from 'react';
import { AlertTriangle, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

interface PolicyAlert {
  id: string;
  ruleKey: string;
  ruleLabel: string;
  codeBasis: string;
  file: string;
  title: string;
  url: string;
  publishedAt?: string;
  official: boolean;
}

export function PolicyAlertBanner() {
  const [alerts, setAlerts] = useState<PolicyAlert[]>([]);

  async function load() {
    const j = await fetch('/api/policy-alerts')
      .then((r) => r.json())
      .catch(() => null);
    if (j?.ok) setAlerts(j.alerts ?? []);
  }

  useEffect(() => {
    const id = setTimeout(() => void load(), 0);
    return () => clearTimeout(id);
  }, []);

  async function ack(id: string) {
    const j = await fetch('/api/policy-alerts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
      .then((r) => r.json())
      .catch(() => null);
    if (j?.ok) {
      setAlerts((prev) => prev.filter((a) => a.id !== id));
      toast.success('확인 처리했습니다. 같은 발표로는 다시 뜨지 않습니다.');
    } else {
      toast.error(j?.error ?? '확인 처리 실패');
    }
  }

  if (alerts.length === 0) return null;

  return (
    <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-4">
      <div className="mb-2 flex items-center gap-2 font-semibold text-amber-700 dark:text-amber-400">
        <AlertTriangle className="size-4 shrink-0" />
        정책 변경 감지 — 계산 기준 갱신 필요 여부를 확인하세요
      </div>
      <p className="text-muted-foreground mb-3 text-xs leading-relaxed">
        대출 한도·세율·규제지역 규칙은 코드에 직접 반영돼 있어 새 대책이 나와도 자동으로 바뀌지
        않습니다. 아래 발표를 확인하고, 규칙이 실제로 바뀌었다면 해당 파일을 갱신한 뒤 확인
        처리하세요.
      </p>
      <ul className="space-y-2">
        {alerts.map((a) => (
          <li
            key={a.id}
            className="bg-background/60 flex flex-wrap items-start justify-between gap-2 rounded-md border p-2.5"
          >
            <div className="min-w-0 text-sm">
              <div className="font-medium">
                {a.ruleLabel}
                <span className="text-muted-foreground ml-2 text-xs font-normal">
                  코드 기준: {a.codeBasis} · <code className="text-[11px]">{a.file}</code>
                </span>
              </div>
              <a
                href={a.url}
                target="_blank"
                rel="noreferrer noopener"
                className="text-muted-foreground mt-0.5 inline-flex items-center gap-1 text-xs underline-offset-2 hover:underline"
              >
                [{a.official ? '공식발표' : '기사'}] {a.title}
                <ExternalLink className="size-3 shrink-0" />
              </a>
            </div>
            <Button type="button" size="sm" variant="outline" onClick={() => void ack(a.id)}>
              확인했음
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
