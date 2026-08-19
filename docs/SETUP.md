# 설정 가이드 — API 키 발급과 배포 전 준비

이 문서 하나만 따라가면 전체 기능을 켤 수 있습니다.
**필수**만 채워도 앱은 동작하고, **선택**은 해당 기능만 비활성화됩니다.

---

## 0. 한눈에 보기

| 우선순위    | 키                                                  | 무엇이 켜지나                          | 발급 시간 | 비용    |
| ----------- | --------------------------------------------------- | -------------------------------------- | --------- | ------- |
| 🔴 필수     | `DATA_GO_KR_SERVICE_KEY`                            | 시세·갭·확산지도·신고가·단지 분석      | 1~2일     | 무료    |
| 🔴 필수     | `NEXT_PUBLIC_SUPABASE_URL` 외 2개                   | 설정 저장·캐시·카카오 토큰             | 10분      | 무료    |
| 🔴 필수     | `CRON_SECRET`                                       | Cron 보호 (직접 생성)                  | 1분       | -       |
| 🟠 권장     | `ECOS_API_KEY`                                      | 기준금리·물가·M2·주담대금리            | 즉시      | 무료    |
| 🟠 권장     | `NAVER_CLIENT_ID` / `NAVER_CLIENT_SECRET`           | 뉴스·공식발표·블로그·카페              | 즉시      | 무료    |
| 🟠 권장     | `KAKAO_REST_API_KEY`                                | 카카오톡 브리핑 + 주변 입지(역·학교)   | 10분      | 무료    |
| 🟡 선택     | `OPENAI_API_KEY`                                    | AI 매물 평가·챗봇                      | 즉시      | 종량제  |
| 🟡 선택     | `FSS_API_KEY`                                       | 은행별 주담대 최저금리 (은행명 표시)   | 즉시      | 무료    |
| 🟡 선택     | `REB_API_KEY`                                       | 부동산원 매매수급지수 (없으면 대체계산) | 1~2일     | 무료    |
| 🟡 선택     | `KOSIS_API_KEY`                                     | 수도권 인구 순이동                     | 즉시      | 무료    |
| 🟡 선택     | `GOV_RSS_FEEDS`                                     | 부처 보도자료 RSS 직접 구독            | 5분       | -       |

> 승인에 1~2일 걸리는 **국토교통부 실거래가부터 먼저 신청**하세요. 나머지는 기다리는 동안 채우면 됩니다.

---

## 1. 🔴 국토교통부 실거래가 (가장 중요)

시세·갭·확산지도·신고가·단지별 분석의 **근간**입니다. 이게 없으면 지도에 숫자가 안 나옵니다.

1. [공공데이터포털](https://www.data.go.kr) 회원가입
2. **[아파트 매매 실거래가 상세 자료](https://www.data.go.kr/data/15126469/openapi.do)** 페이지 → `활용신청`
   - 활용목적: `개인 참고용 부동산 분석`
   - 상세기능: 전체 체크
3. 승인까지 보통 **1~2일** (자동승인인 경우도 있음)
4. 승인 후 → 마이페이지 → 개발계정 → **일반 인증키(Decoding)** 복사
   - ⚠️ **Encoding 이 아니라 Decoding** 값을 써야 합니다. Encoding 을 넣으면 인증 오류가 납니다.

```
DATA_GO_KR_SERVICE_KEY=<Decoding 인증키>
```

**일일 트래픽**: 기본 10,000회. 최초 백필에 약 9,800회가 필요해 하루 이틀 나눠 받아야 합니다.
부족하면 같은 페이지에서 `트래픽 증가 신청`을 할 수 있습니다.

### 같은 키로 추가 신청하면 좋은 것 (선택)

- [건축물대장정보 서비스](https://www.data.go.kr/data/15044713/openapi.do) — 용적률·대지지분·세대수 (재건축 사업성 판단)

---

## 2. 🔴 Supabase (데이터 저장)

설정·실거래 캐시·카카오 토큰을 저장합니다. **없으면 서버 재시작 시 다 사라지고 자동 브리핑을 못 씁니다.**

1. [supabase.com](https://supabase.com) 가입 → `New project`
   - Region: **Northeast Asia (Seoul)** 권장
   - Database Password 는 따로 보관 (앱에서는 안 쓰지만 분실 시 곤란)
2. 프로젝트 생성 후 좌측 **SQL Editor** → `New query`
3. 아래 3개 파일 내용을 **순서대로** 붙여넣고 각각 `Run`
   - `supabase/migrations/0001_init.sql`
   - `supabase/migrations/0002_dong.sql`
   - `supabase/migrations/0003_kakao_recipients.sql`
4. 좌측 **Project Settings → API** 에서 값 복사

```
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhb...       # Project API keys > anon public
SUPABASE_SERVICE_ROLE_KEY=eyJhb...           # Project API keys > service_role
```

> ⚠️ `service_role` 키는 RLS 를 우회합니다. **절대 클라이언트 코드나 공개 저장소에 넣지 마세요.**
> 이 앱에서는 서버 라우트에서만 사용합니다.

무료 플랜 한도(500MB)로 충분합니다. 전국 실거래 집계가 약 50MB 수준입니다.

---

## 3. 🔴 CRON_SECRET

Cron 라우트를 아무나 호출하지 못하게 막는 값입니다. 직접 만듭니다.

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

```
CRON_SECRET=<위 명령이 출력한 64자 문자열>
```

Vercel Cron 은 이 값을 `Authorization: Bearer` 헤더로 자동 전송합니다.

---

## 4. 🟠 한국은행 ECOS (거시 지표)

기준금리 / 소비자물가 / M2 / 주택담보대출금리 → 분석 브리핑과 AI 컨텍스트에 쓰입니다.

1. [ECOS 인증키 신청](https://ecos.bok.or.kr/api/#/AuthKeyApply)
2. 이메일 인증 후 **즉시 발급**

```
ECOS_API_KEY=<발급키>
```

통계표 코드가 ECOS 개편으로 바뀌면 아래로 덮어쓸 수 있습니다 (평소엔 불필요):

```
# ECOS_STAT_BASE_RATE=722Y001
# ECOS_ITEM_BASE_RATE=0101000
```

---

## 5. 🟠 네이버 검색 API (뉴스·공식발표·블로그·카페)

하나의 키로 **뉴스 / 블로그 / 카페**를 모두 씁니다.

1. [네이버 개발자센터](https://developers.naver.com/apps/#/register) 로그인
2. `애플리케이션 등록`
   - 애플리케이션 이름: 아무거나 (예: `부동산 대시보드`)
   - 사용 API: **검색** 선택
   - 환경: `WEB 설정` → 서비스 URL 에 `http://localhost:3000` 과 배포 주소 입력
3. 등록 후 **Client ID / Client Secret** 복사

```
NAVER_CLIENT_ID=<Client ID>
NAVER_CLIENT_SECRET=<Client Secret>
```

**일일 한도**: 25,000회. 이 앱은 1시간 캐시를 걸어 하루 수백 회 수준입니다.

---

## 6. 🟠 카카오 (브리핑 발송 + 주변 입지)

**하나의 키로 두 기능**을 씁니다: 카카오톡 브리핑 + 카카오맵(역·학교·마트 검색).

### 6-1. 앱 만들기

1. [카카오 개발자센터](https://developers.kakao.com) 로그인 → `내 애플리케이션` → `애플리케이션 추가하기`
2. 앱 이름·사업자명 입력 (개인도 가능, 사업자등록 불필요)
3. **앱 키** 메뉴 → **REST API 키** 복사

```
KAKAO_REST_API_KEY=<REST API 키>
```

### 6-2. 카카오 로그인 설정 (브리핑 발송용)

1. **제품 설정 → 카카오 로그인** → 활성화 **ON**
2. **Redirect URI** 등록 (둘 다 추가)
   ```
   http://localhost:3000/api/kakao/callback
   https://<배포주소>/api/kakao/callback
   ```
3. **제품 설정 → 카카오 로그인 → 동의항목**
   - `카카오톡 메시지 전송 (talk_message)` → **필수 동의** 또는 선택 동의로 설정
   - (선택) `프로필 정보(닉네임)` → 수신자 이름을 자동으로 채우려면 켜기

### 6-3. 카카오맵 활성화 (주변 입지용)

1. **제품 설정 → 카카오맵** → 활성화 **ON**
   - 이걸 켜야 단지 주변 지하철역·학교·마트 정보가 나옵니다.

### 6-4. 여러 명에게 보내기

> **카카오톡 ID 를 입력하는 방식은 없습니다.** 카카오는 스팸 방지를 위해
> ID 로 아무에게나 보내는 API 를 제공하지 않습니다.

받을 사람이 **각자 `/settings` 에서 자기 카카오 계정으로 1회 연결**하면 됩니다.
앱이 각자의 토큰으로 각자에게 "나에게 보내기"를 실행합니다.

절차:

1. `/settings` → 카카오톡 브리핑 섹션
2. 수신자 별명 입력 (예: `나`) → `카카오 계정 연결` → 본인 카카오로 로그인
3. 다음 사람: 별명 입력 (예: `아내`) → `카카오 계정 연결`
   → 카카오 로그인 화면에서 **그 사람의 계정으로 로그인** (이미 로그인돼 있으면 로그아웃 후)
4. 수신자 목록에서 스위치로 개별 on/off 가능

**대안(친구에게 보내기)을 쓰지 않는 이유**: `friends` 스코프는 카카오 검수 대상이고,
수신자도 어차피 이 앱에 로그인해야 목록에 뜹니다. 검수만 더 붙으므로 위 방식이 낫습니다.

---

## 7. 🟡 OpenAI (AI 평가·챗봇)

1. [platform.openai.com/api-keys](https://platform.openai.com/api-keys) → `Create new secret key`
2. **결제 수단 등록 필요** (Billing → Payment methods)

```
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4.1-mini      # 기본값. 더 정교하게 하려면 gpt-4.1
```

**비용 감각**: `gpt-4.1-mini` 기준 매물 평가 1회 약 $0.002, 챗봇 대화 1회 약 $0.001.
하루 수십 번 써도 월 $1 미만입니다.

> 💡 사용 한도를 걸어두려면 Billing → Usage limits 에서 월 상한을 설정하세요.

---

## 8. 🟡 금융감독원 (은행별 주담대 금리)

은행명과 최저·최고 금리를 표시합니다. 없으면 ECOS 평균금리로 대체합니다.

1. [금융상품 통합비교공시 OpenAPI](https://finlife.fss.or.kr/finlife/api/fnprdInfo/list) → 인증키 신청
2. 이메일 인증 후 즉시 발급

```
FSS_API_KEY=<발급키>
```

---

## 9. 🟡 한국부동산원 R-ONE (매매수급지수)

**없어도 됩니다.** 키가 없으면 실거래 거래량·신고가 비중으로 대리지표를 계산하고,
화면에 "추정치"라고 표시합니다.

1. [R-ONE OpenAPI](https://www.reb.or.kr/r-one/portal/openapi/openApiIntro.do) → 활용신청 (1~2일)

```
REB_API_KEY=<발급키>
# 통계표 ID 가 개편되면 아래로 덮어쓰기
# REB_STATBL_WEEKLY_PRICE=
# REB_STATBL_SUPPLY_DEMAND=
```

---

## 10. 🟡 통계청 KOSIS (인구 순이동)

수도권 인구 순유입은 주택 수요의 장기 선행 지표입니다.

1. [KOSIS 공유서비스](https://kosis.kr/openapi) → 활용신청 → 즉시 발급

```
KOSIS_API_KEY=<발급키>
```

---

## 11. 🟡 정부 부처 보도자료 RSS

정부 사이트 RSS 는 개편으로 주소가 자주 바뀌어 기본값을 넣지 않았습니다.
원하는 부처 RSS 주소를 직접 찾아 등록하면 원문 보도자료를 바로 받습니다.

```
GOV_RSS_FEEDS=국토교통부|https://.../rss.xml,금융위원회|https://.../rss
```

등록하지 않아도 **네이버 뉴스에서 부처별 발표를 표적 수집**하므로 공식 발표 섹션은 동작합니다.

---

## 12. 배포 (Vercel)

### 12-1. 로그인·연결

```bash
npm i -g vercel
vercel login          # 브라우저 인증 (직접 실행 필요)
vercel link           # 기존 프로젝트 연결 또는 새로 생성
```

### 12-2. 환경변수 등록

```bash
# 하나씩 등록 (값 입력 프롬프트가 뜹니다)
vercel env add DATA_GO_KR_SERVICE_KEY production
vercel env add NEXT_PUBLIC_SUPABASE_URL production
vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY production
vercel env add SUPABASE_SERVICE_ROLE_KEY production
vercel env add CRON_SECRET production
vercel env add ECOS_API_KEY production
vercel env add NAVER_CLIENT_ID production
vercel env add NAVER_CLIENT_SECRET production
vercel env add KAKAO_REST_API_KEY production
vercel env add OPENAI_API_KEY production
```

또는 Vercel 대시보드 → 프로젝트 → **Settings → Environment Variables** 에서 한 번에 붙여넣기.

### 12-3. 배포

```bash
vercel deploy --prod
```

### 12-4. 배포 후 필수 작업

1. **카카오 Redirect URI 에 배포 주소 추가** (6-2 참고)
2. **과거 실거래 백필** — `remaining` 이 `0` 이 될 때까지 반복 호출

   ```bash
   curl "https://<배포주소>/api/cron/backfill?secret=<CRON_SECRET>&regions=6"
   ```

   응답 예: `{"ok":true,"remaining":8400,"hint":"남은 작업이 있습니다..."}`
   이미 받은 (지역, 월)은 건너뛰므로 중복 호출해도 안전합니다.

3. **카카오 계정 연결** — `/settings` 에서 수신자 등록
4. **내 아파트 등록** — `/settings` 에서 보유·목표·관심 지역 입력 후 `전체 자동 계산`

### 12-5. Cron 확인

`vercel.json` 에 정의돼 있습니다 (Vercel 은 **UTC** 기준).

| 경로                         | UTC          | KST   | 하는 일                     |
| ---------------------------- | ------------ | ----- | --------------------------- |
| `/api/cron/refresh?months=3` | `0 22 * * *` | 07:00 | 최근 3개월 실거래 증분 갱신 |
| `/api/cron/briefing`         | `0 23 * * *` | 08:00 | 카카오톡 브리핑 발송        |

> Vercel Hobby 플랜은 Cron 2개, 하루 1회까지 지원합니다. 위 구성이 정확히 그 한도입니다.
> 발송 시각을 바꾸려면 `vercel.json` 의 `schedule` 을 수정하고 재배포하세요.

---

## 13. 로컬에서 먼저 확인하기

```bash
npm install
cp .env.example .env.local     # 위에서 받은 키들을 채웁니다
npm run dev
```

키가 하나도 없어도 앱은 뜹니다. UI 를 먼저 보고 싶다면:

```bash
curl -X POST http://localhost:3000/api/dev/seed
```

> ⚠️ 이 데이터는 **전부 합성이며 실제 시세가 아닙니다**. 개발 환경에서만 동작하고,
> Supabase 가 연결돼 있으면 실제 DB 를 덮어쓰지 않도록 기본 차단됩니다.

---

## 14. 문제 해결

| 증상                                   | 원인·해결                                                                 |
| -------------------------------------- | ------------------------------------------------------------------------- |
| 지도 숫자가 전부 비어 있음             | 백필 미실행. `/api/cron/backfill` 을 `remaining=0` 까지 호출                |
| 실거래 API 가 `SERVICE_KEY_IS_NOT_REGISTERED` | 승인 대기 중이거나 Encoding 키를 넣음 → **Decoding 키** 사용             |
| 카카오 전송 시 `KOE006`                | Redirect URI 불일치 → 개발자센터에 배포 주소를 정확히 등록                 |
| 카카오 전송 시 `insufficient scope`    | 동의항목에서 `talk_message` 미활성 → 켠 뒤 재연결                          |
| 주변 입지가 안 나옴                    | 카카오맵 제품 미활성 → 제품 설정에서 카카오맵 ON                          |
| 동 단위는 나오는데 단지가 안 나옴      | 원본 거래는 **관심 지역으로 등록한 시군구만** 수집. 설정에서 지역 추가      |
| 설정이 재시작하면 사라짐               | Supabase 미연결 → 2번 항목 확인                                           |
| 브리핑이 안 옴                         | `/settings` 에서 자동 발송 ON + 수신자 스위치 ON + Cron 로그 확인          |

---

## 15. 보안 체크리스트

- [ ] `.env.local` 이 `.gitignore` 에 있는지 (기본 포함됨)
- [ ] `SUPABASE_SERVICE_ROLE_KEY` 를 공개 저장소에 올리지 않았는지
- [ ] `CRON_SECRET` 이 충분히 긴 랜덤값인지
- [ ] OpenAI 사용 한도(Usage limits)를 설정했는지
- [ ] 공개 저장소라면 배포 주소를 아는 사람이 `/settings` 에 접근할 수 있음 —
      민감하면 Vercel **Deployment Protection** 을 켜세요
      (Settings → Deployment Protection → Vercel Authentication)
