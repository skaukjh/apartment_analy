/**
 * 서버에서 로그인 사용자 확인 (Supabase Auth)
 *
 * ── 구조 ─────────────────────────────────────────────────────────
 * - 브라우저는 anon 키로 Supabase Auth 에 로그인하고, 세션은 쿠키에 담긴다.
 * - 서버(페이지·API)는 이 모듈로 쿠키에서 사용자를 읽는다.
 * - 데이터 접근은 기존처럼 service role 로만 한다. 따라서 "누구의 데이터를
 *   읽고 쓸지"는 반드시 여기서 얻은 사용자 id 로 정해야 한다.
 *   클라이언트가 보낸 id 를 그대로 믿으면 남의 설정을 고칠 수 있게 된다.
 *
 * - 토큰 갱신은 src/proxy.ts 가 담당한다 (서버 컴포넌트는 쿠키를 못 쓴다).
 */

import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { env } from '@/lib/env';

/** 로그인하지 않은 요청이 쓰는 레거시 설정 id (기존 단일 사용자 시절의 행) */
export const ANON_CONFIG_ID = 'default';

export interface SessionUser {
  id: string;
  email: string | null;
}

function authConfigured(): boolean {
  return Boolean(env.supabaseUrl && env.supabaseAnonKey);
}

/**
 * 현재 요청의 로그인 사용자. 없으면 null.
 * 서버 컴포넌트·라우트 핸들러 어디서든 호출할 수 있다.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  if (!authConfigured()) return null;

  const cookieStore = await cookies();

  const client = createServerClient(env.supabaseUrl!, env.supabaseAnonKey!, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      // 서버 컴포넌트에서는 쿠키를 쓸 수 없다. 갱신은 proxy.ts 몫이므로 조용히 무시한다.
      setAll: () => {},
    },
  });

  const { data, error } = await client.auth.getUser();
  if (error || !data.user) return null;

  return { id: data.user.id, email: data.user.email ?? null };
}

/** 로그인했으면 그 사용자의 설정 id, 아니면 레거시 'default' */
export async function configIdForRequest(): Promise<string> {
  const user = await getSessionUser();
  return user?.id ?? ANON_CONFIG_ID;
}
