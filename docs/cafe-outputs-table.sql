-- ============================================================================
-- 카페 원고 생성기 저장 갤러리 — 생성한 카드 원고(콘텐츠 JSON)·후기 본문·AI 배경을 보관.
--   Supabase SQL Editor에서 1회 실행. 내부 사용자(is_internal) 공유 워크스페이스.
--   content = CafeContent JSON, bg_image = AI 배경 dataURL(선택, 큼).
-- ============================================================================

create table if not exists public.cafe_outputs (
    id uuid primary key default gen_random_uuid(),
    created_at timestamptz not null default now(),
    operator_name text,
    keyword text,
    region text,
    title text,
    content jsonb,
    review_body text,
    tone text,
    bg_image text
);

alter table public.cafe_outputs enable row level security;

-- 내부 사용자만 조회/저장/삭제(공유 워크스페이스). is_internal(): 내부 계정 판별(기존 정의 재사용).
drop policy if exists "cafe_outputs 내부 조회" on public.cafe_outputs;
create policy "cafe_outputs 내부 조회" on public.cafe_outputs
    for select to authenticated using (public.is_internal());

drop policy if exists "cafe_outputs 내부 저장" on public.cafe_outputs;
create policy "cafe_outputs 내부 저장" on public.cafe_outputs
    for insert to authenticated with check (public.is_internal());

drop policy if exists "cafe_outputs 내부 삭제" on public.cafe_outputs;
create policy "cafe_outputs 내부 삭제" on public.cafe_outputs
    for delete to authenticated using (public.is_internal());

create index if not exists cafe_outputs_created_idx on public.cafe_outputs (created_at desc);
