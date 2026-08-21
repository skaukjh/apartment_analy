/**
 * 환경변수 접근 헬퍼.
 * 키가 없어도 앱이 죽지 않고 "해당 소스 비활성" 상태로 동작하도록 설계했다.
 */

function get(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim().length > 0 ? v.trim() : undefined;
}

export const env = {
  /** 공공데이터포털 (국토교통부 실거래가) 서비스키 — Decoding 키 사용 */
  get molitKey() {
    return get('DATA_GO_KR_SERVICE_KEY');
  },
  /** 한국은행 ECOS OpenAPI 인증키 */
  get ecosKey() {
    return get('ECOS_API_KEY');
  },
  /** 한국부동산원 R-ONE OpenAPI 인증키 */
  get rebKey() {
    return get('REB_API_KEY');
  },
  /** 네이버 검색 API */
  get naverClientId() {
    return get('NAVER_CLIENT_ID');
  },
  get naverClientSecret() {
    return get('NAVER_CLIENT_SECRET');
  },
  /** Supabase */
  get supabaseUrl() {
    return get('NEXT_PUBLIC_SUPABASE_URL');
  },
  get supabaseAnonKey() {
    return get('NEXT_PUBLIC_SUPABASE_ANON_KEY');
  },
  get supabaseServiceKey() {
    return get('SUPABASE_SERVICE_ROLE_KEY');
  },
  /** 카카오 */
  get kakaoRestKey() {
    return get('KAKAO_REST_API_KEY');
  },
  get kakaoClientSecret() {
    return get('KAKAO_CLIENT_SECRET');
  },
  get kakaoRedirectUri() {
    return get('KAKAO_REDIRECT_URI');
  },
  /** Vercel Cron 인증용 시크릿 */
  get cronSecret() {
    return get('CRON_SECRET');
  },
  /** 관리자 이메일 목록 (콤마 구분) — 가입 승인 권한 */
  get adminEmails(): string[] {
    return (get('ADMIN_EMAILS') ?? '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
  },
  /** 앱 공개 URL (카카오 메시지 링크용) */
  get appUrl() {
    return (
      get('NEXT_PUBLIC_APP_URL') ??
      (get('VERCEL_PROJECT_PRODUCTION_URL')
        ? `https://${get('VERCEL_PROJECT_PRODUCTION_URL')}`
        : undefined) ??
      'http://localhost:3000'
    );
  },
};

export const featureFlags = {
  get hasMolit() {
    return Boolean(env.molitKey);
  },
  get hasEcos() {
    return Boolean(env.ecosKey);
  },
  get hasReb() {
    return Boolean(env.rebKey);
  },
  get hasNaver() {
    return Boolean(env.naverClientId && env.naverClientSecret);
  },
  get hasSupabase() {
    return Boolean(env.supabaseUrl && env.supabaseAnonKey);
  },
  get hasSupabaseAdmin() {
    return Boolean(env.supabaseUrl && env.supabaseServiceKey);
  },
  get hasKakao() {
    return Boolean(env.kakaoRestKey);
  },
};
