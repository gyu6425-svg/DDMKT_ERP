import { useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import type { CategoryDef } from './categories';

// 카테고리 대시보드 셸 — 영상/인스타/카페/트래픽이 공유. 블로그 대시보드와 같은 탭 구조.
//   탭 전환은 동작하고, 각 탭 내용은 다음 단계(데이터 모델·고객사 관리 연동)에서 채운다.
//   블로그 대시보드와 동일하게 관리자 전용.
const TAB_DESC: Record<string, string> = {
    '대시보드': '이 카테고리의 핵심 지표(업체 수·진행률·재계약 임박 등)를 한눈에.',
    '관리 시트': '고객사 관리에서 등록한 업체의 계약·재계약·금액을 관리(고객사 관리와 동기화 예정).',
    '순위 트래커': '업체별 노출 순위 추적.',
    '크롤링 현황': '오늘 측정 현황을 실시간으로 확인.',
    '블로그 작성기': 'AI 블로그 글 작성 도구.',
};

export function CategoryDashboardSkeleton({ def }: { def: CategoryDef }) {
    const { isAdmin, loading: authLoading } = useAuth();
    const [tab, setTab] = useState(def.tabs[0]);

    if (!authLoading && !isAdmin) {
        return (
            <section className="grid place-items-center py-24 text-center">
                <div>
                    <h2 className="m-0 text-lg font-bold text-[#0f172a]">관리자 전용 페이지</h2>
                    <p className="mt-2 text-sm text-[#64748b]">{def.label}는 관리자 계정만 접근할 수 있습니다.</p>
                </div>
            </section>
        );
    }

    const short = def.label.replace(' 대시보드', '');

    return (
        <section className="grid gap-4">
            <div className="flex items-center gap-2">
                <h2 className="m-0 text-[22px] font-semibold text-[#0f172a]">{def.label}</h2>
                <span className="rounded-full bg-[#fef3c7] px-2.5 py-1 text-xs font-bold text-[#b45309]">준비 중</span>
            </div>
            <p className="m-0 text-sm text-[#64748b]">
                고객사 관리에서 <b>{short}</b> 카테고리로 계약을 등록하면 여기서 관리합니다 · 블로그 대시보드와 동일 구조
            </p>

            {/* 탭 (동작) */}
            <div className="flex gap-1 border-b border-[#e2e8f0]">
                {def.tabs.map((t) => (
                    <button
                        className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold ${
                            tab === t ? 'border-[#1e40af] text-[#1e40af]' : 'border-transparent text-[#94a3b8]'
                        }`}
                        key={t}
                        onClick={() => setTab(t)}
                        type="button"
                    >
                        {t}
                    </button>
                ))}
            </div>

            {/* 탭 내용(placeholder) */}
            <div className="rounded-xl border border-dashed border-[#cbd5e1] bg-[#f8fafc] px-6 py-16 text-center">
                <div className="text-base font-semibold text-[#475569]">
                    {short} · {tab}
                </div>
                <p className="mx-auto mt-2 max-w-md text-sm text-[#94a3b8]">
                    {TAB_DESC[tab] ?? '곧 구현됩니다.'} <br />
                    이 화면은 블로그 대시보드와 같은 구조로 구현될 예정입니다.
                </p>
            </div>
        </section>
    );
}
