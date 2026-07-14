import { AUTH_DISABLED } from '../lib/authConfig';
import { useAuth } from '../hooks/useAuth';

// 승인 대기 게이트 — 회원가입 후 프로필이 비활성(is_active=false)인 계정은
//   관리자 승인 전까지 이 화면만 보인다(데이터 접근 차단, 로그아웃만 가능).
export default function PendingApprovalGate() {
    const { pending, user, signOut } = useAuth();
    if (AUTH_DISABLED || !user || !pending) return null;

    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-[#f3f3f3] p-6">
            <div className="w-[min(460px,94vw)] rounded-2xl bg-white p-8 text-center shadow-sm">
                <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[#fff6f1] text-[28px]">
                    ⏳
                </div>
                <h3 className="m-0 text-[22px] font-bold text-[#333333]">승인 대기 중입니다</h3>
                <p className="mt-3 mb-0 text-[15px] leading-7 text-[#666666]">
                    회원가입이 접수되었습니다. 관리자가 계정을 확인하고 <b>업체·담당 블로그를 연결</b>하면
                    이용할 수 있습니다.
                    <br />
                    승인 완료 후 다시 로그인해 주세요.
                </p>
                <button
                    className="mt-6 w-full rounded-xl bg-[#333333] px-4 py-3 text-[16px] font-bold text-white hover:bg-[#111111]"
                    onClick={() => void signOut()}
                    type="button"
                >
                    로그아웃
                </button>
            </div>
        </div>
    );
}
