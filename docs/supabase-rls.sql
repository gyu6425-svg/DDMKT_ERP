-- React + Supabase direct connection + RLS
-- Run this in the Supabase SQL Editor after creating the tables.
-- Hard delete policies are intentionally omitted. Delete through soft delete only.

alter table clients enable row level security;
alter table contracts enable row level security;
alter table payments enable row level security;
alter table users enable row level security;

alter table clients add column if not exists deleted_at timestamptz;
alter table clients add column if not exists deleted_by uuid references auth.users(id);
alter table contracts add column if not exists deleted_at timestamptz;
alter table contracts add column if not exists deleted_by uuid references auth.users(id);
alter table payments add column if not exists deleted_at timestamptz;
alter table payments add column if not exists deleted_by uuid references auth.users(id);
alter table users add column if not exists deleted_at timestamptz;
alter table users add column if not exists deleted_by uuid references auth.users(id);

create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.users
    where id = auth.uid()
    and role = 'admin'
    and deleted_at is null
  );
$$;

-- clients
create policy "본인 담당 조회"
on clients for select
using ("담당자_id" = auth.uid() and deleted_at is null);

create policy "관리자 전체 조회"
on clients for select
using (public.is_admin());

create policy "본인 담당 수정"
on clients for update
using ("담당자_id" = auth.uid() and deleted_at is null)
with check ("담당자_id" = auth.uid() and deleted_at is null);

create policy "관리자 고객 수정"
on clients for update
using (public.is_admin())
with check (public.is_admin());

create policy "로그인 사용자 등록"
on clients for insert
with check (auth.uid() is not null and deleted_at is null);

-- contracts
create policy "본인 계약 조회"
on contracts for select
using (
  exists (
    select 1
    from clients
    where clients.id = contracts.customer_id
    and clients."담당자_id" = auth.uid()
    and clients.deleted_at is null
    and contracts.deleted_at is null
  )
);

create policy "관리자 계약 전체 조회"
on contracts for select
using (public.is_admin());

create policy "본인 계약 등록"
on contracts for insert
with check (
  deleted_at is null
  and (
    exists (
      select 1
      from clients
      where clients.id = contracts.customer_id
      and clients."담당자_id" = auth.uid()
      and clients.deleted_at is null
    )
    or public.is_admin()
  )
);

create policy "본인 계약 수정"
on contracts for update
using (
  exists (
    select 1
    from clients
    where clients.id = contracts.customer_id
    and clients."담당자_id" = auth.uid()
    and clients.deleted_at is null
    and contracts.deleted_at is null
  )
)
with check (
  exists (
    select 1
    from clients
    where clients.id = contracts.customer_id
    and clients."담당자_id" = auth.uid()
    and clients.deleted_at is null
    and contracts.deleted_at is null
  )
);

create policy "관리자 계약 수정"
on contracts for update
using (public.is_admin())
with check (public.is_admin());

-- payments
create policy "본인 결제 조회"
on payments for select
using (
  exists (
    select 1
    from contracts
    join clients on clients.id = contracts.customer_id
    where contracts.id = payments.contract_payments
    and clients."담당자_id" = auth.uid()
    and clients.deleted_at is null
    and contracts.deleted_at is null
    and payments.deleted_at is null
  )
);

create policy "관리자 결제 전체 조회"
on payments for select
using (public.is_admin());

create policy "본인 결제 등록"
on payments for insert
with check (
  deleted_at is null
  and (
    exists (
      select 1
      from contracts
      join clients on clients.id = contracts.customer_id
      where contracts.id = payments.contract_payments
      and clients."담당자_id" = auth.uid()
      and clients.deleted_at is null
      and contracts.deleted_at is null
    )
    or public.is_admin()
  )
);

create policy "본인 결제 수정"
on payments for update
using (
  exists (
    select 1
    from contracts
    join clients on clients.id = contracts.customer_id
    where contracts.id = payments.contract_payments
    and clients."담당자_id" = auth.uid()
    and clients.deleted_at is null
    and contracts.deleted_at is null
    and payments.deleted_at is null
  )
)
with check (
  exists (
    select 1
    from contracts
    join clients on clients.id = contracts.customer_id
    where contracts.id = payments.contract_payments
    and clients."담당자_id" = auth.uid()
    and clients.deleted_at is null
    and contracts.deleted_at is null
    and payments.deleted_at is null
  )
);

create policy "관리자 결제 수정"
on payments for update
using (public.is_admin())
with check (public.is_admin());

-- users
create policy "본인 정보 조회"
on users for select
using (id = auth.uid() and deleted_at is null);

create policy "관리자 사원 전체 조회"
on users for select
using (public.is_admin());

create policy "본인 정보 수정"
on users for update
using (id = auth.uid() and deleted_at is null)
with check (id = auth.uid() and deleted_at is null);

create policy "관리자 사원 수정"
on users for update
using (public.is_admin())
with check (public.is_admin());

create policy "관리자만 사원 등록"
on users for insert
with check (public.is_admin() and deleted_at is null);
