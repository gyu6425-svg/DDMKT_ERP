# 📮 SUB3 → main : Egress 3차 감축 — 배포 완료분 + 사무실에서 할 것

작성 2026-08-18 23:50 (SUB3/집). 독립검증 3역할(리서처·리뷰어·플래너) 결과 반영.

---

## 0. 현황 (대시보드 실측 2026-08-18)

```
청구주기  12 Aug 2026 – 12 Sep 2026
Egress    11.25 / 5 GB (225%)
Storage   1.021 / 1 GB (102%)     ← 별개 한도. 402 사유 아님(메일은 Egress Exceeded)
DB Size   0.132 / 0.5 GB (26%)
```

**일별 추이** (합계가 11.25 GB 와 일치)

| 12 Aug | 13 Aug | 14 Aug | 15 Aug | 16 Aug | 17 Aug | 18 Aug |
|---|---|---|---|---|---|---|
| 2.22 | **3.01** | 2.02 | **0.84** | 0.93 | 1.00 | 1.23 |

읽어야 할 것 두 가지.

1. **8/14 조치(`cd41259`)는 확실히 먹었다.** 2~3 GB/일 → 0.84 GB/일 (약 -65%).
2. **파란 막대(Storage egress)가 8/12 이후 사라졌다.** 이미지 R2 전환(`845d61b`)으로 Storage egress 는 끝난 문제다. **남은 건 전부 Database egress**(REST 조회)다.

**산수**: 한도 5 GB ÷ 31일 = **하루 161 MB 가 예산**. 가장 좋았던 15일(840 MB)조차 **5.2배**다.
→ 폴링 다듬기로 갈 수 있는 거리가 아니다. **이번 주기는 초과 확정**이고(남은 25일을 0으로 써도 225%),
아래 조치들의 목표는 **다음 주기(9/12~)** 다.

---

## 1. 오늘 배포한 것 (`35cb9f6..a35d2ec` · 23:50 push)

> ⚠️ `src/` 만 변경했다. **`functions/` · `crawler/` 는 한 줄도 안 건드렸다.**
> 크롤러가 부르는 `/api/naver-keywords`(`cafe_kw_probe.py:612`) · `/api/serp-probe`(`:849`) · `/api/img` 번들은 동일하다.
> **사무실 PC 는 pull 할 것이 없다. 새벽 크롤과 겹치지 않는다.**

### `2fd16a1` 보고 대기 '건수'를 head 조회로

`ReportPublishAlert` 는 `Layout.tsx:37` 에 상주해 **내부 직원 전 화면에서 10초마다 2번** `getReports()` 를 부른다.
`NotificationBell.tsx:53` 은 **페이지 이동마다** 부른다. 그런데 쓰는 값은 `data.length` 뿐인데
`getReports`(`blogPostReports.ts:247`)는 `select('*')` + limit 없음이라 **행 전체가 매번 나갔다.**
보고는 1건이 1행으로 영구 누적되므로 시간이 갈수록 커진다. **앱에서 곱셈 계수가 가장 큰 폴링이었다.**

→ `countReports()` 추가(`select('id', {count:'exact', head:true})`). 필터·RLS 조건은 `getReports` 와 동일하게 유지.
목록을 실제로 쓰는 모달·페이지의 `getReports` 는 **그대로 뒀다**(폴링이 아니라 1회 로드).
에러 시 이전 값 유지(누락 방지) 동작도 보존.

### `ae9f410` '자동 새로고침 끄기'가 안 먹던 것

`CrawlStatusTab.tsx:176` 의 `done` 변화 재조회는 `blog_posts`+`blog_accounts` 전체(`select('*')`)를 다시 받는다.
그런데 그 `useEffect` 의 deps 가 `[]` 라 **`auto` 토글을 아예 보지 않았다.**
크롤이 도는 동안 `done` 이 계속 늘어나므로, **사용자가 자동 새로고침을 꺼도 5초마다 전체 재조회가 나갔다.**

→ `autoRef` 로 토글 최신값 참조. `prevDoneRef` 도 실제 재조회할 때만 갱신(토글 재개 시 곧바로 따라잡게).
라벨도 실제 간격에 맞춤(15초 → 30초). `9c0480f` 가 간격만 바꾸고 라벨을 안 고쳐 어긋나 있었다.

---

## 2. 사무실에서 해야 할 것 — **검증 통과 2건만**

독립검증이 크롤러 후보 4건을 냈고, **코드로 확인해 2건은 기각했다.** 아래 2건만 진행할 것.

### ★ ① `blog_save_listener.py` — 시간대 게이트가 조회 **뒤에** 있다 (최우선)

`crawler/blog_pub/blog_save_listener.py:190-192`
```python
reqs = bc.sb_get("blog_save_queue",
                 {"status": "eq.pending", **_owned_filter(),
                  "order": "created_at.asc", "limit": "1", "select": "*"})
```
실행 시간대 판정(`:198-215`, 기본 10:00~23:00)이 **이 조회 다음에** 온다.
즉 **운영시간 밖에도 계속 받아서 버린다.**

- `POLL_SEC = 6` (`:34`)
- `blog_save_queue` **행당 4.12 MB** (`supabase_backup.py:88` 실측)
- 23:00~10:00 = 11시간 = 6,600 폴링 × 4.12 MB ≈ **27 GB/밤**

**단, `limit=1` 이고 pending 이 있을 때만이다.** pending 이 0건이면 응답은 `[]` 로 무해하다.
→ **밤새 pending 이 남아 있던 날이 있었는지가 관건.** 먼저 확인:
```sql
select status, count(*) from blog_save_queue group by 1;
```

**수정**: 시간대 판정을 `sb_get` **앞으로** 옮긴다. 시간대 밖이면 조회 자체를 안 한다.
(존재 확인이 꼭 필요하면 `"select": "id"` 로 바꿔 본문을 뺀다.)

### ② `cafe_top5_tracker.py` — `measurements` 전체를 받는데 마지막 1건만 쓴다

`crawler/cafe_top5_tracker.py:80-83`
```python
posts = c.sb_get("cafe_rank_posts", {
    "excluded": "eq.false",
    "select": "id,measurements,top5_since,top5_achieved_at,top5_seeded",
})
```
소비는 `:91` **`cur = ms[-1] if ms else {}`** — **마지막 1건만 쓴다.** limit 도 없다.
`cafe_rank_posts.measurements` 는 전체의 44%(211 KB / 474 KB, `src/api/cafeRank.ts:60` 실측).

**수정**: `c20437e` 가 `cafe_periodic.py` 에 적용한 것과 **동일하게** `measurements->-1` 서버측 슬라이스.
같은 15분 사이클의 옆 함수만 고쳐서 절감분을 이쪽이 되돌려주고 있다.

---

## 3. 기각한 2건 — **다시 시도하지 말 것**

독립검증이 제안했으나 코드 확인 결과 **깨진다.**

| 제안 | 기각 사유 |
|---|---|
| `cafe_rank_sync.py:46` 의 `manifest` 컬럼 제거 | **`manifest` 를 실제로 쓴다.** `:57 manifest_board()` → `:65 full = manifest_board(x) or (x.get("board") or "").strip()`. `:50` 주석대로 **board 컬럼 적용 전 옛 행의 폴백**이다. 빼면 그 행들의 게시판 판정이 죽는다. |
| `cafe_kw_worker.py:417` 의 `cafes` 컬럼 제거 | **캐시 결과의 `cafes` 를 소비한다.** `:809`, `:1401`, `:1569`, 특히 `:1655 "rows": cached.get("cafes") or []`. 빼면 캐시 히트 경로가 빈 결과를 돌려준다. |

---

## 4. 코드가 아닌 조치 — **오늘 배포분보다 크다**

### ★ 퇴근 시 ERP 탭 닫기 안내

`src/lib/useVisiblePolling.ts:20` 과 인라인 게이트들은 전부 `document.visibilityState === 'visible'` 를 본다.
그런데 `docs/PC-상시가동-설정.md:7,16-17` 이 사무실 PC 를 **"절전 안 함 + 모니터만 끄기 OK"** 로 설정하라고 지시한다.

> **모니터 전원만 끈 탭은 `visible` 로 남는다.** (hidden 이 되려면 최소화되거나 다른 탭으로 전환되어야 한다.)
> 즉 **탭을 앞에 띄운 채 퇴근한 PC 는 밤새 100% 속도로 폴링한다.** 지금까지 넣은 가시성 게이트가 전부 무력화되는 조건이다.

**전달 문장**:
> "업무 중 보는 건 괜찮습니다. **퇴근할 때 ERP 탭을 닫아 주세요.**
>  모니터만 꺼도 브라우저는 계속 데이터를 받습니다."

**추정 감축 0.3~0.9 GB/일** — 위험 0, 롤백 즉시(다시 열면 끝).

**탭 1개를 24시간 열어뒀을 때 소비**(참고):

| 화면 | 근거 | 24h |
|---|---|---|
| 블로그 크롤현황 | `CrawlStatusTab.tsx:149` → `blogRank.ts:298` `select('*')` | ~4.3 GB |
| 카페 발행탭(고객사 선택) | `CafeCustomerStudio.tsx:306` 15초 → `cafeRank.ts:87` 474 KB | ~2.7 GB |
| 카페 대시보드 | `CafeDashboardTab.tsx:77` 60초 | ~430 MB |
| 카페 크롤현황 | `CafeCrawlStatusTab.tsx:48` 60초 | ~370 MB |
| 카페 댓글 | `CafeCommentPage.tsx:52` 5초 | ~350 MB |

전체 소비가 1.0~1.23 GB/일이므로, **위 탭 중 하나만 상시 열려 있어도 전체 예산을 설명한다.**

---

## 5. 보류 — 하려면 별도 판단 필요

| 항목 | 왜 지금 안 했나 |
|---|---|
| **유휴(idle) 게이트** (`useVisiblePolling` 에 "마지막 입력 후 10분이면 중단") | 위 4번 문제의 근본 해결이고 효과가 가장 클 수 있다. 다만 "보기만 하고 안 만지는" 사용자(진행률 관망)에게 화면이 멈춘 것처럼 보인다. **"자동 새로고침 일시중지 · 화면을 클릭하면 재개" 표시를 같이 넣지 않으면 신고가 확실하다.** |
| **`getCafeRankPostsForClient` 서버측 필터** (`cafeRank.ts:87-96`, 15초 폴링에서 전체 테이블) | `:92-96` 의 3중 OR 매칭(`cafe_account_id`/`board`/`company_key`)이 `:82-83` 주석대로 **"SUB PC 발행분도 잡히게" 일부러 넓게** 짜여 있다. 서버측으로 옮기면 **고객사 발행 히스토리에서 글이 사라질 수 있다.** 간격 15초→30초만 먼저 바꾸는 건 위험 거의 0. |
| **Supabase Storage 원본 삭제** | Egress 와 무관하다(Storage egress 는 이미 0). 그리고 `functions/api/img/[[path]].ts:62-66` 실측 주석 — 표본 20개 중 **7개(35%)가 아직 R2 에 없다.** 자가치유는 **누가 그 이미지를 열어볼 때만** 채운다. 지금 지우면 영구 소실. `x-img-src: supabase-miss` 는 R2 적재 실패분이라 특히 지키야 한다. |

---

## 6. 회신 부탁드릴 것

1. `select status, count(*) from blog_save_queue group by 1;` 결과 — ①의 실제 위험도 판정용
2. ①② 적용 여부와 시점 (데몬 재시작 필요)
3. 탭 닫기 안내 전파 여부
4. 내일(8/19) 일별 Egress 차트 — 오늘 배포 3건(`9c0480f`·`c20437e`·오늘 2건) 효과 확인
