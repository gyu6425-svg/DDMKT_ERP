import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { getClients, type ErpClient } from '../api/erp';
import { getReporters, getViewers, type ReporterProfile, type ViewerProfile } from '../api/blogRank';

// 회사 / 고객 / 기자단 ERP 토글 — 김종인·송민경(전부), 김다영(회사·기자단).
//   회사 = 로그인한 본인 뷰. 고객/기자단 = 검색으로 대상 선택(내부 관리자 미리보기, RLS로 이미 접근 가능한 데이터).
const OWNERS = ['rlawhddls@ddmkt.com', 'ming99@ddmkt.com', 'gyu6425@gmail.com', 'ddmkt1@ddmkt.com']; // 김종인, 송민경, 장규진(테스트), 조재현
const REPORTER_EXTRA = ['cleokim77@ddmkt.com']; // + 김다영

function navigate(path: string) {
    if (window.location.pathname + window.location.search !== path) {
        window.history.pushState(null, '', path);
        window.dispatchEvent(new Event('app:navigate'));
    }
}

// 검색 드롭다운 공용 — 항목 { id, label, sub } 중 라벨 검색 → 선택 시 onPick(id).
function SearchPicker({
    placeholder,
    items,
    selectedId,
    onPick,
}: {
    placeholder: string;
    items: { id: string; label: string; sub?: string }[];
    selectedId: string;
    onPick: (id: string, label: string) => void;
}) {
    const [q, setQ] = useState('');
    const [open, setOpen] = useState(false);
    const boxRef = useRef<HTMLDivElement>(null);
    const selected = items.find((i) => i.id === selectedId);
    useEffect(() => {
        const onDown = (e: MouseEvent) => {
            if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', onDown);
        return () => document.removeEventListener('mousedown', onDown);
    }, []);
    const filtered = useMemo(() => {
        const s = q.trim().toLowerCase();
        // 업체명 + 계정 아이디(sub) 둘 다 검색. 전체 스크롤로 보이게 상한 넉넉히.
        return (
            s
                ? items.filter(
                      (i) =>
                          i.label.toLowerCase().includes(s) || (i.sub || '').toLowerCase().includes(s),
                  )
                : items
        ).slice(0, 300);
    }, [q, items]);

    return (
        <div className="relative" ref={boxRef}>
            <input
                className="h-9 w-56 rounded-md border border-[#cbd5e1] bg-white px-3 text-sm"
                onChange={(e) => {
                    setQ(e.target.value);
                    setOpen(true);
                }}
                onFocus={() => setOpen(true)}
                placeholder={selected ? `${selected.label} (변경하려면 검색)` : placeholder}
                value={q}
            />
            {open ? (
                <div className="absolute right-0 z-50 mt-1 max-h-72 w-72 overflow-y-auto rounded-lg border border-[#e2e8f0] bg-white shadow-lg">
                    {filtered.length === 0 ? (
                        <div className="px-3 py-3 text-xs text-[#94a3b8]">검색 결과 없음</div>
                    ) : (
                        filtered.map((i) => (
                            <button
                                className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-[#f8fafc] ${
                                    i.id === selectedId ? 'bg-[#eff6ff]' : ''
                                }`}
                                key={i.id}
                                onClick={() => {
                                    onPick(i.id, i.label);
                                    setQ('');
                                    setOpen(false);
                                }}
                                type="button"
                            >
                                <span className="truncate font-semibold text-[#334155]">{i.label}</span>
                                {i.sub ? <span className="ml-2 shrink-0 text-[11px] text-[#94a3b8]">{i.sub}</span> : null}
                            </button>
                        ))
                    )}
                </div>
            ) : null}
        </div>
    );
}

export default function ErpViewSwitcher() {
    const { profile, role } = useAuth();
    const email = (profile?.email || '').toLowerCase();
    const showCustomer = OWNERS.includes(email);
    const showReporter = OWNERS.includes(email) || REPORTER_EXTRA.includes(email);
    const showToggle = showCustomer || showReporter;

    // 현재 경로/미리보기 대상 추적.
    const [loc, setLoc] = useState(() => window.location.pathname + window.location.search);
    useEffect(() => {
        const s = () => setLoc(window.location.pathname + window.location.search);
        window.addEventListener('app:navigate', s);
        window.addEventListener('popstate', s);
        return () => {
            window.removeEventListener('app:navigate', s);
            window.removeEventListener('popstate', s);
        };
    }, []);
    const path = loc.split('?')[0];
    const asId = new URLSearchParams(loc.split('?')[1] || '').get('as') || '';
    const mode: 'company' | 'customer' | 'reporter' = path.startsWith('/reporter')
        ? 'reporter'
        : path.startsWith('/portal')
          ? 'customer'
          : 'company';

    // 기자단 목록(검색용) — 기자단 토글 권한자만 로드.
    const [reporters, setReporters] = useState<ReporterProfile[]>([]);
    useEffect(() => {
        if (showReporter) void getReporters().then(({ data }) => setReporters(data));
    }, [showReporter]);

    // 고객(업체) 목록(검색용) — 고객 토글 권한자만 직접 로드(ErpDataContext에 의존 X, /portal에서도 확실히 채움).
    const [clients, setClients] = useState<ErpClient[]>([]);
    const [viewers, setViewers] = useState<ViewerProfile[]>([]);
    useEffect(() => {
        if (showCustomer) {
            void getClients().then(({ data }) => setClients(data ?? []));
            void getViewers().then(({ data }) => setViewers(data)); // 업체별 로그인 아이디 매핑용
        }
    }, [showCustomer]);

    // 외부 실계정은 기존 표기(토글 없음).
    if (role === 'viewer') {
        return (
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-[#e2e8f0] bg-[#f8fafc] px-3 py-1.5 text-sm font-semibold text-[#1e40af]">
                <span className="text-[#94a3b8]">업체</span>
                {profile?.name ?? '내 업체'}
            </span>
        );
    }
    if (role === 'reporter') return null;
    if (!showToggle) return null;

    const tabBtn = (label: string, active: boolean, onClick: () => void) => (
        <button
            className={`rounded-md px-3 py-1.5 ${active ? 'bg-white text-[#1e40af] shadow-sm' : 'text-[#94a3b8]'}`}
            onClick={onClick}
            type="button"
        >
            {label}
        </button>
    );

    // 업체 client_id → 로그인 아이디(ddmkt_xxx) 매핑. 검색 우측 () 안에 계정 표시.
    const loginByClient = new Map<string, string>();
    viewers.forEach((v) => {
        if (v.client_id) loginByClient.set(v.client_id, v.email.split('@')[0]);
    });
    const clientItems = clients
        .filter((c) => c.company)
        .map((c) => {
            const login = loginByClient.get(c.id);
            return { id: c.id, label: c.company as string, sub: login ? `(${login})` : '(계정없음)' };
        })
        .sort((a, b) => a.label.localeCompare(b.label, 'ko'));
    // 기자단 = ddmkt_N 숫자 아이디 순으로 정렬(1,2,3…), 숫자 아닌 계정은 뒤로.
    const reporterNum = (email: string) => {
        const m = /^ddmkt_(\d+)@/.exec(email || '');
        return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
    };
    const reporterItems = [...reporters]
        .sort((a, b) => reporterNum(a.email) - reporterNum(b.email))
        .map((r) => ({ id: r.id, label: r.name || r.email, sub: r.email.split('@')[0] }));

    return (
        <div className="flex items-center gap-2">
            <div className="inline-flex rounded-lg border border-[#e2e8f0] bg-[#f8fafc] p-0.5 text-sm font-semibold">
                {tabBtn('회사 ERP', mode === 'company', () => navigate('/dashboard'))}
                {showCustomer ? tabBtn('고객 ERP', mode === 'customer', () => navigate('/portal/blog')) : null}
                {showReporter ? tabBtn('기자단 ERP', mode === 'reporter', () => navigate('/reporter')) : null}
            </div>
            {mode === 'customer' && showCustomer ? (
                <SearchPicker
                    items={clientItems}
                    onPick={(id) => navigate(`/portal/blog?as=${id}`)}
                    placeholder="업체명 검색…"
                    selectedId={asId}
                />
            ) : null}
            {mode === 'reporter' && showReporter ? (
                <SearchPicker
                    items={reporterItems}
                    onPick={(id) => navigate(`/reporter?as=${id}`)}
                    placeholder="기자단 검색…"
                    selectedId={asId}
                />
            ) : null}
        </div>
    );
}
