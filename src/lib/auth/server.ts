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
  /**
   * 가입 승인 여부 — 남발 방지용.
   * 신규 가입은 app_metadata.approved=false 로 시작하고 관리자가 승인한다.
   * app_metadata 는 서버(admin API)만 쓸 수 있어 클라이언트가 위조할 수 없다.
   */
  approved: boolean;
  /** ADMIN_EMAILS 에 있는 계정 — 승인 권한 */
  isAdmin: boolean;
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

  const email = data.user.email?.toLowerCase() ?? null;
  const isAdmin = Boolean(email && env.adminEmails.includes(email));
  const approved =
    isAdmin || (data.user.app_metadata as Record<string, unknown> | null)?.approved === true;

  return { id: data.user.id, email, approved, isAdmin };
}

/** 승인된 사용자만 통과. 아니면 이유를 담은 에러 정보를 돌려준다. */
export async function requireApprovedUser(): Promise<
  { user: SessionUser } | { error: string; status: number }
> {
  const user = await getSessionUser();
  if (!user) return { error: '로그인이 필요합니다.', status: 401 };
  if (!user.approved)
    return { error: '가입 승인 대기 중입니다. 관리자 승인 후 이용할 수 있습니다.', status: 403 };
  return { user };
}

/** 로그인했으면 그 사용자의 설정 id, 아니면 레거시 'default' */
export async function configIdForRequest(): Promise<string> {
  const user = await getSessionUser();
  return user?.id ?? ANON_CONFIG_ID;
}
