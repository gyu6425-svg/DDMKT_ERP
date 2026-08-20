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

// 등록/수정. ⚠️ 정체성은 client_id 다 — company_key 가 아니다.
//   예전엔 upsert(onConflict:'company_key') 하나뿐이라, 담당자가 업체 키를 한 글자라도 다르게 적으면
//   기존 행이 안 잡히고 **새 행이 조용히 생겼다**. 새 행은 is_own·publish_enabled 가 DB 기본값(false)이라
//   자체 발행 섹션에도 안 뜨고, 화면엔 값이 빈 원래 행만 보인다 — 눌러도 "반영이 안 된다"로만 보인다.
//   (실측: 든든한누수탐지 경기 · company_key 자리에 UI 라벨 '자체 발행'이 들어감 · 3회 반복. 2026-08-20)
//   그래서 client_id 로 기존 행을 먼저 찾아 UPDATE 한다. 못 찾을 때만 새로 만든다.
export async function upsertCafeAccount(input: Partial<CafeAccount> & { company_key: string; display_name: string }) {
    if (input.client_id) {
        const { data: rows } = await supabase.from('cafe_accounts')
            .select('id,company_key').eq('client_id', input.client_id);
        // 같은 고객이 카페를 여럿 가질 수 있다 — 업체 키가 맞는 행을 먼저, 하나뿐이면 그 행을.
        //   여러 행인데 키가 하나도 안 맞으면 진짜 '두 번째 카페' 이므로 새로 만든다.
        const match = (rows ?? []).find((r) => r.company_key === input.company_key.trim())
            ?? ((rows ?? []).length === 1 ? rows![0] : null);
        if (match) {
            // ★ 값이 들어온 필드만 덮는다. 빈 칸을 그대로 밀면 이미 등록된 카페 URL·게시판명이 지워진다
            //   (등록 폼엔 club_id 칸이 없어서 매번 빈 값으로 들어온다).
            const patch: Record<string, unknown> = {};
            const put = (k: keyof CafeAccount, v: unknown) => { if (v !== undefined && v !== null && v !== '') patch[k] = v; };
            put('display_name', input.display_name?.trim());
            put('board_name', input.board_name);
            put('board_short', input.board_short);
            put('cafe_name', input.cafe_name);
            put('club_id', input.club_id);
            put('note', input.note);
            // ⚠️ company_key 는 **절대 갱신하지 않는다**. 크롤러·발행큐가 이 키로 업체를 찾는다
            //   (cafe_rank_sync COMPANY_BOARD, cafe_gen_requests.company). 담당자가 폼에 뭘 적든
            //   기존 키를 그대로 둔다 — 이번 사고도 이 칸에 UI 라벨이 들어가서 생겼다.
            if (!Object.keys(patch).length) return { error: null };
            const { error } = await supabase.from('cafe_accounts').update(patch).eq('id', match.id);
            return { error };
        }
    }
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