import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/server';
import { LoginClient } from './login-client';

export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  // 이미 로그인돼 있으면 로그인 화면을 보여줄 이유가 없다
  const user = await getSessionUser();
  if (user) redirect('/settings');

  return (
    <Suspense>
      <LoginClient />
    </Suspense>
  );
}
