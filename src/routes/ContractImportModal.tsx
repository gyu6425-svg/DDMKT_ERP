import { useMemo, useState } from 'react';
import { insertClient, type ErpClient } from '../api/erp';
import { insertClientContracts, type ClientContract } from '../api/clientContracts';
import { normCompany, parseSalesRows, SALES_HEADER, type ParsedRow as Row } from '../lib/contractImport';

// 시트 붙여넣기 일괄 등록 — 판매(매출) 시트만 붙여넣어 업체+계약 등록(상태 '임시').
//   외주단가·외주업체는 나중에 상세페이지에서 계약별로 입력. 동일 업체명은 기존 업체에 계약만 추가.

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
    const rows = useMemo<Row[]>(() => parseSalesRows(salesText), [salesText]);

    const includable = rows.filter((r) => !r.dup && !('exclude' in r.map));
    const excluded = rows.filter((r) => !r.dup && 'exclude' in r.map);
    const dups = rows.filter((r) => r.dup);

    const doImport = async () => {
        if (!includable.length || saving) return;
        setSaving(true);
        let created = 0;
        let contracts = 0;
        let failed = 0;
        // 동일 업체명이면 기존 업체에 계약만 추가(중복 업체 생성 방지).
        const tempIdByCompany = new Map<string, string>();
        for (const c of allClients) {
            if (c.company) tempIdByCompany.set(normCompany(c.company), c.id);
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
                    status: '계약완료', // 시트 등록 = 계약완료(계약 관리), 계약일자 월 필터에 반영.
                    contract_approved: true, // 기존 업체 이관이라 승인 상태로(신규 등록건 아님).
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
                    sheet_approved: true, // 기존 업체 이관 — 카테고리 시트 신규 승인 대기로 안 감.
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
