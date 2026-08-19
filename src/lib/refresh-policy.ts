/**
 * 갱신 주기 정책.
 *
 * 요구사항: "웹 정보는 1시간마다 주요 출처를 확인해 현재 시점 기준으로 보이게 할 것"
 *
 * 구현 방식 (세 겹):
 *  1) 페이지 ISR — `export const revalidate = REFRESH_INTERVAL_SECONDS` 로 1시간마다 서버에서 재조립
 *  2) fetch 캐시  — 각 외부 API 호출에 소스별 TTL 을 걸어 중복 호출을 막음
 *  3) 지연 갱신   — 페이지가 열릴 때 실거래 집계가 1시간 넘게 낡았으면 최근월만 백그라운드 갱신
 *  4) 클라이언트  — 탭이 열려 있으면 1시간마다 자동으로 router.refresh()
 *
 * 왜 크롤링이 아니라 API 인가:
 *  네이버 부동산·호갱노노 등은 이용약관에서 자동 수집을 금지한다.
 *  같은 정보를 국토교통부 실거래가(공공데이터포털)·한국부동산원·한국은행 ECOS·
 *  네이버 검색 API 라는 공식 경로로 모두 얻을 수 있어 그쪽을 쓴다.
 */

/** 기본 갱신 주기 (초) */
export const REFRESH_INTERVAL_SECONDS = 3600;

/** 소스별 fetch 캐시 TTL (초) */
export const SOURCE_TTL: Record<'molitRecent' | 'molitHistory' | 'ecos' | 'reb' | 'news', number> =
  {
    /** 실거래가 — 최근월은 신고가 계속 들어오므로 1시간 */
    molitRecent: 3600,
    /** 실거래가 — 과거월은 거의 바뀌지 않음 */
    molitHistory: 60 * 60 * 24 * 7,
    /** 한국은행 ECOS — 월간 지표라 1시간이면 충분 */
    ecos: 3600,
    /** 한국부동산원 — 주간 지표 */
    reb: 3600,
    /** 뉴스 — 가장 빨리 바뀌므로 30분 */
    news: 1800,
  };

/** 실거래 집계를 지연 갱신할 기준 (이보다 오래되면 최근월 재수집) */
export const LAZY_REFRESH_THRESHOLD_MS = REFRESH_INTERVAL_SECONDS * 1000;

/** 사람이 읽는 갱신 주기 */
export const REFRESH_LABEL = `${Math.round(REFRESH_INTERVAL_SECONDS / 60)}분`;
