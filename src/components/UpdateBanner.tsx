import { useEffect, useState } from 'react';

// 빌드 시 vite define으로 주입되는 현재 앱 버전(배포 식별자).
declare const __APP_VERSION__: string;

// 새 배포 감지 배너 — 5분마다(+탭 포커스 시) /version.json 을 확인해 배포 버전이 바뀌면 안내.
//   강제 리로드는 하지 않는다(업무 지장 방지). 사용자가 원할 때 '새로고침'을 누르면 일반 새로고침.
export function UpdateBanner() {
    const [available, setAvailable] = useState(false);
    const [dismissed, setDismissed] = useState(false);

    useEffect(() => {
        let alive = true;
        const check = async () => {
            try {
                const r = await fetch(`/version.json?_=${Date.now()}`, { cache: 'no-store' });
                if (!r.ok) return;
                const j = (await r.json()) as { version?: string };
                // 서버(최신 배포) 버전 ≠ 현재 로드된 앱 버전 → 새 배포 존재.
                if (alive && j.version && j.version !== __APP_VERSION__) setAvailable(true);
            } catch {
                // 네트워크 오류 등은 무시(다음 주기에 재시도).
            }
        };
        const id = window.setInterval(check, 5 * 60 * 1000); // 5분
        const onVis = () => {
            if (document.visibilityState === 'visible') void check();
        };
        document.addEventListener('visibilitychange', onVis);
        void check();
        return () => {
            alive = false;
            window.clearInterval(id);
            document.removeEventListener('visibilitychange', onVis);
        };
    }, []);

    if (!available || dismissed) return null;

    return (
        <div className="fixed bottom-4 left-1/2 z-[3000] flex -translate-x-1/2 items-center gap-3 rounded-xl border border-[#1e40af] bg-white px-4 py-2.5 shadow-lg">
            <span className="text-sm font-semibold text-[#0f172a]">
                🔄 새 버전이 배포됐어요. 새로고침하면 반영됩니다.
            </span>
            <button
                className="rounded-md bg-[#1e40af] px-3 py-1.5 text-sm font-bold text-white hover:bg-[#1e3a8a]"
                onClick={() => window.location.reload()}
                type="button"
            >
                새로고침
            </button>
            <button
                className="text-sm font-semibold text-[#94a3b8] hover:text-[#475569]"
                onClick={() => setDismissed(true)}
                title="이번엔 나중에(작업 중이면 계속 진행하세요)"
                type="button"
            >
                나중에
            </button>
        </div>
    );
}
