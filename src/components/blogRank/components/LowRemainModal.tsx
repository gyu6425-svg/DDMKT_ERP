import type { BlogAccount } from '../../../api/blogRank';
import { renewLevel } from '../lib/helpers';

// 잔여 5건 이하(재계약 임박) 블로그만 모아 보여주는 모달. 빨강(1건↓) 상단, 노랑(2~3건) 그 아래.
export function LowRemainModal({
    accounts,
    onClose,
    onGoBlog,
}: {
    accounts: BlogAccount[];
    onClose: () => void;
    onGoBlog: (name: string) => void;
}) {
    const list = accounts
        .filter((a) => a.is_active && a.remain_count != null && a.remain_count <= 5)
        .map((a) => ({ a, level: renewLevel(a) }))
        .sort((x, y) => (x.a.remain_count ?? 999) - (y.a.remain_count ?? 999)); // 잔여 적은(빨강 1건) 순

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
            onMouseDown={(e) => e.target === e.currentTarget && onClose()}
        >
            <div className="flex max-h-[85vh] w-[min(560px,94vw)] flex-col rounded-2xl bg-white p-6">
                <h3 className="m-0 text-lg font-bold text-[#0f172a]">재계약 임박 블로그 · 잔여 5건 이하</h3>
                <p className="mt-1 mb-3 text-sm text-[#64748b]">
                    빨강 = 잔여 1건 이하(매우 임박) · 노랑 = 2~5건. 클릭하면 관리 시트로 이동합니다.
                </p>

                <div className="grid gap-1 overflow-y-auto">
                    {list.length ? (
                        list.map(({ a, level }) => (
                            <button
                                className="flex items-center justify-between rounded-md border border-[#f1f5f9] px-3 py-2.5 text-left hover:bg-[#f8fafc]"
                                key={a.id}
                                onClick={() => onGoBlog(a.name)}
                                type="button"
                            >
                                <span className="min-w-0">
                                    <span className="block text-sm font-semibold text-[#0f172a]">{a.name}</span>
                                    <span className="block truncate text-xs text-[#94a3b8]">
                                        잔여 {a.remain_count}건 · 재계약 {level === 'red' ? '매우 임박' : '임박'}
                                    </span>
                                </span>
                                <span
                                    className="ml-2 shrink-0 text-lg font-bold"
                                    style={{ color: level === 'red' ? '#dc2626' : '#d97706' }}
                                >
                                    {a.remain_count}
                                    <span className="text-xs font-semibold">건</span>
                                </span>
                            </button>
                        ))
                    ) : (
                        <p className="m-0 py-10 text-center text-sm text-[#94a3b8]">잔여 5건 이하 블로그가 없습니다.</p>
                    )}
                </div>

                <div className="mt-4 flex justify-end">
                    <button
                        className="rounded-md border border-[#cbd5e1] px-4 py-2 text-sm font-semibold text-[#64748b]"
                        onClick={onClose}
                        type="button"
                    >
                        닫기
                    </button>
                </div>
            </div>
        </div>
    );
}
