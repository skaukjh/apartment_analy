/**
 * 카카오톡 "나에게 보내기" (메모 API) 클라이언트 — 다중 수신자 지원
 *
 * ── 왜 카카오톡 ID 로는 못 보내는가 ────────────────────────────────
 * 카카오는 "ID 를 입력해 아무에게나 보내는" API 를 제공하지 않는다. 스팸 방지 때문이다.
 * 남에게 보내는 경로는 두 가지뿐이고 둘 다 제약이 있다:
 *
 *  (A) 나에게 보내기 (memo API)  ← 이 앱이 쓰는 방식
 *      - 자기 자신에게만 보낸다. 검수·사업자등록 불필요.
 *      - 여러 명에게 보내려면 각 수신자가 이 앱에서 각자 "카카오 연결"을 1회 하면 된다.
 *        그러면 앱이 각자의 토큰으로 각자에게 보낸다. 카카오 ID 를 입력할 필요가 없다.
 *
 *  (B) 친구에게 보내기 (friends API)
 *      - 받는 사람을 카카오 ID 가 아니라 친구목록 API 가 주는 uuid 로 지정한다.
 *      - 수신자도 이 앱에 카카오 로그인을 해야 목록에 뜨고, friends 스코프는
 *        카카오 검수 대상이라 개발 단계에서는 팀원으로 등록된 계정에만 보낼 수 있다.
 *      - 결국 (A)와 똑같이 각자 로그인이 필요하면서 검수만 더 붙으므로 (A)를 쓴다.
 *
 * 준비:
 *  1. https://developers.kakao.com 에서 앱 생성 → REST API 키 확보
 *  2. [카카오 로그인] 활성화, Redirect URI 등록 (예: https://<앱주소>/api/kakao/callback)
 *  3. [동의항목] → "카카오톡 메시지 전송(talk_message)" 활성화
 *  4. 수신자마다 /settings 에서 "카카오 연결" 1회 (본인 카카오로 로그인)
 *
 * 토큰: access_token 약 6시간, refresh_token 약 2개월. 만료 시 자동 갱신한다.
 */

import { env } from '@/lib/env';
import { getAdminClient } from '@/lib/store/supabase';
import { memoryState, type KakaoTokenRecord } from '@/lib/store/memory';

const AUTH_HOST = 'https://kauth.kakao.com';
const API_HOST = 'https://kapi.kakao.com';

/** 첫 수신자의 고정 id — 기존 단일 수신자 데이터와 호환 */
export const PRIMARY_ID = 'default';

export type KakaoRecipient = KakaoTokenRecord;

/* ------------------------------------------------------------------ */
/* 저장소                                                              */
/* ------------------------------------------------------------------ */

interface TokenRow {
  id: string;
  user_id: string | null;
  access_token: string;
  refresh_token: string | null;
  expires_at: string;
  scope: string | null;
  label: string | null;
  kakao_nick: string | null;
  kakao_id: string | null;
  enabled: boolean | null;
}

function fromRow(r: TokenRow): KakaoRecipient {
  return {
    id: r.id,
    userId: r.user_id ?? 'default',
    accessToken: r.access_token,
    refreshToken: r.refresh_token ?? undefined,
    expiresAt: r.expires_at,
    scope: r.scope ?? undefined,
    label: r.label ?? undefined,
    nickname: r.kakao_nick ?? undefined,
    kakaoId: r.kakao_id ?? undefined,
    enabled: r.enabled ?? true,
  };
}

/**
 * 수신자 목록. userId 를 주면 그 사용자의 수신자만.
 * 다중 사용자 도입 후 각 사용자는 자기 수신자에게만 발송한다.
 */
export async function listRecipients(userId?: string): Promise<KakaoRecipient[]> {
  const client = getAdminClient();
  if (!client) {
    return [...memoryState().kakaoTokens.values()].filter(
      (r) => !userId || (r.userId ?? 'default') === userId,
    );
  }

  let query = client
    .from('kakao_token')
    .select(
      'id, user_id, access_token, refresh_token, expires_at, scope, label, kakao_nick, kakao_id, enabled',
    )
    .order('created_at', { ascending: true });
  if (userId) query = query.eq('user_id', userId);

  const { data, error } = await query;

  if (error) {
    console.error('[kakao] 수신자 조회 실패:', error.message);
    return [...memoryState().kakaoTokens.values()];
  }
  return (data ?? []).map((r) => fromRow(r as unknown as TokenRow));
}

export async function getRecipient(id: string): Promise<KakaoRecipient | null> {
  return (await listRecipients()).find((r) => r.id === id) ?? null;
}

export async function saveRecipient(recipient: KakaoRecipient): Promise<void> {
  memoryState().kakaoTokens.set(recipient.id, recipient);

  const client = getAdminClient();
  if (!client) return;

  const { error } = await client.from('kakao_token').upsert({
    id: recipient.id,
    user_id: recipient.userId ?? 'default',
    access_token: recipient.accessToken,
    refresh_token: recipient.refreshToken ?? null,
    expires_at: recipient.expiresAt,
    scope: recipient.scope ?? null,
    label: recipient.label ?? null,
    kakao_nick: recipient.nickname ?? null,
    kakao_id: recipient.kakaoId ?? null,
    enabled: recipient.enabled,
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(`카카오 토큰 저장 실패: ${error.message}`);
}

export async function removeRecipient(id: string): Promise<void> {
  memoryState().kakaoTokens.delete(id);
  const client = getAdminClient();
  if (client) await client.from('kakao_token').delete().eq('id', id);
}

export async function setRecipientEnabled(id: string, enabled: boolean): Promise<void> {
  const r = await getRecipient(id);
  if (!r) return;
  await saveRecipient({ ...r, enabled });
}

/** 같은 사용자가 같은 카카오 계정을 이미 등록했는지 */
async function findByKakaoId(kakaoId: string, userId: string): Promise<KakaoRecipient | null> {
  return (await listRecipients(userId)).find((r) => r.kakaoId === kakaoId) ?? null;
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
    // 수신자를 추가할 때 다른 카카오 계정으로 로그인할 수 있도록 계정 선택을 강제한다
    prompt: 'login',
  });
  if (state) params.set('state', state);
  return `${AUTH_HOST}/oauth/authorize?${params.toString()}`;
}

interface KakaoTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
  error?: string;
  error_description?: string;
}

async function requestToken(
  body: Record<string, string>,
): Promise<Omit<KakaoRecipient, 'id' | 'enabled'>> {
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

/** 액세스 토큰으로 카카오 회원번호·닉네임을 조회 (수신자 구분용) */
async function fetchProfile(accessToken: string): Promise<{ kakaoId?: string; nickname?: string }> {
  try {
    const res = await fetch(`${API_HOST}/v2/user/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
    });
    if (!res.ok) return {};
    const json = (await res.json()) as {
      id?: number;
      properties?: { nickname?: string };
      kakao_account?: { profile?: { nickname?: string } };
    };
    return {
      kakaoId: json.id !== undefined ? String(json.id) : undefined,
      nickname: json.properties?.nickname ?? json.kakao_account?.profile?.nickname,
    };
  } catch {
    // 프로필 동의항목이 없으면 실패할 수 있다 — 메시지 전송에는 지장 없다
    return {};
  }
}

/**
 * 인가 코드를 토큰으로 바꾸고 수신자로 등록한다.
 * 같은 카카오 계정이면 기존 수신자를 갱신한다.
 */
export async function exchangeCodeAndRegister(
  code: string,
  redirectUri: string,
  label?: string,
  userId: string = 'default',
): Promise<KakaoRecipient> {
  const key = env.kakaoRestKey;
  if (!key) throw new Error('KAKAO_REST_API_KEY 가 설정되지 않았습니다.');

  const body: Record<string, string> = {
    grant_type: 'authorization_code',
    client_id: key,
    redirect_uri: redirectUri,
    code,
  };
  if (env.kakaoClientSecret) body.client_secret = env.kakaoClientSecret;

  const token = await requestToken(body);
  const profile = await fetchProfile(token.accessToken);

  const existing = profile.kakaoId ? await findByKakaoId(profile.kakaoId, userId) : null;
  const existingCount = (await listRecipients(userId)).length;

  const recipient: KakaoRecipient = {
    ...token,
    userId,
    // 레거시('default' 사용자)의 첫 수신자만 고정 id 를 쓴다 (기존 데이터 호환)
    id:
      existing?.id ??
      (existingCount === 0 && userId === 'default' ? PRIMARY_ID : crypto.randomUUID()),
    label: label ?? existing?.label ?? profile.nickname,
    nickname: profile.nickname ?? existing?.nickname,
    kakaoId: profile.kakaoId ?? existing?.kakaoId,
    enabled: existing?.enabled ?? true,
  };

  await saveRecipient(recipient);
  return recipient;
}

async function refreshAccessToken(recipient: KakaoRecipient): Promise<KakaoRecipient> {
  const key = env.kakaoRestKey;
  if (!key) throw new Error('KAKAO_REST_API_KEY 가 설정되지 않았습니다.');
  if (!recipient.refreshToken) {
    throw new Error(
      `${recipient.label ?? recipient.id}: 액세스 토큰이 만료됐고 갱신 토큰이 없습니다. 다시 연결해 주세요.`,
    );
  }

  const body: Record<string, string> = {
    grant_type: 'refresh_token',
    client_id: key,
    refresh_token: recipient.refreshToken,
  };
  if (env.kakaoClientSecret) body.client_secret = env.kakaoClientSecret;

  const fresh = await requestToken(body);
  const updated: KakaoRecipient = {
    ...recipient,
    ...fresh,
    // 갱신 응답에 refresh_token 이 없으면 기존 것을 유지한다
    refreshToken: fresh.refreshToken ?? recipient.refreshToken,
  };
  await saveRecipient(updated);
  return updated;
}

/** 유효한 액세스 토큰 확보 (필요 시 자동 갱신) */
async function ensureAccessToken(recipient: KakaoRecipient): Promise<string> {
  if (new Date(recipient.expiresAt).getTime() > Date.now()) return recipient.accessToken;
  return (await refreshAccessToken(recipient)).accessToken;
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

export type KakaoTemplate = KakaoTextTemplate;

async function sendMemoAs(recipient: KakaoRecipient, template: KakaoTemplate): Promise<void> {
  const accessToken = await ensureAccessToken(recipient);

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
    throw new Error(`카카오 전송 실패 (${res.status}): ${text.slice(0, 300)}`);
  }
  const json = JSON.parse(text || '{}') as { result_code?: number };
  if (json.result_code !== undefined && json.result_code !== 0) {
    throw new Error(`카카오 전송 실패 result_code=${json.result_code}`);
  }
}

export interface SendReport {
  recipient: string;
  ok: boolean;
  error?: string;
}

/**
 * 활성 수신자 전원에게 메시지 묶음을 보낸다.
 * 한 명이 실패해도 나머지는 계속 보내고, 결과를 개별로 돌려준다.
 */
export async function broadcast(
  templates: KakaoTemplate[],
  options: { recipientIds?: string[]; userId?: string } = {},
): Promise<SendReport[]> {
  const all = await listRecipients(options.userId);
  const targets = all.filter(
    (r) => r.enabled && (!options.recipientIds || options.recipientIds.includes(r.id)),
  );

  if (targets.length === 0) {
    throw new Error('발송 대상이 없습니다. 설정에서 카카오 계정을 연결하세요.');
  }

  const reports: SendReport[] = [];
  for (const recipient of targets) {
    const name = recipient.label ?? recipient.nickname ?? recipient.id;
    try {
      for (const t of templates) {
        await sendMemoAs(recipient, t);
        // 카카오 API 는 연속 호출에 rate limit 이 있다
        await new Promise((r) => setTimeout(r, 400));
      }
      reports.push({ recipient: name, ok: true });
    } catch (e) {
      reports.push({ recipient: name, ok: false, error: (e as Error).message });
    }
  }
  return reports;
}

/** 연결 상태 요약 (설정 화면용) */
export async function getConnectionStatus(userId?: string): Promise<{
  connected: boolean;
  reason?: string;
  recipients: Array<{
    id: string;
    label: string;
    nickname?: string;
    enabled: boolean;
    expiresAt: string;
    expired: boolean;
  }>;
}> {
  if (!env.kakaoRestKey) {
    return { connected: false, reason: 'KAKAO_REST_API_KEY 미설정', recipients: [] };
  }
  const list = await listRecipients(userId);
  return {
    connected: list.length > 0,
    reason: list.length === 0 ? '연결된 카카오 계정이 없습니다.' : undefined,
    recipients: list.map((r) => ({
      id: r.id,
      label: r.label ?? r.nickname ?? r.id,
      nickname: r.nickname,
      enabled: r.enabled,
      expiresAt: r.expiresAt,
      expired: new Date(r.expiresAt).getTime() <= Date.now(),
    })),
  };
}
