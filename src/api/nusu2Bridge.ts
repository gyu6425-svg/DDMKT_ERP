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
