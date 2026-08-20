# 작업 인수인계 — 2026-08-21 기준

다음 세션은 **"남은 작업" 1번(검증 결과 확인)부터** 시작하면 됩니다.

---

## 지금 상태 한눈에

| 항목                | 상태     | 비고                                                       |
| ------------------- | -------- | ---------------------------------------------------------- |
| GitHub              | ✅       | https://github.com/skaukjh/apartment_analy                 |
| Vercel 프로덕션     | ✅       | https://apartment-analy.vercel.app (짧은 별칭)             |
| Supabase            | ✅       | 테이블 8개 + region_monthly 3.4만 행                       |
| 카카오 연동         | ✅       | 앱 ID 1551984, OAuth·메시지·맵 전부 동작                   |
| 카카오톡 브리핑     | ✅       | 하루 4회(05·11·18·22 KST) 시간대별 다른 내용, 알림 1번     |
| AI 요약(오늘의 요약)| ✅       | gpt-4.1-mini, 1시간 캐시, 매시간 tick 이 미리 생성         |
| 국토부 백필         | 🔄       | 2022-01~현재 완료. **2006-01부터 확장 진행 중 (중단됨)**   |
| 일일 스케줄         | ⚠️       | GitHub Actions 매시간 tick. **레포 시크릿 등록 필요 확인** |

### API 키 (전부 .env.local + Vercel 3개 환경 등록 완료)

CRON_SECRET, Supabase 3종, ECOS, NAVER 2종, DATA_GO_KR_SERVICE_KEY(Decoding),
KAKAO_REST_API_KEY, NEXT_PUBLIC_KAKAO_JS_KEY, KAKAO_CLIENT_SECRET,
NEXT_PUBLIC_APP_URL, OPENAI_API_KEY

미등록(선택): FSS_API_KEY, KOSIS_API_KEY, REB_API_KEY

---

## 남은 작업

### 1. 데이터 정합성 검증 결과 확인 ← 여기서 시작

Fable 에이전트가 서울 25 + 경기 20 + 인천 5 = 50개 지역에서
국토부 원본과 /api/complex 를 대조하는 검증을 돌리던 중 세션이 끝났다.

- 검증 스크립트: 세션 scratchpad 의 verify.mjs (세션이 끝나면 사라짐 — 아래 방법으로 재현)
- 재현: 국토부 원본 XML을 직접 받아 (거래건수, 직전가, 거래일, ㎡당)을 계산하고
  `/api/complex?lawd=…&dong=…&from=2026-01` 응답과 대조
- **불일치가 나오면**: 원본이 기준. /api/complex 쪽 계산을 고친다.

### 2. 미커밋 변경 2건 커밋 (검증 통과 후)

작업 트리에 이미 수정돼 있음:

- `src/app/api/complex/route.ts` — ㎡당 가격을 **같은 거래**에서 산출하도록 수정
  (예전엔 거래가와 ㎡당을 각각 중앙값으로 내서 "13.2억 ÷ 2,520만 = 52.4㎡" 같은
  존재하지 않는 면적이 계산됐다). latestAreaM2·medianPrice 필드 추가.
- `src/components/dashboard/korea-map.tsx` —
  (a) 기간 변경 시 열려 있는 동의 단지 목록 재조회 (예전엔 동 클릭 시에만 로드돼
  기간을 바꿔도 거래 건수가 그대로였다 — 스샷2로 확인된 버그)
  (b) 단지 원 반지름을 화면 픽셀 고정(4/s)으로 — 동 확대 시 원이 거대해지던 문제
  (c) 단지 라벨은 거래 많은 순 상위 12개만

typecheck·lint 통과 상태. `npm run build` → 커밋 → 푸시 → `vercel deploy --prod --yes`.

### 3. 확인·마무리 항목

- **GitHub Actions 시크릿**: 레포 Settings → Secrets 에 `APP_URL`, `CRON_SECRET` 등록됐는지.
  등록 전 실행은 전부 실패했고, 등록 후 실행이 성공했는지 아직 확인 못 함.
  확인: Actions 탭에서 최근 "브리핑 tick" 실행이 success 인지.
  수동 테스트: Run workflow 버튼, slot=morning.
- **2006년 백필 이어서**: 로컬 dev 서버 띄우고
  `curl "http://localhost:3210/api/cron/backfill?secret=<CRON_SECRET>&regions=4&from=200601"`
  을 remaining 0 까지 반복 (약 3만 회 호출 남음, 일일 1만 한도라 2~3일).
  이미 받은 (지역, 월)은 자동 스킵.
- **지도에서 우성2차가 안 보이는 문제**: 지오코딩(카카오 키워드 검색)이 등록명
  "우성2"를 "광진구 우성2"로 검색해 실패하는 것으로 추정. `geocodeComplex` 폴백에
  지번 주소 검색(`{시군구} {법정동} {지번}`)을 추가하면 해결될 것. TradeRecord.jibun 은
  이미 수집 중.
- **네이버 부동산 링크**: 단지 상세의 "카카오맵에서 열기"(complex-map.tsx:227)를
  네이버 부동산 검색으로 바꾸는 요청 있음.
  `https://new.land.naver.com/search?sk=단지명` 형태 URL 동작 확인 후 교체.
  (공식 딥링크 스펙이 없으므로 검색 결과 페이지로 여는 수준까지만.)
- **화면 로딩 ~10초 개선**: 원인은 force-dynamic 페이지가 이동마다 전체 재계산.
  loading.tsx 로 완화했지만 근본 개선은 대시보드 데이터의 Supabase 스냅샷 캐시
  (dashboard_snapshot 재사용) + 라이브 소스 백그라운드 갱신 구조로 바꾸는 것.

---

### 다중 사용자 · 로그인 (이번 세션 후반 추가)

- Supabase Auth 이메일+비밀번호. 가입은 서버 admin API(email_confirm)로 만들어
  **대시보드 설정 없이 바로 로그인**된다 (/api/auth/signup).
- 비밀번호 재설정은 Supabase 메일 → /login/update-password.
  ⚠️ 배포 환경에서 재설정 메일이 동작하려면 Supabase 대시보드 →
  Authentication → URL Configuration 에서 Site URL 을
  https://apartment-analy.vercel.app 로, Redirect URLs 에
  https://apartment-analy.vercel.app/login/update-password 를 추가해야 한다.
  (이것만은 대시보드에서 수동으로 해야 함)
- user_config.id = auth.users.id (레거시 비로그인 = 'default' 행 유지)
- kakao_token.user_id 컬럼 추가 (마이그레이션 0004, pg 직접 적용 완료).
  DB 직접 접속: aws-0-ap-northeast-2.pooler.supabase.com:5432,
  user postgres.acfhrbhigwvsrkrekekn (비밀번호는 기존 문서 참고)
- 설정(/settings)은 로그인 필수. 빈 계정엔 "기존 설정 가져오기" 버튼
  (레거시 default 복사, /api/config?action=import-legacy)
- 대시보드·오늘의 요약·시뮬레이션·AI 캐시·카카오 수신자·브리핑 발송 전부
  세션 사용자 스코프. tick 은 모든 사용자를 돌며 각자 설정·수신자로 발송.
- 세션 갱신은 src/proxy.ts (Next 16: middleware 가 proxy 로 개명됨)
- 검증 완료: 가입→로그인→저장→조회 분리, 비로그인 401, 중복가입 409

## 이번 세션에 한 일 (되돌리지 말 것)

### 카카오 연동 (처음부터 끝까지)

- 개발자 콘솔 앱 생성(부동산 갈아타기, ID 1551984), REST/JS 키 발급
- 로그인 활성화, Redirect URI 4개(localhost 3000/3210, vercel 긴 주소, 짧은 주소)
- talk_message 동의항목, 카카오맵 ON + JS SDK 도메인 4개
- 클라이언트 시크릿 사용 중 (KAKAO_CLIENT_SECRET)

### 국토부 실거래 파이프라인 대수술

백필이 무한 반복하던 원인 3개를 고쳤다:

1. 초당 제한(코드 23)이 `<returnReasonCode>` 로 오는데 `<resultCode>` 만 봐서 인식 못 함
2. 그 오류를 빈 배열로 삼켜 remaining 이 안 줄었음 → 전역 호출 간격 조절(molit.ts) 추가
3. **Supabase 1,000행 잘림** — loadRegionMonthly(Keys) 페이지네이션 추가
4. 거래 0건인 월도 "조회 완료"로 기록 (emptyMonthPoint, trade_count=0, 분석에선 제외)
5. 백필 우선순위: 서울 → 경기 → 인천 → 충청 → 나머지 (regions.ts backfillPriority)

### 시세 원칙 (중요)

- **갭·세금·시뮬레이션은 실거래가만 쓴다** (lib/analysis/price-basis.ts).
  호가는 검증 불가라 계산에 넣지 않고 "실거래 대비 +N%" 참고 표기만.
- 대표 시세 = 직전 실거래가(가장 최근 체결가). 6개월 중앙값은 medianPrice 로 보관.
- 면적 표기는 전부 `formatArea` → "24평(79.07㎡)" 통일.

### 행정동 ↔ 법정동 (중요)

- 지도 경계는 행정동(자양2동), 국토부는 법정동(자양동)+지번.
- lib/dong-name.ts: 분할 번호 떼고 비교 (자양2동→자양동)
- lib/sources/admin-dong.ts: 지번 → 카카오 좌표 → 행정동 판별, 시군구 단위로
  dashboard_snapshot 에 캐시. 자양동 68개 → 자양2동 38 / 자양3동 27 로 정확 분리 확인.

### 단지 검색 (설정 화면)

- 국토부 등록명("우성2")과 부르는 이름("자양우성2차")이 달라 안 잡히던 문제 →
  양방향 부분일치 + '차/아파트/단지' 꼬리말 무시 (complex-search.ts complexMatches)
- 조회 기간 24개월(기본, ?months= 로 최대 60), 상한 60개 단지
- **주의: 그 기간에 거래가 없던 평형은 어떤 방법으로도 안 나온다** (데이터가 없음)

### AI 요약 (오늘의 요약 /today)

- lib/ai/market-outlook.ts: 공식발표 10 + 기사 12 + 블로그 8 + 카페 8
- 검색어에 보유·목표 단지명 + 동 이름 포함
- **네이버 API 는 초당 제한(429)이 있어 반드시 순차 호출** (한꺼번에 던지면 전부 거부)
- 네이버 API 는 회원등급·조회수를 안 줌 → 광고 필터 + 구체성 점수로 대체
- 프롬프트에 근거 우선순위 명문화: 수치 > 공식발표 > 기사 > 개인의견
- 1시간 캐시 (lib/ai/outlook-cache.ts, dashboard_snapshot 재사용)
- 비용: 1회 약 6,700토큰 ≈ 5원. tick 이 시간당 1회 생성 → 하루 약 120원 상한

### 스케줄 구조

- Vercel Hobby 는 cron 하루 1회 제한 → **GitHub Actions 가 매시간
  /api/cron/tick 호출** (.github/workflows/briefing.yml, 레포 시크릿 APP_URL·CRON_SECRET)
- tick: 매시간 최근 2개월 갱신 + AI 요약 사전 생성, 05/11/18/22시(KST)엔 카톡 발송
- vercel.json 의 cron 은 하루 1회(20:00 UTC = 05:00 KST) 백업

### 기타

- 카톡 요약: 슬롯(아침/오전/저녁/마감)별로 다른 구성, 본문에 /today 링크 포함
- 모바일 메뉴가 390px 에서 화면 밖으로 밀리던 문제 → 축약 라벨 (site-header.tsx)
- loading.tsx 4개 라우트 추가 (전환 시 멈춘 것처럼 보이던 문제)
- 관심지역 밖 동 클릭 시 국토부 즉석 조회 (complex/route.ts liveFetched)
- 데이터 시작점: **국토부 실거래는 2006-01부터** (신고제 시행). 2000~2005는 조회돼도 0건.

---

## 알아둘 것 (이전 세션에서 이어짐)

- 네이버 부동산 크롤링 금지 (약관 위반, 소송 사례). 호가 API 는 국내에 없음.
- 호갱노노·아실·apt2.me 등의 실거래 데이터도 전부 국토부 원천 재가공 — 수집할 이유 없음.
- 카페는 네이버 검색 API(cafearticle)로만 — 특정 카페 직접 크롤링 금지.
- 규제지역: lib/analysis/regulation.ts 수동 관리 (2025년 기준).
- 국토부 서비스키는 **Decoding 값** (Encoding 넣으면 에러 30).
- dev 서버는 PORT=3210 관행.
- Windows 환경: 파이썬으로 소스 일괄 치환 시 한글 출력이 깨져 보이는 건 콘솔 인코딩
  문제일 뿐 파일은 정상 (UTF-8 io.open 사용).

## 참고 문서

- docs/SETUP.md — API 키 발급 절차
- README.md — 기능 개요
- docs/스샷.png, 스샷2.png — 이번 세션에서 발견한 UI 버그 증거 (수정 완료분 포함)
