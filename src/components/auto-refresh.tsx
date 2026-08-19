'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw } from 'lucide-react';
import { REFRESH_INTERVAL_SECONDS } from '@/lib/refresh-policy';
import { cn } from '@/lib/utils';

interface Props {
  /** 서버가 데이터를 만든 시각 (ISO) */
  generatedAt: string;
}

/**
 * 탭을 열어둔 채로 두어도 화면이 낡지 않도록 주기적으로 서버 데이터를 다시 가져온다.
 * 백그라운드 탭에서는 낭비이므로 다시 보이는 순간에만 갱신을 확인한다.
 */
export function AutoRefresh({ generatedAt }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [elapsed, setElapsed] = useState(0);

  const refresh = () => startTransition(() => router.refresh());

  useEffect(() => {
    const generated = new Date(generatedAt).getTime();

    const tick = () => setElapsed(Math.floor((Date.now() - generated) / 1000));
    tick();
    const timer = setInterval(() => {
      tick();
      if (
        Date.now() - generated >= REFRESH_INTERVAL_SECONDS * 1000 &&
        document.visibilityState === 'visible'
      ) {
        refresh();
      }
    }, 30_000);

    // 탭으로 돌아왔을 때 낡았으면 즉시 갱신
    const onVisible = () => {
      if (
        document.visibilityState === 'visible' &&
        Date.now() - generated >= REFRESH_INTERVAL_SECONDS * 1000
      ) {
        refresh();
      }
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generatedAt]);

  const remaining = Math.max(0, REFRESH_INTERVAL_SECONDS - elapsed);
  const label =
    elapsed < 60
      ? '방금 갱신'
      : elapsed < 3600
        ? `${Math.floor(elapsed / 60)}분 전 갱신`
        : `${Math.floor(elapsed / 3600)}시간 전 갱신`;

  return (
    <button
      type="button"
      onClick={refresh}
      disabled={pending}
      title={`${Math.ceil(remaining / 60)}분 뒤 자동 갱신 · 클릭하면 즉시 갱신`}
      className={cn(
        'flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition-colors',
        'text-muted-foreground hover:bg-muted hover:text-foreground',
        pending && 'opacity-60',
      )}
    >
      <RefreshCw className={cn('size-3', pending && 'animate-spin')} />
      {pending ? '갱신 중…' : label}
    </button>
  );
}
