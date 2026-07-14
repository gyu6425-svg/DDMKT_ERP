import type { ErpClient } from '../api/erp';
import { totalOutsource, type ClientContract } from '../api/clientContracts';

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
    const withVat = Math.round(supply * 1.1);

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
