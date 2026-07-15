import { useEffect, useState } from 'react';
import type { BlogAccount } from '../../../api/blogRank';
import { getPhotoUrls, listMaterials, type BlogMaterial } from '../../../api/blogMaterials';

// 기자단 자료 받기 모달 — 우리가 이 블로그에 전달한 자료(카테고리·대표/서브키워드·사진)를 회차별로 확인·다운로드.
//   RLS로 본인 담당 블로그만 조회됨. 사진은 signed URL로 다운로드.
export function ReporterMaterialsModal({
    account,
    onClose,
    onToast,
}: {
    account: BlogAccount;
    onClose: () => void;
    onToast: (m: string) => void;
}) {
    const [items, setItems] = useState<BlogMaterial[]>([]);
    const [urls, setUrls] = useState<Record<string, string>>({});
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let alive = true;
        setLoading(true);
        void listMaterials(account.id).then(async ({ data }) => {
            if (!alive) return;
            setItems(data);
            const paths = data.flatMap((m) => (m.photos || []).map((p) => p.path));
            if (paths.length) {
                const { map } = await getPhotoUrls(paths, 600);
                if (alive) setUrls(map);
            }
            setLoading(false);
        });
        return () => {
            alive = false;
        };
    }, [account.id]);

    const copyKw = async (text: string) => {
        try {
            await navigator.clipboard.writeText(text);
            onToast('키워드 복사됨');
        } catch {
            onToast('복사 실패');
        }
    };

    return (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
            <div className="max-h-[88vh] w-[min(720px,96vw)] overflow-y-auto rounded-2xl bg-white p-6">
                <div className="mb-3 flex items-center justify-between">
                    <div>
                        <h3 className="m-0 text-lg font-bold text-[#0f172a]">{account.name} · 전달 자료</h3>
                        <p className="m-0 mt-0.5 text-[12px] text-[#94a3b8]">회차별 자료(키워드·사진)를 확인하고 사진을 다운로드하세요.</p>
                    </div>
                    <button className="rounded-md border border-[#cbd5e1] px-3 py-1 text-sm font-semibold text-[#64748b]" onClick={onClose} type="button">
                        닫기
                    </button>
                </div>

                {loading ? (
                    <div className="py-12 text-center text-sm text-[#94a3b8]">불러오는 중…</div>
                ) : items.length === 0 ? (
                    <div className="py-12 text-center text-sm text-[#94a3b8]">아직 전달된 자료가 없습니다.</div>
                ) : (
                    <div className="grid gap-3">
                        {items.map((m) => (
                            <div className="rounded-xl border border-[#e2e8f0] p-3" key={m.id}>
                                <div className="mb-2 flex flex-wrap items-center gap-1.5 text-[13px]">
                                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${m.category === '사례성' ? 'bg-[#fef3c7] text-[#b45309]' : 'bg-[#dbeafe] text-[#1e40af]'}`}>
                                        {m.category}
                                    </span>
                                    {m.round != null ? <span className="rounded-full bg-[#f1f5f9] px-2 py-0.5 text-[11px] font-semibold text-[#475569]">{m.round}회차</span> : null}
                                    {m.company_name ? <span className="text-[#64748b]">{m.company_name}</span> : null}
                                </div>
                                <div className="grid gap-1 text-[13px]">
                                    <div>
                                        <span className="text-[#94a3b8]">대표키워드 </span>
                                        <button className="font-bold text-[#0f172a] hover:underline" onClick={() => void copyKw(m.main_keyword || '')} title="복사" type="button">
                                            {m.main_keyword || '-'}
                                        </button>
                                    </div>
                                    {(m.sub_keywords || []).length ? (
                                        <div>
                                            <span className="text-[#94a3b8]">서브키워드 </span>
                                            <button className="font-semibold text-[#475569] hover:underline" onClick={() => void copyKw(m.sub_keywords.join(', '))} title="복사" type="button">
                                                {m.sub_keywords.join(' · ')}
                                            </button>
                                        </div>
                                    ) : null}
                                </div>
                                {(m.photos || []).length ? (
                                    <div className="mt-2 flex flex-wrap gap-2">
                                        {m.photos.map((p, i) =>
                                            urls[p.path] ? (
                                                <a className="group relative" download={p.name} href={urls[p.path]} key={i} title="클릭해서 다운로드">
                                                    <img alt={p.name} className="h-20 w-20 rounded-md border border-[#e2e8f0] object-cover group-hover:opacity-80" src={urls[p.path]} />
                                                    <span className="absolute bottom-0 right-0 rounded-tl bg-black/60 px-1 text-[9px] text-white">↓</span>
                                                </a>
                                            ) : (
                                                <div className="flex h-20 w-20 items-center justify-center rounded-md border border-[#e2e8f0] text-[10px] text-[#cbd5e1]" key={i}>…</div>
                                            ),
                                        )}
                                    </div>
                                ) : null}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
