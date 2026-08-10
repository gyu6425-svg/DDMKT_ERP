import { useEffect, useState } from 'react';
import { submitCafeRequest, listMyCafeRequests, type CafeRequest } from '../../api/cafeRequests';

// 카페 자동발행 '승인 요청' — 아직 승인 안 된 고객이 카페 정보를 제출한다.
//   제출 → 내부가 검토·등록·승인 → 승인되면 이 화면 대신 발행 스튜디오가 뜬다.
export function CafeCustomerRequest({ clientId }: { clientId: string | null }) {
    const [cafeName, setCafeName] = useState('');
    const [cafeUrl, setCafeUrl] = useState('');
    const [boardName, setBoardName] = useState('');
    const [business, setBusiness] = useState('');
    const [note, setNote] = useState('');
    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
    const [reqs, setReqs] = useState<CafeRequest[]>([]);

    async function loadReqs() {
        const { data } = await listMyCafeRequests(5);
        setReqs(data);
    }
    useEffect(() => { void loadReqs(); }, []);

    const pending = reqs.find((r) => r.status === 'pending');

    async function submit() {
        if (!clientId) { setMsg({ ok: false, text: '계정 정보를 불러오지 못했습니다. 새로고침 후 다시 시도해 주세요.' }); return; }
        if (!cafeName.trim() && !cafeUrl.trim()) { setMsg({ ok: false, text: '카페 이름 또는 카페 주소를 입력해 주세요.' }); return; }
        setBusy(true); setMsg(null);
        const { error } = await submitCafeRequest(clientId, {
            cafe_name: cafeName.trim(), cafe_url: cafeUrl.trim(), board_name: boardName.trim(),
            business: business.trim(), note: note.trim(),
        });
        setBusy(false);
        if (error) { setMsg({ ok: false, text: (error as { message?: string }).message || '신청에 실패했습니다.' }); return; }
        setMsg({ ok: true, text: '신청이 접수되었습니다. 담당자 검토 후 승인되면 이 화면에서 바로 발행할 수 있습니다.' });
        setCafeName(''); setCafeUrl(''); setBoardName(''); setBusiness(''); setNote('');
        void loadReqs();
    }

    const inputCls = 'h-10 rounded-lg border border-[#cbd5e1] bg-white px-3 text-sm';

    return (
        <div className="grid gap-4">
            <div className="rounded-xl border border-[#dbeafe] bg-[#eff6ff] px-5 py-4">
                <div className="text-base font-bold text-[#1e40af]">카페 자동화 발행 신청</div>
                <p className="m-0 mt-1 text-sm text-[#475569]">
                    내 카페에 자동으로 글을 발행하는 기능입니다. 아래 정보를 남겨 주시면 담당자가 확인 후 승인해 드립니다.
                    승인되면 이 화면에서 바로 원고 생성·발행이 가능합니다.
                </p>
            </div>

            {pending ? (
                <div className="rounded-lg border border-[#fde68a] bg-[#fffbeb] px-4 py-3 text-sm text-[#92400e]">
                    ⏳ 신청이 접수되어 <b>승인 대기 중</b>입니다. (신청일 {new Date(pending.created_at).toLocaleDateString('ko-KR')})
                    담당자 승인 후 자동으로 발행 화면이 열립니다.
                </div>
            ) : null}

            <div className="rounded-xl border border-[#e2e8f0] bg-white p-4">
                <div className="mb-3 text-[13px] font-bold text-[#334155]">신청 정보</div>
                <div className="grid gap-3 sm:grid-cols-2">
                    <label className="grid gap-1 text-xs font-semibold text-[#475569]">
                        카페 이름
                        <input className={inputCls} onChange={(e) => setCafeName(e.target.value)} placeholder="예) 수원맘 카페" value={cafeName} />
                    </label>
                    <label className="grid gap-1 text-xs font-semibold text-[#475569]">
                        카페 주소 (URL)
                        <input className={inputCls} onChange={(e) => setCafeUrl(e.target.value)} placeholder="예) https://cafe.naver.com/..." value={cafeUrl} />
                    </label>
                    <label className="grid gap-1 text-xs font-semibold text-[#475569]">
                        발행할 게시판명
                        <input className={inputCls} onChange={(e) => setBoardName(e.target.value)} placeholder="예) 업체 홍보 게시판" value={boardName} />
                    </label>
                    <label className="grid gap-1 text-xs font-semibold text-[#475569]">
                        업종
                        <input className={inputCls} onChange={(e) => setBusiness(e.target.value)} placeholder="예) 입주청소" value={business} />
                    </label>
                    <label className="grid gap-1 text-xs font-semibold text-[#475569] sm:col-span-2">
                        메모 / 요청사항 (선택)
                        <textarea className="min-h-[80px] rounded-lg border border-[#cbd5e1] bg-white px-3 py-2 text-sm font-normal" onChange={(e) => setNote(e.target.value)} placeholder="발행 주기, 원하는 스타일 등 자유롭게" value={note} />
                    </label>
                </div>

                {msg ? (
                    <div className={`mt-3 rounded-lg px-4 py-3 text-sm ${msg.ok ? 'bg-[#ecfdf5] text-[#047857]' : 'bg-[#fef2f2] text-[#b91c1c]'}`}>{msg.text}</div>
                ) : null}

                <button
                    className="mt-3 h-10 rounded-lg bg-[#1e40af] px-5 text-sm font-bold text-white hover:bg-[#1e3a8a] disabled:opacity-50"
                    disabled={busy}
                    onClick={submit}
                    type="button"
                >
                    {busy ? '신청 중…' : '승인 요청'}
                </button>
            </div>
        </div>
    );
}
