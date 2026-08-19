# 작업 인수인계 — 2026-08-20 기준

다음 세션은 **카카오톡 연동부터** 시작하면 됩니다. 아래 "다음 할 일" 1번을 보세요.

---

## 지금 상태 한눈에

| 항목            | 상태     | 비고                                                              |
| --------------- | -------- | ----------------------------------------------------------------- |
| GitHub          | ✅       | https://github.com/skaukjh/apartment_analy (public)               |
| Vercel 배포     | ✅       | https://apartment-analy-kimjaehuns-projects.vercel.app            |
| Vercel CLI      | ✅       | `skaukjh` 로그인, 프로젝트 링크 완료                              |
| Supabase        | ✅       | `apartment-analy` (서울 리전), 테이블 8개 생성·검증 완료          |
| 로컬 E2E 테스트 | ✅ 28/28 | 합성 데이터 기준 전 항목 통과                                     |
| 타입·린트·빌드  | ✅       | `npm run check-all`, `npm run build` 통과                         |

### API 키 현황

| 키                             | 로컬(.env.local) | Vercel | 검증                              |
| ------------------------------ | ---------------- | ------ | --------------------------------- |
| `CRON_SECRET`                  | ✅               | ✅     | 3개 환경 등록                     |
| `NEXT_PUBLIC_SUPABASE_URL`     | ✅               | ❌     | 연결 확인                         |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`| ✅               | ❌     | 연결 확인                         |
| `SUPABASE_SERVICE_ROLE_KEY`    | ✅               | ❌     | 8개 테이블 전부 200               |
| `ECOS_API_KEY`                 | ✅               | ❌     | 4개 지표 실제 조회 성공           |
| `NAVER_CLIENT_ID` / `_SECRET`  | ✅               | ❌     | 뉴스·블로그·카페 3종 조회 성공    |
| `DATA_GO_KR_SERVICE_KEY`       | ❌               | ❌     | **국토부 승인 대기 중 (1~2일)**   |
| `KAKAO_REST_API_KEY`           | ❌               | ❌     | 미발급 ← **다음 작업**            |
| `NEXT_PUBLIC_KAKAO_JS_KEY`     | ❌               | ❌     | 미발급 (동 단계 실제 지도용)      |
| `OPENAI_API_KEY`               | ❌               | ❌     | 선택 (AI 평가·챗봇)               |
| `FSS_API_KEY`                  | ❌               | ❌     | 선택 (은행별 금리)                |
| `REB_API_KEY`                  | ❌               | ❌     | 선택 (없으면 대리지표로 대체)     |
| `KOSIS_API_KEY`                | ❌               | ❌     | 선택 (인구 순이동)                |

> ⚠️ **Vercel 환경변수는 `CRON_SECRET` 하나만 등록돼 있습니다.** 그래서 배포된 사이트는
> 아직 빈 화면입니다. 로컬은 정상 동작합니다.

### Supabase 접속 정보

- 프로젝트 ID: `acfhrbhigwvsrkrekekn`
- URL: `https://acfhrbhigwvsrkrekekn.supabase.co`
- 대시보드: https://supabase.com/dashboard/project/acfhrbhigwvsrkrekekn
- DB 비밀번호: `Iz2_lE9HzQE4Wmgy63WIFhyD` (앱은 사용하지 않음, 분실 대비 보관)
- 적용된 마이그레이션: `0001_init.sql`, `0002_dong.sql`, `0003_kakao_recipients.sql`
- 현재 데이터: `user_config` 1행만 있고 실거래 테이블은 **비어 있음** (합성 데이터 삭제 완료)

---

## 다음 할 일

### 1. 카카오 연동 ← 여기서 시작

**1-1. 앱 생성 및 키 발급**

1. https://developers.kakao.com → 내 애플리케이션 → 애플리케이션 추가하기
2. 앱 이름 입력 (사업자등록 불필요)
3. **앱 키** 메뉴에서 두 개를 복사
   - **REST API 키** → `KAKAO_REST_API_KEY`
   - **JavaScript 키** → `NEXT_PUBLIC_KAKAO_JS_KEY`

**1-2. 카카오 로그인 설정 (브리핑 발송)**

1. 제품 설정 → **카카오 로그인** → 활성화 ON
2. **Redirect URI** 두 개 등록
   ```
   http://localhost:3000/api/kakao/callback
   https://apartment-analy-kimjaehuns-projects.vercel.app/api/kakao/callback
   ```
   > 로컬 개발 서버를 3210 포트로 띄웠다면 `http://localhost:3210/api/kakao/callback` 도 추가
3. 제품 설정 → 카카오 로그인 → **동의항목**
   - `카카오톡 메시지 전송 (talk_message)` 활성화 ← **필수**
   - `프로필 정보(닉네임)` 활성화 (수신자 이름 자동 입력용, 선택)

**1-3. 카카오맵 설정 (주변 입지 + 동 단계 실제 지도)**

1. 제품 설정 → **카카오맵** → 활성화 ON
2. 앱 설정 → **플랫폼 → Web** 에 사이트 도메인 등록
   ```
   http://localhost:3000
   http://localhost:3210
   https://apartment-analy-kimjaehuns-projects.vercel.app
   ```

**1-4. 키 저장 후 검증**

```bash
echo KAKAO_REST_API_KEY=발급받은REST키 >> .env.local
echo NEXT_PUBLIC_KAKAO_JS_KEY=발급받은JS키 >> .env.local
```

그다음 `/settings` → 카카오톡 브리핑 → 수신자 별명 입력 → **카카오 계정 연결** → **지금 전원에게 보내기**

> **카카오톡 ID 로는 남에게 못 보냅니다.** 카카오가 그런 API 를 제공하지 않습니다.
> 여러 명에게 보내려면 각 수신자가 `/settings` 에서 **자기 카카오 계정으로 1회 연결**하면
> 앱이 각자의 토큰으로 각자에게 "나에게 보내기"를 실행합니다. 검수·사업자등록 불필요.

### 2. 국토부 실거래가 키 (승인되면)

```bash
echo DATA_GO_KR_SERVICE_KEY=일반인증키_Decoding값 >> .env.local
```

> ⚠️ **Encoding 이 아니라 Decoding** 값을 넣어야 합니다. Encoding 을 넣으면 에러코드 30 이 납니다.

승인 후 백필 (`remaining` 이 0 이 될 때까지 반복):

```bash
curl "http://localhost:3210/api/cron/backfill?secret=<CRON_SECRET>&regions=6"
```

- 178개 지역 × 약 55개월 ≈ 9,800회 호출 → 개발계정 일 10,000건에 근접하므로 **하루 이틀 나눠서**
- 이미 받은 (지역, 월)은 자동으로 건너뛰므로 중복 호출해도 안전
- 승인대기·트래픽초과 오류를 만나면 즉시 멈추도록 만들어 뒀습니다

### 3. Vercel 환경변수 일괄 등록

로컬에서 검증이 끝난 뒤:

```bash
node scripts/push-env.mjs            # 미리보기 (값은 가려서 표시)
node scripts/push-env.mjs --apply    # production/preview/development 전부 등록
```

등록 후 재배포:

```bash
vercel deploy --prod        # 또는 git push (자동 배포)
```

### 4. 선택 키

- `OPENAI_API_KEY` — AI 매물 평가·챗봇 (gpt-4.1-mini, 월 $1 미만)
- `FSS_API_KEY` — 은행별 주담대 최저금리 (은행명 표시)
- `KOSIS_API_KEY` — 수도권 인구 순이동
- `REB_API_KEY` — 부동산원 매매수급지수 (없으면 실거래 기반 대리지표 사용)

---

## 이번 세션에 고친 것 (되돌리지 말 것)

1. **실거래가 엔드포인트** — `RTMSDataSvcAptTradeDev` → `RTMSDataSvcAptTrade`
   (`docs/아파트 매매 실거래가 자료 기술문서.hwp` 기준, 2024.07.17 개편).
   구 경로 자동 폴백 + 에러코드 13종 한국어 안내.
2. **ECOS M2 통계표** — `101Y004`(2004년 폐지) → `161Y005`(현행).
3. **지도 드래그 크래시** — `setView` 업데이터가 나중에 실행되며 `dragOrigin.current` 가
   null 이 되어 터지던 문제. 지역 변수로 복사해 해결.
4. **과열 게이지 하이드레이션 불일치** — 부동소수점 자릿수 고정.
5. **갭 정렬 불일치** — 서버도 실소요 자금 오름차순으로 통일 (화면·문서와 일치).
6. **`setPointerCapture` NotFoundError** — try/catch 로 방어.

---

## 알아둘 것

### 로컬 개발 서버

```bash
npm run dev        # 기본 3000 포트. 이번 세션에서는 PORT=3210 으로 띄웠음
```

### 샘플(합성) 데이터

```bash
curl -X POST http://localhost:3210/api/dev/seed
```

- **전부 가짜 데이터입니다.** 실제 시세가 아닙니다.
- Supabase 가 연결돼 있으면 기본 차단됩니다 (`?force=1` 로 강제 가능).
- 이번 세션에서 `force=1` 로 넣어 검증한 뒤 **삭제 완료**했습니다.
- 실거래 키가 들어온 뒤에는 쓰지 마세요.

### E2E 테스트

`scratchpad/e2e.mjs` 로 28개 항목을 확인했습니다. 세션 임시 폴더라 사라졌다면
필요할 때 다시 만들면 됩니다. 검증 항목: 설정 저장 → 자동 채우기 → 대시보드 조립 →
갭·세금 계산 → 반등 분석 → 일정 예측 → 동·단지 드릴다운 → 기간 변경 → 브리핑 생성 →
카카오 발송 → 페이지 렌더링.

### 지도 구조 (오해하기 쉬움)

- **확산 지도**(행정경계 색칠) = 광역 비교용. 시도 → 구·군 → 동 → 단지 4단계 드릴다운.
  경계는 `public/geo/*.json` (통계청 2013 간략화, `scripts/prepare-geo.mjs` 로 전처리).
- **동 단계 실제 지도**(카카오맵) = 개별 물건 확인용. `NEXT_PUBLIC_KAKAO_JS_KEY` 필요.
- 둘은 **목적이 다르므로 둘 다 유지**합니다.

### 네이버 부동산을 쓰지 않는 이유

공식 API 가 없고 크롤링은 이용약관 위반(소송 사례 있음)입니다. 시세는 국토교통부
실거래가(실제 체결가)를 쓰고, 호가는 설정에서 직접 입력받습니다. 호가를 API 로 여는
국내 플랫폼은 없습니다.

### 규제지역 정보는 수동 관리

`src/lib/analysis/regulation.ts` 에 조정대상지역·투기과열지구·토지거래허가구역을
2025년 기준으로 넣어 뒀습니다. 정부 공고로 바뀌므로 주기적으로 확인하고 직접 고쳐야 합니다.

---

## 참고 문서

- `docs/SETUP.md` — API 키 발급 절차 전체 (가장 중요)
- `README.md` — 기능 개요·구조·알려진 한계
- `docs/아파트 매매 실거래가 자료 기술문서.hwp` — 국토부 API 원본 명세
