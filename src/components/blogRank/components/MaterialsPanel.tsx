import { useEffect, useState } from 'react';
import { useAuth } from '../../../hooks/useAuth';
import {
    createMaterial,
    deleteMaterial,
    getPhotoUrls,
    listMaterials,
    MATERIAL_CATEGORIES,
    type BlogMaterial,
} from '../../../api/blogMaterials';

// 자료 탭(내부) — 이 블로그에 전달할 자료 등록/목록/삭제.
//   자료 = 업체명 + 대표키워드(1) + 서브키워드(≤3) + 카테고리(정보성/사례성) + 사진 1~9장(업로드 시 자동 압축).
//   용량 전략: 클라우드엔 최신 몇 건만, 오래된 건은 로컬 데몬이 PC로 아카이브(무료 티어 유지).
export function MaterialsPanel({
    blogAccountId,
    companyName,
    onToast,
}: {
    blogAccountId: string;
    companyName: string;
    onToast: (m: string) => void;
}) {
    const { profile } = useAuth();
    const [items, setItems] = useState<BlogMaterial[]>([]);
    const [urls, setUrls] = useState<Record<string, string>>({});
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    // 입력
    const [category, setCategory] = useState<string>('정보성');
    const [round, setRound] = useState('');
    const [mainKw, setMainKw] = useState('');
    const [sub, setSub] = useState(['', '', '']);
    const [files, setFiles] = useState<File[]>([]);

    const load = () => {
        setLoading(true);
        void listMaterials(blogAccountId).then(async ({ data }) => {
            setItems(data);
            const paths = data.flatMap((m) => (m.photos || []).map((p) => p.path));
            if (paths.length) {
                const { map } = await getPhotoUrls(paths);
                setUrls(map);
            }
            setLoading(false);
        });
    };
    useEffect(load, [blogAccountId]);

    const submit = async () => {
        if (saving) return;
        if (!files.length) return onToast('사진을 1장 이상 선택하세요');
        if (files.length > 9) return onToast('사진은 최대 9장입니다');
        setSaving(true);
        const { error } = await createMaterial({
            blogAccountId,
            category,
            companyName: companyName || '',
            files,
            mainKeyword: mainKw.trim(),
            round: round.trim() ? Number(round) : null,
            subKeywords: sub.map((s) => s.trim()).filter(Boolean),
            uploadedBy: profile?.id ?? null,
        });
        setSaving(false);
        if (error) return onToast('자료 등록 실패: ' + error.message);
        setMainKw('');
        setSub(['', '', '']);
        setRound('');
        setFiles([]);
        onToast('자료 등록 완료 · 기자단이 받을 수 있습니다');
        load();
    };

    const del = async (m: BlogMaterial) => {
        const { error } = await deleteMaterial(m);
        if (error) return onToast('삭제 실패: ' + error.message);
        onToast('자료 삭제됨');
        load();
    };

    const inputCls = 'h-9 w-full rounded-md border border-[#cbd5e1] bg-white px-2.5 text-sm';

    return (
        <div className="mt-4 grid gap-3">
            {/* 등록 폼 */}
            <div className="grid gap-2 rounded-lg border border-[#0f766e] bg-[#f0fdfa] p-3">
                <div className="text-xs font-bold text-[#0f766e]">자료 등록 — 기자단에게 전달</div>
                <div className="grid grid-cols-2 gap-2">
                    <label className="grid gap-0.5 text-[12px] font-semibold text-[#475569]">
                        카테고리
                        <select className={inputCls} onChange={(e) => setCategory(e.target.value)} value={category}>
                            {MATERIAL_CATEGORIES.map((c) => (
                                <option key={c} value={c}>
                                    {c}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label className="grid gap-0.5 text-[12px] font-semibold text-[#475569]">
                        회차(선택)
                        <input className={inputCls} inputMode="numeric" onChange={(e) => setRound(e.target.value.replace(/[^0-9]/g, ''))} placeholder="예: 3" value={round} />
                    </label>
                </div>
                <label className="grid gap-0.5 text-[12px] font-semibold text-[#475569]">
                    대표키워드 (1개)
                    <input className={inputCls} onChange={(e) => setMainKw(e.target.value)} placeholder="대표키워드" value={mainKw} />
                </label>
                <div className="grid gap-0.5 text-[12px] font-semibold text-[#475569]">
                    서브키워드 (최대 3개)
                    <div className="grid grid-cols-3 gap-2">
                        {sub.map((v, i) => (
                            <input
                                className={inputCls}
                                key={i}
                                onChange={(e) => setSub((p) => p.map((x, j) => (j === i ? e.target.value : x)))}
                                placeholder={`서브${i + 1}`}
                                value={v}
                            />
                        ))}
                    </div>
                </div>
                <label className="grid gap-0.5 text-[12px] font-semibold text-[#475569]">
                    사진 (1~9장 · 업로드 시 자동 압축)
                    <input
                        accept="image/*"
                        className="text-xs"
                        multiple
                        onChange={(e) => setFiles(Array.from(e.target.files || []).slice(0, 9))}
                        type="file"
                    />
                    {files.length ? <span className="text-[11px] text-[#0f766e]">{files.length}장 선택됨</span> : null}
                </label>
                <button
                    className="h-9 rounded-md bg-[#0f766e] px-4 text-sm font-bold text-white hover:bg-[#115e59] disabled:opacity-50"
                    disabled={saving}
                    onClick={() => void submit()}
                    type="button"
                >
                    {saving ? '등록 중…(압축·업로드)' : '자료 등록'}
                </button>
            </div>

            {/* 목록 */}
            <div className="text-xs font-bold text-[#334155]">등록된 자료 {items.length}건</div>
            {loading ? (
                <div className="py-6 text-center text-sm text-[#94a3b8]">불러오는 중…</div>
            ) : items.length === 0 ? (
                <div className="py-6 text-center text-[13px] text-[#94a3b8]">아직 등록된 자료가 없습니다.</div>
            ) : (
                <div className="grid max-h-[40vh] gap-2 overflow-y-auto">
                    {items.map((m) => (
                        <div className="rounded-lg border border-[#e2e8f0] p-2.5" key={m.id}>
                            <div className="flex items-center justify-between gap-2">
                                <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
                                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${m.category === '사례성' ? 'bg-[#fef3c7] text-[#b45309]' : 'bg-[#dbeafe] text-[#1e40af]'}`}>
                                        {m.category}
                                    </span>
                                    {m.round != null ? <span className="text-[#64748b]">{m.round}회차</span> : null}
                                    <b className="text-[#0f172a]">{m.main_keyword || '(대표키워드 없음)'}</b>
                                    {(m.sub_keywords || []).length ? (
                                        <span className="text-[#94a3b8]">· {m.sub_keywords.join(', ')}</span>
                                    ) : null}
                                    <span className="text-[#94a3b8]">· 사진 {m.photos?.length || 0}장</span>
                                </div>
                                <button className="shrink-0 text-[11px] font-semibold text-[#dc2626] hover:underline" onClick={() => void del(m)} type="button">
                                    삭제
                                </button>
                            </div>
                            {(m.photos || []).length ? (
                                <div className="mt-1.5 flex flex-wrap gap-1">
                                    {m.photos.map((p, i) =>
                                        urls[p.path] ? (
                                            <img alt="" className="h-12 w-12 rounded border border-[#e2e8f0] object-cover" key={i} src={urls[p.path]} />
                                        ) : (
                                            <div className="flex h-12 w-12 items-center justify-center rounded border border-[#e2e8f0] text-[9px] text-[#cbd5e1]" key={i}>…</div>
                                        ),
                                    )}
                                </div>
                            ) : null}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
