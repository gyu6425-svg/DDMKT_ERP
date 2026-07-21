# 카페 발행 — 여러 업체를 여러 PC로 나눠 돌리기 (이식 + 라우팅 구현계획)

> main 에 커밋되어 **모든 PC/브랜치가 받는다.** sub2(누수 PC)는 이 문서대로 셋업한다.
> 독립검증(리서처 → 플래너 → **리뷰어**) 결과를 반영. 2026-07-21.
> 관련: `docs/MERGE-SAFETY.md`(브랜치 병합), `docs/cafe-multi-pc.md`(집/회사 발행 셋업), `docs/cafe-publish-queue.sql`(큐 스키마).

---

## 0. 큰 그림 — "코드는 하나, `.env` 로만 분기"

발행 엔진(`crawler/cafe_pub/publish_listener.py` · `publish_cafe.py`)은 **main 에서만 개발**하고
모든 PC가 **똑같은 코드**를 받는다. 업체 차이(누수 / 더맨 / 설고)는 **전부 gitignore 된 `.env`** 에만 있다.

```
              ┌─ 공통 코드(main) ─┐        ┌─ 로컬 .env (gitignore) ─┐
  누수 PC     │ publish_listener  │  +     │ CAFE_WRITE_URL=누수카페  │  → 누수 카페에 발행
  (sub2)      │ publish_cafe      │        │ CAFE_BOARD=누수          │
              └───────────────────┘        └──────────────────────────┘
  더맨 PC     같은 코드                     CAFE_WRITE_URL=더맨새카페     → 더맨 카페에 발행
  (나중)                                    CAFE_BOARD=더맨…
```

**충돌이 안 나는 이유**: sub2 는 발행 엔진 코드를 **건드리지 않고 받기만** 한다.
코드 수정은 항상 이 PC(main)에서 → `main` → 모든 PC 흡수. sub2 가 커밋할 것은 사실상 없다.

> ⚠️ **`MERGE-SAFETY.md` 의 "sub2 = 누수 새 파일(`crawler/leak_*`)로 개발" 은 이 경우엔 적용하지 않는다.**
> 누수는 "새 기능"이 아니라 **같은 발행 엔진을 다른 설정으로 운영**하는 것이다.
> sub2 는 코드를 짜는 게 아니라 **실행(운영)만** 하므로, 새 파일도 공유파일 편집도 없다 → 병합 충돌 원천 자체가 없다.

---

## 1. 지금 단계 — 누수만 sub2 (라우팅 코드 **불필요**)

**리스너 한 대 규칙**으로 충분하다: 지금은 **sub2 만 발행**하고 **이 PC(main) 리스너는 끈다.**
큐를 `company` 로 나누지 않아도, 집는 리스너가 한 대뿐이라 중복이 구조적으로 불가능하다.
→ 아래 §2 라우팅 코드는 **더맨을 병행 발행할 때** 비로소 필요하다. 지금은 셋업만 하면 끝.

### sub2 PC 셋업 절차

1. **코드 받기** — ⚠️ **그냥 `git pull` 하지 말 것.** sub2 PC에 예전 로컬 커밋/수정이 남아 있으면
   pull 이 머지하다 충돌난다. `git status` 로 먼저 확인하고 `origin/main` 기준으로 깨끗하게 세운다.
   ```bash
   git fetch origin
   git status                           # (A) 깨끗함(nothing to commit) 이면 아래 진행
                                        # (B) 로컬 변경/커밋이 보이면 → 먼저 처리(아래 참고) 후 진행
   git checkout -B sub2 origin/main     # 최신 main 위에 sub2 세움 (이 세션 작업 포함). pull 아님
   npm install
   pip install playwright requests pillow truststore
   python -m playwright install chromium
   ```
   **(B) 로컬에 미커밋/미푸시가 있을 때** — 버릴지 남길지 정한 뒤:
   ```bash
   git stash                            # 임시 보관(나중에 git stash pop 으로 복원 가능)  ─ 또는
   git commit -am "wip: sub2 로컬 작업"  # 남길 커밋이면 커밋 후 checkout
   ```
   그다음 위 `git checkout -B sub2 origin/main` 을 실행한다. (판단이 서지 않으면 `git status` 결과를 공유할 것.)
   > `checkout -B` 는 작업파일을 origin/main 상태로 맞춘다. 위에서 stash/commit 으로 **먼저 정리했으면** 잃을 것이 없다.

2. **`.env` (gitignore — 이 PC에서 복사하거나 새로 작성. 채팅/메일로 키 보내지 말 것)**
   | 파일 | 키 |
   |---|---|
   | `crawler/.env` | `SUPABASE_URL` · `SUPABASE_SERVICE_KEY` · `OPENAI_API_KEY` |
   | `crawler/cafe_pub/.env` | `CAFE_WRITE_URL=<누수 카페 글쓰기 URL>`<br>`CAFE_BOARD=누수`<br>`CAFE_NO_SEND=0` (등록까지 자동)<br>`CAFE_MIN_GAP_MIN=30` |

3. **Supabase 1회** — `docs/cafe-publish-queue.sql` 의 `alter table` 블록들을 편집기에서 실행
   (`attempts`/`claimed_at` + `company`/`region`/`keyword` + 인덱스). 없으면 리스너가 claim 단계에서 실패한다.

4. **네이버 로그인** — `crawler/cafe_pub/run_chrome_login.bat` → 누수 계정 로그인, **"로그인 상태 유지" 체크 필수**.

5. **리스너 실행** — `crawler/cafe_pub/run_cafe_listener.bat`

6. ⚠️ **이 PC(main) 리스너를 끈다** — 두 대가 동시에 켜지면 같은 글이 두 번 발행된다.

---

## 2. 다음 단계 — 더맨 병행 발행 시 라우팅 구현 (독립검증 반영)

누수 PC와 더맨 PC가 **동시에** 발행하는 순간 "한 대 규칙"을 못 쓴다.
그때 큐를 `company` 로 나눠 **각 PC가 자기 업체 행만 집게** 해야 한다. 아래는 리뷰어 검증을 반영한 최종안.

### 2.1 리스너에 "소유 업체 필터" — `publish_listener.py`

```python
# 상단(환경 로드 부근)
OWNED = [c.strip() for c in os.environ.get("CAFE_COMPANIES", "").split(",") if c.strip()]
CLAIM_NULL = "leak" in OWNED          # 리뷰어#3: 레거시 NULL(=옛 누수 행)은 leak 소유 PC만 집는다
if not OWNED:
    print("CAFE_COMPANIES 미설정 — 이 PC는 발행하지 않음", flush=True)
    sys.exit(1)                       # 리뷰어#6: fail-closed(잘못 집느니 안 집는다). .bat 이 30초 뒤 재시도

def _owned_filter():
    """PostgREST 필터. leak 소유면 레거시 NULL 도 포함(company IS NULL)."""
    ins = ",".join(OWNED)
    if CLAIM_NULL:
        return {"or": f"(company.in.({ins}),company.is.null)"}
    return {"company": f"in.({ins})"}
```

두 곳에 `**_owned_filter()` 를 병합한다(리뷰어 #8: `or=` 는 다른 top-level 필터와 **AND** 되므로 안전):

```python
# poll (현재 publish_listener.py:174)
reqs = pc.sb_get("cafe_publish_queue",
                 {"status": "eq.pending", **_owned_filter(),
                  "order": "created_at.asc", "limit": "1", "select": "*"})

# claim CAS (현재 :206) — 필터를 넣어도 id=eq 와 AND 되어 정확히 그 행만, pending 일 때만 집는다
claimed = pc.sb_patch("cafe_publish_queue",
                      {"id": f"eq.{jid}", **_owned_filter()},
                      {"status": "processing", "claimed_at": _now_iso()}, expect="pending")
```

### 2.2 발행 대상 카페 **fail-closed** — `publish_cafe.py`  🔴 리뷰어 #1·#2 (가장 중요)

**문제**: 현재 `CAFE_WRITE_URL = os.environ.get("CAFE_WRITE_URL", "")` (`:75`) 라
값이 없으면 `""`(falsy)이지 `None` 이 아니다. `if CAFE_WRITE_URL:`(`:636`) 을 그냥 건너뛰고
**열려 있는 아무 페이지에 발행**을 시도한다. 특히 옛 공유 카페 URL 이 `.env` 에 남아 있으면
더맨 작업이 **옛 카페로 조용히 오발행**된다(board 이름도 옛 카페에 있어 `BoardError` 도 안 뜬다).

**수정**: 발행 직전에 대상 URL 이 없으면 **중단**(오발행 대신 실패):

```python
# publish() 초입 또는 _preflight 에서
if not CAFE_WRITE_URL:
    raise BoardError("발행 대상 카페 미설정(CAFE_WRITE_URL) — 오발행 방지로 중단")
```

**운영 규칙**: 더맨 새 카페가 준비되기 전에는 더맨 PC 의 `CAFE_WRITE_URL` 을
**비워두거나** 새 카페 URL 로 **교체**한다. **옛 URL 을 절대 남기지 말 것.**
(한 PC = 한 카페이므로 per-job URL 까지는 불필요. PC별 `.env` 로 충분하되, 위 가드는 반드시 넣는다.)

### 2.3 설고점 작업 **유실** 방지  🔴 리뷰어 #2

**문제**: 웹 설고 탭의 "카페 발행" 버튼은 `company='seolgo'` 행을 큐에 넣는다.
그런데 누수 PC(=leak)·더맨 PC(=theman) 어느 쪽도 seolgo 를 소유하지 않으면
**아무도 집지 않아 영영 `pending`** 으로 쌓인다. §2.1 의 fail-closed 가드는 *집은 뒤* 작동하므로
이 유실을 못 잡는다(집히지도 않으니까). 대응 **택1**:

- **(a) 권장** — 설고 웹 "카페 발행" 버튼을 **수동 안내로** 바꿔 큐 적재를 막는다.
  설고는 하루 1건 수동 운영이라 큐를 거칠 이유가 없다.
- (b) 어느 PC가 `CAFE_COMPANIES=…,seolgo` 로 **소유**한다. 단 설고는 다른 카페라 **별도 크롬 프로필** 필요.
- (c) **모니터** — "살아있는 어느 PC도 소유하지 않은 company 의 pending 행"을 주기적으로 경고.

### 2.4 새 PC 마이그레이션 순서  🟢 리뷰어 #7 → **반영 완료**

`docs/cafe-publish-queue.sql` 에 `company/region/keyword` **컬럼 add → 그다음 인덱스** 순서로 넣었다.
(그동안 라이브 DB 에만 수동 반영돼 있던 것을 문서화. 새 PC 는 이 파일 한 번만 실행하면 된다.)

---

## 3. 독립검증 결과 (발견 → 대응)

| # | 심각도 | 리뷰어 발견 | 대응 |
|---|---|---|---|
| 1 | 🔴 | `_resolve_cafe`/`CAFE_WRITE_URL` 이 `""`(≠`None`)라 fail-closed 안 됨 | §2.2 — 발행 직전 falsy 면 `BoardError` 중단 |
| 2 | 🔴 | 설고 작업을 아무 PC도 안 집어 영영 `pending`(가드 우회) | §2.3 — 웹 버튼 차단(권장)/소유/모니터 택1 |
| 3 | 🟡 | NULL-claim 이 독립 플래그라 misconfig 시 누수글이 더맨 카페로 | §2.1 — `CLAIM_NULL` 을 **`leak` 소유에 묶음**(독립 플래그 폐기) |
| 4 | 🟡 | 두 PC 가 같은 업체 소유 시 리퍼가 남의 in-flight 를 회수→중복 | **업체당 PC 1대(disjoint) 강제.** 스케일업 전엔 위반 금지 |
| 5 | 🟢 | `listPublishedPairs(company)` 가 레거시 NULL 행을 못 봐 중복 가능 | 누수를 `AutoPublishPanel` 에 붙이기 **전에** NULL→leak 백필 또는 필터 보정 |
| 6 | 🟢 | `CAFE_COMPANIES` 미설정 시 `sys.exit`→.bat 30초 재시작 루프 | 의도된 fail-closed(오발행 없음). 로그로만 보임 |
| 7 | 🟢 | SQL: 컬럼 없이 인덱스 만들면 새 PC apply 에러 | **반영 완료**(§2.4) |
| 8 | ✅ | PostgREST `or=`/`in.()` 필터 정합성 | **검증 통과** — 그대로 사용 |

---

## 4. 이식 체크리스트

**지금(누수 sub2, 라우팅 없이):**
- [ ] sub2 PC: `git checkout -B sub2 origin/main` + npm/pip 설치
- [ ] `.env` 2개(누수용) 복사 — `CAFE_WRITE_URL=누수카페`, `CAFE_NO_SEND=0`
- [ ] Supabase: `cafe-publish-queue.sql` 의 alter 블록 실행
- [ ] 누수 계정 네이버 로그인(상태유지 체크)
- [ ] sub2 리스너 켜고 **이 PC(main) 리스너 끄기**

**나중(더맨 병행, 라우팅 켤 때) — 이 PC(main)에서 개발 후 main→양쪽 흡수:**
- [ ] §2.1 소유 필터(`CAFE_COMPANIES`, `_owned_filter`) 를 `publish_listener.py` 에
- [ ] §2.2 `CAFE_WRITE_URL` fail-closed 가드를 `publish_cafe.py` 에
- [ ] §2.3 설고 유실 대응 택1 적용
- [ ] 누수 PC `.env`: `CAFE_COMPANIES=leak` / 더맨 PC: `CAFE_COMPANIES=theman`
- [ ] 더맨 PC `CAFE_WRITE_URL` = **새 카페 URL**(옛 URL 금지)
- [ ] 업체당 PC 1대(disjoint) 확인
