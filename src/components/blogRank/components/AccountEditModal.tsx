import { useState } from 'react';
import { deleteBlogAccount, extractBlogId, updateBlogAccount, type BlogAccount } from '../../../api/blogRank';
import { amountTotal } from '../lib/helpers';
import { MaterialsPanel } from './MaterialsPanel';

export function AccountEditModal({
    account,
    onClose,
    onReload,
    onToast,
}: {
    account: BlogAccount;
    onClose: () => void;
    onReload: () => Promise<void>;
    onToast: (message: string) => void;
}) {
    const [tab, setTab] = useState<'basic' | 'materials'>('basic'); // 기본 설정 / 자료
    // 시트 전체 항목(편집에서 수정 가능)
    const [name, setName] = useState(account.name ?? '');
    const [manager, setManager] = useState(account.manager ?? '');
    const [contact, setContact] = useState(account.contact ?? '');
    const [blogUrl, setBlogUrl] = useState(account.blog_url ?? '');
    const [contractDate, setContractDate] = useState(account.contract_date ?? '');
    // 금액 = 누적 계약금액 합계(amounts) 우선 표시(레거시 amount 폴백). 편집하면 단일 금액으로 덮어씀.
    const initAmount = (() => {
        const t = amountTotal(account);
        return t ? String(t) : account.amount ?? '';
    })();
    const [amount, setAmount] = useState(initAmount);
    const [goalCount, setGoalCount] = useState(account.goal_count?.toString() ?? '');
    const [remainCount, setRemainCount] = useState(account.remain_count?.toString() ?? '');
    const [weekly, setWeekly] = useState(account.weekly ?? '');
    const [reporter, setReporter] = useState(account.reporter ?? '');
    const [manageSheet, setManageSheet] = useState(account.manage_sheet_url ?? '');
    const [note, setNote] = useState(account.note ?? '');
    const [isActive, setIsActive] = useState(account.is_active);
    // 계정(별도 '보기'에서만 노출)
    const [loginId, setLoginId] = useState(account.login_id ?? '');
    const [loginPw, setLoginPw] = useState(account.login_pw ?? '');
    const [showCred, setShowCred] = useState(false);
    const [saving, setSaving] = useState(false);
    const [confirmDel, setConfirmDel] = useState(false);
    const [deleting, setDeleting] = useState(false);

    const save = async () => {
        setSaving(true);
        const parseNum = (v: string) => {
            const d = v.replace(/[^\d]/g, ''); // 콤마·단위 무시하고 숫자만
            return d ? Number(d) : null;
        };
        // 금액을 바꿨을 때만 누적 금액(amounts)을 이 단일 값으로 덮어씀(표 합계에 반영). 안 바꿨으면 기존 내역 유지.
        const amtChanged = amount.trim() !== initAmount.trim();
        const amtNum = parseNum(amount) ?? 0;
        const { error } = await updateBlogAccount(account.id, {
            name: name.trim() || account.name,
            manager: manager.trim() || null,
            contact: contact.trim() || null,
            blog_url: blogUrl.trim() || account.blog_url,
            blog_id: extractBlogId(blogUrl) || account.blog_id,
            contract_date: contractDate.trim() || null,
            amount: amount.trim() || null,
            ...(amtChanged ? { amounts: amtNum ? [{ amount: amtNum }] : [] } : {}),
            goal_count: parseNum(goalCount),
            remain_count: parseNum(remainCount),
            weekly: weekly.trim() || null,
            reporter: reporter.trim() || null,
            manage_sheet_url: manageSheet.trim() || null,
            note: note.trim() || null,
            is_active: isActive,
            login_id: loginId.trim() || null,
            login_pw: loginPw.trim() || null,
        });
        setSaving(false);
        if (error) {
            onToast(`오류: ${error.message}`);
            return;
        }
        // 계약 관리(client_contracts) 연동은 아직 하지 않음 — 이 편집은 블로그 관리시트에만 저장.
        await onReload();
        onToast('저장 완료');
        onClose();
    };

    // 보류 — note 마커 '[보류]' 토글로 '보류' 탭으로 빼거나 되돌림(별도 컬럼 없이). 다른 편집값은 저장 안 함.
    const HOLD = '[보류]';
    const isHeld = note.includes(HOLD);
    const toggleHold = async () => {
        setSaving(true);
        const next = isHeld
            ? note.replace(HOLD, '').replace(/\s{2,}/g, ' ').trim()
            : `${HOLD} ${note}`.trim();
        const { error } = await updateBlogAccount(account.id, { note: next || null });
        setSaving(false);
        if (error) {
            onToast(`오류: ${error.message}`);
            return;
        }
        await onReload();
        onToast(isHeld ? '보류 해제 — 계약 중으로 복귀' : '보류로 이동됨');
        onClose();
    };

    // blog_posts 는 ON DELETE CASCADE 로 함께 삭제됨(측정 이력 포함).
    const remove = async () => {
        setDeleting(true);
        const { error } = await deleteBlogAccount(account.id);
        setDeleting(false);
        if (error) {
            onToast(`삭제 오류: ${error.message}`);
            return;
        }
        await onReload();
        onToast(`'${account.name}' 삭제 완료`);
        onClose();
    };

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
            onMouseDown={(e) => e.target === e.currentTarget && onClose()}
        >
            <div className="max-h-[90vh] w-[min(520px,94vw)] overflow-y-auto rounded-2xl bg-white p-6">
                <h3 className="m-0 text-lg font-bold">{account.name} · 정보</h3>

                {/* 탭: 기본 설정 / 자료 */}
                <div className="mt-3 flex gap-1 border-b border-[#e2e8f0]">
                    {(
                        [
                            ['basic', '기본 설정'],
                            ['materials', '자료'],
                        ] as ['basic' | 'materials', string][]
                    ).map(([k, label]) => (
                        <button
                            className={`-mb-px border-b-2 px-4 py-2 text-sm font-bold ${tab === k ? 'border-[#1e40af] text-[#1e40af]' : 'border-transparent text-[#94a3b8]'}`}
                            key={k}
                            onClick={() => setTab(k)}
                            type="button"
                        >
                            {label}
                        </button>
                    ))}
                </div>

                {tab === 'basic' ? (
                <>
                {/* ── 관리 정보(시트 전체 항목 · 편집에서 모두 수정 가능) ── */}
                <div className="mt-4 grid gap-2 rounded-lg border border-[#e2e8f0] p-3">
                    <div className="text-xs font-bold text-[#334155]">관리 정보</div>
                    <p className="-mt-1 text-[11px] text-[#94a3b8]">
                        모든 항목을 여기서 수정할 수 있습니다. 이 편집은 <b>블로그 관리시트에만</b> 저장되며 계약
                        관리(계약 원장)와는 <b>아직 연동되지 않습니다</b>.
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                        {(
                            [
                                ['업체명', name, setName, '', false],
                                ['담당', manager, setManager, '', false],
                                ['연락처', contact, setContact, '010-0000-0000', false],
                                ['계약일자', contractDate, setContractDate, '2026-06-22', false],
                                ['금액', amount, setAmount, '예: 500,000', false],
                                ['계약건수', goalCount, setGoalCount, '20', false],
                                ['잔여건수', remainCount, setRemainCount, '6', false],
                                ['주 발행', weekly, setWeekly, '주 5회', false],
                                ['기자단', reporter, setReporter, 'A팀', false],
                            ] as Array<[string, string, (v: string) => void, string, boolean]>
                        ).map(([label, value, setter, ph, locked]) => (
                            <label
                                className="block text-xs font-semibold text-[#334155]"
                                key={label}
                            >
                                <span className="mb-1 block">
                                    {label}
                                    {locked ? (
                                        <span className="ml-1 font-normal text-[#94a3b8]">
                                            · 계약 관리
                                        </span>
                                    ) : null}
                                </span>
                                <input
                                    className={`h-9 w-full rounded-md border px-2 text-sm ${
                                        locked
                                            ? 'cursor-not-allowed border-[#e2e8f0] bg-[#f1f5f9] text-[#94a3b8]'
                                            : 'border-[#cbd5e1] bg-white'
                                    }`}
                                    disabled={locked}
                                    onChange={(e) => setter(e.target.value)}
                                    placeholder={ph}
                                    title={locked ? '계약 관리에서 수정하세요' : undefined}
                                    value={value}
                                />
                            </label>
                        ))}
                    </div>
                    <label className="block text-xs font-semibold text-[#334155]">
                        <span className="mb-1 block">발행 URL</span>
                        <input
                            className="h-9 w-full rounded-md border border-[#cbd5e1] bg-white px-2 text-sm"
                            onChange={(e) => setBlogUrl(e.target.value)}
                            placeholder="https://blog.naver.com/..."
                            value={blogUrl}
                        />
                    </label>
                    <label className="block text-xs font-semibold text-[#334155]">
                        <span className="mb-1 block">발행 관리시트</span>
                        <input
                            className="h-9 w-full rounded-md border border-[#cbd5e1] bg-white px-2 text-sm"
                            onChange={(e) => setManageSheet(e.target.value)}
                            placeholder="관리 시트 링크"
                            value={manageSheet}
                        />
                    </label>
                    <label className="block text-xs font-semibold text-[#334155]">
                        <span className="mb-1 block">특이사항</span>
                        <textarea
                            className="min-h-[56px] w-full resize-y rounded-md border border-[#cbd5e1] bg-white px-2 py-1.5 text-sm"
                            onChange={(e) => setNote(e.target.value)}
                            placeholder="메모/특이사항"
                            value={note}
                        />
                    </label>
                    <label className="flex items-center gap-2 text-xs font-semibold text-[#334155]">
                        <input
                            checked={isActive}
                            onChange={(e) => setIsActive(e.target.checked)}
                            type="checkbox"
                        />
                        진행중(활성) — 끄면 ‘진행 중단’ 상태
                    </label>
                </div>

                {/* ── 계정 정보(아이디/비밀번호) — 표에는 안 보이고 여기서만 보기·수정 ── */}
                <div className="mt-3 grid gap-2 rounded-lg border border-[#fde68a] bg-[#fffbeb] p-3">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-[#92400e]">
                            계정 정보 (아이디 · 비밀번호)
                        </span>
                        <button
                            className="rounded-md border border-[#fbbf24] bg-white px-2 py-1 text-[11px] font-semibold text-[#92400e]"
                            onClick={() => setShowCred((v) => !v)}
                            type="button"
                        >
                            {showCred ? '숨기기' : '보기'}
                        </button>
                    </div>
                    {showCred ? (
                        <div className="grid grid-cols-2 gap-2">
                            {(
                                [
                                    ['아이디', loginId, setLoginId],
                                    ['비밀번호', loginPw, setLoginPw],
                                ] as Array<[string, string, (v: string) => void]>
                            ).map(([label, value, setter]) => (
                                <label
                                    className="block text-xs font-semibold text-[#92400e]"
                                    key={label}
                                >
                                    <span className="mb-1 block">{label}</span>
                                    <div className="flex gap-1">
                                        <input
                                            className="h-9 w-full rounded-md border border-[#fbbf24] bg-white px-2 text-sm"
                                            onChange={(e) => setter(e.target.value)}
                                            value={value}
                                        />
                                        <button
                                            className="shrink-0 rounded-md border border-[#fbbf24] bg-white px-2 text-[11px] font-semibold text-[#92400e]"
                                            onClick={() => {
                                                void navigator.clipboard.writeText(value);
                                                onToast(`${label} 복사됨`);
                                            }}
                                            type="button"
                                        >
                                            복사
                                        </button>
                                    </div>
                                </label>
                            ))}
                        </div>
                    ) : (
                        <p className="m-0 text-[11px] text-[#92400e]">
                            ‘보기’를 눌러 아이디·비밀번호를 확인·수정하세요. (표에는 노출되지 않습니다)
                        </p>
                    )}
                </div>

                <div className="mt-5 flex items-center gap-2">
                    {confirmDel ? (
                        <span className="flex items-center gap-2 text-xs text-[#dc2626]">
                            측정 이력까지 삭제됩니다.
                            <button
                                className="rounded-md bg-[#dc2626] px-3 py-2 text-xs font-bold text-white disabled:opacity-60"
                                disabled={deleting}
                                onClick={() => void remove()}
                                type="button"
                            >
                                {deleting ? '삭제 중...' : '정말 삭제'}
                            </button>
                            <button
                                className="text-xs font-semibold text-[#64748b]"
                                onClick={() => setConfirmDel(false)}
                                type="button"
                            >
                                취소
                            </button>
                        </span>
                    ) : (
                        <button
                            className="rounded-md border border-[#fecaca] px-3 py-2 text-sm font-semibold text-[#dc2626] hover:bg-[#fef2f2]"
                            onClick={() => setConfirmDel(true)}
                            type="button"
                        >
                            업체 삭제
                        </button>
                    )}
                    {!confirmDel && (
                        <button
                            className="rounded-md border border-[#fcd34d] px-3 py-2 text-sm font-semibold text-[#b45309] hover:bg-[#fffbeb] disabled:opacity-60"
                            disabled={saving}
                            onClick={() => void toggleHold()}
                            title={isHeld ? '보류 해제하고 계약 중으로 복귀' : '이 업체를 보류 탭으로 이동'}
                            type="button"
                        >
                            {isHeld ? '보류 해제' : '보류'}
                        </button>
                    )}
                    <button
                        className="ml-auto rounded-md border border-[#cbd5e1] px-4 py-2 text-sm font-semibold text-[#64748b]"
                        onClick={onClose}
                        type="button"
                    >
                        닫기
                    </button>
                    <button
                        className="rounded-md bg-[#1e40af] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                        disabled={saving}
                        onClick={() => void save()}
                        type="button"
                    >
                        {saving ? '저장 중...' : '저장'}
                    </button>
                </div>
                </>
                ) : (
                    <MaterialsPanel blogAccountId={account.id} companyName={account.name} onToast={onToast} />
                )}
            </div>
        </div>
    );
}

// ───────────────────────── 트래커 ─────────────────────────
