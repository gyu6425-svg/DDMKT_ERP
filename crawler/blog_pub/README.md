# 블로그 자동 저장 (SUB1) — 임시저장까지만

네이버 블로그 글쓰기 에디터에 원고/사진을 자동으로 채우고 **'저장'(임시저장)까지만** 한다.
**발행은 하지 않는다.** 사람이 임시저장함에서 검수한 뒤 직접 발행한다.

카페 자동발행(`crawler/cafe_pub/`)의 구조를 본떴지만 **코드는 복사**했다
(`docs/MERGE-SAFETY.md` §3.2 — import 하면 상대가 리팩터링했을 때 조용히 깨진다).
카페 파일은 읽기만 하고 절대 수정하지 않는다.

## 왜 카페 코드를 그대로 못 쓰나 (독립검증 결론)

| 항목 | 카페 | 블로그 |
|---|---|---|
| 성공 판정 | 등록 후 **URL 전이** | 임시저장은 **URL 이 안 바뀐다** → '저장 N' 카운터 증가로 판정 |
| 에디터 위치 | top-level document | `#mainFrame` iframe 일 수 있음 → 프레임 해석 필수 |
| 에디터 비우기 | 못 찾으면 **True(통과)** | 못 찾으면 **False(중단)** — fail-closed 로 뒤집음 |
| 제출 버튼 | `a.BaseButton--skinGreen` 클래스 폴백 OK | **금지** — 블로그의 초록 버튼은 '발행' |
| 파티션 키 | 게시판(board) | 블로그 아이디(blog_id) = 프로필 = 포트 1:1:1 |
| 큐 | `cafe_publish_queue` | `blog_save_queue` (**절대 공유 금지**) |

## 발행 차단 4겹

1. **네트워크** — 발행 POST 를 `page.route` 로 abort (`save_blog._install_publish_guard`)
2. **DOM** — 캡처 단계에서 발행 버튼 클릭을 삼키고 `pointer-events:none`
3. **스키마** — `blog_save_queue.status` CHECK 에 `posted` 가 없고 `posted_url` 컬럼도 없다
4. **사후검증** — 저장 후 URL 이 `logNo=`/`PostView` 로 전이하면 최고 심각도로 실패

가드가 **발동하면 조용히 넘어가지 않고** job 을 `fail` 로 떨어뜨린다(`GuardTripped`).
`python test_no_publish.py` 가 이 구조를 매번 정적으로 검사한다.

## 설치 (SUB1, 1회)

```bat
REM 1) 의존성 (playwright 번들 크로미움은 불필요 — CDP 로 시스템 크롬에 붙는다)
pip install playwright requests pillow

REM 2) 설정
copy .env.example .env
REM    .env 에 BLOG_IDS / BLOG_ID / BLOG_WRITE_URL 채우기

REM 3) 대상 블로그 계정으로 1회 수동 로그인 (창이 뜬다)
run_chrome_blog_login.bat
```

DB: Supabase SQL Editor 에서 `docs/blog-save-queue.sql` 1회 실행
(또는 `docs/_RUN_ALL.sql` 끝 블록).

## Phase 0 — 셀렉터 확정 (이거 안 하면 저장 안 된다)

`blog_selectors.CONFIRMED_ON` 이 비어 있으면 엔진이 저장을 **거부**한다.
추측 셀렉터로 돌리면 '실패'가 아니라 '엉뚱한 버튼 클릭'이 되기 때문이다.

```bat
run_chrome_blog.bat
python diag_blog.py                REM 프레임/입력칸/버튼 덤프 + 현재 후보 매칭 결과
python diag_blog.py --record 180   REM 사람이 '저장'을 누를 때 나가는 POST 기록 → _endpoints.txt
```

결과로 `blog_selectors.py` 의 `FRAME_HINT` / `SEL_*` / `SAVE_URL_PARTS` / `BLOCK_URL_PARTS` 를
채우고 `CONFIRMED_ON = '2026-MM-DD'` 를 적는다.

> ⚠️ 저장과 발행이 **같은 엔드포인트**로 확인되면 URL 차단(#1)을 쓸 수 없다.
> 그 경우 `BLOCK_URL_PARTS` 를 비우고 그 사실을 `blog_selectors.py` 주석에 반드시 남긴 뒤
> DOM 가드(#2)와 사후검증(#4)에만 의존한다.

## 운영

```bat
python save_blog.py --job <id>          REM dry-run (기본) — 저장 버튼을 찾기만 하고 안 누름
python save_blog.py --job <id> --save   REM 실제 임시저장
run_blog_saver.bat                      REM 상시 리스너 (30초 재시작 루프)
```

리스너가 실제로 저장하려면 `.env` 에 **`BLOG_SAVE_ENABLED=1`** 이 필요하다(기본은 dry-run).
카페(`CAFE_NO_SEND` 기본 발행)와 정반대로 뒤집어 둔 것이다.

## 첫 실측 합격 기준 (QA)

전부 충족해야 통과. 코드가 "안 눌렀다"고 주장하는 것만으로는 불합격.

- [ ] 실행 전/후 글쓰기 화면 `저장 N` → **정확히 N+1** (스크린샷 2장)
- [ ] 실행 전/후 **공개 글목록 총 글 수가 완전 동일** (스크린샷 2장) ← 발행 안 됨의 적극 증명
- [ ] 저장 시점 `page.url` 이 여전히 `postwrite` 계열, `logNo=` 없음
- [ ] DB 행 status = `saved`, `draft_seq` 기록됨
- [ ] 저장된 글 제목이 입력값과 완전일치, 본문 글자수 99% 이상, 이미지 개수·순서 일치
- [ ] 이전 저장분이 겹쳐 쓰이지 않음

첫 스모크는 **헤드풀 + 사람 입회 + 테스트/자사 블로그**로. 통과 후에만 헤드리스 전환.

## 안전 규칙

- 발행 코드는 "안 부른다"가 아니라 **없다**. 주석으로도 남기지 않는다(복붙 사고 차단).
- 저장 버튼 셀렉터는 **텍스트 제약 필수**. 매칭 실패 시 폴백하지 말고 중단.
- `CAFE_*` 환경변수 이름 재사용 금지 — 전부 `BLOG_` 접두어.
- 커밋 전 `git diff --stat` 로 `crawler/cafe_pub/` 변경 0줄 확인.
- **포트 9235 전용.** 포트 지도:

  | 포트 | 용도 |
  |---|---|
  | 9222 | 카카오 |
  | 9223 | 카페 발행 |
  | **9224~9229** | **카페 댓글 — 계정당 1포트** (`cafe_cmt/accounts.txt`) |
  | 9235 | 블로그 저장 (이 폴더) |

  ⚠️ 처음엔 9235 가 아니라 **9225** 로 잡았다가 SUB1 이 잡아냈다(2026-08-10). 9225 는 이미
  댓글 자동화 계정 하나가 쓰고 있어서, 그대로 뒀으면 블로그 크롬이 댓글 크롬과 충돌해
  **댓글 자동화가 깨졌을 것**이다. 댓글은 계정이 늘면 포트도 9224 부터 위로 늘어나므로,
  새 포트를 쓸 땐 **반드시 `cafe_cmt/accounts.txt` 를 먼저 확인**할 것.
- 크롬 프로필 공유 금지 — 카페 세션이 오염된다.
- "저장이니까 안전"은 **거짓**. 차단축은 IP·볼륨·계정이지 공개 여부가 아니다
  (`BLOG_DAILY_CAP` 기본 5, 실행창 10:00~23:00 로 main PC 크롤 윈도우 회피).
- 검증 끝날 때까지 Startup 자동시작에 넣지 말 것 — 재부팅 시 무인으로 네이버에 붙는다.

## 파일

| 파일 | 역할 |
|---|---|
| `blog_common.py` | env/REST/매니페스트/타이핑/**프레임 해석** (카페 순수함수 복사본) |
| `blog_selectors.py` | 셀렉터 — Phase 0 로 채운다. ⚠️ `selectors.py` 로 개명 금지(stdlib 가림) |
| `diag_blog.py` | Phase 0 실측 도구 (아무것도 입력·클릭하지 않음) |
| `save_blog.py` | 저장 엔진. 공개 진입점은 `save_draft()` 하나 |
| `blog_save_listener.py` | 큐 소비 워커 (CAS 잠금·좀비 복구·상한·세션핑) |
| `test_no_publish.py` | 발행 경로 부재 정적검사 — 커밋 전 필수 |
| `sb_auth.py` | Supabase 인증 (cafe_pub 복사본) |
