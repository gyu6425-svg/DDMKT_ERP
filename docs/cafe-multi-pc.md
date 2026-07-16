# 카페 자동생성·자동발행 — 다른 PC(집)에서 작업하기

## 구조 요약 (무엇이 어디서 도는가)

| 기능 | 어디서 되나 | 이유 |
|---|---|---|
| **원고/배너 생성** (`cafe_auto_publish.py`) | **어느 PC든 OK** | OpenAI + Supabase + 배너 API 호출뿐. 브라우저 불필요 |
| **큐 적재** (`cafe_publish_queue`) | 어느 PC든 OK | Supabase(클라우드) 공유 |
| **실제 발행** (`publish_listener.py` → `publish_cafe.py`) | **네이버 로그인된 크롬이 있는 PC에서만** | 스마트에디터를 CDP로 조종해야 함 |
| 웹 ERP `/cafe` 생성기 | 어느 PC든 OK | Cloudflare 배포본 |
| 블로그/플레이스 크롤 | 회사 PC(작업 스케줄러 등록된 곳) | 예약작업이 그 PC에 있음 |

**핵심**: 큐가 Supabase에 있어서 **"집에서 생성 → 회사 PC가 발행"** 이 자연스럽게 된다.

## ⚠️ 절대 규칙: 리스너는 한 대에서만

`publish_listener.py` 를 **회사·집에서 동시에 켜면 같은 글이 두 번 발행된다.**
집에서 발행까지 하려면 **회사 리스너를 먼저 끄고** 시작할 것.

## 집 PC 세팅 (최초 1회)

```bash
git clone https://github.com/gyu6425-svg/DDMKT_ERP.git
cd DDMKT_ERP
npm install
pip install playwright requests pillow truststore
python -m playwright install chromium
```

### .env 파일 (git 에 없음 — 회사 PC 에서 복사해와야 함)

| 파일 | 필요한 키 |
|---|---|
| `crawler/.env` | `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `OPENAI_API_KEY` |
| `crawler/cafe_pub/.env` | `CAFE_WRITE_URL`, `CAFE_NO_SEND=0`, `CAFE_MIN_GAP_MIN=30` |

USB나 안전한 경로로 옮길 것. **채팅·메일로 키를 보내지 말 것.**

## 집에서 "원고 생성만" (발행은 회사 PC가) — 권장

배너 API를 로컬에 안 띄우고 운영 주소로 쓰려면 `crawler/cafe_pub/.env` 에 추가:

```
CAFE_BANNER_API=https://<배포도메인>/api/generate-cafe-card
```

그리고:

```bash
cd crawler/cafe_pub
python cafe_auto_publish.py --limit 5        # 인기글 뜨는 신규 지역만 골라 생성→큐 적재
python cafe_auto_publish.py --limit 5 --dry  # 대상만 확인(생성·비용 없음)
```

큐에 쌓이면 **회사 PC 리스너가 30분 간격으로 알아서 발행**한다. 집에서 할 일 끝.

(로컬 배너 서버를 쓰고 싶으면 `CAFE_BANNER_API` 생략 + `npm run api:dev` 실행)

## 집에서 "발행까지" 하려면

1. **회사 PC 리스너를 끈다** (중복 발행 방지)
2. 집 PC에서 네이버 로그인:
   ```
   crawler/cafe_pub/run_chrome_login.bat
   ```
   창이 뜨면 네이버 로그인 — **"로그인 상태 유지" 반드시 체크** (안 하면 크롬 끄는 순간 로그인 날아감)
3. 리스너 실행:
   ```
   crawler/cafe_pub/run_cafe_listener.bat
   ```
   (크롬 9223 확인/기동 + 리스너 + 유휴 시 세션 유지 핑까지 한 번에)

옵션(환경변수):

- `CAFE_FIRST_AT=18:13` — 첫 발행 시각 고정
- `CAFE_STOP_AT=23:59` — 이 시각 지나면 발행 중단
- `CAFE_MIN_GAP_MIN=30` — 발행 간격(분)
- `CAFE_MIN_SECONDS=330` — 글 1건 최소 작성 시간(초)

## 자주 겪는 함정

- **`.bat`/`.vbs` 는 반드시 CRLF** — LF 로 저장되면 cmd 가 파싱 못 해 자동시작이 조용히 죽는다. `.gitattributes` 로 강제해뒀지만, 새로 만들 때 확인할 것.
- **네이버 쿠키가 세션쿠키면 크롬 종료 시 로그인 소멸** → 로그인할 때 "로그인 상태 유지" 체크 필수.
- **크롬 탭을 전부 닫으면 헤드리스 크롬이 종료된다** — 최소 1탭 유지.
- 로그인 체크는 반드시 **로그인 필수 페이지**(글쓰기 URL)로 — `section.cafe.naver.com` 같은 공개 페이지는 로그아웃 상태에서도 열려서 오판한다.
