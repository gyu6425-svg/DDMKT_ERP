import { useState } from 'react';
import ApiUsagePanel from '../components/ApiUsagePanel';
import { useAuth } from '../hooks/useAuth';

type AdminCategory = 'overview' | 'api-usage';

const categories: Array<{ id: AdminCategory; label: string }> = [
    { id: 'overview', label: '개요' },
    { id: 'api-usage', label: 'API 사용량' },
];

function AdminPage() {
    const { isAdmin } = useAuth();
    const [category, setCategory] = useState<AdminCategory>('overview');

    if (!isAdmin) {
        return (
            <section className="min-h-[320px] rounded-[40px] border border-[#e5e7eb] bg-white p-12">
                <h2 className="m-0 text-[24px] font-semibold text-[#111111]">접근 권한이 없습니다</h2>
                <p className="mt-4 mb-0 text-[16px] font-medium text-[#555555]">
                    관리자 계정으로 로그인해야 볼 수 있는 페이지입니다.
                </p>
            </section>
        );
    }

    return (
        <section className="min-h-[320px] rounded-[40px] border border-[#e5e7eb] bg-white p-12">
            <h2 className="m-0 text-[24px] font-semibold text-[#111111]">관리자 페이지</h2>

            <nav className="mt-6 flex flex-wrap gap-2">
                {categories.map((item) => {
                    const selected = item.id === category;

                    return (
                        <button
                            className={`inline-flex h-10 items-center justify-center rounded-md border px-4 text-sm font-semibold ${
                                selected
                                    ? 'border-[#1457ff] bg-[#eff6ff] text-[#111827]'
                                    : 'border-[#d1d5db] bg-white text-[#4b5563]'
                            }`}
                            key={item.id}
                            onClick={() => setCategory(item.id)}
                            type="button"
                        >
                            {item.label}
                        </button>
                    );
                })}
            </nav>

            <div className="mt-8">
                {category === 'api-usage' ? (
                    <ApiUsagePanel />
                ) : (
                    <p className="m-0 text-[16px] font-medium text-[#555555]">
                        관리자 계정에서만 표시되는 전용 페이지입니다. 위 카테고리에서 항목을 선택하세요.
                    </p>
                )}
            </div>
        </section>
    );
}

export default AdminPage;
