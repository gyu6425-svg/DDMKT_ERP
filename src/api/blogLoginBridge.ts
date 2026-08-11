// 블로그 로그인 브릿지 클라이언트 — 발행 PC(SUB1) 로컬 서버(127.0.0.1:8790, blog_login_bridge.py)를 호출.
//   웹UI는 로컬 크롬을 직접 못 띄우므로, 그 PC에서 도는 브릿지가 blog_id 전용 크롬(전용 포트·프로필)을 띄운다.
//   ★ 발행 PC에서 :5173(dev)로 띄운 UI 전용. run_blog_login_bridge.bat 로 브릿지를 먼저 켜야 한다.
//   ★ 업체마다 다른 크롬: blog_id + port 로 세션이 안 섞인다.
const BRIDGE = 'http://127.0.0.1:8790';

// 브릿지 서버가 켜져 있는지.
export async function blogBridgeHealth(): Promise<boolean> {
    try {
        const r = await fetch(`${BRIDGE}/api/blog/health`);
        const d = await r.json();
        return Boolean(d && d.ok);
    } catch {
        return false;
    }
}

// 그 포트에 로그인 크롬이 떠 있는지.
export async function blogLoginPing(port: number): Promise<boolean> {
    try {
        const r = await fetch(`${BRIDGE}/api/blog/ping?port=${encodeURIComponent(String(port))}`);
        const d = await r.json();
        return Boolean(d && d.alive);
    } catch {
        return false;
    }
}

// '네이버 로그인' — 브릿지가 이 블로그 전용 크롬(port·프로필=blog_id)을 띄운다. 담당자가 그 창에서 직접 로그인.
//   reached=false: 브릿지 미가동(발행 PC에서 run_blog_login_bridge.bat 켜야 함).
export async function blogLogin(blogId: string, port: number): Promise<{ ok: boolean; already?: boolean; error?: string; reached: boolean }> {
    try {
        const r = await fetch(`${BRIDGE}/api/blog/login`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ blog_id: blogId, port }),
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok || d.ok === false) return { ok: false, error: d.error || `HTTP ${r.status}`, reached: true };
        return { ok: true, already: Boolean(d.already), reached: true };
    } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e), reached: false };
    }
}
