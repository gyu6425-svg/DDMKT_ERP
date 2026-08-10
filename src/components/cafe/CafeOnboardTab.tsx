import { useEffect, useState } from 'react';
import { launchLogin, loginPing, nusu2Health } from '../../api/nusu2Bridge';

// 업체 온보딩 (신규 · 격리 탭) — code로 하던 로그인/크롬기동/카페설정을 UI 버튼으로.
//   그 PC에서 도는 브릿지(8788)가 '보이는 크롬'을 띄워 네이버 로그인 → 세션이 프로필에 저장 →
//   발행이 그 프로필+글쓰기URL 을 사용. 다른 PC(대행사)에서도 브릿지만 켜져 있으면 동작.

export function CafeOnboardTab() {
    const [profile, setProfile] = useState('chrome_profile_업체1');
    const [port, setPort] = useState('9230');
    const [writeUrl, setWriteUrl] = useState('');
    const [board, setBoard] = useState('');
    const [company, setCompany] = useState('');
    const [alive, setAlive] = useState<boolean | null>(null);
    const [bridgeUp, setBridgeUp] = useState<boolean | null>(null);
    const [msg, setMsg] = useState('');

    useEffect(() => { void nusu2Health().then(setBridgeUp); }, []);
    // 로그인 창 상태 폴링
    useEffect(() => {
        const t = setInterval(() => { void loginPing(port).then(setAlive); }, 4000);
        void loginPing(port).then(setAlive);
        return () => clearInterval(t);
    }, [port]);

    const openLogin = async () => {
        setMsg('크롬 여는 중…');
        const r = await launchLogin(profile.trim(), port.trim(), 'https://nid.naver.com/nidlogin.login');
        if (!r.ok) return setMsg(`실패: ${r.error || '브릿지(8788) 확인'}`);
        setMsg(r.already ? '이미 열려있는 창 재사용 — 그 창에서 로그인' : '크롬 열림 — 뜬 창에서 네이버 로그인하세요');
    };

    return (
        <div className="grid gap-4">
            <div className="rounded-xl border-2 border-[#0891b2] bg-[#ecfeff] p-4">
                <div className="mb-1 flex items-center gap-2 text-[13px] font-bold text-[#0e7490]">
                    🔑 업체 온보딩 — 네이버 로그인 · 카페 설정 <span className="rounded bg-[#0891b2] px-1.5 py-0.5 text-[10px] text-white">신규</span>
                </div>
                <div className="mb-3 text-[11px] leading-relaxed text-[#475569]">
                    이 PC의 브릿지가 <b>보이는 크롬</b>을 띄웁니다. 뜬 창에서 <b>발행할 네이버 계정으로 직접 로그인</b>하면 세션이 프로필에 저장돼요(비번은 저장 안 됨, 세션 쿠키만). 이후 발행이 이 프로필을 씁니다.
                    {bridgeUp === false ? <span className="ml-1 font-semibold text-[#dc2626]">· 브릿지(8788) 꺼짐 — run_nusu2_api.bat 실행 필요</span> : bridgeUp ? <span className="ml-1 font-semibold text-[#0e7490]">· 브릿지 ✓</span> : null}
                </div>

                {/* ① 로그인 */}
                <div className="grid gap-2 rounded-lg border border-[#a5f3fc] bg-white p-3">
                    <div className="text-[12px] font-bold text-[#0e7490]">① 네이버 로그인</div>
                    <div className="flex flex-wrap items-end gap-2">
                        <label className="grid gap-1">
                            <span className="text-[11px] text-[#475569]">프로필명(업체 구분)</span>
                            <input className="h-8 w-48 rounded border border-[#cbd5e1] px-2 text-sm" onChange={(e) => setProfile(e.target.value)} value={profile} />
                        </label>
                        <label className="grid gap-1">
                            <span className="text-[11px] text-[#475569]">크롬 포트(업체마다 고유)</span>
                            <input className="h-8 w-24 rounded border border-[#cbd5e1] px-2 text-sm" onChange={(e) => setPort(e.target.value)} value={port} />
                        </label>
                        <button className="h-9 rounded-md bg-[#0891b2] px-4 text-sm font-bold text-white hover:bg-[#0e7490] disabled:opacity-50" disabled={bridgeUp === false} onClick={() => void openLogin()} type="button">🔓 네이버 로그인 창 열기</button>
                        <span className={`text-[12px] font-semibold ${alive ? 'text-[#059669]' : 'text-[#94a3b8]'}`}>{alive ? '● 로그인 창 열림' : '○ 창 없음'}</span>
                    </div>
                    {msg ? <div className="text-[12px] text-[#0e7490]">{msg}</div> : null}
                </div>

                {/* ② 카페 설정 */}
                <div className="mt-2 grid gap-2 rounded-lg border border-[#a5f3fc] bg-white p-3">
                    <div className="text-[12px] font-bold text-[#0e7490]">② 카페 발행 설정</div>
                    <label className="grid gap-1">
                        <span className="text-[11px] text-[#475569]">게시판 글쓰기 URL (해당 카페 게시판의 '글쓰기' 주소)</span>
                        <input className="h-9 rounded border border-[#cbd5e1] px-2.5 text-sm" onChange={(e) => setWriteUrl(e.target.value)} placeholder="https://cafe.naver.com/ca-fe/cafes/31761053/menus/2/articles/write?boardType=L" value={writeUrl} />
                    </label>
                    <div className="flex flex-wrap gap-2">
                        <label className="grid flex-1 gap-1">
                            <span className="text-[11px] text-[#475569]">게시판명(정확히 일치)</span>
                            <input className="h-9 rounded border border-[#cbd5e1] px-2.5 text-sm" onChange={(e) => setBoard(e.target.value)} placeholder="예: 더반클린 입주청소" value={board} />
                        </label>
                        <label className="grid flex-1 gap-1">
                            <span className="text-[11px] text-[#475569]">company 키(업체 구분자)</span>
                            <input className="h-9 rounded border border-[#cbd5e1] px-2.5 text-sm" onChange={(e) => setCompany(e.target.value)} placeholder="예: durban" value={company} />
                        </label>
                    </div>
                    <div className="text-[11px] text-[#b45309]">※ 저장(레지스트리 cafe_companies)·발행 연결은 멀티업체 단계에서 이 값들을 그대로 씀 — 지금은 로그인·크롬기동 검증까지.</div>
                </div>
            </div>
        </div>
    );
}
