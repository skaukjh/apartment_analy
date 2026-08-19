/**
 * 카카오톡 "나에게 보내기" (메모 API) 클라이언트
 *
 * 왜 알림톡이 아니라 메모 API인가:
 *  - 카카오 알림톡/친구톡은 사업자등록 + 발신프로필 심사가 필요하다.
 *  - 개인이 본인에게 보내는 용도라면 talk_message 스코프의 메모 API가 정식 경로이며
 *    별도 심사 없이 즉시 사용할 수 있다.
 *
 * 준비:
 *  1. https://developers.kakao.com 에서 앱 생성 → REST API 키 확보
 *  2. [카카오 로그인] 활성화, Redirect URI 등록 (예: https://<앱주소>/api/kakao/callback)
 *  3. [동의항목] → "카카오톡 메시지 전송(talk_message)" 활성화
 *  4. 앱 배포 후 /settings 에서 "카카오 연결" 버튼으로 1회 인증
 *
 * 토큰: access_token 약 6시간, refresh_token 약 2개월.
 *       만료 시 refresh_token 으로 자동 갱신한다.
 */

import { env } from '@/lib/env';
import { getAdminClient } from '@/lib/store/supabase';
import { memoryState } from '@/lib/store/memory';

const AUTH_HOST = 'https://kauth.kakao.com';
const API_HOST = 'https://kapi.kakao.com';
const TOKEN_ID = 'default';

export interface KakaoToken {
  accessToken: string;
  refreshToken?: string;
  expiresAt: string;
  scope?: string;
}

/* ------------------------------------------------------------------ */
/* 토큰 저장 (Supabase 없으면 메모리)                                    */
/* ------------------------------------------------------------------ */

export async function loadToken(): Promise<KakaoToken | null> {
  const client = getAdminClient();
  if (!client) return memoryState().kakaoToken;

  const { data, error } = await client
    .from('kakao_token')
    .select('access_token, refresh_token, expires_at, scope')
    .eq('id', TOKEN_ID)
    .maybeSingle();

  if (error || !data) return memoryState().kakaoToken;
  return {
    accessToken: data.access_token as string,
    refreshToken: (data.refresh_token as string) ?? undefined,
    expiresAt: data.expires_at as string,
    scope: (data.scope as string) ?? undefined,
  };
}

export async function saveToken(token: KakaoToken): Promise<void> {
  memoryState().kakaoToken = token;
  const client = getAdminClient();
  if (!client) return;

  const { error } = await client.from('kakao_token').upsert({
    id: TOKEN_ID,
    access_token: token.accessToken,
    refresh_token: token.refreshToken ?? null,
    expires_at: token.expiresAt,
    scope: token.scope ?? null,
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(`카카오 토큰 저장 실패: ${error.message}`);
}

export async function clearToken(): Promise<void> {
  memoryState().kakaoToken = null;
  const client = getAdminClient();
  if (client) await client.from('kakao_token').delete().eq('id', TOKEN_ID);
}

/* ------------------------------------------------------------------ */
/* OAuth                                                               */
/* ------------------------------------------------------------------ */

export function buildAuthUrl(redirectUri: string, state?: string): string {
  const key = env.kakaoRestKey;
  if (!key) throw new Error('KAKAO_REST_API_KEY 가 설정되지 않았습니다.');

  const params = new URLSearchParams({
    client_id: key,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'talk_message',
  });
  if (state) params.set('state', state);
  return `${AUTH_HOST}/oauth/authorize?${params.toString()}`;
}

interface KakaoTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  refresh_token_expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}

async function requestToken(body: Record<string, string>): Promise<KakaoToken> {
  const res = await fetch(`${AUTH_HOST}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
    body: new URLSearchParams(body).toString(),
    cache: 'no-store',
  });

  const json = (await res.json()) as KakaoTokenResponse;
  if (!res.ok || json.error) {
    throw new Error(
      `카카오 토큰 발급 실패: ${json.error ?? res.status} ${json.error_description ?? ''}`,
    );
  }

  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: new Date(Date.now() + (json.expires_in - 60) * 1000).toISOString(),
    scope: json.scope,
  };
}

export async function exchangeCode(code: string, redirectUri: string): Promise<KakaoToken> {
  const key = env.kakaoRestKey;
  if (!key) throw new Error('KAKAO_REST_API_KEY 가 설정되지 않았습니다.');

  const body: Record<string, string> = {
    grant_type: 'authorization_code',
    client_id: key,
    redirect_uri: redirectUri,
    code,
  };
  if (env.kakaoClientSecret) body.client_secret = env.kakaoClientSecret;

  return requestToken(body);
}

export async function refreshAccessToken(refreshToken: string): Promise<KakaoToken> {
  const key = env.kakaoRestKey;
  if (!key) throw new Error('KAKAO_REST_API_KEY 가 설정되지 않았습니다.');

  const body: Record<string, string> = {
    grant_type: 'refresh_token',
    client_id: key,
    refresh_token: refreshToken,
  };
  if (env.kakaoClientSecret) body.client_secret = env.kakaoClientSecret;

  const fresh = await requestToken(body);
  // 갱신 응답에 refresh_token 이 없으면 기존 것을 유지한다
  return { ...fresh, refreshToken: fresh.refreshToken ?? refreshToken };
}

/** 유효한 액세스 토큰을 확보 (필요 시 자동 갱신) */
export async function ensureAccessToken(): Promise<string> {
  const token = await loadToken();
  if (!token) {
    throw new Error(
      '카카오 계정이 연결되지 않았습니다. 설정 화면에서 "카카오 연결"을 먼저 진행하세요.',
    );
  }

  if (new Date(token.expiresAt).getTime() > Date.now()) return token.accessToken;

  if (!token.refreshToken) {
    throw new Error('카카오 액세스 토큰이 만료되었고 갱신 토큰이 없습니다. 다시 연결해 주세요.');
  }

  const refreshed = await refreshAccessToken(token.refreshToken);
  await saveToken(refreshed);
  return refreshed.accessToken;
}

/* ------------------------------------------------------------------ */
/* 메시지 전송                                                          */
/* ------------------------------------------------------------------ */

export interface KakaoLink {
  web_url: string;
  mobile_web_url: string;
}

export interface KakaoTextTemplate {
  object_type: 'text';
  text: string;
  link: KakaoLink;
  button_title?: string;
}

export interface KakaoFeedTemplate {
  object_type: 'feed';
  content: {
    title: string;
    description: string;
    image_url?: string;
    link: KakaoLink;
  };
  item_content?: {
    profile_text?: string;
    items?: Array<{ item: string; item_op: string }>;
    sum?: string;
    sum_op?: string;
  };
  buttons?: Array<{ title: string; link: KakaoLink }>;
}

export type KakaoTemplate = KakaoTextTemplate | KakaoFeedTemplate;

/** 나에게 메시지 1건 전송 */
export async function sendMemo(template: KakaoTemplate): Promise<void> {
  const accessToken = await ensureAccessToken();

  const res = await fetch(`${API_HOST}/v2/api/talk/memo/default/send`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
    },
    body: new URLSearchParams({ template_object: JSON.stringify(template) }).toString(),
    cache: 'no-store',
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`카카오 메시지 전송 실패 (${res.status}): ${text.slice(0, 300)}`);
  }
  const json = JSON.parse(text || '{}') as { result_code?: number };
  if (json.result_code !== undefined && json.result_code !== 0) {
    throw new Error(`카카오 메시지 전송 실패 result_code=${json.result_code}`);
  }
}

/** 여러 건을 순차 전송 (카카오 API 는 대량 전송 시 rate limit 이 있다) */
export async function sendMemos(templates: KakaoTemplate[]): Promise<void> {
  for (const t of templates) {
    await sendMemo(t);
    await new Promise((r) => setTimeout(r, 400));
  }
}

/** 연결 상태 확인 */
export async function getConnectionStatus(): Promise<{
  connected: boolean;
  expiresAt?: string;
  scope?: string;
  reason?: string;
}> {
  if (!env.kakaoRestKey) return { connected: false, reason: 'KAKAO_REST_API_KEY 미설정' };
  const token = await loadToken();
  if (!token) return { connected: false, reason: '아직 연결되지 않음' };
  return { connected: true, expiresAt: token.expiresAt, scope: token.scope };
}
