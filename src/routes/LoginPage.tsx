import { useState, type FormEvent } from 'react';
import { sendOtp, verifyEmailOtp } from '../api/auth';
import Button from '../components/Button';
import { getAuthErrorMessage } from '../lib/authErrors';
import { hasSupabaseConfig } from '../lib/supabase';

type LoginStep = 'email' | 'otp';

const inputClass =
    'h-[59px] w-[400px] max-w-full rounded-xl border border-[#cfcfcf] bg-white px-[13px] text-[20px] font-medium text-[#333333] outline-none placeholder:text-[20px] placeholder:font-medium placeholder:text-[#999999] focus:border-[#ff5a00]';

function LoginPage() {
    const [email, setEmail] = useState('');
    const [errorMessage, setErrorMessage] = useState('');
    const [loading, setLoading] = useState(false);
    const [otp, setOtp] = useState('');
    const [step, setStep] = useState<LoginStep>('email');

    async function handleSendOtp(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setErrorMessage('');
        setLoading(true);

        const { error } = await sendOtp(email);

        setLoading(false);

        if (error) {
            setErrorMessage(getAuthErrorMessage());
            return;
        }

        setStep('otp');
    }

    async function handleVerifyOtp(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setErrorMessage('');
        setLoading(true);

        const { error } = await verifyEmailOtp(email, otp);

        setLoading(false);

        if (error) {
            setErrorMessage(getAuthErrorMessage());
            return;
        }

        window.location.href = '/dashboard';
    }

    return (
        <main className="grid min-h-svh content-center justify-items-center gap-7 bg-[#f3f3f3] p-8">
            <h1 className="m-0 text-[48px] leading-[1.2] font-semibold text-[#333333] max-[800px]:text-[38px]">
                든든한마케팅
            </h1>

            <section className="grid min-h-[228px] w-full max-w-[560px] items-center rounded-[26px] bg-white px-20 py-[46px] max-[800px]:px-5 max-[800px]:py-9">
                {step === 'email' ? (
                    <form className="grid gap-3.5" onSubmit={handleSendOtp}>
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
                        <div className="mt-3.5 flex justify-center gap-3 max-[800px]:flex-col max-[800px]:items-center">
                            <Button
                                disabled={loading || !hasSupabaseConfig}
                                type="submit"
                                className="w-full"
                            >
                                {loading ? '발송 중' : 'OTP 받기'}
                            </Button>
                            {/* <Button disabled type="button" variant="secondary">
                관리자 문의
              </Button> */}
                        </div>
                    </form>
                ) : (
                    <form className="grid gap-3.5" onSubmit={handleVerifyOtp}>
                        <input
                            aria-label="OTP 코드"
                            autoComplete="one-time-code"
                            className={inputClass}
                            id="otp"
                            inputMode="numeric"
                            maxLength={8}
                            onChange={(event) => setOtp(event.target.value)}
                            placeholder="OTP"
                            required
                            value={otp}
                        />
                        <div className="mt-3.5 flex justify-center gap-3 max-[800px]:flex-col max-[800px]:items-center">
                            <Button disabled={loading || !hasSupabaseConfig} type="submit">
                                {loading ? '확인 중' : '로그인'}
                            </Button>
                            <Button
                                disabled={loading}
                                onClick={() => {
                                    setErrorMessage('');
                                    setOtp('');
                                    setStep('email');
                                }}
                                type="button"
                                variant="secondary"
                            >
                                이메일 변경
                            </Button>
                        </div>
                    </form>
                )}

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
