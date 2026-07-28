import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

// 고객 ERP 내 '발행 프로그램(에이전트) 설치' — 다운로드 + 설정파일(agent.env) 자동생성 + 안내.
//   인증 = 고객 자기 계정(viewer). 발행측 RLS 가 고객 스코프로 열려 있어야 함(cpq 고객 발행 처리 정책).
//   ⚠️ 에이전트 zip 은 우리가 호스팅(Supabase storage 공개버킷 등) — 아래 AGENT_DOWNLOAD_URL 에 지정.
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
// 에이전트 zip 다운로드(자격 없는 배포본). ⚠️ 임시=구글드라이브 직접다운로드 링크(무료 Supabase 50MB 초과라).
//   나중에 Cloudflare R2 등 영구 호스팅으로 교체 권장.
const AGENT_DOWNLOAD_URL = 'https://drive.usercontent.google.com/download?id=11-L0eNvzyO8VnKVFt1nRCRvqPUJK38M0&export=download&confirm=t';
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
const GENERATE_API = 'https://ddmkt-erp.pages.dev/api/generate-cafe';

export function CafeAgentSetup({ companyKey, board }: { companyKey: string | null; board: string | null }) {
    const [open, setOpen] = useState(false);
    const [email, setEmail] = useState('');
    const [writeUrl, setWriteUrl] = useState('');
    const [password, setPassword] = useState('');

    useEffect(() => {
        void supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? ''));
    }, []);

    function buildEnv(): string {
        return [
            '# DDMKT 카페 발행 에이전트 설정 (자동생성) — 이 파일을 압축 푼 폴더에 넣으세요.',
            `CAFE_WRITE_URL=${writeUrl.trim()}`,
            `CAFE_BOARDS=${board ?? ''}`,
            `CAFE_BOARD=${board ?? ''}`,
            `CAFE_COMPANY=${companyKey ?? ''}`,
            'CAFE_CDP=http://127.0.0.1:9223',
            'CAFE_PROFILE=chrome_profile',
            `CAFE_GENERATE_API=${GENERATE_API}`,
            'CAFE_NO_SEND=0',
            'CAFE_START_AT=00:00',
            'CAFE_STOP_AT=23:59',
            'CAFE_MIN_GAP_MIN=30',
            'CAFE_MAX_GAP_MIN=60',
            `SUPABASE_URL=${SUPABASE_URL}`,
            `SUPABASE_PUBLISHABLE_KEY=${SUPABASE_PUBLISHABLE_KEY}`,
            `SUPABASE_AUTH_EMAIL=${email}`,
            `SUPABASE_AUTH_PASSWORD=${password}`,
            '',
        ].join('\r\n');
    }

    const [copied, setCopied] = useState(false);
    function downloadEnv() {
        const blob = new Blob([buildEnv()], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = 'agent.env'; a.click();
        URL.revokeObjectURL(url);
    }
    async function copyEnv() {
        try {
            await navigator.clipboard.writeText(buildEnv());
            setCopied(true); setTimeout(() => setCopied(false), 2000);
        } catch { /* clipboard 차단 시 아래 textarea 에서 직접 복사 */ }
    }

    const ready = Boolean(writeUrl.trim() && password.trim());
    const inputCls = 'h-10 rounded-lg border border-[#cbd5e1] bg-white px-3 text-sm';

    return (
        <div className="rounded-xl border border-[#c7d2fe] bg-[#eef2ff] p-4">
            <button className="flex w-full items-center justify-between text-left" onClick={() => setOpen((v) => !v)} type="button">
                <span className="text-[13px] font-bold text-[#3730a3]">🖥️ 발행 프로그램 설치 (최초 1회)</span>
                <span className="text-xs text-[#6366f1]">{open ? '접기' : '펼치기'}</span>
            </button>

            {open ? (
                <div className="mt-3 grid gap-4">
                    <div className="text-sm text-[#475569]">
                        카페에 자동으로 글을 올리려면 내 PC에 발행 프로그램을 한 번 설치해야 합니다. 아래 순서대로 진행하세요.
                    </div>

                    {/* 1. 다운로드 */}
                    <div className="rounded-lg border border-[#e0e7ff] bg-white p-3">
                        <div className="mb-1 text-xs font-bold text-[#4338ca]">1. 프로그램 다운로드</div>
                        {AGENT_DOWNLOAD_URL ? (
                            <a className="inline-flex h-9 items-center rounded-lg bg-[#4338ca] px-4 text-sm font-bold text-white" href={AGENT_DOWNLOAD_URL} rel="noreferrer" target="_blank">발행 프로그램 다운로드</a>
                        ) : (
                            <span className="text-sm text-[#64748b]">다운로드 링크는 담당자에게 문의해 주세요.</span>
                        )}
                        <p className="m-0 mt-1 text-xs text-[#94a3b8]">받은 zip 을 압축 풀면 DDMKT-Agent 폴더가 생깁니다. (크롬 설치 필요)</p>
                    </div>

                    {/* 2. 설정파일 */}
                    <div className="rounded-lg border border-[#e0e7ff] bg-white p-3">
                        <div className="mb-2 text-xs font-bold text-[#4338ca]">2. 설정 파일 만들기</div>
                        <div className="grid gap-2 sm:grid-cols-2">
                            <label className="grid gap-1 text-[11px] font-semibold text-[#475569]">내 카페 글쓰기 주소 (필수)
                                <input className={inputCls} onChange={(e) => setWriteUrl(e.target.value)} placeholder="카페에서 '글쓰기' 열었을 때 주소창 URL" value={writeUrl} />
                            </label>
                            <label className="grid gap-1 text-[11px] font-semibold text-[#475569]">내 로그인 비밀번호 (이 ERP)
                                <input className={inputCls} onChange={(e) => setPassword(e.target.value)} placeholder="지금 로그인한 비밀번호" type="password" value={password} />
                            </label>
                        </div>
                        <div className="mt-1 text-[11px] text-[#94a3b8]">계정: {email || '(불러오는 중)'} · 게시판: {board ?? '—'}</div>
                        <div className="mt-2 flex flex-wrap gap-2">
                            <button className="h-9 rounded-lg bg-[#0f766e] px-4 text-sm font-bold text-white disabled:opacity-50" disabled={!ready} onClick={downloadEnv} type="button">설정 파일 다운로드</button>
                            <button className="h-9 rounded-lg border border-[#0f766e] px-4 text-sm font-bold text-[#0f766e] disabled:opacity-50" disabled={!ready} onClick={copyEnv} type="button">{copied ? '복사됨 ✓' : '설정 내용 복사'}</button>
                        </div>
                        {ready ? (
                            <div className="mt-2">
                                <p className="m-0 mb-1 text-[11px] text-[#94a3b8]">다운로드가 막히면(보안 프로그램) 아래 내용을 <b>복사</b> → 메모장에 붙여넣고 폴더에 <b>agent.env</b>(모든 파일·UTF-8)로 저장하세요.</p>
                                <textarea className="h-40 w-full rounded-lg border border-[#cbd5e1] bg-[#f8fafc] px-3 py-2 font-mono text-[11px] leading-snug" readOnly value={buildEnv()} />
                            </div>
                        ) : (
                            <p className="m-0 mt-1 text-[11px] text-[#94a3b8]">위 2칸(글쓰기 주소·비밀번호)을 채우면 설정 내용이 만들어집니다.</p>
                        )}
                    </div>

                    {/* 3. 실행 */}
                    <div className="rounded-lg border border-[#e0e7ff] bg-white p-3">
                        <div className="mb-1 text-xs font-bold text-[#4338ca]">3. 실행</div>
                        <ol className="m-0 grid list-decimal gap-1 pl-5 text-sm text-[#475569]">
                            <li><b>1-로그인.bat</b> 실행 → 내 카페 계정으로 네이버 로그인 → 창 닫기 (최초 1회)</li>
                            <li><b>2-시작.bat</b> 실행 → 검은 창이 뜨면 완료 (창은 닫지 말고 최소화)</li>
                        </ol>
                        <p className="m-0 mt-1 text-[11px] text-[#94a3b8]">이후 이 화면에서 발행하면 프로그램이 자동으로 카페에 올립니다.</p>
                    </div>
                </div>
            ) : null}
        </div>
    );
}
