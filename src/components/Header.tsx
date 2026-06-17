const pageTitles: Record<string, string> = {
    '/dashboard': '대시보드',
    '/clients': '고객사 관리',
    '/contracts': '계약 관리',
    '/calendar': '캘린더',
    '/reports': '리포트',
    '/banner-generator': '배너 생성기',
    '/mypage': '내 페이지',
    '/admin': '관리자 페이지',
};

function Header() {
    const currentPath = window.location.pathname;
    const title = pageTitles[currentPath] ?? '대시보드';

    return (
        <header className="mb-6 flex min-h-[48px] items-center justify-between">
            <h1 className="m-0 text-[28px] font-semibold">{title}</h1>
        </header>
    );
}

export default Header;
