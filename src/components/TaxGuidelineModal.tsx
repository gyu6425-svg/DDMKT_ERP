import { useMemo, useState } from 'react';
import type { ErpClient } from '../api/erp';
import { PRODUCT_CATEGORIES } from '../lib/products';

// 세금계산서 요청 가이드라인 붙여넣기 → 기본/업종 정보 자동 입력 + (상품/외주 있으면) 계약 생성.
//   상호명→업체명 · 사업자등록번호→사업자 · 광고주 성함→담당자(+광고주) · 광고주 휴대폰→연락처
//   사업장 주소→주소 · 업종/업태→업종 · 이메일→이메일. 상품 금액=공급가, 외주=외주단가.
export type PaymentMethod = 'card' | null;
export type ParsedProduct = {
    name: string;
    category: string;
    subtype: string;
    qty: number;
    unit: number; // 판매단가
    amount: number; // 공급가
    outUnit: number; // 외주단가
    outAmt: number; // 외주비
    payment?: PaymentMethod; // 카드결제면 'card'(카드매출)
};

const digits = (s: string) => Number((s || '').replace(/[^\d]/g, '')) || 0;
const norm = (s: string) => (s || '').replace(/\s+/g, '').toLowerCase();
const won = (n: number) => `${Math.round(n).toLocaleString('ko-KR')}원`;

// 한글/숫자 금액 파싱 — "100만원"→1,000,000 · "1,100,000원"→1,100,000 · "1억2천만"도 대략 처리.
function parseKoWon(raw: string): number {
    const s = (raw || '').replace(/[원\s]/g, '');
    if (!s) return 0;
    if (/^[\d,]+$/.test(s)) return digits(s);
    let total = 0;
    let rest = s;
    const em = rest.match(/([\d,]+)억/);
    if (em) {
        total += digits(em[1]) * 1e8;
        rest = rest.replace(em[0], '');
    }
    const mm = rest.match(/([\d,]+)만/);
    if (mm) {
        total += digits(mm[1]) * 1e4;
        rest = rest.replace(mm[0], '');
    }
    const tail = rest.match(/([\d,]+)/);
    if (tail) total += digits(tail[1]);
    return total;
}

// 상품/외주 한 줄 파싱 — 다음 형태 모두 허용:
//   "브랜드 블로그 10건 * 50,000원 => 500,000원"  (단가·금액)
//   "브랜드블로그 23건 > 100만원"                 (금액만, > 구분·만원)
//   "브랜드블로그 10건"                           (수량만 — 카드 결제상품)
function parseProductLine(line: string): { name: string; qty: number; unit: number; amt: number } | null {
    const head = line.match(/^(.+?)\s+(\d[\d,]*)\s*건(.*)$/);
    if (!head) return null;
    const name = head[1].trim();
    const qty = digits(head[2]);
    const rest = head[3] || '';
    const unitM = rest.match(/[*x×＊]\s*([\d,]+)/); // 단가(* 8,000원)
    const unit = unitM ? digits(unitM[1]) : 0;
    // 금액 — =>,=,>,: 뒤의 금액(만원 허용). 없으면 단가×수량, 그것도 없으면 0(수량만).
    const amtM = rest.match(/(?:=>|=|＝|>|＞|:|：)\s*([\d,]+\s*[만억]?[\d,]*원?)/);
    const amt = amtM ? parseKoWon(amtM[1]) : unit ? qty * unit : 0;
    return { name, qty, unit, amt };
}

export function parseTaxGuideline(text: string): {
    clientPatch: Partial<ErpClient>;
    products: ParsedProduct[];
    supply: number;
    outsource: number;
    net: number;
    payment: PaymentMethod;
    vatTotal: number; // 부가세포함 금액(표시용)
} {
    const lines = text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
    const fields: Record<string, string> = {};
    const rawProducts: { name: string; qty: number; unit: number; amt: number }[] = [];
    const rawOuts: { name: string; qty: number; unit: number; amt: number }[] = [];
    let section: 'none' | 'product' | 'outsource' = 'none';

    for (const line of lines) {
        if (/^-{3,}$|^─{3,}$|^={3,}$/.test(line)) continue; // 구분선 무시
        if (/^상품\s*[:：]?$/.test(line)) {
            section = 'product';
            continue;
        }
        if (/^외주(비)?\s*[:：]?$/.test(line)) {
            section = 'outsource';
            continue;
        }
        if (section !== 'none') {
            const m = parseProductLine(line);
            if (m && m.qty > 0 && (m.amt > 0 || m.unit > 0)) {
                (section === 'product' ? rawProducts : rawOuts).push(m);
                continue;
            }
            // 상품/외주 섹션이지만 매칭 안 되는 줄(순매출/금액 등) → 섹션 종료 후 키밸류로.
            section = 'none';
        }
        const idx = line.search(/[:：]/);
        if (idx > 0) fields[line.slice(0, idx).replace(/\s+/g, '')] = line.slice(idx + 1).trim();
    }

    // 카드 결제 양식 — "결제 : 카드결제" 감지. 상품/외주 섹션 없이 결제상품·순매출로 계약 1건 생성.
    const isCard = /카드/.test(fields['결제'] || '') || /카드\s*결제/.test(text);
    if (isCard) return parseCardForm(fields);

    const g = (...keys: string[]) => {
        for (const k of keys) if (fields[k]) return fields[k];
        return '';
    };
    const clientPatch: Partial<ErpClient> = {};
    const company = g('상호명', '업체명');
    if (company) clientPatch.company = company;
    // 거래처명 — 별도 값이 있으면 그것, 없으면 상호명으로(발급 조건 충족용).
    const partner = g('거래처명') || company;
    if (partner) clientPatch.client_partner = partner;
    const biz = g('사업자등록번호', '사업자번호');
    if (biz) clientPatch.business_number = biz;
    const adv = g('광고주성함', '담당자성함', '담당자명');
    if (adv) {
        clientPatch.manager = adv;
        clientPatch.advertiser_name = adv;
    }
    const phone = g('광고주휴대폰번호', '담당자휴대폰번호', '연락처', '휴대폰번호');
    if (phone) clientPatch.contact = phone;
    const addr = g('사업장주소', '주소');
    if (addr) clientPatch.address = addr;
    const ind = g('업종/업태', '업종', '업태');
    if (ind) clientPatch.industry = ind;
    const email = g('이메일주소', '이메일', 'email');
    if (email) {
        clientPatch.email = email;
        clientPatch.invoice_email = email;
    }

    const outByName = new Map(rawOuts.map((o) => [norm(o.name), o]));
    const products: ParsedProduct[] = rawProducts.map((p) => {
        const cat = PRODUCT_CATEGORIES.find((c) => c.subs.some((s) => norm(s) === norm(p.name)));
        // 정규 세부유형명(예: "브랜드블로그"→"브랜드 블로그")으로 저장 — 브랜드블로그 로직 정상 매칭.
        const canon = cat?.subs.find((s) => norm(s) === norm(p.name)) || p.name;
        const o = outByName.get(norm(p.name));
        return {
            name: p.name,
            category: cat?.label || '기타',
            subtype: canon,
            qty: p.qty,
            unit: p.unit || (p.qty ? Math.round(p.amt / p.qty) : 0),
            amount: p.amt,
            outUnit: o ? o.unit : 0,
            outAmt: o ? o.amt : 0,
            payment: null,
        };
    });
    const supply = products.reduce((s, p) => s + p.amount, 0);
    const outsource = products.reduce((s, p) => s + p.outAmt, 0);
    const vatTotal = parseKoWon(fields['부가세포함금액'] || fields['부가세포함결제금액'] || '') || Math.round(supply * 1.1);
    return { clientPatch, products, supply, outsource, net: supply - outsource, payment: null, vatTotal };
}

// 카드 결제 양식 파싱 — 업체명·휴대폰·결제상품(수량)·부가세포함 결제금액·순매출 → 카드매출 계약 1건.
function parseCardForm(fields: Record<string, string>): ReturnType<typeof parseTaxGuideline> {
    const clientPatch: Partial<ErpClient> = {};
    const company = fields['업체명'] || fields['상호명'] || '';
    if (company) clientPatch.company = company;
    const phone = fields['휴대폰번호'] || fields['연락처'] || fields['광고주휴대폰번호'] || '';
    if (phone) clientPatch.contact = phone;

    const net = parseKoWon(fields['순매출'] || '');
    const vatTotal = parseKoWon(fields['부가세포함결제금액'] || fields['결제금액'] || fields['부가세포함금액'] || '');
    // 결제상품/히스토리에서 "브랜드블로그 10건" 파싱.
    const line = parseProductLine(fields['결제상품'] || fields['상품'] || fields['히스토리'] || '');
    const products: ParsedProduct[] = [];
    if (line && line.qty > 0) {
        const cat = PRODUCT_CATEGORIES.find((c) => c.subs.some((s) => norm(s) === norm(line.name)));
        const canon = cat?.subs.find((s) => norm(s) === norm(line.name)) || line.name;
        // 공급가(amount) = 순매출(외주 없음). 순매출 없으면 부가세포함/1.1로 역산.
        const amount = net || (vatTotal ? Math.round(vatTotal / 1.1) : line.amt);
        products.push({
            name: line.name,
            category: cat?.label || '기타',
            subtype: canon,
            qty: line.qty,
            unit: line.qty ? Math.round(amount / line.qty) : 0,
            amount,
            outUnit: 0,
            outAmt: 0,
            payment: 'card',
        });
    }
    const supply = products.reduce((s, p) => s + p.amount, 0);
    return { clientPatch, products, supply, outsource: 0, net: supply, payment: 'card', vatTotal: vatTotal || Math.round(supply * 1.1) };
}

const FIELD_LABEL: Record<string, string> = {
    company: '업체명',
    business_number: '사업자등록번호',
    manager: '담당자(광고주)',
    contact: '연락처',
    address: '사업장 주소',
    industry: '업종/업태',
    email: '이메일',
    invoice_email: '세금계산서 이메일',
    advertiser_name: '광고주 성함',
};

export default function TaxGuidelineModal({
    onApply,
    onClose,
}: {
    onApply: (patch: Partial<ErpClient>, products: ParsedProduct[]) => Promise<void>;
    onClose: () => void;
}) {
    const [text, setText] = useState('');
    const [saving, setSaving] = useState(false);
    const parsed = useMemo(() => (text.trim() ? parseTaxGuideline(text) : null), [text]);
    const fieldRows = parsed ? Object.entries(parsed.clientPatch).filter(([k]) => k !== 'invoice_email' && k !== 'advertiser_name') : [];

    const apply = async () => {
        if (!parsed) return;
        setSaving(true);
        await onApply(parsed.clientPatch, parsed.products);
        setSaving(false);
        onClose();
    };

    return (
        <div
            className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4"
            onMouseDown={(e) => e.target === e.currentTarget && onClose()}
        >
            <div className="flex max-h-[90vh] w-[min(760px,96vw)] flex-col rounded-2xl bg-white p-5">
                <div className="mb-2 flex items-center justify-between">
                    <h3 className="m-0 text-lg font-bold text-[#0f172a]">세금계산서 가이드라인 붙여넣기</h3>
                    <button
                        className="rounded-md border border-[#cbd5e1] px-3 py-1 text-sm font-semibold text-[#64748b]"
                        onClick={onClose}
                        type="button"
                    >
                        닫기
                    </button>
                </div>
                <p className="mt-0 mb-2 text-xs text-[#94a3b8]">
                    상호명·사업자번호·광고주·주소·업종·이메일이 기본/업종 정보로 들어갑니다. 상품·외주가 있으면 계약도
                    생성됩니다. <b className="text-[#7c3aed]">“결제 : 카드결제”</b>가 있으면 <b>카드매출</b>로 등록됩니다
                    (업체명·결제상품·순매출 인식).
                </p>
                <textarea
                    className="min-h-[220px] w-full resize-y rounded-md border border-[#cbd5e1] px-3 py-2 text-sm"
                    onChange={(e) => setText(e.target.value)}
                    placeholder={
                        '(신규)세금계산서 요청 가이드라인\n상호명 : test\n사업자등록번호 : 000-00-00000\n광고주 성함 : 홍길동\n광고주 휴대폰번호 : 010-0000-1111\n사업장 주소 : ...\n업종 / 업태 : 교육서비스업 / 보통교과\n이메일주소 : test@naver.com\n\n상품 :\n브랜드 블로그 10건 * 50,000원 => 500,000원\n영수증 리뷰 30건 * 2,500원 => 75,000원\n\n외주 :\n브랜드 블로그 10건 * 8,000원 => 80,000원\n영수증 리뷰 30건 * 700원 => 21,000원'
                    }
                    value={text}
                />

                {parsed ? (
                    <div className="mt-3 grid gap-2 overflow-y-auto">
                        <div className="rounded-lg border border-[#e2e8f0] bg-[#f8fafc] p-3">
                            <div className="mb-1 text-xs font-bold text-[#475569]">입력될 정보</div>
                            {fieldRows.length ? (
                                <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
                                    {fieldRows.map(([k, v]) => (
                                        <div className="flex justify-between gap-2 text-[13px]" key={k}>
                                            <span className="text-[#94a3b8]">{FIELD_LABEL[k] || k}</span>
                                            <span className="truncate text-right font-semibold text-[#334155]">
                                                {String(v)}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="text-[13px] text-[#94a3b8]">인식된 정보가 없습니다.</div>
                            )}
                        </div>

                        {parsed.products.length ? (
                            <div className="rounded-lg border border-[#e2e8f0] bg-[#f8fafc] p-3">
                                <div className="mb-1 flex items-center gap-2 text-xs font-bold text-[#475569]">
                                    생성될 계약 {parsed.products.length}건
                                    {parsed.payment === 'card' ? (
                                        <span className="rounded-full bg-[#ede9fe] px-2 py-0.5 text-[10px] font-bold text-[#7c3aed]">카드매출</span>
                                    ) : null}
                                </div>
                                {parsed.products.map((p, i) => (
                                    <div className="flex justify-between py-0.5 text-[13px] text-[#334155]" key={i}>
                                        <span>
                                            [{p.category}] {p.subtype} {p.qty}건 × {won(p.unit)}
                                            {p.outUnit ? ` · 외주 ${won(p.outUnit)}` : ''}
                                        </span>
                                        <span className="font-semibold">{won(p.amount)}</span>
                                    </div>
                                ))}
                                <div className="mt-1.5 flex justify-end gap-4 border-t border-[#e2e8f0] pt-1.5 text-[13px]">
                                    <span>
                                        공급가 <b className="text-[#1e40af]">{won(parsed.supply)}</b>
                                    </span>
                                    <span>
                                        외주 <b className="text-[#dc2626]">{won(parsed.outsource)}</b>
                                    </span>
                                    <span>
                                        순매출 <b className="text-[#059669]">{won(parsed.net)}</b>
                                    </span>
                                </div>
                            </div>
                        ) : (
                            <div className="rounded-lg border border-dashed border-[#cbd5e1] bg-white p-2 text-center text-[13px] text-[#94a3b8]">
                                상품 내역이 없어 정보만 입력됩니다.
                            </div>
                        )}
                    </div>
                ) : null}

                <div className="mt-4 flex justify-end gap-2">
                    <button
                        className="rounded-md border border-[#cbd5e1] px-4 py-2 text-sm font-semibold text-[#64748b]"
                        onClick={onClose}
                        type="button"
                    >
                        취소
                    </button>
                    <button
                        className="rounded-md bg-[#1e40af] px-5 py-2 text-sm font-bold text-white disabled:opacity-50"
                        disabled={!parsed || saving || Object.keys(parsed.clientPatch).length === 0}
                        onClick={() => void apply()}
                        type="button"
                    >
                        {saving ? '적용 중…' : parsed?.products.length ? '정보+계약 등록' : '정보 입력'}
                    </button>
                </div>
            </div>
        </div>
    );
}
