-- 기자단 글 보고: 블로그 종류 + 비-브랜드 외주비 금액
--   blog_kind  : 브랜드 블로그 | 최적화 | 준최적화 | 저인망 배포 (null=브랜드 간주, 구 데이터 호환)
--   out_amount : 비-브랜드 블로그의 외주비 금액(승인 시 담당자가 입력). null이면 브랜드 규칙(8,000/대박종합주방 10,000).
-- 컬럼 추가만 — RLS/정책 변경 불필요(기존 행 정책이 그대로 적용).

alter table public.blog_post_reports add column if not exists blog_kind  text;
alter table public.blog_post_reports add column if not exists out_amount integer;

-- 참고: 기존 승인 건은 blog_kind=null → 브랜드 블로그로 간주되어 외주비 8,000/10,000 규칙이 그대로 유지됩니다.

-- ── 방어심화(독립검증 권고): 기자단은 out_amount를 절대 쓸 수 없게 DB에서 원천 차단 ──
--   RLS는 행 단위라 컬럼을 못 막는다 → 기자단이 insert/update 시 out_amount를 강제로 NULL.
--   (앱 계층 reportOutUnit도 브랜드는 무시하지만, 향후 리팩터/우회 대비 이중 방어.)
create or replace function public.bpr_guard_out_amount()
returns trigger language plpgsql security definer set search_path = public as $$
begin
    if public.is_reporter() then
        new.out_amount := null; -- 기자단 주입 차단(외주비는 내부 승인 시에만 설정)
    end if;
    return new;
end;
$$;

drop trigger if exists trg_bpr_guard_out_amount on public.blog_post_reports;
create trigger trg_bpr_guard_out_amount
    before insert or update on public.blog_post_reports
    for each row execute function public.bpr_guard_out_amount();

-- 혹시 남아있을 수 있는 브랜드/구데이터의 out_amount 값 정리(브랜드는 규칙가로 계산되므로 NULL이 정상).
update public.blog_post_reports set out_amount = null
 where out_amount is not null and (blog_kind is null or blog_kind = '브랜드 블로그');
