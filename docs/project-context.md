# Project Context

## Purpose

This project is an internal company ERP for marketing operations.
Employees sign in and manage their own customers, contracts, payments, schedules, and reports.

## Fixed Stack

- Frontend: React + TypeScript
- Auth: Supabase Auth
- Database: Supabase DB
- Access control: Supabase RLS
- Deployment: Cloudflare Pages

## Security Direction

- Do not rely on frontend-only hiding for security.
- Enforce data access with Supabase RLS.
- Employees can access only their assigned records.
- Admin users can access all records.
- Deletes are admin-only.
- Keep Supabase URL and anon key in `.env` locally.
- Register production environment variables in Cloudflare Pages.
- Never commit `.env` files.

## Main Tables

- `clients`: customer and inquiry data
- `contracts`: contract data linked to `clients`
- `payments`: payment and cost records linked to `contracts`
- `users`: employee profile data linked to Supabase Auth

## Current App Structure

```txt
src/
├── components/
│   ├── Layout.tsx
│   ├── Sidebar.tsx
│   └── ProtectedRoute.tsx
├── routes/
│   ├── DashboardPage.tsx
│   ├── ClientsPage.tsx
│   ├── ContractsPage.tsx
│   ├── CalendarPage.tsx
│   ├── ReportsPage.tsx
│   └── LoginPage.tsx
├── lib/
│   └── supabase.ts
├── context/
│   └── AuthContext.tsx
├── hooks/
│   └── useAuth.ts
├── types/
│   └── index.ts
├── App.tsx
└── main.tsx
```

## UI Direction

- Keep current UI minimal until Figma designs are provided.
- Use Tailwind CSS for UI styling.
- `public/images/refer.png` is a reference image for design work, not an app asset unless explicitly requested.

## Product Workflow Reference

The workflow in `public/images/refer.png` is the source of truth for the ERP flow.
Keep this structure when adding pages, database features, and automations.

### Main Flow

1. 문의 접수
   - 숨고/네이버
   - 카카오/이메일
   - 인스타/홈페이지
   - 지인소개/기타
   - 빠른 등록 또는 문의 추가

2. 고객 DB 관리
   - 업체명
   - 연락처
   - 경로
   - 담당자
   - 상태
   - 연락 일정 캘린더
   - 다음 연락일
   - 히스토리 기록

3. 계약 관리
   - 상태가 계약완료일 때 생성
   - 계약 정보
   - 사업자
   - 상품
   - 결제 관리
   - 상품 등록
   - 결제 기록
   - 콘텐츠 스케줄
   - 외주비 관리

4. 월별 리포트
   - 매출
   - 외주비
   - 순매출
   - 영업자별 인센티브
   - 문의 경로별 유입 분석
   - 상품별 매출/마케팅 상품
   - 영업자 전환율 및 인센티브
   - 최근 6개월 신규 트렌드

5. AI 추가 도구
   - 상세페이지 생성기
   - 블로그 도구
   - 메모/캘린더

### Integration Flow

- Supabase is the shared database.
- Supabase stores employee data, clients, contracts, URLs, and anon key configuration.
- Anthropic API is used for AI-generated content such as detail pages and blog text.
