-- 카카오 브리핑 다중 수신자 지원
-- 기존 kakao_token(단일 행)을 여러 수신자로 확장합니다.
-- Supabase SQL Editor 에 붙여넣어 실행하세요.

-- 1) 수신자 식별 정보 컬럼 추가
alter table public.kakao_token
  add column if not exists label       text,           -- 화면에 표시할 이름 (별명)
  add column if not exists kakao_nick  text,           -- 카카오 프로필 닉네임
  add column if not exists kakao_id    text,           -- 카카오 회원번호 (중복 연결 방지용)
  add column if not exists enabled     boolean not null default true,
  add column if not exists created_at  timestamptz not null default now();

-- 2) 같은 카카오 계정이 중복 등록되지 않도록
create unique index if not exists kakao_token_kakao_id_idx
  on public.kakao_token (kakao_id)
  where kakao_id is not null;

-- 참고: id 컬럼은 그대로 primary key 이며, 기존 'default' 행은 첫 번째 수신자로 남습니다.
--       새 수신자는 랜덤 id 로 추가됩니다.
