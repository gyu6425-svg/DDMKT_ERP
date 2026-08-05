# 누수탐지 ERP — 설계 (2026-08-05)

> 브랜치 sub3 작성. **미구현 · 설계 단계.**
> 대상: 든든한누수탐지(백준누수 제휴) 사업의 상담·작업·정산 관리.
> 근거: 구글시트 8개 탭 전수 분석 + 독립검증(리서처·리뷰어 병렬).

---

## 0. 결론
- **기존 ERP에 추가**한다(별도 사이트 아님). 사용자가 기존 ERP 로그인 4인과 동일하고, 데이터가 독립이라 새 테이블만 추가하면 됨.
- 시트는 **데이터 소스가 아니라 마이그레이션 대상 레거시**다. 그대로 옮기면 잘못된 정산이 코드로 고착된다.
- **선행 3가지**(자격증명 교체 / 공유 차단 / 정산 11건 확인)가 끝나기 전엔 마이그레이션 금지.

---

## 1. 🔴 즉시 조치 (설계보다 우선)

시트가 **인증 없이 CSV 다운로드 가능**(로그인 없는 curl로 8탭 전량 취득 확인). 노출 자산:

| 자산 | 위치 | 심각도 |
|---|---|---|
| 네이버 계정 5개 ID+**평문 비밀번호** | `플레이스/블로그` 탭, 블로그이력 2탭에 중복 | 🔴 |
| 하나은행 계좌번호 `464-910008-14605` + 일별 잔고 전체 | 작업현황 탭 상단·우측 원장 | 🔴 |
| 고객 개인정보 48건(연락처·지역·누수종류) | 상담DB 탭 | 🟠 |
| 직원 정산액·대표 인출 | 원장 메모(`재현,민경 정산`, `대표님`) | 🟠 |
| 백준 정산 배분율, 외주업체 단가 | 정의블록·외주발주 탭 | 🟠 |

**⚠️ 최우선**: 비밀번호 `ddmkt0514` / `ddmkt0514@` 가 **소유자 구글 계정(`ddmkt0514@gmail.com`)의 로컬파트와 동일**. 크리덴셜 스터핑으로 구글 계정 → 드라이브 전체 탈취 경로가 열려 있음.
또 `1178268qw@`(=`rlawhddls125`)는 **플레이스 8개 지점 공용** — 1개 탈취 = 전 지역 장악.

**순서 (교체가 공유차단보다 먼저 — 이미 열람됐을 수 있음):**
1. 네이버 계정 5개 비밀번호 전면 교체 + 2FA
2. 구글 계정 비밀번호 교체 + 2FA
3. 시트 공유를 "제한됨"으로 전환, 접근 로그 확인
4. 개인정보보호법 제34조(유출 통지) 검토 — 연락처 48건 보유

---

## 2. 정산 데이터 실측 — 규칙 ≠ 실제

시트 정의: **백준 진행 = 든든 30% / 백준 70%** (타업체 진행 구조는 적용 행 0건).

| # | 지역 | 결제금액 | 든든 | 백준 | 합계−결제 | 든든비율 | 비고 | 판정 |
|---|---|---|---|---|---|---|---|---|
| 1 | 구로 고척동 | 100,000 | 30,000 | 70,000 | 0 | 30.0% | | ✅ |
| 2 | 동탄 푸르지오 | 300,000 | 60,000 | 240,000 | 0 | **20.0%** | | ❌ 규칙이탈 |
| 3 | 과천 지정타 | 300,000 | 60,000 | 240,000 | 0 | **20.0%** | | ❌ 규칙이탈 |
| 4 | 인천청라 | 250,000 | 43,400 | 217,000 | **+10,400** | 17.4% | 수전교체 20% 정산 | ❌ 합계초과 |
| 5 | 남양주 화도읍 | 1,900,000 | 570,000 | 1,330,000 | 0 | 30.0% | | ✅ |
| 6 | 인천 청라 | 1,800,000 | 540,000 | **1,800,000** | **+540,000** | 30.0% | | ❌ **백준칸=결제금액 복사** |
| 7 | 인천 청라 카페 | 480,000 | 106,000 | 374,000 | 0 | **22.1%** | | ❓ 설명불가 |
| 8 | 인천청라 | 740,000 | 222,000 | 518,000 | 0 | 30.0% | 자재비 6만원 | ⚠️ 공제 미적용 |
| 9 | 서구 검암동 | 100,000 | 16,000 | 80,000 | **−4,000** | 16.0% | 자재비 2만원 | ❌ 합계미달 |
| 10 | 강동구 암사동 | 5,500,000 | 780,000 | 2,600,000 | **−2,120,000** | 14.2% | 자재비 외 290만 | ❌ 백준칸=기준금액 |
| 11 | 용인 기흥구 | 400,000 | 80,000 | 320,000 | 0 | **20.0%** | | ❌ 규칙이탈 |
| | **합계** | **11,870,000** | **2,507,400** | **7,789,000** | | **21.1%** | | |

### 2-1. 핵심 결함 3가지
1. **#6 명백한 오류** — 백준 칸에 결제금액 그대로 복사. 70%면 1,260,000. **540,000 과대계상.**
2. **"백준 정산금액" 컬럼에 3가지 의미 혼재** — ①백준 몫(대부분) ②결제금액(#6) ③자재비 공제 후 기준금액(#4·#10). **단일 컬럼으로 마이그레이션 불가 → 분해 필요.**
3. **자재비 공제 규칙 미문서화** — 실제는 `공제O/X` × `20%/30%` 4가지 조합 혼재(#8 공제X·30%, #9 공제O·20%, #10 공제O·30%, #4 base 217,000의 근거 불명).

### 2-2. ⚠️ 설계 원칙: **재계산 금지**
"비율만 넣으면 자동계산"으로 만들면 **과거 데이터가 소급 변경**된다.
- #2·#3·#11(각 20%)을 30%로 재계산 시 60,000→90,000, 80,000→120,000으로 증액
- 이 중 다수가 **세금계산서 발행완료** 상태 → 발행 금액과 시스템 값 불일치 = **세무 리스크**
- 전체로는 든든 수취액 2,507,400 → 3,561,000 (**1,053,600 소급 증액**)

**→ 확정 시점의 값을 스냅샷으로 고정 저장. 조회 시 재계산하지 않는다.**

---

## 3. 검증된 사실 (설계 근거)

**✅ 신뢰 가능**
- **연락처가 유일한 조인 키** — 작업 11건이 상담DB `계약성사=진행` 11건과 **양방향 100% 매칭**. 순서·지역명은 불일치(`인천청라` vs `인천 청라`)라 조인 불가.
- **통장 일별 잔고 연속성 정합** — 전 구간 `전일잔고+입금−출금=당일잔고` 오차 0건. 월간 이월도 4→5→6→7→8 전부 일치.
- **작업 정산액 → 원장 입금 11/11 금액 일치** (단 #4는 정산날짜 06-09 vs 원장 06-08, 1일 차이).

**❌ 신뢰 불가 / 폐기 대상**
- **블로그이력 `g499789438` 탭** = `g1205812806`의 구버전 스냅샷. 고유 데이터 **0건** → 폐기(자격증명 교체 후).
- **월간요약 탭** = 파생 집계인데 오류 다수: 총매출·순수익·잔액이 `#REF!`, 4월 행 중복·6월 행 누락, 5월 행에 6월 값, "4월 백준 외주비 7,789,000"은 실은 **전 기간 누계**, 작업건수 0건(실제 11건). → **이관 대상 아님, 재생성 대상.**
- **월 합계 행이 손입력** — 4월 잔고는 외주비 이중차감(1,548,110 vs 실제 2,274,055), 8월 잔고는 전월값. → **집계는 저장하지 말고 뷰로 산출.**
- **`#REF!` 39개** — 작업현황 결제금액 열 35개(순서 70~100), 월간요약 4개.

**⚠️ 미분류**
- 원장에만 있고 작업 근거 없는 입금 2건: `2026-05-12 50,000`(메모 "디디클린 입금"), `2026-06-20 575`
- **"외주비" 컬럼이 잡탕** — 원장 외주비 합계 5,557,975 vs 외주발주탭 3,538,345, **차액 2,019,630**. 실제로는 외주비+인건비+세금+대표인출이 한 컬럼에. → 최소 4개 계정 분리 필요.

---

## 4. 스키마 (초안)

기존 컨벤션 준수: `uuid` PK, `created_at timestamptz not null default now()`, `<축약>_<col>_idx` 인덱스, RLS `is_internal()` 기반, 파일 1개=마이그레이션 1개.

```sql
-- docs/leak-erp.sql (예정)

-- ① 상담/문의 (유입)
create table if not exists public.leak_inquiries (
    id uuid primary key default gen_random_uuid(),
    created_at timestamptz not null default now(),
    counselor text,                          -- 상담자(내부 직원명)
    region text,                             -- 지역/현장
    phone text,                              -- 원본 표기
    phone_norm text,                         -- 숫자만 정규화 ← 조인/조회용
    inquired_on date,                        -- 문의일 (시트 MM-DD → 연도 보정)
    leak_type text,                          -- 누수 종류
    contracted boolean not null default false,  -- 계약성사(진행/미진행)
    source text,                             -- 유입경로: cafe | blog | place | 기타
    happy_call text,                         -- 시트엔 전부 공란(미사용) — 유지 여부 결정
    note text
);
create index if not exists li_phone_idx on public.leak_inquiries (phone_norm);
create index if not exists li_created_idx on public.leak_inquiries (created_at desc);

-- ② 작업 + 정산 (⚠️ 계산 컬럼 없음 — 전부 확정값 스냅샷)
create table if not exists public.leak_jobs (
    id uuid primary key default gen_random_uuid(),
    created_at timestamptz not null default now(),
    inquiry_id uuid references public.leak_inquiries(id),
    site_name text,                          -- 시트의 '고객명'(실제는 지역/현장)
    phone_norm text,
    worked_on date,                          -- 진행일자
    gross_amount bigint not null,            -- 결제금액(VAT 포함), 정수 원
    vendor text,                             -- 집행업체(백준누수 | 타업체)
    -- 정산: 규칙 재계산 금지. 확정 시점 값을 그대로 보존.
    deduction_amount bigint not null default 0,   -- 자재비 등 공제액
    deduction_note text,                          -- 공제 사유(시트 비고 텍스트 보존)
    base_amount bigint,                           -- 산정 기준금액(= gross - deduction)
    applied_rate numeric(5,2),                    -- 실제 적용된 요율(%) — 20/30 등
    our_share bigint not null,               -- 든든한누수탐지 확정 정산액
    partner_share bigint,                    -- 백준누수 확정 정산액(몫만! 기준금액 아님)
    is_rule_exception boolean not null default false,  -- 규칙 이탈 건 플래그
    exception_reason text,                   -- 이탈 사유(필수 입력)
    settled_on date,                         -- 정산날짜
    invoice_status text not null default '미발행',  -- 미발행 | 발행완료
    note text
);
create index if not exists lj_worked_idx on public.leak_jobs (worked_on desc);
create index if not exists lj_inquiry_idx on public.leak_jobs (inquiry_id);

-- ③ 통장 원장 (일별 러닝밸런스 — 원천 데이터)
create table if not exists public.leak_ledger (
    id uuid primary key default gen_random_uuid(),
    created_at timestamptz not null default now(),
    entry_date date not null,
    inflow bigint not null default 0,        -- 최종 정산 금액(입금)
    outflow bigint not null default 0,       -- 유출
    outflow_kind text,                       -- ⚠️ 잡탕 분해: 외주비|급여|세금|대표인출|기타
    balance bigint,                          -- 잔액(검증용, 재계산 가능해야 함)
    job_id uuid references public.leak_jobs(id),   -- 대응 작업(있으면)
    memo text,                               -- 원장 메모 보존
    unreconciled boolean not null default false    -- 근거 없는 건(50,000 / 575 등)
);
create index if not exists ll_date_idx on public.leak_ledger (entry_date);

-- ④ 외주 발주
create table if not exists public.leak_outsourcing (
    id uuid primary key default gen_random_uuid(),
    created_at timestamptz not null default now(),
    item_name text,
    marketing_type text,                     -- 마케팅 분류
    vendor text,
    started_on date,
    ended_on date,
    amount bigint,                           -- 음수 허용(환불/차감)
    amount_vat bigint,
    entry_kind text not null default 'order',   -- order | refund ← 음수 9건 구분
    settled_to_vendor boolean not null default false,   -- 정산유무(든든→외주)
    settled_final boolean not null default false,       -- 정산유무(든든→든든 최종)
    note text
);

-- ⑤ 계정 자격증명 (⚠️ 평문 금지 — 별도 검토)
-- 플레이스/블로그 계정은 이 스키마에 넣지 않는다. §5 참조.

-- RLS: 4인 전용
alter table public.leak_inquiries   enable row level security;
alter table public.leak_jobs        enable row level security;
alter table public.leak_ledger      enable row level security;
alter table public.leak_outsourcing enable row level security;
-- 정책: for all to authenticated using (public.is_internal() and <4인 이메일>) 형태
-- ⚠️ 정책 DROP만 따로 실행 금지(RLS-on·정책0 = 전체차단 락아웃)
```

### 4-1. 설계 결정 근거
| 결정 | 이유 |
|---|---|
| `our_share`/`partner_share`를 **저장**(계산 아님) | 11건 중 8건이 규칙 이탈, 재계산 시 발행된 세금계산서와 불일치(§2-2) |
| `base_amount`·`deduction_amount`·`partner_share` **분리** | 시트의 백준 컬럼에 3가지 의미 혼재(§2-1) |
| `is_rule_exception` + `exception_reason` | 이탈 8건을 삭제·수정이 아니라 명시적으로 남김 |
| `phone_norm` 별도 컬럼 | 원본에 `010 -2774-7589`(공백)·유선번호 혼재. **UNIQUE 걸면 안 됨**(중복 2쌍 존재) |
| `outflow_kind` | 외주비 컬럼이 외주비+급여+세금+대표인출 잡탕, 차액 2,019,630원(§3) |
| `unreconciled` 플래그 | 근거 없는 입금 2건 보존 |
| 월간요약 테이블 **없음** | 파생 집계 → 뷰로 산출. 시트 요약은 오류 다수(§3) |
| `entry_kind` (order/refund) | 외주 탭 음수 9건이 건수 집계를 왜곡 |

---

## 5. 자격증명 — 별도 취급

플레이스 10건·블로그 4건의 네이버 ID/PW는 **일반 테이블 컬럼으로 옮기지 않는다.**
- 현재 3개 탭에 중복 게재 + 공개 노출 상태(§1)
- 기존 저장소 컨벤션상 민감값은 CF 환경변수 또는 `is_internal()` 경계 안쪽 (`naver-keywords.ts` 패턴)
- **선행**: 비밀번호 전면 교체 후 → 저장 위치 별도 설계(시크릿 분리 / 암호화 컬럼)
- 계정↔플레이스/블로그 매핑(등급 `NB` vs `NB1` 표기 불일치도 정리)은 별도 테이블로 단일화

---

## 6. 마이그레이션 규칙

| 대상 | 규칙 |
|---|---|
| 자리표시 행 **392개** | "순서만 있고 핵심 필드 전부 공백" → 제외 |
| `#REF!` 39개 | 값 아님 → null |
| 순서 열 | **전면 폐기**(상담DB에 76~92 중복, 탭 간 순번 불일치). surrogate PK 사용 |
| 금액 `"100,000원"` | 정수 파싱. 원장은 '원' 없음 → 표기 2종 모두 처리 |
| 날짜 4형식(`05-12`/`2026-04-10`/`26-04-14`/`2026년 4월`) | date로 정규화. **연도 없는 `MM-DD`는 원장 대조로 2026 확정** |
| 후행 공백(`홍여진 `, `TS `, `가양동 `) | trim — 현재 집계가 갈라져 있음 |
| 상담DB 중복 2쌍(`010-3780-4347`, `010-2247-8300`) | 문의일·상담자·종류 동일 + 지역만 상세화 → 병합 |
| 블로그이력 `g499789438` | 폐기(고유 데이터 0건) |
| 월간요약 탭 | 이관 안 함 → 뷰로 재생성 |
| 미래 일자 원장(08-06~08-25, 잔고 0) | 제외 — "미래 잔고 0원"으로 오인됨 |
| 링크 오류 4건 / `순위` 열(252건 중 1건) / `해피콜`(전부 공란) | 정리 후 이관 |

---

## 7. 배선 (기존 ERP 추가)

**신규 파일만** (충돌 위험 최소):
```
src/routes/LeakPage.tsx
src/components/leak/          ← 상담·작업·정산·원장 탭
src/api/leakErp.ts
docs/leak-erp.sql
```
**기존 파일 수정 = 2곳**
- `src/App.tsx` 라우트 배열 1줄: `{ path: '/leak', element: <LeakPage /> }`
- `src/lib/permissions.ts`: `canSeeLeakPage` 추가 — 4인(`rlawhddls@ddmkt.com`·`ming99@ddmkt.com`·`ddmkt1@ddmkt.com`·`gyu6425@gmail.com`)은 **이미 등록돼 있어 재사용**

> ⚠️ 저장소가 매우 활발(5일 145커밋) — 새 폴더 위주 + 기존 파일 2줄 원칙을 지켜야 머지 충돌이 안 남.

---

## 8. ❓ 사람만 답할 수 있는 것 (마이그레이션 전 필수)

1. **#2·#3·#11이 왜 20%인가?** 집행업체는 백준누수인데 요율이 20%. 타업체 건을 잘못 적었나, 구두로 깎았나?
2. **#6의 백준 1,800,000은 오류가 맞나?** 70%면 1,260,000. 540,000 차이 — 실제로 얼마 지급했나?
3. **#7의 22.08%(106,000)는 어떻게 나온 값인가?** 30%도 20%도 아니고 비고도 없음.
4. **#4의 기준금액 217,000의 33,000 차감 근거는?**
5. **자재비 공제 규칙 확정** — 공제 후 요율 적용이 맞나? 그럼 #8(공제 미적용)은 정정 대상인가?
6. **원장 미분류 2건**(05-12 50,000 "디디클린 입금", 06-20 575)의 정체
7. **`해피콜` 열** — 쓸 건가 뺄 건가(현재 48건 전부 공란)

> 1~5는 **금액이 걸린 문제**라 추정으로 넘기면 안 됨. 확정 후 마이그레이션.

---

## 9. 별건 (법무 검토 권고)
외주발주 탭에 `리워드 애플 200타`, `어스 100건`, `슈퍼뭉치` 등 **플레이스 리워드/트래픽 발주 내역**과 분류 `플레이스(리워드)`·`플레이스(블배포)`가 기록돼 있고, 현재 **공개 상태로 열람 가능**. ERP 이관 여부와 별개로 노출 차단 + 법무 검토 권고.

---

### 참조
분석 원본: 구글시트 8탭(gid 0 / 1798011727 / 70199481 / 1082929641 / 702812795 / 1205812806 / 499789438 / 1036062057)
기존 컨벤션: `docs/cafe-publish-queue.sql` · `docs/enable-login-rls.sql` · `src/lib/permissions.ts` · `src/api/erp.ts`
