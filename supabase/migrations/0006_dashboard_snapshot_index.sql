-- dashboard_snapshot 조회용 표현식 인덱스
--
-- 이 테이블에는 종류가 다른 행이 섞여 있고(대시보드 캐시·브리핑 스냅샷·AI 요약),
-- 대시보드 캐시 한 줄은 페이로드가 0.5MB 다. 그런데 인덱스는 captured_at 뿐이라
-- kind/userId 로 거르는 조회(dashboard-cache.ts, loadSnapshotBefore)가 매번
-- 행마다 JSONB 를 풀어 봐야 했다 — 화면 첫 로딩이 20초를 넘던 원인 중 하나다.
--
-- 조회 조건과 같은 표현식으로 인덱스를 만든다. PostgREST 의
--   .eq('payload->>kind', ...) .eq('payload->>userId', ...) .order('captured_at', desc)
-- 가 그대로 이 인덱스를 탄다.

create index if not exists dashboard_snapshot_kind_user_idx
  on public.dashboard_snapshot ((payload ->> 'kind'), (payload ->> 'userId'), captured_at desc);

-- 종류만으로 훑는 조회(브리핑 비교 등)도 같은 인덱스의 앞부분을 쓴다.
-- userId 없이 kind 로만 거르는 경로가 있어 접두 컬럼 순서를 kind 먼저로 두었다.
