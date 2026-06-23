import { useState } from 'react';
import { updateBlogAccount, type BlogAccount } from '../../api/blogRank';

export function NoteModal({
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
    const [note, setNote] = useState(account.note ?? '');
    const [saving, setSaving] = useState(false);

    const save = async () => {
        setSaving(true);
        const { error } = await updateBlogAccount(account.id, { note: note.trim() || null });
        setSaving(false);
        if (error) {
            onToast(`오류: ${error.message}`);
            return;
        }
        await onReload();
        onToast('특이사항 저장 완료');
        onClose();
    };

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
            onClick={(e) => e.target === e.currentTarget && onClose()}
        >
            <div className="w-[min(560px,94vw)] rounded-2xl bg-white p-6">
                <h3 className="m-0 text-lg font-bold">{account.name} · 특이사항</h3>
                <p className="mt-1 mb-3 text-sm text-[#64748b]">자유롭게 보고 수정할 수 있습니다.</p>
                <textarea
                    autoFocus
                    className="min-h-[200px] w-full resize-y rounded-md border border-[#cbd5e1] bg-white px-3 py-2 text-sm"
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="특이사항을 입력하세요"
                    value={note}
                />
                <div className="mt-4 flex justify-end gap-2">
                    <button
                        className="rounded-md border border-[#cbd5e1] px-4 py-2 text-sm font-semibold text-[#64748b]"
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
                        {saving ? '저장 중…' : '저장'}
                    </button>
                </div>
            </div>
        </div>
    );
}

// ───────────────────────── 업체 편집(시트 항목·계정) ─────────────────────────
