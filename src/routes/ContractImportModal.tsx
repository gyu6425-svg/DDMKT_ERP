import { useMemo, useState } from 'react';
import { insertClient, type ErpClient } from '../api/erp';
import { insertClientContracts, type ClientContract } from '../api/clientContracts';

// 시트 붙여넣기 일괄 등록 — 엑셀에서 복사(탭 구분)한 계약 시트를 파싱→품목명 분류→미리보기→일괄 등록.
//   시트 컬럼 순서(기본): 일자-No | 계약일자-No | 거래처명 | 품목명 | 업체명 | 수량 | 단가 | 공급가액 | 부가세 | 합계 | 외주비 | 순매출 | 담당자

const num = (s: string) => Number((s || '').replace(/[^\d.-]/g, '')) || 0;
const normCompany = (s: string) => (s || '').trim().replace(/\s+/g, '').toLowerCase();
const parseDate = (s: string) => {
    const m = (s || '').match(/(\d{4})[./-](\d{1,2})[./-](\d{1,2})/);
    if (!m) return null;
    return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
};

type Mapped = { category: string; subtype: string; outCompany: string } | { exclude: true };

// 품목명 → 카테고리·세부유형·외주업체. 매핑 밖/애매한 품목은 제외.
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
    // 리워드(외주업체 = 품목명)
    if (['고스트', '저스트', '슈퍼뭉치', '라인'].includes(p))
        return { category: '플레이스', subtype: '플레이스 리워드', outCompany: p };
    if (p === '리워드') return { category: '플레이스', subtype: '플레이스 리워드', outCompany: '' };
    // 실계 / 247 → 플레이스용 블로그 리뷰
    if (has('실계')) return { category: '플레이스', subtype: '플레이스용 블로그 리뷰', outCompany: '실계' };
    if (has('247')) return { category: '플레이스', subtype: '플레이스용 블로그 리뷰', outCompany: '247' };
    // 저인망 / AI → AI 블로그 배포
    if (has('저인망')) return { category: '블로그', subtype: 'AI 블로그 배포', outCompany: '저인망' };
    if (has('ai') || has('AI')) return { category: '블로그', subtype: 'AI 블로그 배포', outCompany: '' };
    // 상위노출 / 월보장 → 상위노출 보장형
    if (has('상위노출') || has('월보장')) return { category: '플레이스', subtype: '상위노출 보장형', outCompany: '' };
    // 영수증
    if (has('영수증')) return { category: '플레이스', subtype: '영수증 리뷰', outCompany: '' };
    // 브랜드블로그
    if (has('브랜드블로그') || has('브랜드 블로그'))
        return { category: '블로그', subtype: '브랜드 블로그', outCompany: '' };
    // 최적화 / 준최적화
    if (has('준최적화')) return { category: '블로그', subtype: '준최적화 블로그 배포', outCompany: '' };
    if (has('최적화')) return { category: '블로그', subtype: '최적화 블로그 배포', outCompany: '' };
    // 일반 블로그 배포/리뷰 → 플레이스용 블로그 리뷰(만원 미만 배포)
    if (has('블로그')) return { category: '플레이스', subtype: '플레이스용 블로그 리뷰', outCompany: '' };
    // 인스타
    if (has('인스타그램')) return { category: '인스타', subtype: '브랜드 인스타', outCompany: '' };
    if (has('인스타') || has('릴스')) return { category: '인스타', subtype: '인스타 배포', outCompany: '' };
    // 파워링크
    if (has('파워링크')) return { category: '파워링크', subtype: '파워링크', outCompany: '' };
    // 쇼핑
    if (has('스마트스토어') || has('슬롯') || has('가구매') || has('실구매') || has('체험단'))
        return { category: '쇼핑', subtype: '쇼핑', outCompany: '' };
    return { exclude: true };
}

type Row = {
    date: string | null;
    partner: string;
    product: string;
    company: string;
    qty: number;
    unit: number;
    amount: number;
    outsource: number;
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
    const [text, setText] = useState('');
    const [saving, setSaving] = useState(false);

    const rows = useMemo<Row[]>(() => {
        const seen = new Set<string>();
        const out: Row[] = [];
        for (const raw of text.split('\n')) {
            const line = raw.replace(/\r$/, '');
            if (!line.trim()) continue;
            const c = line.split('\t');
            if (c.length < 11) continue; // 컬럼 부족(헤더/잘린 행) 스킵
            const company = (c[4] || '').trim();
            const product = (c[3] || '').trim();
            if (!company || product === '품목명' || company === '거래처명') continue; // 헤더 스킵
            const qty = num(c[5]);
            const amount = num(c[7]);
            const outsource = num(c[10]);
            const key = `${(c[0] || '').trim()}|${company}|${product}|${qty}|${amount}|${outsource}`;
            const dup = seen.has(key);
            seen.add(key);
            out.push({
                amount,
                company,
                date: parseDate(c[0]) || parseDate(c[1]),
                dup,
                manager: (c[12] || '').trim(),
                map: mapProduct(product),
                outsource,
                partner: (c[2] || '').trim(),
                product,
                qty,
                unit: num(c[6]),
            });
        }
        return out;
    }, [text]);

    const includable = rows.filter((r) => !r.dup && !('exclude' in r.map));
    const excluded = rows.filter((r) => !r.dup && 'exclude' in r.map);
    const dups = rows.filter((r) => r.dup);

    const doImport = async () => {
        if (!includable.length || saving) return;
        setSaving(true);
        // 업체명 기준 그룹 → 기존 업체는 계약만 추가, 없으면 clients 생성.
        const idByCompany = new Map<string, string>();
        for (const c of allClients) {
            if (c.company) idByCompany.set(normCompany(c.company), c.id);
        }
        let created = 0;
        let contracts = 0;
        let failed = 0;
        // 업체별로 묶기
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
                const m = r.map as { category: string; subtype: string; outCompany: string };
                return {
                    amount: r.amount,
                    category: m.category,
                    client_id: clientId!,
                    contract_date: r.date,
                    goal_count: r.qty,
                    outsource: r.outsource,
                    outsource_company: m.outCompany || null,
                    remain_count: r.qty,
                    subtype: m.subtype,
                    unit_outsource: r.qty ? Math.round(r.outsource / r.qty) : null,
                    unit_price: r.unit || null,
                };
            });
            const { error } = await insertClientContracts(payload);
            if (error) failed += grp.length;
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
            <div className="max-h-[90vh] w-[min(720px,96vw)] overflow-y-auto rounded-2xl bg-white p-6">
                <h3 className="m-0 text-lg font-bold">시트 붙여넣기 일괄 등록</h3>
                <p className="mt-1 mb-2 text-sm text-[#64748b]">
                    엑셀에서 계약 시트를 복사해 붙여넣으세요(탭 구분). 품목명으로 카테고리를 자동 분류하고,
                    애매한 품목·중복 행은 제외합니다.
                </p>
                <textarea
                    className="h-32 w-full rounded-md border border-[#cbd5e1] p-2 font-mono text-xs"
                    onChange={(e) => setText(e.target.value)}
                    placeholder="여기에 시트 붙여넣기 (일자 · 계약일자 · 거래처명 · 품목명 · 업체명 · 수량 · 단가 · 공급가액 · 부가세 · 합계 · 외주비 · 순매출 · 담당자)"
                    value={text}
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
                                    <th className="px-2 py-1 text-right">수량</th>
                                    <th className="px-2 py-1 text-right">매출</th>
                                    <th className="px-2 py-1 text-right">외주</th>
                                    <th className="px-2 py-1">상태</th>
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map((r, i) => {
                                    const ex = 'exclude' in r.map;
                                    const m = ex ? null : (r.map as { category: string; subtype: string; outCompany: string });
                                    return (
                                        <tr
                                            className={`border-t border-[#eef2f7] ${r.dup ? 'opacity-40' : ex ? 'bg-[#fff7f7]' : ''}`}
                                            key={i}
                                        >
                                            <td className="max-w-[120px] truncate px-2 py-1 font-semibold">{r.company}</td>
                                            <td className="max-w-[100px] truncate px-2 py-1 text-[#64748b]">{r.product}</td>
                                            <td className="px-2 py-1 text-[#475569]">
                                                {m ? `${m.category} · ${m.subtype}${m.outCompany ? ` · ${m.outCompany}` : ''}` : '—'}
                                            </td>
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
