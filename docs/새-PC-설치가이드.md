# 다른 PC에서 크롤링 · 카페 원고 생성기 돌리기

회사의 다른 컴퓨터(또는 집 PC)에서 이 시스템을 쓰기 위한 설치 안내서.
**위에서부터 순서대로** 따라 하면 됩니다.

---

## 0. 먼저 알아둘 것 (중요)

**무엇이 어디서 돌아가는가**

| 기능 | 다른 PC에서 되나? | 이유 |
|---|---|---|
| **카페 원고·배너 생성** | ✅ 된다 | OpenAI + Supabase 호출만 함. 브라우저 불필요 |
| **크롤링(순위 측정)** | ✅ 된다 | 네이버에 HTTP 요청만 함 |
| **카페 실제 발행** | ⚠️ 그 PC에서 네이버 로그인 필요 | 로그인된 크롬을 조종해야 함 |

**⚠️ 두 PC에서 동시에 돌리면 안 되는 것**

- **크롤 스케줄**: 회사 메인 PC 한 대만 켜세요.
  두 대가 같은 회사 인터넷(같은 공인 IP)을 쓰는데, 크롤러에는 네이버 차단을 피하려고
  "차단 예방 휴식"(요청 사이 40~50초 대기)이 들어 있습니다. 두 대가 동시에 돌면
  네이버 입장에선 한 IP에서 두 배 속도로 긁는 셈이라 **차단 위험이 커집니다.**
- **카페 발행 리스너**: 절대 두 대에서 켜지 마세요. **같은 글이 두 번 올라갑니다.**

**그래서 권장 사용법**
- 메인 PC: 크롤 스케줄 + 카페 발행 (지금처럼)
- 다른 PC: **카페 원고 생성** + 필요할 때 **수동 크롤**

---

## 1. 프로그램 설치 (그 PC에서 1회)

1. **Python** — https://www.python.org/downloads/
   설치 화면에서 **"Add python.exe to PATH" 체크** (이거 안 하면 나중에 명령이 안 먹습니다)
2. **Git** — https://git-scm.com/download/win
3. (배너 이미지까지 만들 거면) **Node.js** — https://nodejs.org (LTS)

설치 확인 — 명령 프롬프트(cmd)에서:
```
python --version
git --version
```
버전이 나오면 정상입니다.

---

## 2. 소스 받기

```
cd C:\Users\%USERNAME%
git clone https://github.com/gyu6425-svg/DDMKT_ERP.git
cd DDMKT_ERP
```

---

## 3. 파이썬 패키지 설치

```
pip install -r crawler\requirements.txt
```

---

## 4. `.env` 파일 3개 넣기 ← 직접 옮겨야 함

`.env` 에는 비밀키가 들어 있어서 **깃에 올라가지 않습니다.**
메인 PC에서 USB 등으로 직접 복사해 오세요. (**카톡·메일로 보내지 마세요.**)

| 놓을 위치 | 들어있는 키 |
|---|---|
| `DDMKT_ERP\.env` | `OPENAI_API_KEY`, `OPENAI_IMAGE_MODEL` 등 |
| `DDMKT_ERP\crawler\.env` | `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `NAVER_CLIENT_ID/SECRET` |
| `DDMKT_ERP\crawler\cafe_pub\.env` | `CAFE_*` 설정 |

각 폴더에 `.env.example` 이 있으니, **어떤 키가 필요한지는 그 파일을 보면 됩니다.**
(`.env.example` 을 복사해서 이름을 `.env` 로 바꾸고 값을 채워도 됩니다.)

---

## 5. 실행하기

명령 프롬프트에서 `DDMKT_ERP\crawler` 폴더로 이동한 뒤 실행합니다.

### 카페 원고 생성 (다른 PC의 주 용도)

```
cd DDMKT_ERP\crawler\cafe_pub
python cafe_auto_publish.py --dry          ← 어떤 지역이 뽑히는지만 확인(돈 안 씀)
python cafe_auto_publish.py --limit 2      ← 실제로 2건 생성해서 큐에 넣기
```

생성된 글은 Supabase 큐에 쌓이고, **메인 PC의 발행 리스너가 30분 간격으로 알아서 올립니다.**
즉 다른 PC에서는 생성만 하면 끝입니다.

> **배너 이미지 서버**: 기본값은 로컬 서버(8787)를 씁니다. 그 PC에서 배너까지 만들려면
> 별도 창에서 `npm install` 후 `npm run api:dev` 를 켜두세요.
> 또는 `crawler\cafe_pub\.env` 에 `CAFE_BANNER_API=https://<배포도메인>/api/generate-cafe-card`
> 를 넣으면 로컬 서버 없이도 됩니다.

### 크롤링 (수동 실행)

```
cd DDMKT_ERP\crawler
python crawl_bydate.py 1        ← 오늘 쓴 글 순위 측정
python blog_rank_crawler.py     ← 전체 크롤
python place_rank_crawler.py    ← 플레이스 순위
python cafe_rank_crawler.py     ← 카페 순위
```

⚠️ **메인 PC의 크롤이 도는 시간대(새벽 3시 전체크롤, 매 30분 당일글)에는 돌리지 마세요.**
같은 IP에서 동시에 긁으면 차단 위험이 있습니다.

---

## 6. 자주 나는 오류

| 증상 | 원인 / 해결 |
|---|---|
| `'python'은(는) 내부 또는 외부 명령이 아닙니다` | Python 설치 시 "Add to PATH" 를 안 함 → 재설치하며 체크 |
| `ModuleNotFoundError: No module named 'requests'` | 3단계 `pip install -r crawler\requirements.txt` 안 함 |
| `SUPABASE_URL / SUPABASE_SERVICE_KEY 필요` | `crawler\.env` 가 없거나 위치가 틀림 |
| 배너 생성 실패 | 배너 API 서버(`npm run api:dev`)가 안 떠 있음 → 위 5단계 설명 참고 |
| `LOGIN_REQUIRED` | 카페 **발행**을 시도한 경우. 그 PC에서 네이버 로그인 필요(아래 참고) |

---

## 7. (선택) 그 PC에서 카페 발행까지 하려면

발행은 **네이버에 로그인된 크롬**을 조종하는 방식이라 PC마다 로그인이 필요합니다.
로그인 세션(`chrome_profile` 폴더)은 깃에 없고 복사해도 잘 안 됩니다.

1. **메인 PC의 발행 리스너를 먼저 끄세요.** (안 그러면 같은 글이 두 번 올라갑니다.)
2. `pip install playwright` 후 `python -m playwright install chromium`
3. `crawler\cafe_pub\run_chrome_login.bat` 실행 → 창이 뜨면 네이버 로그인
   - **"로그인 상태 유지" 반드시 체크** (안 하면 크롬을 끄는 순간 로그인이 사라집니다)
4. `crawler\cafe_pub\.env` 에서 `CAFE_NO_SEND=0` 으로 바꾸기
5. `crawler\cafe_pub\run_cafe_listener.bat` 실행

---

## 8. 아직 자동화되지 않은 것 (알고 계셔야 할 부분)

- **크롤 자동 스케줄은 그 PC에 자동으로 안 생깁니다.**
  매일 3시 전체크롤 / 30분마다 당일글 같은 일정은 **메인 PC의 Windows 작업 스케줄러에만** 등록돼 있고,
  깃에는 그 설정이 없습니다. 다른 PC에서는 위 5단계처럼 **수동 실행**만 됩니다.
  (애초에 크롤 스케줄은 한 대만 돌리는 게 맞으므로 대부분 문제되지 않습니다.)
- `.bat` 실행 파일들은 아직 **메인 PC의 파이썬 설치 경로가 박혀 있어** 다른 PC에서 그냥 누르면 실패합니다.
  → 다른 PC에서는 위 5단계처럼 **`python xxx.py` 로 직접 실행**하세요.

관련 문서: [카페 멀티 PC 운영](cafe-multi-pc.md)
