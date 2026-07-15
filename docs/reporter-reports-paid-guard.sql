-- 방어심화(독립검증 권고): 기자단이 out_amount 뿐 아니라 paid/paid_at(입금 상태)도 조작 못 하게 DB에서 차단.
--   입금 처리는 내부(회사 ERP)에서만. 기자단은 insert 시 미입금 고정, update 시 기존값 유지(변경 무시).
--   RLS가 이미 confirmed 행을 기자단이 못 바꾸게 막지만, 정책 변경/우회 대비 컬럼 단위 이중 방어.

create or replace function public.bpr_guard_out_amount()
returns trigger language plpgsql security definer set search_path = public as $$
begin
    if public.is_reporter() then
        new.out_amount := null; -- 외주비 금액은 내부 승인 시에만
        if TG_OP = 'INSERT' then
            new.paid := false; new.paid_at := null; -- 신규 보고는 항상 미입금
        else
            new.paid := old.paid; new.paid_at := old.paid_at; -- 기자단의 paid 변경 무시(기존값 유지)
        end if;
    end if;
    return new;
end;
$$;

drop trigger if exists trg_bpr_guard_out_amount on public.blog_post_reports;
create trigger trg_bpr_guard_out_amount
    before insert or update on public.blog_post_reports
    for each row execute function public.bpr_guard_out_amount();
