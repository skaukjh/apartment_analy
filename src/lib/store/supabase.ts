/**
 * Supabase 서버 클라이언트 (Service Role).
 * RLS 를 우회하므로 반드시 서버 라우트에서만 사용한다.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env, featureFlags } from '@/lib/env';

let cached: SupabaseClient | null = null;

export function getAdminClient(): SupabaseClient | null {
  if (!featureFlags.hasSupabaseAdmin) return null;
  if (cached) return cached;
  cached = createClient(env.supabaseUrl!, env.supabaseServiceKey!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}

export function requireAdminClient(): SupabaseClient {
  const client = getAdminClient();
  if (!client) {
    throw new Error(
      'Supabase 가 설정되지 않았습니다. NEXT_PUBLIC_SUPABASE_URL 과 SUPABASE_SERVICE_ROLE_KEY 를 확인하세요.',
    );
  }
  return client;
}
