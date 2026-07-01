import { useMemo, useState } from 'react';
import { insertClient, type ErpClient } from '../api/erp';
import { insertClientContracts, type ClientContract } from '../api/clientContracts';

// 시트 붙여넣기 일괄 등록 — 매출 시트 + (선택) 외주비 시트를 붙여넣어 매칭·병합해 등록.
//   매출 시트(13열): 일자 | 계약일자 | 거래처명(청구명) | 품목명 | 업체명 | 수량 | 단가(판매) | 공급가액(매출) | 부가세 | 합계 | 외주비 | 순매출 | 담당자
//   외주비 시트(10열): 일자 | 거래처명(=외주업체) | 업체명 | 품목명 | 수량 | 단가(외주) | 공급가액(외주비) | 부가세 | 합계 | 담당자
//   → 외주업체명·외주단가는 외주비 시트에서, 나머지는 매출 시트에서. 매칭 키 = 업체명+품목명+수량.

const num = (s: string) => Number((s || '').replace(/[^\d.-]/g, '')) || 0;
const normCompany = (s: string) => (s || '').trim().replace(/\s+/g, '').toLowerCase();
const norm = (s: string) => (s || '').trim().replace(/\s+/g, '').toLowerCase();
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

type OutRow = { company: string; product: string; qty: number; outUnit: number; outAmount: number; vendor: string };
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

    // 외주비 시트 파싱 → 매칭 버킷(업체명|품목명|수량 → OutRow[])
    const outBuckets = useMemo(() => {
        const m = new Map<string, OutRow[]>();
        for (const raw of outText.split('\n')) {
            const c = raw.replace(/\r$/, '').split('\t');
            if (c.length < 7) continue;
            const company = (c[2] || '').trim();
            const product = (c[3] || '').trim();
            if (!company || company === '업체명' || product === '품목명') continue;
            const qty = num(c[4]);
            const key = `${normCompany(company)}|${norm(product)}|${qty}`;
            const row: OutRow = {
                company,
                outAmount: num(c[6]),
                outUnit: num(c[5]),
                product,
                qty,
                vendor: (c[1] || '').trim(),
            };
            if (!m.has(key)) m.set(key, []);
            m.get(key)!.push(row);
        }
        return m;
    }, [outText]);

    const rows = useMemo<Row[]>(() => {
        const seen = new Set<string>();
        const buckets = new Map<string, OutRow[]>();
        for (const [k, v] of outBuckets) buckets.set(k, [...v]); // 소비용 복제
        const out: Row[] = [];
        for (const raw of salesText.split('\n')) {
            const c = raw.replace(/\r$/, '').split('\t');
            if (c.length < 11) continue;
            const company = (c[4] || '').trim();
            const product = (c[3] || '').trim();
            if (!company || product === '품목명' || company === '거래처명') continue;
            const qty = num(c[5]);
            const amount = num(c[7]);
            const outsource = num(c[10]);
            const key = `${(c[0] || '').trim()}|${company}|${product}|${qty}|${amount}`;
            const dup = seen.has(key);
            seen.add(key);
            // 외주비 시트 매칭(업체명+품목명+수량, 1:1 소비)
            const mkey = `${normCompany(company)}|${norm(product)}|${qty}`;
            let vendor: string | null = null;
            let outUnit: number | null = qty ? Math.round(outsource / qty) : null;
            if (!dup) {
                const b = buckets.get(mkey);
                if (b && b.length) {
                    const om = b.shift()!;
                    vendor = om.vendor || null;
                    outUnit = om.outUnit || outUnit;
                }
            }
            out.push({
                amount,
                company,
                date: parseDate(c[0]) || parseDate(c[1]),
                dup,
                manager: (c[12] || '').trim(),
                map: mapProduct(product),
                outUnit,
                outsource,
                partner: (c[2] || '').trim(),
                product,
                qty,
                unit: num(c[6]),
                vendor,
            });
        }
        return out;
    }, [salesText, outBuckets]);

    const includable = rows.filter((r) => !r.dup && !('exclude' in r.map));
    const excluded = rows.filter((r) => !r.dup && 'exclude' in r.map);
    const dups = rows.filter((r) => r.dup);
    const matched = includable.filter((r) => r.vendor);
    // 외주비 시트에서 매칭 안 된 행 수(경고)
    const outTotal = useMemo(() => {
        let n = 0;
        for (const v of outBuckets.values()) n += v.length;
        return n;
    }, [outBuckets]);
    const outUnmatched = outTotal - matched.length;

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
                    엑셀에서 복사(탭 구분). 품목명으로 카테고리 자동 분류, 애매/중복 자동 제외. 외주비 시트를 함께
                    넣으면 외주업체명·외주단가가 매칭됩니다.
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                    <label className="block text-xs font-bold text-[#334155]">
                        매출 시트 (필수)
                        <textarea
                            className="mt-1 h-28 w-full rounded-md border border-[#cbd5e1] p-2 font-mono text-xs"
                            onChange={(e) => setSalesText(e.target.value)}
                            placeholder="일자 · 계약일자 · 거래처명 · 품목명 · 업체명 · 수량 · 단가 · 공급가액 · 부가세 · 합계 · 외주비 · 순매출 · 담당자"
                            value={salesText}
                        />
                    </label>
                    <label className="block text-xs font-bold text-[#334155]">
                        외주비 시트 (선택 — 외주업체·외주단가)
                        <textarea
                            className="mt-1 h-28 w-full rounded-md border border-[#fecaca] p-2 font-mono text-xs"
                            onChange={(e) => setOutText(e.target.value)}
                            placeholder="일자 · 거래처명(외주업체) · 업체명 · 품목명 · 수량 · 단가 · 공급가액 · 부가세 · 합계 · 담당자"
                            value={outText}
                        />
                    </label>
                </div>
                {rows.length ? (
                    <div className="mt-2 text-xs font-semibold text-[#334155]">
                        등록 예정 <b className="text-[#059669]">{includable.length}</b>
                        <span className="text-[#94a3b8]"> (외주매칭 {matched.length})</span> · 제외{' '}
                        <b className="text-[#dc2626]">{excluded.length}</b> · 중복{' '}
                        <b className="text-[#94a3b8]">{dups.length}</b>
                        {outUnmatched > 0 ? (
                            <span className="text-[#dc2626]"> · 외주비 미매칭 {outUnmatched}행 ⚠</span>
                        ) : null}
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
