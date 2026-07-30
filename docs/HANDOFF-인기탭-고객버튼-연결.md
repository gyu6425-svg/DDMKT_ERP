# 인수인계 — 고객 '인기글 조회' 버튼을 인기탭 발굴 큐에 연결

**보내는 세션(ERP/크롤 담당) → 카페 자동발행 세션**
작성 2026-07-30. 대상 파일: `src/components/cafe/CafeDeployIntake.tsx`(당신 소유), `src/api/keywordScan.ts`(당신 소유).

---

## 0. ★ 정정 — 인기탭 조회 IP는 "우리 IP"입니다 (폰 테더링 아님)

코드에 **오래된 주석**이 남아 혼동을 줍니다. 아래 두 곳은 **틀렸으니 고쳐 주세요**(sub4가 예전 모바일테더링이던 시절 잔재):

- `CafeDeployIntake.tsx`: `// 워커(폰 IP) → 진짜 인기탭 결과` → **틀림.**
- `cafeKwScan.ts` 안에 같은 취지 표현 있으면 함께 정정.

**실제 경로**: 고객 플레이스 인기탭 조회(`runPlaceScan` → `cafe_kw_requests` → `cafe_kw_worker.py`)는
- **기본 = 우리 IP 직접 스크랩**(m.search/PC 호스트 로테이션). sub4가 처리하면 **사무실 유선 IP**, main이 처리하면 main IP.
- **main 크롤과 겹칠 때만 CF**(데이터센터 IP)로 자동 전환(부하 회피).
- **폰 테더링 안 씀.** sub4는 이미 모바일테더링 → 사무실 유선 스캔전용 PC로 전환됨.

> 참고 — `keyword_scan_requests`/`scan_listener.py`/`checkPopular(CF)`는 **발행쪽(AutoPublishPanel) 별개 경로**입니다. 고객 인기탭 조회와 혼동 금지. "한국 모바일 IP" 주석은 그쪽 얘기고, 그마저 sub4가 유선이면 지금은 유선입니다.

정확한 주석으로:
```
// 정확 인기탭 분석 — cafe_kw_requests 큐 → 워커(우리 IP: 사무실 유선/ main, 크롤 겹치면 CF) → 진짜 인기탭 결과
```

---

## 1. 지금 상태 (왜 이걸 전달하나)

`/portal/cafe` '인기글 조회' 버튼은 **현재 검색량만** 보여줍니다(순수 웹, 인기탭 판정 X).
반면 내가 만든 **인기탭 발굴 엔진 + 분산 워커**는 "이 키워드가 인기글 섹션에 있나 / 카페 자리가 비었나(진입 가능)"까지 판정합니다. 버튼을 이 엔진에 붙이면 고객에게 **진짜 인기탭 결과**를 줄 수 있습니다.

**두 시스템이 별개 큐로 병존 중** — 어느 걸 버튼에 쓸지 결정 필요:

| | 내 시스템(인기탭 발굴) | 당신 시스템(현행) |
|---|---|---|
| 큐 테이블 | `cafe_kw_requests` | `keyword_scan_requests` |
| 워커 | `cafe_kw_worker.py` (**우리 IP**: 사무실 유선/main + 크롤 중 CF 자동전환) | `scan_listener.py` (SUB4 — 지금은 사무실 유선) |
| 입력 | **플레이스 URL 1개** → 넓은→좁은 키워드 자동 발굴 | 키워드 배열(고객이 이미 아는 키워드) |
| 출력 | 인기탭 진입가능 키워드 목록 + 점유 카페 | 키워드별 O/X |
| 캐시 | `cafe_kw_targets` 공유(중복 스크랩 0) | 없음 |

→ **플레이스 주소만 받아 "들어갈 만한 인기탭 키워드를 찾아주는"** 용도라면 내 큐가 맞습니다. 이미 아는 키워드 O/X만이면 당신 큐 유지.

---

## 2. 계약(스키마) — 이대로만 쓰면 됨

### ★★ 지역형 vs 키워드형 — 반드시 `deploy_type`으로 구분해 넘길 것
둘은 **완전히 다른 스캔**입니다. `form.deploy_type` 값을 그대로 실어 주세요.

| deploy_type | 뜻 | 워커 처리 | 예 |
|---|---|---|---|
| `지역형` | 지역 기반 업체(맛집·청소·인테리어) | **플레이스 자기 지역**(주소에서 자동 추출) × 업종. 지역 키워드 유지 | 선유도바닷가→`군산 조개요리 맛집`,`군산 맛집` |
| `키워드형` | 제품/니치 기반(전국 대상) | **지역 완전 배제**. 제품 니치 키워드만 | 향수→`고체향수`,`니치향수` / 조개→`조개구이무한리필` |

> ⚠️ **지금 버그가 이거였음.** 선유도바닷가(군산 맛집=지역형)에 `regions:'서울,경기,인천'` 고정값이 실려서 **영종/송도/인천 조개구이**(엉뚱한 수도권)만 나왔음. 이제 워커가 ①`deploy_type`으로 갈라 처리하고 ②`deploy_type`이 없어도 맛집이면 자기 지역만 쓰도록 자동보정하지만, **프론트가 `deploy_type`을 실어주면 확실**합니다.

### 요청 넣기 → `cafe_kw_requests` INSERT
```jsonc
{
  "place_url": "https://naver.me/xxxx",  // 필수. 플레이스 URL 또는 placeId
  "deploy_type": "지역형",                // ★ '지역형'|'키워드형' — form.deploy_type 그대로. null이면 지역형으로 처리
  "target": 5,                            // 찾을 인기탭 건수(기본 10). 고객 화면엔 3~5 권장
  "regions": "서울,경기,인천",            // 선택. '서비스형(청소·이사 등)'의 서비스지역일 때만 의미.
                                          //   맛집/키워드형이면 워커가 무시함. 대개 안 넣어도 됨(자기 지역 자동)
  "status": "queued",                     // ★반드시 'queued' (기본값이지만 명시 권장)
  "requested_by": "<profiles.id>",        // 선택. 고객 식별
  "note": "고객ERP 인기글조회"
}
```
> `deploy_type` 컬럼은 `docs/cafe-kw-queue.sql` 의 `alter table … add column if not exists deploy_type` 로 추가됨 — **SQL 재실행 필요**(멱등이라 안전).
> ⚠️ status를 `pending` 으로 넣으면 워커가 **안 집습니다**(claim RPC가 `queued`만 조회). 내가 처음에 이 실수를 해서 명시합니다.

### 결과 폴링 → 같은 행을 `id`로 조회
- `status`: `queued` → `claimed` → `done` / `failed`
- `done`이면 `result` (jsonb 배열):
```jsonc
[
  {
    "keyword": "수원 입주청소",
    "volume": 2400,                // 검색광고 월 검색량
    "theme": "인테리어·DIY 인기글", // 인기글 섹션 테마
    "cafes": [                     // 현재 그 자리 점유 카페(최대 5)
      { "rank": 2, "who": "카페명", "article": "글제목" }
    ]
  }
]
```
- 워커가 `place_id`, `biz_name`(해석된 업체명)도 같은 행에 채움 → 헤더에 "○○ 업체 기준" 표시에 쓰면 좋음.
- `failed`면 `note`에 사유.

폴링은 당신의 `keywordScan.ts` 패턴 그대로 재사용 가능(2초 간격, done/failed까지). timeout은 **넉넉히** — 플레이스 해석+후보 발굴+스캔이라 `target`에 비례해 잡으세요(대략 `target*15초 + 60초`, 캐시 히트면 훨씬 빠름).

---

## 3. ★ 막히는 지점 하나 — RLS (이거 안 풀면 고객 화면에서 안 됨)

`cafe_kw_requests`의 현재 RLS:
- **SELECT = `is_internal()`만** → 고객(외부 계정)은 자기 요청도 **못 읽음** = 폴링 실패
- **INSERT 정책 없음** → 고객 클라이언트 직접 INSERT 불가(service_role만 우회)

**두 가지 방법 중 택1:**

**(A) Edge Function 경유 (권장·안전)**
- 함수가 service_role로 INSERT하고, 같은 함수(또는 별도 get 함수)가 결과를 대신 읽어 반환.
- 고객 키는 RLS에 안 걸리고, place_url·requested_by만 검증하면 됨.
- 당신의 기존 카페 Edge Function 패턴 재사용 가능.

**(B) RLS 정책 추가 (클라 직접 접근 허용)**
```sql
-- 고객이 자기 요청만 INSERT / 자기 것만 SELECT
create policy cafe_kw_req_ins_self on public.cafe_kw_requests
  for insert with check (requested_by = auth.uid());
create policy cafe_kw_req_read_self on public.cafe_kw_requests
  for select using (requested_by = auth.uid() or public.is_internal());
```
→ 이 SQL은 **당신이 실행**하세요(내 세션에서 RLS 건드리면 [[rls-lockout-recovery]] 위험). 기존 `cafe_kw_req_read`는 두지 말고 위 read_self로 교체(is_internal 조건 포함).

---

## 4. 워커/엔진은 이미 라이브 (당신이 손댈 것 없음)
- `cafe_kw_worker.py` 상시 데몬(원자 클레임·공유캐시·크롤 중 CF 자동전환) — 이미 배포.
- 스캔 전용 PC(sub4) 세팅 완료. main 크롤과 IP 겹쳐도 자동 회피.
- 즉 **당신은 UI에서 INSERT + 폴링만** 붙이면 끝. 스캔 부하/차단회피는 내 쪽이 책임.

## 5. 테스트용 큐 넣어둠
- `cafe_kw_requests` **id=2** (place `naver.me/IDkdOjPW`, target 3, regions 서울·경기·인천, status queued) — sub4 워커가 처리하면 `result` 채워짐. UI 폴링 붙일 때 이 행으로 형태 확인하면 됨.

---

## 6. 결정만 주면 됨
- **연결한다** → 위 2·3번대로 CafeDeployIntake 버튼을 `cafe_kw_requests`로. RLS(3번)는 당신이 SQL 실행.
- **현행 유지(검색량만)** → 내 엔진은 내부 인기탭 발굴 전용으로 둠. UI 변경 없음.

궁금하면 이 문서 남기고 회신 주세요. 큐/캐시/워커 쪽 질문은 ERP 세션(이쪽)이 답합니다.
