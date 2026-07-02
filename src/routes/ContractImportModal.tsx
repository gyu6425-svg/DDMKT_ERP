import { useMemo, useState } from 'react';
import { insertClient, type ErpClient } from '../api/erp';
import { insertClientContracts, type ClientContract } from '../api/clientContracts';

// 시트 붙여넣기 일괄 등록 — 판매(매출) 시트만 붙여넣어 업체+계약 등록(상태 '임시').
//   외주단가·외주업체는 나중에 상세페이지에서 계약별로 입력. 동일 업체명은 기존 '임시' 업체에 계약만 추가.

const num = (s: string) => Number((s || '').replace(/[^\d.-]/g, '')) || 0;
const normCompany = (s: string) => (s || '').trim().replace(/\s+/g, '').toLowerCase();
// 품목명 '슈퍼뭉치 외 1건' → '슈퍼뭉치'(외 N건 앞부분만). 분류에 이 기준값 사용.
const productBase = (s: string) => (s || '').replace(/\s*외\s*\d+\s*건.*$/, '').trim();
// 머리글 행에서 컬럼을 이름으로 찾기(순서/개수 무관). 첫 매칭 열 인덱스.
const findCol = (headers: string[], keys: string[]) =>
    headers.findIndex((h) => {
        const x = h.replace(/\s/g, '');
        return keys.some((k) => x.includes(k));
    });
const parseDate = (s: string) => {
    const m = (s || '').match(/(\d{4})[./-](\d{1,2})[./-](\d{1,2})/);
    return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : null;
};

const TEMP_STATUS = '임시';
// 미리 채워둘 머리글(탭 구분) — 실제 시트 컬럼과 동일. 사용자는 아래에 데이터만 붙여넣음.
const SALES_HEADER =
    '일자-No.\t회계전표일자-No.\t거래처명\t품목명(규격)\t업체명\t수량\t단가\t공급가액\t부가세\t합계\t외주비\t순매출\t사원(담당)명';

// 알려진 외주업체(품목명이 이 브랜드면 외주업체명 자동 기입). 그 외 품목은 외주업체 공란(나중 입력).
const VENDORS = ['슈퍼뭉치', '저인망', '247', '고스트', '저스트', '라인', '실계'];
const vendorFromProduct = (base: string): string | null => {
    const b = (base || '').trim();
    for (const v of VENDORS) {
        if (b === v || b.includes(v)) return v;
    }
    return null;
};

type Mapped = { category: string; subtype: string } | { exclude: true };

// 품목명 → 카테고리·세부유형. 매핑 밖/애매 품목은 제외.
function mapProduct(nameRaw: string, unit = 0): Mapped {
    const p = (nameRaw || '').trim();
    const has = (k: string) => p.includes(k);
    const EXCLUDE = [
        '종합광고대행',
        '대행 수수료',
        '대행수수료',
        '사진촬영',
        '영상제작',
        '숏폼 마케팅',
        '숏품 마케팅',
        '클립 업로드',
        '월관리 패키지',
        '90패키지',
        '서비스',
    ];
    if (!p) return { exclude: true };
    if (EXCLUDE.some((e) => p.includes(e))) return { exclude: true };
    if (['고스트', '저스트', '슈퍼뭉치', '라인', '마케팅'].includes(p) || p === '리워드')
        return { category: '플레이스', subtype: '플레이스 리워드' };
    if (has('실계')) return { category: '플레이스', subtype: '플레이스용 블로그 배포' };
    if (has('247')) return { category: '플레이스', subtype: '플레이스용 블로그 배포' };
    if (has('저인망')) return { category: '블로그', subtype: 'AI 블로그 배포' };
    if (has('ai') || has('AI')) return { category: '블로그', subtype: 'AI 블로그 배포' };
    if (has('상위노출') || has('월보장')) return { category: '플레이스', subtype: '상위노출 보장형' };
    if (has('영수증')) return { category: '플레이스', subtype: '영수증 리뷰' };
    if (has('프리미엄')) return { category: '플레이스', subtype: '플레이스용 블로그 배포' };
    if (has('브랜드블로그') || has('브랜드 블로그')) return { category: '블로그', subtype: '브랜드 블로그' };
    if (has('준최적화')) return { category: '블로그', subtype: '준최적화 블로그 배포' };
    if (has('최적화')) return { category: '블로그', subtype: '최적화 블로그 배포' };
    // 일반 블로그 배포/리뷰: 단가 10,000원 미만이면 플레이스용, 이상이면 브랜드 블로그.
    if (has('블로그'))
        return unit < 10000
            ? { category: '플레이스', subtype: '플레이스용 블로그 배포' }
            : { category: '블로그', subtype: '브랜드 블로그' };
    if (has('인스타그램')) return { category: '인스타', subtype: '브랜드 인스타' };
    if (has('인스타') || has('릴스')) return { category: '인스타', subtype: '인스타 배포' };
    if (has('파워링크')) return { category: '파워링크', subtype: '파워링크' };
    if (has('스마트스토어') || has('슬롯') || has('가구매') || has('실구매') || has('체험단'))
        return { category: '쇼핑', subtype: '쇼핑' };
    return { exclude: true };
}

type Row = {
    date: string | null;
    partner: string; // 매출 시트 거래처명 = 고객 청구명
    product: string;
    company: string;
    qty: number;
    unit: number; // 판매단가
    amount: number; // 매출(공급가액)
    outsource: number; // 외주비(매출 시트)
    outUnit: number | null; // 외주단가 = 외주비 ÷ 수량
    vendor: string | null; // 외주업체명(알려진 브랜드면 자동)
    manager: string;
    map: Mapped;
    dup: boolean;
};

export function ContractImportModal({
    allClients,
    onClose,
    onDone,
    onToast,
}: {
    allClients: ErpClient[];
    onClose: () => void;
    onDone: () => Promise<void>;
    onToast: (m: string) => void;
}) {
    // 머리글 미리 채움 — 사용자는 이 아래에 판매 시트 데이터만 붙여넣음(중복 머리글 자동 무시).
    const [salesText, setSalesText] = useState(SALES_HEADER + '\n');
    const [saving, setSaving] = useState(false);

    // 판매(주) 시트 파싱(헤더 기반). 일자·품목명·업체명·수량·단가·공급가액·거래처명·담당자를 이름으로.
    const rows = useMemo<Row[]>(() => {
        const out: Row[] = [];
        const lines = salesText.split('\n').map((l) => l.replace(/\r$/, '')).filter((l) => l.trim());
        if (lines.length < 2) return out;
        const H = lines[0].split('\t').map((s) => s.trim());
        const iDate = findCol(H, ['일자', '날짜']);
        const iProduct = findCol(H, ['품목']);
        const iCompany = findCol(H, ['업체명']);
        const iPartner = findCol(H, ['거래처']);
        const iQty = findCol(H, ['수량']);
        const iUnit = findCol(H, ['단가']);
        const iAmount = findCol(H, ['공급가']);
        const iOut = findCol(H, ['외주비']);
        const iManager = findCol(H, ['담당', '사원']);
        if (iCompany < 0 || iProduct < 0 || iQty < 0) return out;
        const seen = new Set<string>();
        for (const line of lines.slice(1)) {
            const c = line.split('\t');
            const company = (c[iCompany] || '').trim();
            const product = (c[iProduct] || '').trim();
            if (!company || !product) continue;
            const qty = num(c[iQty]);
            const amount = iAmount >= 0 ? num(c[iAmount]) : 0;
            const outsource = iOut >= 0 ? num(c[iOut]) : 0;
            const unit = iUnit >= 0 ? num(c[iUnit]) : 0;
            const base = productBase(product);
            const key = `${iDate >= 0 ? (c[iDate] || '').trim() : ''}|${company}|${product}|${qty}|${amount}`;
            const dup = seen.has(key);
            seen.add(key);
            out.push({
                amount,
                company,
                date: iDate >= 0 ? parseDate(c[iDate]) : null,
                dup,
                manager: iManager >= 0 ? (c[iManager] || '').trim() : '',
                map: mapProduct(base, unit), // 단가 전달(블로그 배포 10,000원 임계값)
                // 외주단가 = 외주비 ÷ 수량(외주비가 있을 때만). 외주업체는 알려진 브랜드면 자동.
                outUnit: qty > 0 && outsource > 0 ? Math.round(outsource / qty) : null,
                outsource,
                partner: iPartner >= 0 ? (c[iPartner] || '').trim() : '',
                product,
                qty,
                unit,
                vendor: vendorFromProduct(base),
            });
        }
        return out;
    }, [salesText]);

    const includable = rows.filter((r) => !r.dup && !('exclude' in r.map));
    const excluded = rows.filter((r) => !r.dup && 'exclude' in r.map);
    const dups = rows.filter((r) => r.dup);

    const doImport = async () => {
        if (!includable.length || saving) return;
        setSaving(true);
        let created = 0;
        let contracts = 0;
        let failed = 0;
        // 동일 업체명은 기존 '임시' 업체에 계약만 추가(실제 계약완료 업체는 재사용 안 함).
        const tempIdByCompany = new Map<string, string>();
        for (const c of allClients) {
            if (c.company && c.status === TEMP_STATUS) tempIdByCompany.set(normCompany(c.company), c.id);
        }
        const groups = new Map<string, Row[]>();
        for (const r of includable) {
            const k = normCompany(r.company);
            if (!groups.has(k)) groups.set(k, []);
            groups.get(k)!.push(r);
        }
        for (const [k, grp] of groups) {
            let clientId = tempIdByCompany.get(k);
            if (!clientId) {
                const first = grp[0];
                const { data, error: cErr } = await insertClient({
                    client_partner: first.partner || null,
                    company: first.company,
                    manager: first.manager || null,
                    status: TEMP_STATUS, // 임시 신규 생성 — 계약 관리 '임시(테스트)' 탭에서 확인.
                });
                if (cErr || !data[0]?.id) {
                    failed += grp.length;
                    continue;
                }
                clientId = data[0].id;
                tempIdByCompany.set(k, clientId);
                created += 1;
            }
            // 외주단가=외주비÷수량, 외주업체=알려진 브랜드면 자동(아니면 null → 나중 입력).
            const payload: Array<Partial<ClientContract>> = grp.map((r) => {
                const m = r.map as { category: string; subtype: string };
                return {
                    amount: r.amount,
                    category: m.category,
                    client_id: clientId!,
                    contract_date: r.date,
                    goal_count: r.qty,
                    outsource: r.outsource,
                    outsource_company: r.vendor,
                    remain_count: r.qty,
                    subtype: m.subtype,
                    unit_outsource: r.outUnit,
                    unit_price: r.unit || null,
                };
            });
            const { error } = await insertClientContracts(payload);
            if (error) failed += payload.length;
            else contracts += payload.length;
        }
        setSaving(false);
        onToast(`등록 완료 — 신규 업체 ${created} · 계약 ${contracts}건${failed ? ` · 실패 ${failed}` : ''}`);
        await onDone();
        onClose();
    };

    return (
        <div
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
            onMouseDown={(e) => e.target === e.currentTarget && onClose()}
        >
            <div className="max-h-[92vh] w-[min(720px,96vw)] overflow-y-auto rounded-2xl bg-white p-6">
                <h3 className="m-0 text-lg font-bold">판매 시트 붙여넣기 등록</h3>
                <p className="mt-1 mb-2 text-sm text-[#64748b]">
                    <b>머리글은 미리 채워져 있습니다</b> — 그 아래 줄에 판매 시트 데이터만 붙여넣으세요(탭 구분).
                    품목명으로 카테고리 자동 분류. <b>외주단가는 외주비÷수량으로 자동 측정</b>, 외주업체는 알려진
                    브랜드(슈퍼뭉치·고스트 등)면 자동 기입·아니면 공란(상세에서 입력). 동일 업체명은 한 임시 업체에
                    상품만 추가됩니다.
                </p>
                <textarea
                    className="h-32 w-full rounded-md border border-[#cbd5e1] p-2 font-mono text-xs"
                    onChange={(e) => setSalesText(e.target.value)}
                    value={salesText}
                />
                {rows.length ? (
                    <div className="mt-2 text-xs font-semibold text-[#334155]">
                        등록 예정 <b className="text-[#059669]">{includable.length}</b> · 제외{' '}
                        <b className="text-[#dc2626]">{excluded.length}</b> · 중복{' '}
                        <b className="text-[#94a3b8]">{dups.length}</b>
                    </div>
                ) : null}
                {rows.length ? (
                    <div className="mt-2 max-h-[40vh] overflow-y-auto rounded-md border border-[#e2e8f0]">
                        <table className="w-full border-collapse text-left text-[11px]">
                            <thead className="sticky top-0 bg-[#f1f5f9] text-[#64748b]">
                                <tr>
                                    <th className="px-2 py-1">업체명</th>
                                    <th className="px-2 py-1">품목</th>
                                    <th className="px-2 py-1">분류</th>
                                    <th className="px-2 py-1">외주업체</th>
                                    <th className="px-2 py-1 text-right">수량</th>
                                    <th className="px-2 py-1 text-right">판매단가</th>
                                    <th className="px-2 py-1 text-right">외주단가</th>
                                    <th className="px-2 py-1 text-right">매출</th>
                                    <th className="px-2 py-1">상태</th>
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map((r, i) => {
                                    const ex = 'exclude' in r.map;
                                    const m = ex ? null : (r.map as { category: string; subtype: string });
                                    return (
                                        <tr
                                            className={`border-t border-[#eef2f7] ${r.dup ? 'opacity-40' : ex ? 'bg-[#fff7f7]' : ''}`}
                                            key={i}
                                        >
                                            <td className="max-w-[120px] truncate px-2 py-1 font-semibold">{r.company}</td>
                                            <td className="max-w-[100px] truncate px-2 py-1 text-[#64748b]">{r.product}</td>
                                            <td className="px-2 py-1 text-[#475569]">{m ? `${m.category}·${m.subtype}` : '—'}</td>
                                            <td className="px-2 py-1 text-[#dc2626]">{r.vendor || '—'}</td>
                                            <td className="px-2 py-1 text-right">{r.qty.toLocaleString('ko-KR')}</td>
                                            <td className="px-2 py-1 text-right">{r.unit.toLocaleString('ko-KR')}</td>
                                            <td className="px-2 py-1 text-right text-[#dc2626]">{r.outUnit != null ? r.outUnit.toLocaleString('ko-KR') : '—'}</td>
                                            <td className="px-2 py-1 text-right text-[#1e40af]">{r.amount.toLocaleString('ko-KR')}</td>
                                            <td className="px-2 py-1">
                                                {r.dup ? (
                                                    <span className="text-[#94a3b8]">중복</span>
                                                ) : ex ? (
                                                    <span className="text-[#dc2626]">제외</span>
                                                ) : (
                                                    <span className="text-[#059669]">등록</span>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
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
                        className="rounded-md bg-[#1e40af] px-4 py-2 text-sm font-bold text-white hover:bg-[#1e3a8a] disabled:opacity-50"
                        disabled={saving || !includable.length}
                        onClick={() => void doImport()}
                        type="button"
                    >
                        {saving ? '등록 중…' : `${includable.length}건 등록`}
                    </button>
                </div>
            </div>
        </div>
    );
}
