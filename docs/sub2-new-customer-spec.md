# SUB2 — 신규 고객(모델B: 자기 카페·자기 계정) 발행 스펙

**목적**: 접수로 새로 들어오는 고객(예: 선유도바닷가)을 SUB2에서 **고객 자기 네이버 계정으로 로그인 → 고객 카페/게시판에 대신 발행**. 기존 더반/누수(우리 계정·우리 카페)와 다름 — 계정·카페·게시판·키워드·사진을 **접수 데이터에서 읽어** 처리(하드코딩 X).

지금 단계: **SUB2에서 수동 실행**(스크립트 돌려서 처리). 나중에 main 발행버튼 트리거는 별도.

---

## 1. 읽을 데이터 (서비스키 REST, RLS 우회)

### A. 접수 — `cafe_deploy_requests`
발행 대상 = **`status='세팅중'`** 인 행(우리가 검토 후 세팅중으로 올린 것). 신규 고객형은 자기 계정/카페가 있음.
```
GET /rest/v1/cafe_deploy_requests?status=eq.세팅중&select=*
```
쓰는 필드:
- `id`, `client_id` — credential·사진 조인 키
- `company_name` — 업체명(원고 브랜드)
- `url` — 네이버 플레이스 주소(업종/메뉴 파악용, 원고 소스)
- `deploy_type` — 키워드형/지역형
- `cafe_name` — **대상 카페명**(예: "마이클의 정보 세상2")
- `board_name` — **게시판명**(예: "정보") → 매니페스트 board 블록에 정확일치
- `selected_keywords` — **발행할 키워드 배열**(이미 인기탭 검증됨): `[{keyword, volume, theme}]`
- `photos` — `{main:[경로], real:[경로], banner:[경로]}` (스토리지 경로)

### B. 네이버 계정(민감) — `cafe_deploy_credentials`
```
GET /rest/v1/cafe_deploy_credentials?client_id=eq.<client_id>&select=naver_id,naver_pw,deploy_request_id
```
- `naver_id`, `naver_pw` — **고객 계정 로그인**(평문, 서비스키로만 접근). 이 계정으로 CDP 로그인.

### C. 사진 — ⚠️ **스튜디오 설정 우선**, 없으면 접수
이미지는 **두 소스**가 있고 담당자가 스튜디오에서 넣은 게 최종이다. **아래 우선순위로 읽을 것**:

**① (우선) 스튜디오 설정 `cafe_studio_settings`** — 담당자가 '값 저장하기'로 넣은 발행 이미지. **버킷 `cafe-images`**.
```
GET /rest/v1/cafe_studio_settings?client_id=eq.<client_id>&select=main_banner,photos,banners
```
- `main_banner`(상단 배너 1장)·`photos`(실사)·`banners`(끝 배너) = 경로 배열(jsonb).
- 경로 예: `studio-settings/<client_id>/main_banner_0.jpg` · `..._photos_N` · `..._banners_N`
- 다운로드: `POST /storage/v1/object/sign/cafe-images/<경로>` 또는 `GET /storage/v1/object/cafe-images/<경로>` (서비스키).
- 배치: **상단배너(main_banner) → 실사(photos, 문단 사이) → 끝배너(banners)** — 더반/누수 스타일.

**② (없을 때만) 접수 `cafe_deploy_requests.photos`** — 고객 접수 원본. **버킷 `deploy-intake`**.
```
GET /storage/v1/object/sign/deploy-intake/<경로>   경로 예: <client_id>/<batch>/main_0.jpg
```
→ **cafe_studio_settings 에 값이 있으면 그걸 쓰고(우리가 세팅한 최종본), 없을 때만 접수 photos 로 폴백.** (지금 배너가 '빈 데이터'로 나온 원인 = SUB2가 접수만 읽어서. 배너는 스튜디오 설정에 저장돼 있음.)

---

## 2. 발행 절차 (접수 1건당)

1. `status='세팅중'` 접수 claim(중복처리 방지 — 처리 시작 시 별도 플래그/노트 또는 claimed 표시).
2. `cafe_deploy_credentials` 에서 그 client_id 의 `naver_id/naver_pw` → **고객 계정으로 CDP 로그인**.
3. 사진 다운로드: `photos.main`(대표), `photos.real`(현장 실사), `photos.banner`(배너) 로컬 저장.
4. `selected_keywords` 각 키워드마다:
   - **원고 생성**(SUB2 기존 generator, 키워드형=맛집 양식). `company_name`·`url`(플레이스 업종/메뉴)로 맥락, 키워드를 제목/본문 주제로.
   - **사진 배치**: 매니페스트 image 블록에 다운로드한 사진(대표+실사+배너) 삽입.
   - **게시**: `cafe_name` 카페의 `board_name` 게시판에 등록. write URL 은 menuid 빼기(BoardError 방지). board 는 매니페스트 board 블록에 **정확일치**.
5. 처리 결과 기록(성공/실패, 게시 URL).

---

## 3. 반드시 넣을 가드 (더반/누수 폴러와 동일 원칙)

- **하루상한·발행 간 텀**(예: 40분): 계정당 볼륨 관리(차단 방지). 신규 계정은 특히 보수적으로.
- **2차 중복검사**: 같은 카페에 같은 키워드/제목 이미 있으면 skip(check_exists).
- **CDP 견고성**: 로그인 세션 keepalive, 실패 재시도, 캡차/2단계 감지 시 중단.
- **계정 분리**: 고객 계정은 고객 것만 — 우리 계정과 절대 섞지 말 것.

### 3-1. ⚠️ 크롬(CDP) 포트·프로필 격리 — 신규 업체는 반드시 새 포트
**신규 업체(고객 자기 계정)는 기존 발행과 크롬 인스턴스를 절대 공유하면 안 된다.** (계정·쿠키 섞임=오발행·차단·세션 파괴)
- **포트**: 신규 업체마다 **기존과 겹치지 않는 새 원격디버그 포트** 할당. 기존 고정업체(더반/누수)가 쓰는 포트대역과 분리.
  - 권장: 계정(naver_id)·client_id 기준으로 결정적 포트 매핑(예: base 9500 + 해시%N), 또는 사용 중 포트 스캔 후 빈 포트 점유. **이미 열린 포트 재사용 금지**.
- **프로필**: 크롬 `--user-data-dir` 을 **계정별 전용 디렉터리**로(고객 계정끼리도·우리 계정과도 분리). 프로필 공유 시 로그인 충돌.
- **진행 중 발행과 충돌 금지**: 현재 발행 중인 잡(고정업체 더반/누수 포함)이 쓰는 **포트·프로필·계정을 절대 건드리지 말 것**. 시작 전 "이 계정으로 도는 크롬이 이미 있나" 확인 후, 없을 때만 새로 기동. 있으면 그 잡 끝날 때까지 대기(또는 다른 포트로 별개 기동하되 계정이 다를 때만).
- **동시성**: 같은 naver 계정을 두 프로세스가 동시에 몰면 안 됨(락). client_id/계정 단위 단일 실행 보장.

---

## 4. 상태 흐름

- 접수(고객 제출) → **세팅중**(우리 검토·세팅 완료 = SUB2 처리 대상) → SUB2 발행 → **완료**.
- SUB2: 처리 시작 시 중복 claim 방지 표시, 완료 시 `status='완료'` 로 PATCH.
```
PATCH /rest/v1/cafe_deploy_requests?id=eq.<id>   {"status":"완료"}
```

---

## 5. 지금 처리할 실제 1건 (선유도바닷가)

| 항목 | 값 |
|---|---|
| deploy_request id | `d15e488d-32d7-4d77-986c-61100a4e4fb4` |
| client_id | `9f58a414-5648-4d7b-a0ab-86d186a48777` |
| 업체명 | 선유도바닷가 |
| 플레이스 | https://naver.me/FXwGExYg |
| 대상 카페 | **마이클의 정보 세상2** |
| 게시판 | **정보** |
| 네이버 계정 | `rlawhddls125` (+pw는 credentials) |
| 키워드 10 | 군산 맛집 · 군산선유도맛집 · 군산선유도가볼만한곳 · 군산선유도횟집 · 군산 삼합 · 군산 조개 · 선유남 맛집 · 선유남 조개 · 전북 삼합맛집 · 군산 물회 |
| 사진 | main 1 · real 8 · banner 1 (deploy-intake 버킷, client 폴더) |

---

## 6. 스튜디오 발행요청 큐 (cafe_gen_requests, client_id) — 추가분 발행
접수의 selected_keywords 외에, 담당자가 **자동화 발행 스튜디오**(CafeCustomerStudio)에서 finder로 키워드를 더 골라 "SUB2 발행 요청"을 누르면 **`cafe_gen_requests`** 에 쌓인다(고정업체와 같은 큐, 단 **client_id 채워짐**). 전제: docs/cafe-gen-requests-client.sql.
- 신규 업체 요청 식별 = **`client_id is not null`** (고정업체 더반/누수는 client_id null·company=durban/leak3).
- 각 행: company(고객 company_key)·board(고객 게시판)·region·keyword·client_id·status=pending.
- SUB2 처리: `cafe_gen_requests?client_id=not.is.null&status=eq.pending` claim(CAS) → **client_id 로 `cafe_deploy_credentials`(계정)·`cafe_accounts`(카페/게시판/club_id) 조회** → 그 계정·카페로 keyword 발행(2절 절차 동일) → status done + queue_job_id.
- 즉 **접수(초기 selected_keywords) + 이 큐(추가 키워드)** 둘 다 처리하면 됨.

## 7. 나중(별도): main 발행버튼 → SUB2 자동 트리거
지금은 SUB2 수동. 최종엔 main 발행 버튼이 이 접수를 '발행배정'으로 표시 → SUB2가 폴링해 위 절차 자동 실행. 그 큐/플래그는 그때 main측에 붙임.
