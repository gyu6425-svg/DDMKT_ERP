import { useEffect, useState } from 'react';
import AccountMenu from './AccountMenu';
import NotificationBell from './NotificationBell';
import ErpViewSwitcher from './ErpViewSwitcher';
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
    const title = resolveTitle(loc.path, loc.search);

    return (
        <header className="mb-6 flex min-h-[48px] items-center justify-between gap-3">
            <h1 className="m-0 text-[28px] font-semibold">{title}</h1>

            <div className="flex items-center gap-3">
                {/* 회사/고객/기자단 ERP 토글 + 대상 검색(권한자만) / 외부 고객 = 업체명 */}
                <ErpViewSwitcher />
                <NotificationBell />
                <AccountMenu />
            </div>
        </header>
    );
}

export default Header;
