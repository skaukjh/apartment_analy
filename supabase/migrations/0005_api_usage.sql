-- 외부 API 호출량 자체 집계.
-- 어느 공공 API 도 "남은 쿼터"를 응답으로 주지 않으므로 우리가 보낸 호출 수를 직접 센다.
-- (source, day KST) 단위 카운터이며, bump_api_usage RPC 로만 증가시킨다 — upsert 경쟁을 피하기 위한 원자적 증가.

create table if not exists api_usage (
  source text not null,
  day date not null,
  count integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (source, day)
);

alter table api_usage enable row level security;
-- service role 만 접근한다 (정책 없음 = anon 차단)

create or replace function bump_api_usage(src text, d date, n integer)
returns void
language sql
security definer
as $$
  insert into api_usage (source, day, count, updated_at)
  values (src, d, n, now())
  on conflict (source, day) do update
    set count = api_usage.count + excluded.count,
        updated_at = now();
$$;
