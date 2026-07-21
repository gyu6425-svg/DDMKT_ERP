# 병합 안전 가이드 — `sub1` · `sub2` → `main`

> 이 문서는 **모든 브랜치에서 읽히도록** 공유 베이스(main)에 커밋된다.
> 어느 컴퓨터에서 어느 브랜치를 받아도 이 파일이 보인다.
> (최초 2026-07-16 카페 댓글용 → 2026-07-21 sub2(누수탐지) 확장 반영)

## 0. 브랜치 역할 (서로 다른 파일을 써야 충돌이 안 난다)

| 브랜치 | 작업 내용 | 주로 건드리는 위치 |
|---|---|---|
| **`main`** (이 PC) | ERP·기자단·업체 ERP + **크롤/순위 측정** + 카페 자동발행·원고생성·순위 트래커 | `src/routes/ClientsPage.tsx`·기자단·`crawler/`(크롤러)·`crawler/cafe_pub/`·`src/routes/CafePage.tsx` |
| **`sub1`** (= 기존 `sub`) | 카페 **댓글 자동화** | `crawler/cafe_cmt/`·`src/api/cafeCommentQueue.ts`·`src/routes/CafeCommentPage.tsx` |
| **`sub2`** (신규) | **누수탐지** 관련 | ⚠️ 새 *기능*을 짜면 **새 파일**로만(`crawler/leak_*` 등). **단 카페 발행은 예외** — 기존 발행 엔진을 코드 수정 없이 `.env`로 운영만 한다(→ `docs/카페발행-멀티PC-라우팅.md`). |

**git 충돌은 "같은 파일의 같은/인접한 줄"을 두 브랜치가 고칠 때만** 난다.
→ 각 sub는 **자기 기능을 신규 파일로** 짓고, 아래 §1 공유 파일 3곳만 규칙대로 최소 편집한다.

## 1. ⚠️ 모든 브랜치가 같이 건드리는 공유 파일 3곳 (충돌 1순위)

| 파일 | 위험 | 규칙 |
|---|---|---|
| **`docs/_RUN_ALL.sql`** | **높음** | 새 테이블 SQL을 파일 **맨 끝(`-- ═══ 끝`) 바로 앞**에 붙인다. 충돌 나면 두 블록 다 남기면 됨(keep-both). |
| **`src/App.tsx`** | 중간 | import + routes 배열에 **자기 항목 옆**에 끼운다(맨 끝 아님 → 위치 분리로 회피). |
| **`src/components/categoryRank/categories.ts`** | 중간 | 해당 `subs` 배열에 **한 줄 추가**. 줄 추가라 keep-both로 해결. |

**규칙**: 이 3곳은 "줄 추가 vs 줄 추가"만 하면 전부 keep-both로 풀린다. **절대 기존 줄을 재배치·재정렬하지 말 것**(그러면 진짜 충돌).

## 2. 🚨 각 브랜치가 큰 공용 화면을 건드리지 않기 (가장 큰 충돌원 회피)

- **`src/routes/CafePage.tsx`** (카페 원고 생성기, 최다 변경) — sub는 **건드리지 않는다**. 새 기능은 **별도 페이지**로.
  (댓글 = `CafeCommentPage.tsx`. 누수탐지도 필요하면 `LeakPage.tsx` 등 새 페이지로.)
- **`src/routes/ClientsPage.tsx`**·기자단 화면 — **main(이 PC) 전용**. sub는 건드리지 않는다.
- main(이 PC)도 sub 영역(`crawler/cafe_cmt/`, sub2의 누수 파일)은 되도록 건드리지 않는다.

## 3. 🚨 git이 "충돌"로 못 잡는데 조용히 깨지는 함정 2개

1. **SQL을 새 파일에만 두면** → 운영자는 `_RUN_ALL.sql`만 실행 → 새 테이블이 프로덕션에 안 생김 → 기능 전체 실패.
   → **`docs/<기능>.sql`(새 파일) + `docs/_RUN_ALL.sql`(끝에 동일 블록) 양쪽 다** 넣는다.
2. **Python에서 main 파일을 `import`하면** → main이 그 파일을 리팩터링하면 병합은 깨끗한데 런타임에 조용히 깨짐.
   → 재사용 코드는 **import 말고 복사(copy)** 해서 자기 폴더(`cafe_cmt/`, `leak_*/`) 안에서 자립시킨다.

## 4. 병합 규칙 (매번 지킬 것) — ⭐ 한 번에 하나씩

```bash
# ── 작업 시작 전 (매번, 자기 sub에서) — 최신 main을 먼저 흡수 ──
git checkout sub1   # 또는 sub2
git fetch origin && git merge origin/main      # 최신 main 반영(충돌은 여기서, 내 PC에서 해결)

# ── 공유 파일 3곳(_RUN_ALL.sql / App.tsx / categories.ts) 건드리기 직전 ──
#    반드시 위 'merge origin/main' 을 먼저 해서 최신 tail 에 붙인다.

# ── sub → main 합칠 때 ──
git checkout sub1 && git fetch origin && git merge origin/main   # 먼저 sub를 최신 main에 맞춤(충돌 해결)
git checkout main && git fetch origin && git merge --ff-only origin/main
git merge --no-ff sub1 && git push origin main
```

**⭐ sub1·sub2는 한 번에 하나씩 main에 합친다.** (sub1 병합·푸시 완료 → 그 다음 sub2가 `merge origin/main`으로 sub1 결과를 흡수 → sub2 병합.)
동시에 둘 다 main에 밀어넣으면 공유 파일 3곳에서 충돌 가능. **순서대로 하면 항상 깨끗하다.**

**핵심**: 작업 전 항상 자기 sub를 **최신 main에 먼저 맞추면**(재동기화), `sub → main` 병합은 거의 항상 깨끗하다. 충돌은 §1 세 파일에서만 가능하고 전부 keep-both로 풀린다.

## 5. sub2(누수탐지) 시작 체크리스트

- [ ] `git checkout main && git pull` → `git checkout -b sub2` (최신 main에서 분기)
- [ ] 누수탐지 기능은 **새 파일**로 (`crawler/leak_*` / `src/routes/Leak*.tsx` / `src/api/leak*.ts` 등)
- [ ] `CafePage.tsx`·`ClientsPage.tsx`·기자단 화면 **건드리지 않기**
- [ ] 새 테이블은 `docs/<이름>.sql` + `_RUN_ALL.sql` **끝에** 양쪽
- [ ] 공유 파일 3곳은 **줄 추가만**, 자기 항목 옆에
- [ ] 커밋 전 `git merge origin/main` 으로 최신 흡수 먼저

## 6. 컴퓨터별 설정(gitignore) — 커밋 금지, 컴퓨터마다 따로

`.env`, `crawler/.env`, `crawler/cafe_pub/.env`, `crawler/cafe_cmt/.env`, `*/chrome_profile/`, `crawler/cafe_pub/.session_expired` 는 전부 gitignore.
새 PC 세팅 시 기존 PC에서 `.env` 복사 + 네이버 로그인(`run_chrome_login.bat`) 필요. → 상세: `docs/새-PC-설치가이드.md`
`.bat`/`.vbs` 는 반드시 **CRLF**(루트 `.gitattributes`가 강제). LF면 자동시작이 조용히 실패한다.
