-- 법정동별 월 실거래 집계 (지도 드릴다운 동 단위 표시용)
-- Supabase SQL Editor 에 붙여넣어 실행하세요.

create table if not exists public.dong_monthly (
  lawd_cd       text not null,             -- 시군구 법정동코드 앞 5자리
  dong          text not null,             -- 법정동 이름 (실거래 umdNm)
  month         text not null,             -- YYYY-MM
  price_per_m2  bigint not null,           -- ㎡당 중앙값 (원)
  trade_count   integer not null,
  updated_at    timestamptz not null default now(),
  primary key (lawd_cd, dong, month)
);

create index if not exists dong_monthly_lawd_idx on public.dong_monthly (lawd_cd, month);

alter table public.dong_monthly enable row level security;
-- 정책 없음 = anon 접근 불가, service_role 만 사용 (기존 테이블과 동일)
