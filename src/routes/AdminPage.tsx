import { useAuth } from '../hooks/useAuth';

function AdminPage() {
    const { isAdmin } = useAuth();

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
            <p className="mt-4 mb-0 text-[16px] font-medium text-[#555555]">
                관리자 계정에서만 표시되는 전용 페이지입니다.
            </p>
        </section>
    );
}

export default AdminPage;
