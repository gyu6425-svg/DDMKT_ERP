import { useMemo, useState } from 'react';
import { insertClient, type ErpClient } from '../api/erp';
import { insertClientContracts, type ClientContract } from '../api/clientContracts';

// 시트 붙여넣기 일괄 등록 — 매출 시트 + (선택) 외주비 시트를 붙여넣어 매칭·병합해 등록.
//   매출 시트(13열): 일자 | 계약일자 | 거래처명(청구명) | 품목명 | 업체명 | 수량 | 단가(판매) | 공급가액(매출) | 부가세 | 합계 | 외주비 | 순매출 | 담당자
//   외주비 시트(10열): 일자 | 거래처명(=외주업체) | 업체명 | 품목명 | 수량 | 단가(외주) | 공급가액(외주비) | 부가세 | 합계 | 담당자
//   → 외주업체명·외주단가는 외주비 시트에서, 나머지는 매출 시트에서. 매칭 키 = 업체명+품목명+수량.

const num = (s: string) => Number((s || '').replace(/[^\d.-]/g, '')) || 0;
const normCompany = (s: string) => (s || '').trim().replace(/\s+/g, '').toLowerCase();
// 품목명 '슈퍼뭉치 외 1건' → '슈퍼뭉치'(외 N건 앞부분만). 매칭·분류에 이 기준값 사용.
const productBase = (s: string) => (s || '').replace(/\s*외\s*\d+\s*건.*$/, '').trim();
const normProduct = (s: string) => productBase(s).replace(/\s+/g, '').toLowerCase();
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

type Mapped = { category: string; subtype: string } | { exclude: true };

// 품목명 → 카테고리·세부유형(외주업체는 여기서 결정하지 않음). 매핑 밖/애매 품목은 제외.
function mapProduct(nameRaw: string): Mapped {
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
        '프리미엄 배포',
        '서비스',
    ];
    if (!p) return { exclude: true };
    if (p === '마케팅' || EXCLUDE.some((e) => p.includes(e))) return { exclude: true };
    if (['고스트', '저스트', '슈퍼뭉치', '라인'].includes(p))
        return { category: '플레이스', subtype: '플레이스 리워드' };
    if (p === '리워드') return { category: '플레이스', subtype: '플레이스 리워드' };
    if (has('실계')) return { category: '플레이스', subtype: '플레이스용 블로그 리뷰' };
    if (has('247')) return { category: '플레이스', subtype: '플레이스용 블로그 리뷰' };
    if (has('저인망')) return { category: '블로그', subtype: 'AI 블로그 배포' };
    if (has('ai') || has('AI')) return { category: '블로그', subtype: 'AI 블로그 배포' };
    if (has('상위노출') || has('월보장')) return { category: '플레이스', subtype: '상위노출 보장형' };
    if (has('영수증')) return { category: '플레이스', subtype: '영수증 리뷰' };
    if (has('브랜드블로그') || has('브랜드 블로그')) return { category: '블로그', subtype: '브랜드 블로그' };
    if (has('준최적화')) return { category: '블로그', subtype: '준최적화 블로그 배포' };
    if (has('최적화')) return { category: '블로그', subtype: '최적화 블로그 배포' };
    if (has('블로그')) return { category: '플레이스', subtype: '플레이스용 블로그 리뷰' };
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
    unit: number;
    amount: number;
    outsource: number;
    manager: string;
    map: Mapped;
    dup: boolean;
    vendor: string | null; // 외주업체명(외주비 시트 매칭)
    outUnit: number | null; // 외주단가(외주비 시트 매칭, 없으면 역산)
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
    const [salesText, setSalesText] = useState('');
    const [outText, setOutText] = useState('');
    const [saving, setSaving] = useState(false);

    // 외주비 시트 파싱(헤더 기반) → 외주단가 조회맵(업체명|품목명(외N건제거) → 외주단가).
    //   외주비 시트는 '외주단가'만 제공. 거래처명(HS)·수량·금액은 매칭/저장에 쓰지 않음(수량이 매출과 다름).
    const outUnitByKey = useMemo(() => {
        const m = new Map<string, number>();
        const lines = outText.split('\n').map((l) => l.replace(/\r$/, '')).filter((l) => l.trim());
        if (lines.length < 2) return m;
        const H = lines[0].split('\t').map((s) => s.trim());
        const iCompany = findCol(H, ['업체명']);
        const iProduct = findCol(H, ['품목']);
        const iUnit = findCol(H, ['단가']);
        if (iCompany < 0 || iUnit < 0) return m;
        for (const line of lines.slice(1)) {
            const c = line.split('\t');
            const company = (c[iCompany] || '').trim();
            if (!company) continue;
            const unit = num(c[iUnit]);
            const key = `${normCompany(company)}|${normProduct(c[iProduct] || '')}`;
            if (!m.has(key) && unit > 0) m.set(key, unit); // 첫 값
        }
        return m;
    }, [outText]);

    // 매출(주) 시트 파싱(헤더 기반). 일자·품목명·업체명·수량·단가·공급가액·외주비·순매출·담당자·거래처명을 이름으로.
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
        const iOut = findCol(H, ['외주비', '외주']);
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
            const salesOut = iOut >= 0 ? num(c[iOut]) : 0; // 매출 시트 외주비(비어있을 수 있음)
            const key = `${iDate >= 0 ? (c[iDate] || '').trim() : ''}|${company}|${product}|${qty}|${amount}`;
            const dup = seen.has(key);
            seen.add(key);
            // 외주업체명 = 품목명(외 N건 앞부분) 그대로(리워드 브랜드명 등).
            const base = productBase(product);
            const vendor: string | null = base || null;
            // 외주단가 = 외주비 시트(업체명+품목명 매칭). 없으면 매출 시트 외주비/수량 역산.
            const matchedUnit = outUnitByKey.get(`${normCompany(company)}|${normProduct(product)}`);
            let outUnit: number | null;
            let outsource: number;
            if (matchedUnit != null && matchedUnit > 0) {
                outUnit = matchedUnit;
                outsource = matchedUnit * qty; // 외주비 = 외주단가 × 판매수량(상세페이지 계산과 동일)
            } else {
                outsource = salesOut;
                outUnit = qty ? Math.round(salesOut / qty) : null;
            }
            out.push({
                amount,
                company,
                date: iDate >= 0 ? parseDate(c[iDate]) : null,
                dup,
                manager: iManager >= 0 ? (c[iManager] || '').trim() : '',
                map: mapProduct(base),
                outUnit,
                outsource,
                partner: iPartner >= 0 ? (c[iPartner] || '').trim() : '',
                product,
                qty,
                unit: iUnit >= 0 ? num(c[iUnit]) : 0,
                vendor,
            });
        }
        return out;
    }, [salesText, outUnitByKey]);

    const includable = rows.filter((r) => !r.dup && !('exclude' in r.map));
    const excluded = rows.filter((r) => !r.dup && 'exclude' in r.map);
    const dups = rows.filter((r) => r.dup);
    // 외주단가를 외주비 시트에서 찾은 행 수(외주단가 매칭)
    const matched = includable.filter((r) =>
        outUnitByKey.has(`${normCompany(r.company)}|${normProduct(r.product)}`),
    );

    const doImport = async () => {
        if (!includable.length || saving) return;
        setSaving(true);
        const idByCompany = new Map<string, string>();
        for (const c of allClients) if (c.company) idByCompany.set(normCompany(c.company), c.id);
        let created = 0;
        let contracts = 0;
        let failed = 0;
        const groups = new Map<string, Row[]>();
        for (const r of includable) {
            const k = normCompany(r.company);
            if (!groups.has(k)) groups.set(k, []);
            groups.get(k)!.push(r);
        }
        for (const [key, grp] of groups) {
            let clientId = idByCompany.get(key);
            if (!clientId) {
                const first = grp[0];
                const { data, error } = await insertClient({
                    client_partner: first.partner || null,
                    company: first.company,
                    manager: first.manager || null,
                    status: '계약완료',
                });
                if (error || !data[0]?.id) {
                    failed += grp.length;
                    continue;
                }
                clientId = data[0].id;
                idByCompany.set(key, clientId);
                created += 1;
            }
            const payload: Array<Partial<ClientContract>> = grp.map((r) => {
                const m = r.map as { category: string; subtype: string };
                return {
                    amount: r.amount,
                    category: m.category,
                    client_id: clientId!,
                    contract_date: r.date,
                    goal_count: r.qty,
                    outsource: r.outsource,
                    outsource_company: r.vendor || null,
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
            <div className="max-h-[92vh] w-[min(760px,96vw)] overflow-y-auto rounded-2xl bg-white p-6">
                <h3 className="m-0 text-lg font-bold">시트 붙여넣기 일괄 등록</h3>
                <p className="mt-1 mb-2 text-sm text-[#64748b]">
                    엑셀에서 <b>머리글(품목명·업체명·수량 등) 행을 포함</b>해 복사(탭 구분)하세요. 컬럼을 이름으로
                    인식하므로 순서·개수가 달라도 됩니다. 품목명으로 카테고리 자동 분류, 애매/중복 자동 제외. 외주비
                    시트를 함께 넣으면 외주업체명·외주단가가 매칭됩니다.
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                    <label className="block text-xs font-bold text-[#334155]">
                        매출 시트 (필수)
                        <textarea
                            className="mt-1 h-28 w-full rounded-md border border-[#cbd5e1] p-2 font-mono text-xs"
                            onChange={(e) => setSalesText(e.target.value)}
                            placeholder="머리글 행 포함 붙여넣기 (일자·품목명·업체명·수량·단가·공급가액·외주비·순매출·담당자 …)"
                            value={salesText}
                        />
                    </label>
                    <label className="block text-xs font-bold text-[#334155]">
                        외주비 시트 (선택 — 외주업체·외주단가)
                        <textarea
                            className="mt-1 h-28 w-full rounded-md border border-[#fecaca] p-2 font-mono text-xs"
                            onChange={(e) => setOutText(e.target.value)}
                            placeholder="머리글 행 포함 (거래처명=외주업체·업체명·품목명·수량·단가·공급가액 …)"
                            value={outText}
                        />
                    </label>
                </div>
                {rows.length ? (
                    <div className="mt-2 text-xs font-semibold text-[#334155]">
                        등록 예정 <b className="text-[#059669]">{includable.length}</b>
                        <span className="text-[#94a3b8]"> (외주단가 매칭 {matched.length})</span> · 제외{' '}
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
                                    <th className="px-2 py-1 text-right">매출</th>
                                    <th className="px-2 py-1 text-right">외주</th>
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
                                            <td className="max-w-[110px] truncate px-2 py-1 font-semibold">{r.company}</td>
                                            <td className="max-w-[90px] truncate px-2 py-1 text-[#64748b]">{r.product}</td>
                                            <td className="px-2 py-1 text-[#475569]">{m ? `${m.category}·${m.subtype}` : '—'}</td>
                                            <td className="px-2 py-1 text-[#dc2626]">{r.vendor || '—'}</td>
                                            <td className="px-2 py-1 text-right">{r.qty.toLocaleString('ko-KR')}</td>
                                            <td className="px-2 py-1 text-right text-[#1e40af]">{r.amount.toLocaleString('ko-KR')}</td>
                                            <td className="px-2 py-1 text-right text-[#dc2626]">{r.outsource.toLocaleString('ko-KR')}</td>
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
