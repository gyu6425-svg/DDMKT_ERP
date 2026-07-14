import { useState, type FormEvent } from 'react';
import Button from '../components/Button';
import { hasSupabaseConfig } from '../lib/supabase';
import { requestSignup, type SignupRole } from '../api/signup';

const inputClass =
    'h-[59px] w-[400px] max-w-full rounded-xl border border-[#cfcfcf] bg-white px-[13px] text-[20px] font-medium text-[#333333] outline-none placeholder:text-[20px] placeholder:font-medium placeholder:text-[#999999] focus:border-[#ff5a00]';

const goLogin = () => {
    window.location.href = '/login';
};

// 회원가입 — 고객(viewer)/기자단(reporter) 셀프 가입. 가입=관리자 승인 대기(비활성) → 승인 후 이용.
//   로그인 화면과 동일한 톤(든든한마케팅 · 주황 포인트 · 큰 라운드 인풋).
function SignupPage() {
    const [role, setRole] = useState<SignupRole>('viewer');
    const [login, setLogin] = useState('');
    const [password, setPassword] = useState('');
    const [password2, setPassword2] = useState('');
    const [name, setName] = useState('');
    const [company, setCompany] = useState('');
    const [bizNo, setBizNo] = useState('');
    const [phone, setPhone] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [done, setDone] = useState(false);

    async function handleSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setError('');
        if (!login.trim()) return setError('아이디를 입력하세요.');
        if (password.length < 6) return setError('비밀번호는 6자 이상이어야 합니다.');
        if (password !== password2) return setError('비밀번호가 일치하지 않습니다.');
        if (role === 'reporter' && !name.trim()) return setError('이름을 입력하세요.');
        if (role === 'viewer' && !company.trim()) return setError('업체명을 입력하세요.');
        setLoading(true);
        const { ok, error: err } = await requestSignup({
            login: login.trim(),
            password,
            // 고객은 담당자명 없이 업체명을 표시 이름으로 사용.
            name: role === 'viewer' ? company.trim() : name.trim(),
            role,
            company: company.trim() || undefined,
            bizNo: bizNo.trim() || undefined,
            phone: phone.trim() || undefined,
        });
        setLoading(false);
        if (!ok) return setError(err || '가입에 실패했습니다.');
        setDone(true);
    }

    return (
        <main className="grid min-h-svh content-center justify-items-center gap-7 bg-[#f3f3f3] p-8">
            <h1 className="m-0 text-[48px] leading-[1.2] font-semibold text-[#333333] max-[800px]:text-[38px]">
                든든한마케팅
            </h1>

            <section className="grid w-full max-w-[560px] items-center gap-4 rounded-[8px] bg-white px-20 py-[46px] max-[800px]:px-5 max-[800px]:py-9">
                {done ? (
                    <div className="grid gap-3 text-center">
                        <div className="text-[22px] font-bold text-[#333333]">가입 신청 완료</div>
                        <p className="m-0 text-[15px] leading-7 text-[#666666]">
                            관리자 승인 후 이용할 수 있습니다. 승인되면 입력하신 아이디/비밀번호로 로그인하세요.
                            <br />
                            {role === 'viewer'
                                ? '입력하신 업체 정보로 담당자가 확인 후 연결합니다.'
                                : '담당자가 담당 블로그를 배정한 뒤 이용 가능합니다.'}
                        </p>
                        <Button className="mt-2 w-full" onClick={goLogin} type="button">
                            로그인 화면으로
                        </Button>
                    </div>
                ) : (
                    <form className="grid gap-3.5" onSubmit={handleSubmit}>
                        <div className="text-center text-[22px] font-bold text-[#333333]">회원가입</div>

                        {/* 가입 유형 — 고객 / 기자단 */}
                        <div className="grid grid-cols-2 gap-2">
                            {(
                                [
                                    ['viewer', '고객'],
                                    ['reporter', '기자단'],
                                ] as [SignupRole, string][]
                            ).map(([k, label]) => (
                                <button
                                    className={`h-[52px] rounded-xl border text-[18px] font-bold transition ${
                                        role === k
                                            ? 'border-[#ff5a00] bg-[#fff6f1] text-[#ff5a00]'
                                            : 'border-[#cfcfcf] bg-white text-[#999999]'
                                    }`}
                                    key={k}
                                    onClick={() => setRole(k)}
                                    type="button"
                                >
                                    {label}
                                </button>
                            ))}
                        </div>

                        <input
                            autoComplete="username"
                            className={inputClass}
                            onChange={(e) => setLogin(e.target.value)}
                            placeholder="아이디"
                            value={login}
                        />
                        <input
                            autoComplete="new-password"
                            className={inputClass}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="비밀번호(6자 이상)"
                            type="password"
                            value={password}
                        />
                        <input
                            autoComplete="new-password"
                            className={inputClass}
                            onChange={(e) => setPassword2(e.target.value)}
                            placeholder="비밀번호 확인"
                            type="password"
                            value={password2}
                        />
                        {/* 이름 — 기자단만(고객은 업체명을 이름으로 사용) */}
                        {role === 'reporter' ? (
                            <input
                                className={inputClass}
                                onChange={(e) => setName(e.target.value)}
                                placeholder="이름"
                                value={name}
                            />
                        ) : null}
                        {role === 'viewer' ? (
                            <>
                                <input
                                    className={inputClass}
                                    onChange={(e) => setCompany(e.target.value)}
                                    placeholder="업체명"
                                    value={company}
                                />
                                <input
                                    className={inputClass}
                                    onChange={(e) => setBizNo(e.target.value)}
                                    placeholder="사업자등록번호(선택)"
                                    value={bizNo}
                                />
                            </>
                        ) : null}
                        <input
                            autoComplete="tel"
                            className={inputClass}
                            onChange={(e) => setPhone(e.target.value)}
                            placeholder="연락처(선택)"
                            value={phone}
                        />

                        {error ? <p className="m-0 text-[15px] text-[#b91c1c]">{error}</p> : null}
                        {!hasSupabaseConfig ? (
                            <p className="m-0 text-sm text-[#b91c1c]">Supabase 연결값이 없습니다.</p>
                        ) : null}

                        <Button
                            className="mt-2 w-full"
                            disabled={loading || !hasSupabaseConfig}
                            type="submit"
                        >
                            {loading ? '가입 신청 중' : '가입 신청'}
                        </Button>
                        <button
                            className="text-center text-[15px] font-medium text-[#999999] hover:text-[#ff5a00]"
                            onClick={goLogin}
                            type="button"
                        >
                            이미 계정이 있으신가요? 로그인
                        </button>
                        <p className="m-0 text-center text-[13px] leading-6 text-[#999999]">
                            가입 후 관리자 승인이 완료되어야 이용할 수 있습니다.
                        </p>
                    </form>
                )}
            </section>
        </main>
    );
}

export default SignupPage;
