-- 카페 자동발행 대기열 — 웹 '카페 발행' 버튼이 적재 → 로컬 데몬(publish_listener.py)이 폴링해
--   스마트에디터로 이미지 순서대로 + 본문 발행. 카카오 report_send_requests와 동형(내부 전용).
-- 전제: enable-login-rls.sql / reporter-erp-rls.sql (is_internal 강화판) 적용.

create table if not exists public.cafe_publish_queue (
    id uuid primary key default gen_random_uuid(),
    created_at timestamptz not null default now(),
    title text not null,
    club_id text,                              -- 카페 clubid(예: demolish0812의 숫자 id)
    menu_id text,                              -- 게시판 menuid
    manifest jsonb not null default '[]',      -- [{type:'image',url} | {type:'text',text}] 게시 순서(위→아래)
    status text not null default 'pending',    -- pending | processing | done | fail
    posted_url text,                           -- 발행된 글 URL(검증 후 기록)
    reason text,                               -- 실패 사유
    scheduled_at timestamptz,                  -- 예약/간격 제어(선택)
    done_at timestamptz
);
create index if not exists cpq_status_idx on public.cafe_publish_queue (status, created_at);
alter table public.cafe_publish_queue enable row level security;

drop policy if exists "cpq 내부 전체" on public.cafe_publish_queue;
create policy "cpq 내부 전체" on public.cafe_publish_queue
    for all to authenticated
    using (public.is_internal()) with check (public.is_internal());

-- 카페 발행용 이미지 버킷(private) — 웹이 생성 이미지 업로드, 로컬 데몬(service_role)이 다운로드.
insert into storage.buckets (id, name, public)
values ('cafe-images', 'cafe-images', false)
on conflict (id) do nothing;

drop policy if exists "storage cafe 내부" on storage.objects;
create policy "storage cafe 내부" on storage.objects
    for all to authenticated
    using (bucket_id = 'cafe-images' and public.is_internal())
    with check (bucket_id = 'cafe-images' and public.is_internal());
