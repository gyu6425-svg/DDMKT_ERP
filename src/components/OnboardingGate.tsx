import { useState } from 'react';
import { AUTH_DISABLED } from '../lib/authConfig';
import { useAuth } from '../hooks/useAuth';
import { submitKakaoOnboarding } from '../api/auth';

// 카카오 가입 온보딩 — 카카오로 처음 로그인하면(비활성 스텁 프로필 + 온보딩 미완료) 이 화면만 보인다.
//   고객/기자단 + 업체명·이름 + 연락처를 받아 본인 프로필에 저장(kakao_onboard RPC) → 승인 대기로 넘어감.
export default function OnboardingGate() {
    const { needsOnboarding, user, signOut } = useAuth();
    const [role, setRole] = useState<'viewer' | 'reporter'>('viewer');
    const [name, setName] = useState('');
    const [phone, setPhone] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    if (AUTH_DISABLED || !user || !needsOnboarding) return null;

    const submit = async () => {
        setError('');
        if (!name.trim()) return setError(role === 'viewer' ? '업체명을 입력하세요.' : '이름을 입력하세요.');
        setLoading(true);
        const { error: err } = await submitKakaoOnboarding(role, name, phone);
        setLoading(false);
        if (err) return setError('저장 실패: ' + err.message);
        // 프로필이 갱신되도록 새로고침 → 승인 대기 화면으로 이동.
        window.location.reload();
    };

    const inputCls =
        'h-[52px] w-full rounded-xl border border-[#cfcfcf] bg-white px-[13px] text-[17px] font-medium text-[#333333] outline-none placeholder:text-[#999999] focus:border-[#ff5a00]';

    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-[#f3f3f3] p-6">
            <div className="w-[min(480px,94vw)] rounded-2xl bg-white p-8 shadow-sm">
                <h3 className="m-0 text-center text-[22px] font-bold text-[#333333]">가입 정보 입력</h3>
                <p className="mt-2 mb-5 text-center text-[14px] leading-6 text-[#666666]">
                    카카오로 로그인하셨습니다. 아래 정보를 입력하면 관리자 승인 후 이용할 수 있습니다.
                </p>

                <div className="grid gap-3">
                    {/* 유형 — 고객 / 기자단 */}
                    <div className="grid grid-cols-2 gap-2">
                        {([['viewer', '고객'], ['reporter', '기자단']] as [typeof role, string][]).map(([k, label]) => (
                            <button
                                key={k}
                                type="button"
                                onClick={() => setRole(k)}
                                className={`h-[50px] rounded-xl border text-[17px] font-bold transition ${
                                    role === k
                                        ? 'border-[#ff5a00] bg-[#fff6f1] text-[#ff5a00]'
                                        : 'border-[#cfcfcf] bg-white text-[#999999]'
                                }`}
                            >
                                {label}
                            </button>
                        ))}
                    </div>
                    <input
                        className={inputCls}
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder={role === 'viewer' ? '업체명' : '이름'}
                    />
                    <input
                        className={inputCls}
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        placeholder="연락처(선택)"
                        autoComplete="tel"
                    />
                    {error ? <p className="m-0 text-[14px] text-[#b91c1c]">{error}</p> : null}
                    <button
                        type="button"
                        disabled={loading}
                        onClick={() => void submit()}
                        className="mt-1 h-[52px] w-full rounded-xl bg-[#ff5a00] text-[17px] font-bold text-white hover:bg-[#e85200] disabled:opacity-50"
                    >
                        {loading ? '저장 중…' : '가입 신청'}
                    </button>
                    <button
                        type="button"
                        onClick={() => void signOut()}
                        className="text-center text-[14px] font-medium text-[#999999] hover:text-[#ff5a00]"
                    >
                        로그아웃
                    </button>
                </div>
            </div>
        </div>
    );
}
