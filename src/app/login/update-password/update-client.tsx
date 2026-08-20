'use client';

/**
 * 비밀번호 재설정 마지막 단계.
 * 재설정 메일의 링크가 이 페이지로 오면 Supabase 가 임시 세션을 만들어 주고,
 * 그 세션으로 새 비밀번호를 저장한다.
 */

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { getBrowserSupabase } from '@/lib/auth/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function UpdatePasswordClient() {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) return toast.error('비밀번호는 8자 이상이어야 합니다.');

    setBusy(true);
    try {
      const { error } = await getBrowserSupabase().auth.updateUser({ password });
      if (error) throw error;
      toast.success('비밀번호를 바꿨습니다.');
      window.location.assign(new URL('/settings', window.location.origin).toString());
    } catch (err) {
      const msg = (err as Error).message;
      toast.error(
        /session/i.test(msg) ? '재설정 링크가 만료됐습니다. 로그인 화면에서 다시 요청하세요.' : msg,
        { duration: 8000 },
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-sm flex-col justify-center px-4 py-10">
      <h1 className="mb-6 text-center text-xl font-semibold">새 비밀번호 설정</h1>
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="new-password">새 비밀번호</Label>
          <Input
            id="new-password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="8자 이상"
          />
        </div>
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : null}
          <span className="ml-1.5">저장</span>
        </Button>
      </form>
    </div>
  );
}
