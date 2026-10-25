-- 정기 작업(/api/cron/tick)을 Supabase pg_cron 으로 30분마다 부른다.
--
-- ── 왜 필요한가 ──────────────────────────────────────────────────
-- tick 을 부르던 GitHub Actions 무료 cron(7,37분)은 하루 48번 중 3~5번만 실제로 왔다.
-- 그래서 08시로 설정한 카톡이 08:59·10:08 에 나가고, 17·21시 브리핑이 2시간 넘게 밀렸다.
-- Vercel Hobby cron 은 하루 1회뿐이다. pg_cron 은 DB 안에서 도는 스케줄러라 제시간에 돈다.
--
-- GitHub Actions 는 예비로 남긴다. 겹치지 않게 15분 어긋난 22·52분에 건다.
-- (tick 은 같은 회차를 두 번 보내지 않도록 발송 표시를 남긴다)
--
-- ── 실행 방법 ────────────────────────────────────────────────────
-- 앱은 DDL 을 못 돌리므로 Supabase 대시보드 → SQL Editor 에 붙여넣어 실행한다.
-- 아래 <CRON_SECRET> 을 .env.local 의 CRON_SECRET 값으로 바꾼 뒤 실행할 것.
-- 비밀값은 Vault 에 암호화돼 저장되고, 이 파일(저장소)에는 남지 않는다.
-- 여러 번 실행해도 안전하다 (비밀값은 갱신, 작업은 다시 등록).

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 1) 비밀값을 Vault 에 저장 (이미 있으면 값만 바꾼다)
do $$
declare
  existing uuid;
begin
  select id into existing from vault.secrets where name = 'cron_secret';
  if existing is null then
    perform vault.create_secret('<CRON_SECRET>', 'cron_secret', '/api/cron/tick 호출용');
  else
    perform vault.update_secret(existing, '<CRON_SECRET>');
  end if;
end $$;

-- 2) 같은 이름의 작업이 있으면 지우고 다시 등록
select cron.unschedule(jobid) from cron.job where jobname = 'apartment-tick';

-- pg_cron 은 UTC 기준이지만 분 단위 반복이라 시간대와 무관하다.
-- 비밀값은 URL 대신 Authorization 헤더로 보낸다 (요청 로그에 남지 않게).
-- tick 은 최대 300초가 걸리므로 응답 대기도 300초로 둔다.
select cron.schedule(
  'apartment-tick',
  '22,52 * * * *',
  $job$
  select net.http_get(
    url := 'https://apartment-analy.vercel.app/api/cron/tick',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    timeout_milliseconds := 300000
  );
  $job$
);

-- 확인용 (실행 후 따로 돌려 보기)
-- select jobid, jobname, schedule, active from cron.job;
-- select status, return_message, start_time from cron.job_run_details order by start_time desc limit 10;
-- select status_code, timed_out, error_msg, created from net._http_response order by created desc limit 10;
