# 병합 안전 가이드 — `sub` → `main` (카페 댓글 자동화 작업)

> 이 문서는 **main·sub 양쪽에서 읽히도록** 공유 베이스에 커밋됩니다.
> 다른 컴퓨터에서 `main`을 받아도 이 파일이 보입니다.
> 독립검증(리서처·플래너·리뷰어)으로 git 실측 검증한 결과를 기록합니다. (최초 작성: 2026-07-16)

## 0. 브랜치 역할 (겹치면 안 되는 이유)

| 브랜치 | 작업 내용 | 주요 위치 |
|---|---|---|
| `main` | 카페 **자동발행** + 카페 원고 생성 + 순위 트래커 | `crawler/cafe_pub/`, `src/api/cafePublishQueue.ts`, `src/routes/CafePage.tsx` |
| `sub` (이 PC) | 카페 **댓글 자동화** (신규) | `crawler/cafe_cmt/`, `src/api/cafeCommentQueue.ts`, `src/routes/CafeCommentPage.tsx` |

두 기능은 **다른 파일**을 쓰도록 설계됐다. git 충돌은 "같은 파일의 같은/인접한 줄"을 양쪽에서 고칠 때만 난다.
따라서 **댓글 자동화는 신규 파일로만** 짓고, 공유 파일은 아래 3곳만 최소 편집한다.

## 1. ⚠️ 양쪽이 같이 건드리는 공유 파일 3곳 (반드시 조심)

| 파일 | 위험 | 편집 위치 / 규칙 |
|---|---|---|
| **`docs/_RUN_ALL.sql`** | **높음** | 새 테이블 SQL을 이 통합 파일 **끝(`-- ═══ 끝`) 바로 앞**에 붙인다. main도 여기 끝에 붙이므로 재동기화 직후 작업. 충돌 시 두 블록 다 남기면 됨(keep-both). |
| **`src/App.tsx`** | 중간 | 2군데: import(L8 `CafePage` 옆) + routes 배열(L38 `/cafe` 옆). **배열/ import 맨 끝이 아니라 카페 항목 옆에** 끼운다(main은 보통 끝에 추가 → 위치 분리로 충돌 회피). |
| **`src/components/categoryRank/categories.ts`** | 중간 | 카페 `subs` 배열(L73 `카페 원고 생성기` 옆)에 한 줄 추가. 줄 추가라 keep-both로 쉽게 해결. |

**`src/routes/CafePage.tsx`(610줄, 최다 변경)은 절대 건드리지 않는다** → 댓글은 새 탭이 아니라 **별도 페이지** `CafeCommentPage.tsx`로 만든다. (이게 가장 큰 충돌원 회피)

## 2. 🚨 git이 "충돌"로 못 잡는데 조용히 깨지는 함정 2개

1. **SQL을 새 파일에만 두면** → 운영자는 `_RUN_ALL.sql`만 실행 → `cafe_comment_queue` 테이블이 프로덕션에 안 생김 → 댓글기능 전체 실패.
   → **`docs/cafe-comment-queue.sql`(새 파일) + `docs/_RUN_ALL.sql`(끝에 추가) 양쪽 다** 넣는다.
2. **Python에서 `import publish_cafe` 하면** → main이 그 파일을 리팩터링하면 병합은 깨끗한데 댓글 데몬이 런타임에 조용히 깨짐.
   → 재사용 코드는 **import 말고 복사(copy)** 해서 `crawler/cafe_cmt/` 안에서 자립시킨다.

## 3. 병합 규칙 (매번 지킬 것)

```bash
# ── 이 PC(sub)에서 작업 시작 전 (매번) ──
git checkout sub && git fetch origin && git merge --ff-only origin/main

# ── 공유 파일 3곳(_RUN_ALL.sql / App.tsx / categories.ts) 건드리기 직전 ──
#    반드시 위 재동기화를 먼저 해서 최신 tail에 붙인다.

# ── 나중에 sub → main 합칠 때 ──
git checkout sub && git fetch origin && git merge --ff-only origin/main   # 먼저 sub를 최신 main에 맞춤(충돌은 여기서 해결)
git checkout main && git fetch origin && git merge --ff-only origin/main   # main = origin/main
git merge --no-ff sub && git push origin main
```

**핵심**: 작업 전 항상 `sub`를 최신 `main`에 먼저 맞추면(재동기화), `sub → main` 병합은 항상 깨끗하다.
충돌은 오직 위 공유 파일 3곳에서만 가능하고, 전부 "줄 추가 vs 줄 추가"라 keep-both로 해결된다.

## 4. 무충돌 신규 파일 목록 (댓글 자동화 — main 파일 미접촉)

- `crawler/cafe_cmt/comment_cafe.py`, `comment_listener.py`, `run_chrome.bat`, `run_chrome_login.bat`, `.env.example`, `.gitignore`
- `src/api/cafeCommentQueue.ts`
- `docs/cafe-comment-queue.sql` (+ `_RUN_ALL.sql` 끝에 동일 블록)
- `src/routes/CafeCommentPage.tsx`

## 5. 컴퓨터별(gitignore) 설정 — 커밋 금지, 컴퓨터마다 따로

`.env`, `crawler/.env`, `crawler/cafe_pub/.env`, `crawler/cafe_cmt/.env`, `*/chrome_profile/` 는 전부 gitignore.
새 PC 세팅 시 기존 PC에서 값 복사 + 네이버 로그인(`run_chrome_login.bat`) 필요.
