'use client';

/**
 * 로그인 · 가입 · 비밀번호 재설정 (Supabase Auth)
 *
 * - 가입: 이메일 확인이 켜져 있으면 확인 메일을 보내고, 링크를 누르면 로그인된다.
 * - 재설정: 재설정 메일의 링크가 /login/update-password 로 돌아와 새 비밀번호를 받는다.
 * - 로그인하면 ?next= 로 지정된 곳(기본 /settings)으로 이동한다.
 */

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Loader2, LogIn } from 'lucide-react';
import { toast } from 'sonner';
import { getBrowserSupabase } from '@/lib/auth/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type Mode = 'signin' | 'signup' | 'reset';

const MODE_LABEL: Record<Mode, string> = {
  signin: '로그인',
  signup: '가입하기',
  reset: '재설정 메일 보내기',
};

export function LoginClient() {
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const params = useSearchParams();
  const next = params.get('next') || '/settings';

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return toast.error('이메일을 입력하세요.');
    if (mode !== 'reset' && password.length < 8)
      return toast.error('비밀번호는 8자 이상이어야 합니다.');

    setBusy(true);
    const supabase = getBrowserSupabase();
    const origin = window.location.origin;

    try {
      if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        window.location.assign(new URL(next, window.location.origin).toString());
        return;
      }

      if (mode === 'signup') {
        // 서버(admin API)가 계정을 만든다 — 확인 메일 의존 없이 바로 로그인 가능
        const res = await fetch('/api/auth/signup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
        });
        const json = await res.json();
        if (!json.ok) throw new Error(json.error ?? '가입에 실패했습니다.');

        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast.success('가입 완료. 환영합니다!');
        window.location.assign(new URL(next, window.location.origin).toString());
        return;
      }

      // reset
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${origin}/login/update-password`,
      });
      if (error) throw error;
      toast.success('재설정 메일을 보냈습니다. 메일의 링크에서 새 비밀번호를 정하세요.', {
        duration: 10000,
      });
      setMode('signin');
    } catch (err) {
      const msg = (err as Error).message;
      // Supabase 오류를 사람이 읽을 수 있게
      const friendly = /Invalid login credentials/i.test(msg)
        ? '이메일 또는 비밀번호가 맞지 않습니다.'
        : /already registered/i.test(msg)
          ? '이미 가입된 이메일입니다. 로그인하거나 비밀번호를 재설정하세요.'
          : /rate limit/i.test(msg)
            ? '메일 발송 한도에 걸렸습니다. 잠시 후 다시 시도하세요.'
            : msg;
      toast.error(friendly, { duration: 8000 });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-sm flex-col justify-center px-4 py-10">
      <div className="mb-6 text-center">
        <h1 className="text-xl font-semibold">
          {mode === 'signin' ? '로그인' : mode === 'signup' ? '계정 만들기' : '비밀번호 재설정'}
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {mode === 'reset'
            ? '가입한 이메일로 재설정 링크를 보냅니다.'
            : '보유·목표 아파트 설정은 계정별로 저장됩니다.'}
        </p>
      </div>

      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="email">이메일</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
        </div>

        {mode !== 'reset' ? (
          <div className="space-y-1.5">
            <Label htmlFor="password">비밀번호</Label>
            <Input
              id="password"
              type="password"
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="8자 이상"
            />
          </div>
        ) : null}

        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <LogIn className="size-4" />}
          <span className="ml-1.5">{MODE_LABEL[mode]}</span>
        </Button>
      </form>

      <div className="text-muted-foreground mt-5 flex justify-between text-sm">
        {mode !== 'signup' ? (
          <button type="button" className="hover:underline" onClick={() => setMode('signup')}>
            계정 만들기
          </button>
        ) : (
          <button type="button" className="hover:underline" onClick={() => setMode('signin')}>
            로그인으로
          </button>
        )}
        {mode !== 'reset' ? (
          <button type="button" className="hover:underline" onClick={() => setMode('reset')}>
            비밀번호를 잊었어요
          </button>
        ) : (
          <button type="button" className="hover:underline" onClick={() => setMode('signin')}>
            로그인으로
          </button>
        )}
      </div>
    </div>
  );
}
