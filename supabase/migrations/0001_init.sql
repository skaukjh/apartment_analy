-- 부동산 매매 현황 분석 앱 초기 스키마
-- Supabase SQL Editor 에 붙여넣어 실행하세요.

-- 1) 사용자 설정 (보유/목표 아파트, 관심 지역, 세대 프로필)
create table if not exists public.user_config (
  id          text primary key default 'default',
  data        jsonb not null,
  updated_at  timestamptz not null default now()
);

-- 2) 시군구·월별 실거래 집계 캐시 (국토교통부 실거래가 파생)
create table if not exists public.region_monthly (
  lawd_cd       text not null,
  month         text not null,           -- YYYY-MM
  price_per_m2  bigint not null,         -- ㎡당 중앙값 (원)
  trade_count   integer not null,
  median_price  bigint,                  -- 거래가 중앙값 (원)
  updated_at    timestamptz not null default now(),
  primary key (lawd_cd, month)
);

create index if not exists region_monthly_month_idx on public.region_monthly (month);

-- 3) 관심/보유 지역의 원본 거래 캐시 (신고가·신저가 분석용)
create table if not exists public.trade_cache (
  lawd_cd     text not null,
  month       text not null,             -- YYYYMM
  payload     jsonb not null,            -- TradeRecord[]
  updated_at  timestamptz not null default now(),
  primary key (lawd_cd, month)
);

-- 4) 대시보드 스냅샷 (브리핑 비교 및 빠른 로딩용)
create table if not exists public.dashboard_snapshot (
  id          bigserial primary key,
  captured_at timestamptz not null default now(),
  payload     jsonb not null
);

create index if not exists dashboard_snapshot_captured_idx
  on public.dashboard_snapshot (captured_at desc);

-- 5) 카카오 액세스 토큰 (나에게 보내기용)
create table if not exists public.kakao_token (
  id             text primary key default 'default',
  access_token   text not null,
  refresh_token  text,
  expires_at     timestamptz not null,
  scope          text,
  updated_at     timestamptz not null default now()
);

-- 6) 브리핑 발송 이력
create table if not exists public.briefing_log (
  id         bigserial primary key,
  sent_at    timestamptz not null default now(),
  status     text not null,              -- sent | failed | skipped
  message    text,
  error      text,
  payload    jsonb
);

create index if not exists briefing_log_sent_idx on public.briefing_log (sent_at desc);

-- 7) 사용자 등록 호재
create table if not exists public.catalyst (
  id           text primary key,
  region_id    text,
  title        text not null,
  category     text not null,
  stage        text not null,
  progress     integer not null default 0,
  expected_at  text,
  last_update  text,
  impact       text not null default 'medium',
  source_url   text,
  updated_at   timestamptz not null default now()
);

-- RLS: 개인용 단일 사용자 앱이므로 서버(Service Role)만 접근하도록 잠근다.
alter table public.user_config        enable row level security;
alter table public.region_monthly     enable row level security;
alter table public.trade_cache        enable row level security;
alter table public.dashboard_snapshot enable row level security;
alter table public.kakao_token        enable row level security;
alter table public.briefing_log       enable row level security;
alter table public.catalyst           enable row level security;

-- 별도 정책을 만들지 않으면 anon/authenticated 는 접근 불가,
-- service_role 키는 RLS 를 우회하므로 서버 라우트에서만 읽고 씁니다.
