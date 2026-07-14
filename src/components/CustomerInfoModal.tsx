import { useEffect, useState } from 'react';
import type { ErpClient } from '../api/erp';
import { totalOutsource, type ClientContract } from '../api/clientContracts';
import { useAuth } from '../hooks/useAuth';
import { getClientBilling, maskAccount, upsertClientBilling, type ClientBilling } from '../api/clientBilling';

// 고객 계정 정보 모달 — 발급된 고객 ERP 계정의 등록 정보를 카드식으로 표시.
//   기본 정보 · 업종 정보 · 세금계산서(계약에서 금액 자동 계산) 세 섹션.
const won = (n: number) => `${Math.round(n).toLocaleString('ko-KR')}원`;

export default function CustomerInfoModal({
    client,
    contracts,
    accountEmail,
    onClose,
}: {
    client: ErpClient;
    contracts: ClientContract[];
    accountEmail: string | null;
    onClose: () => void;
}) {
    // 세금계산서 금액 — 계약(client_contracts)에서 계산.
    //   공급가(실매출)=Σamount · 외주비=Σ총외주비 · 순매출=실매출−외주비 · 부가세포함=실매출×1.1.
    const lines = contracts
        .filter((ct) => (ct.amount || 0) > 0 || (ct.goal_count || 0) > 0)
        .map((ct) => {
            const sub = (ct.subtype || '').replace(/^상위노출 보장형 · /, '');
            const qty = ct.goal_count || 0;
            const unit = ct.unit_price || 0;
            const amt = ct.amount || 0;
            return { label: sub || ct.category, qty, unit, amt };
        });
    const supply = contracts.reduce((s, ct) => s + (ct.amount || 0), 0);
    const outsource = contracts.reduce((s, ct) => s + totalOutsource(ct), 0);
    const net = supply - outsource;
    // 부가세 — 계약별 no_vat(현금 등 부가세 제외) 반영. 그 외 공급가의 10%.
    const vat = contracts.reduce((s, ct) => s + (ct.no_vat ? 0 : Math.round((ct.amount || 0) * 0.1)), 0);
    const withVat = supply + vat;

    const Row = ({ k, v }: { k: string; v: string }) => (
        <div className="flex justify-between gap-3 border-b border-[#f1f5f9] py-1.5 last:border-b-0">
            <span className="shrink-0 text-[13px] text-[#94a3b8]">{k}</span>
            <span className="text-right text-[13px] font-semibold text-[#334155]">{v || '-'}</span>
        </div>
    );
    const Card = ({ title, children }: { title: string; children: React.ReactNode }) => (
        <div className="rounded-xl border border-[#e2e8f0] bg-white p-4">
            <div className="mb-1.5 text-sm font-bold text-[#0f172a]">{title}</div>
            {children}
        </div>
    );

    const id = (accountEmail || '').split('@')[0] || accountEmail || '-';

    return (
        <div
            className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4"
            onMouseDown={(e) => e.target === e.currentTarget && onClose()}
        >
            <div className="max-h-[90vh] w-[min(760px,96vw)] overflow-y-auto rounded-2xl bg-[#f8fafc] p-5">
                <div className="mb-3 flex items-center justify-between">
                    <h3 className="m-0 text-lg font-bold text-[#0f172a]">
                        {client.company || '고객사'} · 계정 정보
                    </h3>
                    <button
                        className="rounded-md border border-[#cbd5e1] bg-white px-3 py-1 text-sm font-semibold text-[#64748b]"
                        onClick={onClose}
                        type="button"
                    >
                        닫기
                    </button>
                </div>

                <div className="grid gap-3">
                    {accountEmail ? (
                        <Card title="고객 ERP 계정">
                            <Row k="아이디" v={id} />
                            <Row k="접속 주소" v="https://ddmkt-erp.pages.dev/" />
                            <Row k="초기 비밀번호" v="아이디와 동일(첫 로그인 시 변경)" />
                        </Card>
                    ) : null}

                    <div className="grid gap-3 sm:grid-cols-2">
                        <Card title="기본 정보">
                            <Row k="업체명" v={client.company || ''} />
                            <Row k="거래처명" v={client.client_partner || ''} />
                            <Row k="담당자" v={client.manager || ''} />
                            <Row k="연락처" v={client.contact || ''} />
                            <Row k="이메일" v={client.email || ''} />
                            <Row k="문의 경로" v={client.source || ''} />
                        </Card>
                        <Card title="업종 정보">
                            <Row k="사업자등록번호" v={client.business_number || ''} />
                            <Row k="사업장 주소" v={client.address || ''} />
                            <Row k="업종/업태" v={client.industry || ''} />
                            <Row k="URL" v={client.url || ''} />
                        </Card>
                    </div>

                    <BillingSection clientId={client.id} />

                    <Card title="세금계산서 정보">
                        <div className="grid gap-x-6 sm:grid-cols-2">
                            <Row k="상호명" v={client.client_partner || client.company || ''} />
                            <Row k="사업자등록번호" v={client.business_number || ''} />
                            <Row k="광고주 성함" v={client.advertiser_name || ''} />
                            <Row k="담당자 성함" v={client.manager || ''} />
                            <Row k="담당자 휴대폰번호" v={client.contact || ''} />
                            <Row k="이메일주소" v={client.invoice_email || client.email || ''} />
                            <Row k="사업장 주소" v={client.address || ''} />
                            <Row k="업종/업태" v={client.industry || ''} />
                        </div>

                        {/* 상품 내역 */}
                        <div className="mt-3 rounded-lg border border-[#e2e8f0] bg-[#f8fafc] p-2.5">
                            <div className="mb-1 text-[12px] font-bold text-[#475569]">상품 내역</div>
                            {lines.length ? (
                                lines.map((l, i) => (
                                    <div className="flex justify-between py-0.5 text-[13px] text-[#334155]" key={i}>
                                        <span>
                                            {l.label} {l.qty}건 × {won(l.unit)}
                                        </span>
                                        <span className="font-semibold">{won(l.amt)}</span>
                                    </div>
                                ))
                            ) : (
                                <div className="text-[13px] text-[#94a3b8]">계약 상품이 없습니다.</div>
                            )}
                        </div>

                        {/* 금액 요약 */}
                        <div className="mt-3 grid gap-1">
                            <Row k="금액(공급가)" v={won(supply)} />
                            <Row k="부가세 포함 금액" v={won(withVat)} />
                            <Row k="실매출" v={won(supply)} />
                            <Row k="외주비" v={won(outsource)} />
                            <div className="flex justify-between gap-3 pt-1.5">
                                <span className="text-[13px] font-bold text-[#0f172a]">순매출</span>
                                <span className="text-[14px] font-extrabold text-[#059669]">{won(net)}</span>
                            </div>
                        </div>
                    </Card>
                </div>
            </div>
        </div>
    );
}

// 정산 계좌 — 민감 정보. 내부 전용(RLS)로만 조회/저장. 마스킹 + '보기' 토글, 편집은 관리자만.
function BillingSection({ clientId }: { clientId: string }) {
    const { profile, isAdmin } = useAuth();
    const [billing, setBilling] = useState<ClientBilling | null>(null);
    const [loaded, setLoaded] = useState(false);
    const [reveal, setReveal] = useState(false);
    const [editing, setEditing] = useState(false);
    const [saving, setSaving] = useState(false);
    const [msg, setMsg] = useState('');
    const [form, setForm] = useState({ bank_name: '', account_number: '', account_holder: '' });

    useEffect(() => {
        let alive = true;
        void getClientBilling(clientId).then(({ data }) => {
            if (!alive) return;
            setBilling(data);
            setLoaded(true);
        });
        return () => {
            alive = false;
        };
    }, [clientId]);

    // 관리자만 조회/편집(내부 전용 정보). 비관리자에겐 아예 렌더 안 함.
    if (!isAdmin) return null;

    const startEdit = () => {
        setForm({
            bank_name: billing?.bank_name || '',
            account_number: billing?.account_number || '',
            account_holder: billing?.account_holder || '',
        });
        setEditing(true);
        setReveal(true);
    };
    const save = async () => {
        setSaving(true);
        setMsg('');
        const { error } = await upsertClientBilling(clientId, form, profile?.id ?? null);
        setSaving(false);
        if (error) {
            setMsg('저장 실패: ' + error.message);
            return;
        }
        setBilling({ ...form });
        setEditing(false);
        setReveal(false);
    };

    return (
        <div className="rounded-xl border border-[#fde68a] bg-[#fffbeb] p-4">
            <div className="mb-1.5 flex items-center justify-between">
                <div className="text-sm font-bold text-[#0f172a]">
                    정산 계좌 <span className="text-[11px] font-semibold text-[#b45309]">· 내부 전용</span>
                </div>
                {!editing ? (
                    <button
                        className="rounded-md border border-[#cbd5e1] bg-white px-2.5 py-1 text-[11px] font-semibold text-[#475569] hover:bg-[#f1f5f9]"
                        onClick={startEdit}
                        type="button"
                    >
                        {billing ? '편집' : '등록'}
                    </button>
                ) : null}
            </div>

            {!loaded ? (
                <div className="text-[13px] text-[#94a3b8]">불러오는 중…</div>
            ) : editing ? (
                <div className="grid gap-2">
                    <input
                        className="h-9 w-full rounded border border-[#cbd5e1] bg-white px-2 text-sm"
                        onChange={(e) => setForm((f) => ({ ...f, bank_name: e.target.value }))}
                        placeholder="은행명 (예: 국민)"
                        value={form.bank_name}
                    />
                    <input
                        className="h-9 w-full rounded border border-[#cbd5e1] bg-white px-2 text-sm"
                        onChange={(e) => setForm((f) => ({ ...f, account_holder: e.target.value }))}
                        placeholder="예금주"
                        value={form.account_holder}
                    />
                    <input
                        autoComplete="off"
                        className="h-9 w-full rounded border border-[#cbd5e1] bg-white px-2 text-sm"
                        onChange={(e) => setForm((f) => ({ ...f, account_number: e.target.value }))}
                        placeholder="계좌번호"
                        value={form.account_number}
                    />
                    {msg ? <p className="m-0 text-xs text-[#dc2626]">{msg}</p> : null}
                    <div className="flex justify-end gap-1">
                        <button
                            className="rounded-md border border-[#cbd5e1] bg-white px-3 py-1.5 text-xs font-semibold text-[#64748b]"
                            onClick={() => {
                                setEditing(false);
                                setReveal(false);
                            }}
                            type="button"
                        >
                            취소
                        </button>
                        <button
                            className="rounded-md bg-[#1e40af] px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
                            disabled={saving}
                            onClick={() => void save()}
                            type="button"
                        >
                            {saving ? '저장 중…' : '저장'}
                        </button>
                    </div>
                </div>
            ) : billing && (billing.bank_name || billing.account_number) ? (
                <div className="grid gap-1 text-[13px]">
                    <div className="flex justify-between">
                        <span className="text-[#94a3b8]">은행 · 예금주</span>
                        <span className="font-semibold text-[#334155]">
                            {billing.bank_name || '-'}
                            {billing.account_holder ? ` · ${billing.account_holder}` : ''}
                        </span>
                    </div>
                    <div className="flex items-center justify-between">
                        <span className="text-[#94a3b8]">계좌번호</span>
                        <span className="flex items-center gap-2">
                            <span className="font-mono font-semibold text-[#334155]">
                                {reveal ? billing.account_number || '-' : maskAccount(billing.account_number)}
                            </span>
                            <button
                                className="rounded border border-[#cbd5e1] bg-white px-1.5 py-0.5 text-[11px] font-semibold text-[#475569] hover:bg-[#f1f5f9]"
                                onClick={() => setReveal((v) => !v)}
                                type="button"
                            >
                                {reveal ? '숨기기' : '보기'}
                            </button>
                        </span>
                    </div>
                </div>
            ) : (
                <div className="text-[13px] text-[#94a3b8]">등록된 정산 계좌가 없습니다.</div>
            )}
        </div>
    );
}
