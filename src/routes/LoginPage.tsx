import { useState, type FormEvent } from 'react';
import { signInWithPassword } from '../api/auth';
import Button from '../components/Button';
import { hasSupabaseConfig } from '../lib/supabase';

const inputClass =
    'h-[59px] w-[400px] max-w-full rounded-xl border border-[#cfcfcf] bg-white px-[13px] text-[20px] font-medium text-[#333333] outline-none placeholder:text-[20px] placeholder:font-medium placeholder:text-[#999999] focus:border-[#ff5a00]';

function LoginPage() {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [errorMessage, setErrorMessage] = useState('');
    const [loading, setLoading] = useState(false);

    async function handleLogin(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setErrorMessage('');
        setLoading(true);
        const { error } = await signInWithPassword(email, password);
        setLoading(false);
        if (error) {
            setErrorMessage('이메일 또는 비밀번호가 올바르지 않습니다.');
            return;
        }
        window.location.href = '/dashboard';
    }

    return (
        <main className="grid min-h-svh content-center justify-items-center gap-7 bg-[#f3f3f3] p-8">
            <h1 className="m-0 text-[48px] leading-[1.2] font-semibold text-[#333333] max-[800px]:text-[38px]">
                든든한마케팅
            </h1>

            <section className="grid min-h-[228px] w-full max-w-[560px] items-center rounded-[8px] bg-white px-20 py-[46px] max-[800px]:px-5 max-[800px]:py-9">
                <form className="grid gap-3.5" onSubmit={handleLogin}>
                    <input
                        aria-label="이메일"
                        autoComplete="email"
                        className={inputClass}
                        id="email"
                        onChange={(event) => setEmail(event.target.value)}
                        placeholder="이메일"
                        required
                        type="email"
                        value={email}
                    />
                    <input
                        aria-label="비밀번호"
                        autoComplete="current-password"
                        className={inputClass}
                        id="password"
                        onChange={(event) => setPassword(event.target.value)}
                        placeholder="비밀번호"
                        required
                        type="password"
                        value={password}
                    />
                    <div className="mt-3.5 flex justify-center gap-3 max-[800px]:flex-col max-[800px]:items-center">
                        <Button disabled={loading || !hasSupabaseConfig} type="submit" className="w-full">
                            {loading ? '로그인 중' : '로그인'}
                        </Button>
                    </div>
                    <p className="text-center text-sm text-[#999999]">
                        초기 비밀번호는 아이디(이메일 앞부분)와 동일합니다. 로그인 후 변경하세요.
                    </p>
                </form>

                {!hasSupabaseConfig ? (
                    <p className="mt-4 text-sm leading-6 text-[#b91c1c]">
                        Supabase 연결값이 없습니다. .env 파일에 VITE_SUPABASE_URL,
                        VITE_SUPABASE_PUBLISHABLE_KEY를 입력한 뒤 dev 서버를 다시 시작하세요.
                    </p>
                ) : null}
                {errorMessage ? <p className="mt-4 text-[#b91c1c]">{errorMessage}</p> : null}
            </section>
        </main>
    );
}

export default LoginPage;
