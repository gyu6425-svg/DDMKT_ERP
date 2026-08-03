// nusu2 발행 브릿지 클라이언트 — 로컬 python 서버(127.0.0.1:8788, nusu2_api.py)를 호출한다.
//   UI가 region 을 넘기면 서버가 nusu2/ddclean make_and_queue 로 최신 포맷(위치스택·동·지역CTA·
//   실사페어·카드·존댓말) 그대로 생성·큐 적재한다. nusu2 로직을 JS로 이식하지 않는다(단일소스).
//   ★ 로컬 발행 PC에서 :5173(dev)로 띄운 UI 전용. run_nusu2_api.bat 로 브릿지를 먼저 켜야 한다.

const BRIDGE = 'http://127.0.0.1:8788';

export type Nusu2QueueInput = {
    region: string;
    kind?: 'nusu' | 'durban';   // nusu=누수(nusu2), durban=입주청소(ddclean)
    company?: string;           // 큐 company (예: 'leak')
    board?: string;             // 카페 게시판명 (예: '누수')
    addLink?: boolean;
};

export type Nusu2QueueResult = { ok: true; job_id: string; title: string; region: string };

export async function queueNusu2(input: Nusu2QueueInput): Promise<Nusu2QueueResult> {
    const res = await fetch(`${BRIDGE}/api/nusu2/queue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            region: input.region,
            kind: input.kind ?? 'nusu',
            company: input.company,
            board: input.board,
            add_link: input.addLink,
        }),
    });
    const data = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
    if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data as Nusu2QueueResult;
}

// 온보딩 — 브릿지가 그 PC에서 '보이는 크롬'을 remote-debugging 포트로 띄운다(네이버 로그인용).
//   웹UI는 로컬 크롬을 직접 못 띄우므로, 그 PC에서 도는 브릿지가 대신 실행 → 사용자가 창에서 직접 로그인.
export async function launchLogin(profile: string, port: string, url?: string): Promise<{ ok: boolean; already?: boolean; error?: string }> {
    try {
        const r = await fetch(`${BRIDGE}/api/login/launch`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ profile, port, url }),
        });
        return await r.json();
    } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
}

// 고객 스튜디오 '네이버 로그인' — SUB2 브릿지가 client_id 전용 크롬(포트/프로필 고정)을 띄운다.
//   담당자가 그 창에서 직접 로그인(자동입력 안 함=봇 방지). 127.0.0.1 사용(localhost→::1 IPv6 미바인딩 회피).
export async function customerLogin(clientId: string): Promise<{ ok: boolean; error?: string }> {
    try {
        const r = await fetch(`${BRIDGE}/api/customer/login`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ client_id: clientId }),
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok || d.ok === false) return { ok: false, error: d.error || `HTTP ${r.status}` };
        return { ok: true };
    } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
}

// 로그인 크롬(포트)이 떠 있는지 확인.
export async function loginPing(port: string): Promise<boolean> {
    try {
        const r = await fetch(`${BRIDGE}/api/login/ping?port=${encodeURIComponent(port)}`);
        const d = await r.json();
        return Boolean(d && d.alive);
    } catch {
        return false;
    }
}

// 계층 스캔용 — 지역의 실재 동 목록 + 구 형태(서울 자치구)를 브릿지(python 단일소스)에서 받는다.
export async function fetchDongs(region: string): Promise<{ dongs: string[]; gu: string[] }> {
    try {
        const r = await fetch(`${BRIDGE}/api/nusu2/dongs?region=${encodeURIComponent(region)}`);
        const d = await r.json();
        return { dongs: Array.isArray(d.dongs) ? d.dongs : [], gu: Array.isArray(d.gu) ? d.gu : [] };
    } catch {
        return { dongs: [], gu: [] };
    }
}

// 지역형 인기글 검사 — 이 PC(브릿지, 주거 IP)에서 네이버 조회. CF/데이터센터 IP 는 네이버가 차단하므로
//   고객 지역형 스캔은 반드시 고객 로컬 에이전트를 경유한다(브라우저→localhost 는 Chrome 이 허용).
export async function checkPopularBridge(keyword: string): Promise<{ hasPopular: boolean; reason: string }> {
    const r = await fetch(`${BRIDGE}/api/nusu2/popular?keyword=${encodeURIComponent(keyword)}`);
    const d = await r.json();
    return { hasPopular: Boolean(d && d.hasPopular), reason: (d && d.reason) || 'ok' };
}

// 브릿지 서버가 켜져 있는지 확인(끄져 있으면 UI에서 안내).
export async function nusu2Health(): Promise<boolean> {
    try {
        const r = await fetch(`${BRIDGE}/api/nusu2/health`);
        const d = await r.json();
        return Boolean(d && d.ok);
    } catch {
        return false;
    }
}
