-- 다중 사용자 지원
--
-- user_config.id 는 원래 text PK('default')라 그대로 사용자 id(auth.users.id)를 담는다.
-- 기존 'default' 행은 로그인하지 않은(레거시) 설정으로 남는다.
--
-- kakao_token 은 어느 사용자의 수신자인지 구분할 컬럼이 없어 추가한다.

-- 1) 카카오 수신자에 소유자 표시
alter table public.kakao_token
  add column if not exists user_id text not null default 'default';

create index if not exists kakao_token_user_idx
  on public.kakao_token (user_id);

-- 2) "같은 카카오 계정 중복 금지"는 사용자 단위로 완화한다
--    (다른 사용자가 같은 카카오 계정을 자기 수신자로 등록하는 건 허용)
drop index if exists kakao_token_kakao_id_idx;

create unique index if not exists kakao_token_user_kakao_idx
  on public.kakao_token (user_id, kakao_id)
  where kakao_id is not null;
