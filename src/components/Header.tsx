import { useEffect, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import AccountMenu from './AccountMenu';
import NotificationBell from './NotificationBell';
import { SIDEBAR_CATEGORIES } from './categoryRank/categories';

const pageTitles: Record<string, string> = {
    '/dashboard': '대시보드',
    '/clients': '고객사 관리',
    '/contracts': '계약 관리',
    '/calendar': '캘린더',
    '/reports': '리포트',
    '/banner-generator': '배너 생성기',
    '/mypage': '내 페이지',
    '/admin': '관리자 페이지',
    '/portal': '고객 ERP',
};

// 상단 제목 — pathname + ?sub 기준(내부 ?tab 무시). '대시보드' 글자는 메인에만.
function resolveTitle(path: string, search: string): string {
    if (pageTitles[path]) return pageTitles[path];
    const sub = new URLSearchParams(search).get('sub');
    for (const c of SIDEBAR_CATEGORIES) {
        for (const s of c.subs) {
            const [sp, sq] = s.href.split('?');
            const ssub = sq ? new URLSearchParams(sq).get('sub') : null;
            if (sp === path && (ssub || null) === (sub || null)) return s.label;
        }
        if (c.dashHref === path && !sub) return c.label;
    }
    return '';
}

function Header() {
    const [loc, setLoc] = useState({
        path: window.location.pathname,
        search: window.location.search,
    });
    useEffect(() => {
        const sync = () =>
            setLoc({ path: window.location.pathname, search: window.location.search });
        window.addEventListener('popstate', sync);
        window.addEventListener('app:navigate', sync);
        return () => {
            window.removeEventListener('popstate', sync);
            window.removeEventListener('app:navigate', sync);
        };
    }, []);
    const currentPath = loc.path;
    const title = resolveTitle(loc.path, loc.search);
    const { isAdmin, profile, role } = useAuth();
    // 회사/고객 토글은 관리자·매니저만. 고객(viewer)은 업체명. 사원은 표기 없음(계정 메뉴에 이름만).
    const isInternal = isAdmin || role === 'manager';
    const isCustomerView = currentPath.startsWith('/portal');

    const go = (path: string) => {
        if (window.location.pathname !== path) {
            window.history.pushState(null, '', path);
            window.dispatchEvent(new Event('app:navigate'));
        }
    };

    return (
        <header className="mb-6 flex min-h-[48px] items-center justify-between gap-3">
            <h1 className="m-0 text-[28px] font-semibold">{title}</h1>

            <div className="flex items-center gap-3">
            {/* 내부(관리자·매니저) = 회사 ⇄ 고객 토글 / 외부 고객 = 본인 업체명 */}
            {isInternal ? (
                <div className="inline-flex rounded-lg border border-[#e2e8f0] bg-[#f8fafc] p-0.5 text-sm font-semibold">
                    <button
                        className={`rounded-md px-3 py-1.5 ${
                            !isCustomerView ? 'bg-white text-[#1e40af] shadow-sm' : 'text-[#94a3b8]'
                        }`}
                        onClick={() => go('/dashboard')}
                        type="button"
                    >
                        회사 ERP
                    </button>
                    <button
                        className={`rounded-md px-3 py-1.5 ${
                            isCustomerView ? 'bg-white text-[#1e40af] shadow-sm' : 'text-[#94a3b8]'
                        }`}
                        onClick={() => go('/portal')}
                        type="button"
                    >
                        고객 ERP
                    </button>
                </div>
            ) : role === 'viewer' ? (
                <span className="inline-flex items-center gap-1.5 rounded-lg border border-[#e2e8f0] bg-[#f8fafc] px-3 py-1.5 text-sm font-semibold text-[#1e40af]">
                    <span className="text-[#94a3b8]">업체</span>
                    {profile?.name ?? '내 업체'}
                </span>
            ) : null}
            <NotificationBell />
            <AccountMenu />
            </div>
        </header>
    );
}

export default Header;
