# 다른 PC에서 크롤링 · 카페 원고 생성기 돌리기

회사의 다른 컴퓨터(또는 집 PC)에서 이 시스템을 쓰기 위한 설치 안내서.
**위에서부터 순서대로** 따라 하면 됩니다.

> 💡 이 문서는 GitHub 웹에서 바로 볼 수도 있습니다.
> (설치 전에는 Git이 없어서 clone을 못 하므로, 처음에는 웹에서 보고 따라 하세요)
> `https://github.com/gyu6425-svg/DDMKT_ERP` → `docs` → `새-PC-설치가이드.md`

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

## 1단계. 메인 PC에서 먼저 할 일 — `.env` 3개를 USB에 담기

`.env` 에는 비밀키(Supabase·OpenAI·네이버)가 들어 있어서 **깃에 올라가지 않습니다.**
그래서 이 3개만은 **직접 옮겨야** 합니다.

메인 PC에서 아래 3개를 USB에 복사하세요:

```
C:\Users\ddmkt\DDMKT_ERP\.env
C:\Users\ddmkt\DDMKT_ERP\crawler\.env
C:\Users\ddmkt\DDMKT_ERP\crawler\cafe_pub\.env
```

- 📌 **숨김 파일**이라 안 보이면: 탐색기 상단 `보기` → **`숨긴 항목` 체크**
- ⚠️ **카톡·메일로 보내지 마세요.** USB로만 옮기세요.

어떤 키가 들어있는지 참고 (값은 각자 다름):

| 파일 | 들어있는 키 |
|---|---|
| `DDMKT_ERP\.env` | `OPENAI_API_KEY`, `OPENAI_IMAGE_MODEL` 등 |
| `DDMKT_ERP\crawler\.env` | `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `NAVER_CLIENT_ID/SECRET` |
| `DDMKT_ERP\crawler\cafe_pub\.env` | `CAFE_*` 설정 |

---

## 2단계. 다른 PC에 프로그램 2개 설치

1. **Python** — https://www.python.org/downloads/
   ⚠️ 설치 **첫 화면 맨 아래 "Add python.exe to PATH" 체크** (이걸 빠뜨리면 나중에 명령이 안 먹습니다)
2. **Git** — https://git-scm.com/download/win (계속 "다음"만 눌러도 됩니다)

설치 확인 — **명령 프롬프트(cmd)** 를 열고:
```
python --version
git --version
```
둘 다 버전이 나오면 정상입니다.

> 💡 cmd 여는 법: 키보드 `윈도우키` + `R` → `cmd` 입력 → 엔터

---

## 3단계. 소스 받기

```
cd C:\Users\%USERNAME%
git clone https://github.com/gyu6425-svg/DDMKT_ERP.git
cd DDMKT_ERP
```

---

## 4단계. 파이썬 패키지 설치

```
pip install -r crawler\requirements.txt
```

---

## 5단계. USB의 `.env` 3개를 붙여넣기

1단계에서 USB에 담은 3개를, 새 PC의 **똑같은 위치**에 넣습니다:

```
DDMKT_ERP\.env
DDMKT_ERP\crawler\.env
DDMKT_ERP\crawler\cafe_pub\.env
```

(각 폴더에 `.env.example` 이 있는데, 그건 **견본**이라 그대로 두시면 됩니다.
어떤 키가 필요한지 궁금할 때 열어보는 용도입니다.)

---

## 6단계. 잘 설치됐는지 테스트 — **돈 안 나갑니다**

```
cd crawler\cafe_pub
python cafe_auto_publish.py --dry
```

**성공하면** 이런 식으로 지역 목록이 쭉 나옵니다:
```
=== 카페 자동발행: 업종 '누수탐지' · 후보 51개 · 목표 2건 ===
이미 발행된 지역(제외): ['강남', '과천', ...]
  [❌인기글없음] 서초 누수탐지
  [✅통과] 의왕 누수탐지
→ 발행 대상 2개: ['의왕', '부천']
(dry-run: 생성·발행 안 함)
```

`--dry` 는 **확인만 하고 실제로 만들지 않으므로 비용이 들지 않습니다.**

---

## 7단계. 실제 사용

### 카페 원고 생성 (다른 PC의 주 용도)

```
cd DDMKT_ERP\crawler\cafe_pub
python cafe_auto_publish.py --limit 2
```

→ 원고 2건이 생성되어 **Supabase 큐에 쌓입니다.**
→ **메인 PC의 발행 리스너가 30분 간격으로 알아서 카페에 올립니다.**
   (다른 PC에서는 생성만 하면 끝. 발행 신경 안 쓰셔도 됩니다.)

`--limit` 숫자를 바꾸면 갯수 조절이 됩니다. 1건당 대략 60원.

> **배너 이미지 관련**: 기본값은 로컬 배너 서버(8787)를 씁니다. 그 PC에 서버가 없으면
> 배너 생성에서 실패할 수 있습니다. 두 가지 해결책 중 하나를 쓰세요.
> 1. 그 PC에서 Node 설치 후 별도 cmd 창에 `npm install` → `npm run api:dev` 켜두기
> 2. `crawler\cafe_pub\.env` 에 아래 한 줄 추가 (로컬 서버 불필요)
>    ```
>    CAFE_BANNER_API=https://<배포도메인>/api/generate-cafe-card
>    ```

### 크롤링 (수동 실행)

```
cd DDMKT_ERP\crawler
python crawl_bydate.py 1        ← 오늘 쓴 글 순위 측정
python blog_rank_crawler.py     ← 전체 크롤
python place_rank_crawler.py    ← 플레이스 순위
python cafe_rank_crawler.py     ← 카페 순위
```

⚠️ **메인 PC의 크롤 시간대(새벽 3시 전체크롤 / 매 30분 당일글 / 9시20분 플레이스)에는 돌리지 마세요.**
같은 IP에서 동시에 긁으면 차단 위험이 있습니다.

---

## 8단계. 막혔을 때 (자주 나는 오류)

| 화면에 나오는 말 | 원인 / 해결 |
|---|---|
| `'python'은(는) 내부 또는 외부 명령이 아닙니다` | 2단계에서 **"Add python.exe to PATH"** 를 안 함 → Python 재설치하며 체크 |
| `'git'은(는) 내부 또는 외부 명령이 아닙니다` | Git 미설치 → 2단계 |
| `ModuleNotFoundError: No module named 'requests'` (또는 PIL 등) | 4단계 `pip install -r crawler\requirements.txt` 안 함 |
| `env 부족(SUPABASE_*/OPENAI_API_KEY)` | `.env` 를 안 넣었거나 **위치가 틀림** → 5단계 다시 확인 |
| `배너 실패` / `Connection refused ... 8787` | 배너 서버가 없음 → 7단계의 배너 관련 안내 참고 |
| `LOGIN_REQUIRED` | 카페 **발행**을 시도한 경우. 발행은 메인 PC가 담당하므로 다른 PC에선 안 하셔도 됩니다 |

그래도 안 되면 **화면에 나온 빨간 글씨를 그대로 캡처/복사**해서 알려주세요.

---

## 9단계. (선택) 그 PC에서 카페 발행까지 하려면

평소엔 **안 하셔도 됩니다** (발행은 메인 PC 담당). 굳이 필요할 때만:

1. **메인 PC의 발행 리스너를 먼저 끄세요.** 안 그러면 같은 글이 두 번 올라갑니다.
2. `pip install playwright` → `python -m playwright install chromium`
3. `crawler\cafe_pub\run_chrome_login.bat` 실행 → 창이 뜨면 네이버 로그인
   - ⚠️ **"로그인 상태 유지" 반드시 체크** (안 하면 크롬을 끄는 순간 로그인이 사라져서 발행이 멈춥니다)
4. `crawler\cafe_pub\.env` 에서 `CAFE_NO_SEND=0` 으로 변경
5. `crawler\cafe_pub\run_cafe_listener.bat` 실행

---

## 10단계. 알아두면 좋은 제약 (아직 자동화 안 된 부분)

- **크롤 자동 스케줄은 다른 PC에 자동으로 안 생깁니다.**
  매일 3시 전체크롤, 30분마다 당일글 같은 일정은 **메인 PC의 Windows 작업 스케줄러에만**
  등록돼 있고 깃에는 없습니다. 다른 PC에서는 7단계처럼 **수동 실행**만 됩니다.
  (크롤은 원래 한 대만 돌리는 게 맞으므로 대부분 문제되지 않습니다.)
- **`.bat` 파일은 다른 PC에서 더블클릭해도 안 됩니다.**
  파일 안에 메인 PC의 파이썬 설치 경로가 그대로 적혀 있기 때문입니다.
  → 다른 PC에서는 7단계처럼 **`python 파일이름.py` 로 직접 실행**하세요.

---

## 부록. 메인 PC 담당자용 — 발행이 멈췄을 때

다른 PC에서 원고를 아무리 만들어도, **메인 PC 쪽이 아래 상태가 아니면 발행이 안 됩니다.**

1. **크롬(9223)이 떠 있어야 함** — `crawler\cafe_pub\run_chrome.bat`
2. **네이버 로그인이 살아 있어야 함**
   - 크롬이 꺼지면 로그인도 같이 사라질 수 있습니다(세션 쿠키인 경우).
   - 그래서 로그인할 때 **"로그인 상태 유지"를 꼭 체크**하세요. 그래야 크롬이 죽거나
     재부팅해도 로그인이 유지돼 무인 발행이 이어집니다.
3. **발행 리스너가 돌고 있어야 함** — `crawler\cafe_pub\run_cafe_listener.bat`

로그인이 풀렸는지 확인하는 방법:
```
cd DDMKT_ERP\crawler\cafe_pub
python -c "import publish_cafe as pc; print(pc.session_ping(pc.DEFAULT_CDP))"
```
- `True` → 로그인 유지, 발행 가능
- `False` → 로그아웃됨. `run_chrome_login.bat` 으로 다시 로그인 필요
- `None` → 크롬이 꺼져 있음. `run_chrome.bat` 실행

관련 문서: [카페 멀티 PC 운영](cafe-multi-pc.md)
