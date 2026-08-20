import { supabase } from '../lib/supabase';

export type CafeAccount = {
    id: string;
    created_at: string;
    company_key: string;
    display_name: string;
    cafe_name: string;
    club_id: string;
    board_name: string;
    board_short: string;
    client_id: string | null;
    active: boolean;
    publish_enabled: boolean;   // 고객 셀프 발행 승인(기본 false) — docs/cafe-customer-publish-rls.sql
    // 자체 카페(우리 콘텐츠) — 토큰 차감 대상이 아니다. 고객 대신발행과 한 목록에 섞이면
    //   '잔여 토큰 0건'이 빨갛게 떠서 문제처럼 보인다(SUB2 요청 2026-08-20).
    //   ⚠ 처음엔 note 에 '자체' 를 적어 구분했는데, 자유 입력 메모라 누가 고치면 그룹핑이 조용히 깨진다.
    //     그래서 정식 컬럼으로 옮겼다. note 는 메모 그대로 둔다.
    is_own: boolean;
    note: string | null;
    // 계약 정보(관리시트) — docs/cafe-account-contract.sql
    goal_count: number | null;   // 목표 발행 건수
    done_count: number | null;   // 발행 완료
    amount: number | null;       // 계약금액(원)
    contract_date: string | null;
    manager: string | null;
};

// 계약/담당 필드 인라인 수정.
export async function updateCafeAccount(id: string, patch: Partial<CafeAccount>) {
    const { error } = await supabase.from('cafe_accounts').update(patch).eq('id', id);
    return { error };
}

export async function getCafeAccounts() {
    const { data, error } = await supabase
        .from('cafe_accounts')
        .select('*')
        .order('created_at', { ascending: true });
    return { data: (data ?? []) as CafeAccount[], error };
}

export async function upsertCafeAccount(input: Partial<CafeAccount> & { company_key: string; display_name: string }) {
    const payload = {
        active: input.active ?? true,
        board_name: input.board_name || input.board_short || input.display_name,
        board_short: input.board_short || input.display_name,
        // ⚠️ 예전엔 여기 'ddmkt2' / '31754130'(마이클의 정보세상)이 박혀 있었다.
        //   카페 정보를 안 넣고 등록하면 **새 업체가 조용히 남의 카페로 묶인다** —
        //   그 카페 글이 새 업체 실적으로 잡히고 발행도 남의 카페로 나갈 수 있다. 에러가 안 나서 한참 뒤에나 안다.
        //   DB 기본값은 2026-08-20 에 제거했는데 코드가 같은 값을 넣고 있어 구멍이 그대로였다.
        //   → 빈 값으로 둔다. 틀린 값보다 빈 값이 낫다 — 빈 값은 화면에 '카페 URL 미등록'으로 보인다.
        cafe_name: input.cafe_name || '',
        client_id: input.client_id || null,
        club_id: input.club_id || '',
        company_key: input.company_key.trim(),
        display_name: input.display_name.trim(),
        note: input.note || null,
    };
    const { error } = await supabase.from('cafe_accounts').upsert(payload, { onConflict: 'company_key' });
    return { error };
}

export async function setCafeAccountActive(id: string, active: boolean) {
    const { error } = await supabase.from('cafe_accounts').update({ active }).eq('id', id);
    return { error };
}

// 고객 셀프 발행 승인 on/off (내부 전용 — cafe_accounts 내부 update RLS).
export async function setCafeAccountPublish(id: string, publish_enabled: boolean) {
    const { error } = await supabase.from('cafe_accounts').update({ publish_enabled }).eq('id', id);
    return { error };
}

// 게시판 주소에서 clubid 추출 — '.../cafes/<club>/menus/<n>' · '?clubid=<club>' 둘 다.
const clubIdFromUrl = (url: string): string =>
    (url.match(/cafes\/(\d+)/) ?? url.match(/(?:search\.)?clubid=(\d+)/))?.[1] ?? '';

// 토큰 발급 시 자동화 발행 탭 활성화 — 이 고객의 카페 계정을 발행 승인(publish_enabled=true).
//   계정이 없으면 생성(접수 없이 토큰만 준 경우 대비). 여러 개면 전부 켠다.
export async function enablePublishByClient(clientId: string, displayName?: string) {
    const { data } = await supabase.from('cafe_accounts').select('id').eq('client_id', clientId);
    if (data && data.length) {
        const { error } = await supabase.from('cafe_accounts')
            .update({ publish_enabled: true, active: true }).eq('client_id', clientId);
        return { error };
    }
    // ★ 신규 생성 시 board_name·board_short 는 NOT NULL 인데 기본값이 없다 — 안 넣으면 insert 자체가 죽는다.
    //   (실측 2026-08-14 금융책사: "null value in column board_name ... violates not-null constraint")
    //   cafe_name·club_id 는 기본값이 있지만 그게 마이클 공유카페(ddmkt2/31754130)라, 두면 남의 카페로 박힌다.
    //   그래서 넷 다 직접 채운다 — 값은 스튜디오 설정(있으면)에서, 없으면 빈 문자열(세팅 때 채움).
    const { data: st } = await supabase.from('cafe_studio_settings')
        .select('brand,board_name,board_url').eq('client_id', clientId).maybeSingle();
    const s = (st ?? {}) as { brand?: string | null; board_name?: string | null; board_url?: string | null };
    const name = (displayName || s.brand || '고객사').trim();
    const board = (s.board_name || '').trim();
    const { error } = await supabase.from('cafe_accounts').insert({
        company_key: `dep_${clientId}`, display_name: name,
        cafe_name: name, club_id: clubIdFromUrl(s.board_url || ''),
        board_name: board, board_short: board,
        client_id: clientId, active: true, publish_enabled: true,
    });
    return { error };
}