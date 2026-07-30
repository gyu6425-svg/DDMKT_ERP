import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { listDeployCredentials, listCafeDeployRequests } from '../../api/cafeDeployRequests';
import type { CafeAccount } from '../../api/cafeAccounts';

// 담당자 발행 세팅(모델 B: 우리가 대신 발행) — 네이버 계정 확인 + 2단계 대응 + 글쓰기URL 저장 + agent.env 생성 + 발행 승인.
export function DeployPublishSetupModal({ account, onClose, onSaved }: {
    account: CafeAccount; onClose: () => void; onSaved: () => void;
}) {
    const [naverId, setNaverId] = useState('');
    const [naverPw, setNaverPw] = useState('');
    const [twoFactor, setTwoFactor] = useState(false);
    const [showPw, setShowPw] = useState(false);
    const [writeUrl, setWriteUrl] = useState((account as { write_url?: string }).write_url || '');
    const [pubEnabled, setPubEnabled] = useState(!!account.publish_enabled);
    const [msg, setMsg] = useState('');
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        if (!account.client_id) return;
        void listDeployCredentials(account.client_id).then(({ data }) => {
            const c = data[0];
            if (c) { setNaverId(c.naver_id || ''); setNaverPw(c.naver_pw || ''); }
        });
        void listCafeDeployRequests(account.client_id).then(({ data }) => {
            const r = data.find((x) => x.two_factor);
            if (r) setTwoFactor(true);
        });
    }, [account.client_id]);

    const clubFromUrl = (u: string) => (u.match(/cafes\/(\d+)|clubid=(\d+)|(\d{6,})/) ? u.replace(/\D/g, '').slice(0, 12) : '');

    const saveWriteUrl = async () => {
        setBusy(true); setMsg('');
        const patch: Record<string, unknown> = { write_url: writeUrl.trim() || null };
        const cid = clubFromUrl(writeUrl);
        if (cid) patch.club_id = cid;
        const { error } = await supabase.from('cafe_accounts').update(patch).eq('id', account.id);
        setBusy(false);
        setMsg(error ? '저장 실패: ' + error.message : '글쓰기 주소 저장 완료' + (cid ? ` (club_id ${cid})` : ''));
        if (!error) onSaved();
    };

    const togglePublish = async () => {
        const next = !pubEnabled;
        setBusy(true); setMsg('');
        const { error } = await supabase.from('cafe_accounts').update({ publish_enabled: next }).eq('id', account.id);
        setBusy(false);
        if (error) return setMsg('발행 승인 변경 실패: ' + error.message);
        setPubEnabled(next); setMsg(next ? '발행 승인 ON → 고객에 자동화 발행 탭 노출됨' : '발행 승인 OFF');
        onSaved();
    };

    const board = account.board_name || '';
    const agentEnv = [
        `# DDMKT 카페 발행 에이전트 (우리 발행 PC) — ${account.display_name}`,
        `CAFE_WRITE_URL=${writeUrl.trim()}`,
        `CAFE_BOARDS=${board}`,
        `CAFE_BOARD=${board}`,
        `CAFE_COMPANY=${account.company_key}`,
        `CAFE_CDP=http://127.0.0.1:9223   # 이 카페 전용 포트로 조정(계정마다 분리)`,
        `CAFE_PROFILE=chrome_profile_${account.company_key}`,
        'CAFE_NO_SEND=0',
        'CAFE_START_AT=10:00',
        'CAFE_STOP_AT=19:00',
        'CAFE_MIN_GAP_MIN=55',
        'CAFE_MAX_GAP_MIN=90',
        'CAFE_DAILY_CAP=3',
        `# 네이버 로그인: 위 프로필 크롬에 이 계정으로 1회 로그인(2단계면 해제/기기등록)`,
        `#   네이버 아이디: ${naverId || '(미입력)'}`,
        '# Supabase/서비스키는 발행 PC 공용 .env 사용',
        '',
    ].join('\r\n');

    const downloadEnv = () => {
        const blob = new Blob([agentEnv], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `agent_${account.company_key}.env`; a.click();
        URL.revokeObjectURL(url);
    };

    const box = 'rounded-lg border border-[#e2e8f0] p-3';
    const lbl = 'mb-1 text-[12px] font-semibold text-[#64748b]';
    return (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4" onClick={onClose}>
            <div className="mt-8 w-full max-w-2xl rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
                <div className="mb-4 flex items-center justify-between">
                    <div>
                        <div className="text-[17px] font-bold text-[#0f172a]">발행 세팅 — {account.display_name}</div>
                        <div className="text-[12px] text-[#64748b]">카페 {account.cafe_name} · 게시판 {board || '—'} · 우리가 대신 발행(모델 B)</div>
                    </div>
                    <button className="text-[#94a3b8] hover:text-[#334155]" onClick={onClose} type="button">✕</button>
                </div>

                <div className="grid gap-3">
                    {/* 네이버 계정 */}
                    <div className={box}>
                        <div className={lbl}>네이버 계정 (발행 PC 로그인용) 🔒</div>
                        {account.client_id ? (
                            naverId || naverPw ? (
                                <div className="flex flex-wrap items-center gap-3 text-sm">
                                    <span>아이디: <b>{naverId || '-'}</b></span>
                                    <span>비번: <b className="font-mono">{showPw ? (naverPw || '-') : '••••••'}</b></span>
                                    <button className="rounded border border-[#cbd5e1] px-2 py-0.5 text-xs text-[#475569]" onClick={() => setShowPw((v) => !v)} type="button">{showPw ? '가리기' : '보기'}</button>
                                    <button className="rounded border border-[#cbd5e1] px-2 py-0.5 text-xs text-[#475569]" onClick={() => void navigator.clipboard.writeText(naverPw)} type="button">비번 복사</button>
                                </div>
                            ) : <div className="text-[13px] text-[#94a3b8]">접수에 네이버 계정이 없습니다.</div>
                        ) : <div className="text-[13px] text-[#94a3b8]">이 카페에 연결된 고객(client)이 없습니다.</div>}
                    </div>

                    {/* 2단계 인증 */}
                    {twoFactor ? (
                        <div className="rounded-lg border-2 border-[#f59e0b] bg-[#fffbeb] p-3">
                            <div className="text-[13px] font-bold text-[#92400e]">⚠️ 네이버 2단계 인증 사용 중</div>
                            <p className="m-0 mt-1 text-[12px] text-[#92400e]">자동 로그인이 막힙니다. 대응: ① 고객에게 2단계 해제 요청, 또는 ② 발행 PC에서 1회 수동 로그인 후 기기 등록·세션 유지.</p>
                        </div>
                    ) : null}

                    {/* 글쓰기 주소 */}
                    <div className={box}>
                        <div className={lbl}>글쓰기 주소 (URL) — club_id·게시판 menu 포함</div>
                        <div className="flex gap-2">
                            <input className="h-9 flex-1 rounded border border-[#cbd5e1] px-2 text-sm" placeholder="https://cafe.naver.com/ca-fe/cafes/00000000/menus/0/articles/write?boardType=L" value={writeUrl} onChange={(e) => setWriteUrl(e.target.value)} />
                            <button className="h-9 rounded-md bg-[#4338ca] px-4 text-xs font-bold text-white disabled:opacity-50" disabled={busy || !writeUrl.trim()} onClick={() => void saveWriteUrl()} type="button">저장</button>
                        </div>
                        <p className="m-0 mt-1 text-[11px] text-[#94a3b8]">그 카페에서 '글쓰기'를 열었을 때 주소창 URL. 저장 시 club_id 자동 추출.</p>
                    </div>

                    {/* agent.env */}
                    <div className={box}>
                        <div className="mb-2 flex items-center justify-between">
                            <div className={lbl}>발행 에이전트 설정 (agent.env)</div>
                            <div className="flex gap-2">
                                <button className="rounded border border-[#cbd5e1] px-2 py-1 text-xs font-semibold text-[#475569]" onClick={() => void navigator.clipboard.writeText(agentEnv)} type="button">복사</button>
                                <button className="rounded bg-[#0f766e] px-3 py-1 text-xs font-bold text-white" onClick={downloadEnv} type="button">다운로드</button>
                            </div>
                        </div>
                        <textarea className="h-40 w-full rounded border border-[#e2e8f0] bg-[#f8fafc] p-2 font-mono text-[11px]" readOnly value={agentEnv} />
                    </div>

                    {/* 발행 승인 */}
                    <div className="flex items-center justify-between rounded-lg border border-[#e2e8f0] p-3">
                        <div>
                            <div className="text-[13px] font-bold text-[#334155]">발행 승인 (고객 자동화 발행 탭 노출)</div>
                            <div className="text-[11px] text-[#94a3b8]">켜면 고객 뷰에 '카페 자동화 발행' 탭이 뜹니다. 세팅(글쓰기URL·로그인) 후 켜세요.</div>
                        </div>
                        <button className={`h-8 w-16 rounded-full text-xs font-bold ${pubEnabled ? 'bg-[#059669] text-white' : 'bg-[#e2e8f0] text-[#64748b]'}`} disabled={busy} onClick={() => void togglePublish()} type="button">{pubEnabled ? 'ON' : 'OFF'}</button>
                    </div>

                    {msg ? <div className="text-[13px] text-[#1e40af]">{msg}</div> : null}
                </div>
            </div>
        </div>
    );
}
