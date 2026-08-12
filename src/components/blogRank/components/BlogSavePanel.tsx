import { useCallback, useEffect, useState } from 'react';
import {
    clearSaveJob,
    createSaveJob,
    listSaveJobs,
    listSavableBlogs,
    retrySaveJob,
    type BlogJobMode,
    type BlogSaveJob,
} from '../../../api/blogSaveQueue';
import Button from '../../Button';

// 블로그 자동 '임시저장' 요청 + 현황 패널.
//   ⚠️ 이 화면은 발행을 하지 않는다. SUB1 데몬이 네이버 블로그 에디터에 채우고 '저장'까지만 하고,
//      사람이 임시저장함에서 검수한 뒤 직접 발행한다. (docs/blog-save-queue.sql 참고)

const STATUS_STYLE: Record<BlogSaveJob['status'], { label: string; cls: string }> = {
    fail: { cls: 'bg-[#fee2e2] text-[#b91c1c]', label: '실패' },
    pending: { cls: 'bg-[#f1f5f9] text-[#475569]', label: '대기' },
    posted: { cls: 'bg-[#fef3c7] text-[#b45309]', label: '발행됨(공개)' },
    processing: { cls: 'bg-[#dbeafe] text-[#1d4ed8]', label: '작성 중' },
    saved: { cls: 'bg-[#dcfce7] text-[#15803d]', label: '임시저장됨' },
};

type BlogRow = { id: string; name: string; blog_id: string; blog_url: string };

function fileToDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('이미지를 읽지 못했습니다.'));
        reader.readAsDataURL(file);
    });
}

export default function BlogSavePanel({
    body,
    title,
    sourceOutputId,
}: {
    body: string;
    title: string;
    sourceOutputId?: string;
}) {
    const [blogs, setBlogs] = useState<BlogRow[]>([]);
    const [blogAccountId, setBlogAccountId] = useState('');
    const [titleInput, setTitleInput] = useState(title);
    const [images, setImages] = useState<string[]>([]);
    const [keyword, setKeyword] = useState('');
    const [region, setRegion] = useState('');
    const [jobs, setJobs] = useState<BlogSaveJob[]>([]);
    // 🔴 기본은 '저장'. 발행은 되돌릴 수 없으므로 사용자가 명시적으로 바꿔야 하고,
    //    바꿀 때 한 번 더 확인받는다. (DB 도 default 'save' + CHECK 로 같은 방향을 보증)
    const [mode, setMode] = useState<BlogJobMode>('save');
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');

    useEffect(() => setTitleInput(title), [title]);

    useEffect(() => {
        let alive = true;
        void listSavableBlogs().then(({ data }) => {
            if (!alive) return;
            setBlogs(data);
            if (data.length === 1) setBlogAccountId(data[0].id);
        });
        return () => {
            alive = false;
        };
    }, []);

    const refresh = useCallback(async () => {
        const { data, error: loadError } = await listSaveJobs(15);
        if (loadError) {
            setError('저장 현황을 불러오지 못했습니다. blog_save_queue 테이블이 있는지 확인하세요.');
            return;
        }
        setJobs(data);
    }, []);

    useEffect(() => {
        void refresh();
        // 작성에 5~10분이 걸리므로 느슨하게 폴링.
        const t = window.setInterval(() => void refresh(), 20000);
        return () => window.clearInterval(t);
    }, [refresh]);

    const pickImages = async (files: FileList | null) => {
        if (!files?.length) return;
        try {
            const urls = await Promise.all(Array.from(files).map(fileToDataUrl));
            setImages((prev) => [...prev, ...urls]);
        } catch (e) {
            setError(e instanceof Error ? e.message : '이미지를 읽지 못했습니다.');
        }
    };

    const submit = async () => {
        setError('');
        setMessage('');
        const blog = blogs.find((b) => b.id === blogAccountId);
        if (!blog) {
            setError('저장할 블로그를 선택하세요.');
            return;
        }
        setBusy(true);
        try {
            const { error: saveError } = await createSaveJob({
                blogAccountId: blog.id,
                blogId: blog.blog_id,
                body,
                images,
                keyword: keyword.trim() || undefined,
                mode,
                region: region.trim() || undefined,
                sourceOutputId,
                title: titleInput.trim(),
            });
            if (saveError) {
                setError(saveError.message || '저장 요청에 실패했습니다.');
                return;
            }
            setMessage(mode === 'publish'
                ? '🔴 발행 대기열에 등록했습니다. SUB1 이 순서대로 실제 공개 발행합니다.'
                : '저장 대기열에 등록했습니다. SUB1 이 순서대로 임시저장합니다.');
            setImages([]);
            await refresh();
        } finally {
            setBusy(false);
        }
    };

    const selected = blogs.find((b) => b.id === blogAccountId);

    return (
        <div className="grid gap-3 rounded-lg border border-[#e2e8f0] bg-white p-4">
            <div className="flex items-center justify-between">
                <h3 className="m-0 text-sm font-bold text-[#0f172a]">블로그에 저장 요청</h3>
                <span className={`rounded px-2 py-0.5 text-[11px] font-semibold ${
                    mode === 'publish' ? 'bg-[#fee2e2] text-[#b91c1c]' : 'bg-[#fef3c7] text-[#92400e]'}`}>
                    {mode === 'publish' ? '🔴 실제 공개 발행 · 되돌릴 수 없음' : '임시저장까지만 · 발행은 사람이'}
                </span>
            </div>

            {/* 모드 선택 — 기본 '임시저장'. 발행으로 바꿀 때 한 번 더 확인받는다. */}
            <div className="flex items-center gap-2">
                {([['save', '임시저장'], ['publish', '바로 발행(공개)']] as const).map(([k, label]) => (
                    <Button
                        className={`rounded-md border px-3 py-1.5 text-xs font-bold ${
                            mode === k
                                ? (k === 'publish'
                                    ? 'border-[#b91c1c] bg-[#b91c1c] text-white'
                                    : 'border-[#1e40af] bg-[#1e40af] text-white')
                                : 'border-[#cbd5e1] bg-white text-[#475569]'}`}
                        key={k}
                        onClick={() => {
                            if (k === 'publish'
                                && !window.confirm('바로 발행하면 글이 즉시 공개되고 되돌릴 수 없습니다.\n계속할까요?')) return;
                            setMode(k);
                        }}
                        type="button"
                    >
                        {label}
                    </Button>
                ))}
            </div>

            {blogs.length === 0 ? (
                <p className="m-0 text-xs text-[#94a3b8]">
                    저장 가능한 블로그가 없습니다. 블로그 관리에서 <b>블로그 아이디</b>가 등록된 활성 블로그가 필요합니다.
                </p>
            ) : null}

            <div className="grid gap-2 sm:grid-cols-2">
                <label className="grid gap-1 text-xs text-[#475569]">
                    블로그
                    <select
                        className="rounded-md border border-[#e2e8f0] px-2 py-1.5 text-sm"
                        onChange={(e) => setBlogAccountId(e.target.value)}
                        value={blogAccountId}
                    >
                        <option value="">선택하세요</option>
                        {blogs.map((b) => (
                            <option key={b.id} value={b.id}>
                                {b.name} ({b.blog_id})
                            </option>
                        ))}
                    </select>
                </label>
                <label className="grid gap-1 text-xs text-[#475569]">
                    제목
                    <input
                        className="rounded-md border border-[#e2e8f0] px-2 py-1.5 text-sm"
                        onChange={(e) => setTitleInput(e.target.value)}
                        placeholder="제목"
                        value={titleInput}
                    />
                </label>
                <label className="grid gap-1 text-xs text-[#475569]">
                    키워드 (선택)
                    <input
                        className="rounded-md border border-[#e2e8f0] px-2 py-1.5 text-sm"
                        onChange={(e) => setKeyword(e.target.value)}
                        value={keyword}
                    />
                </label>
                <label className="grid gap-1 text-xs text-[#475569]">
                    지역 (선택)
                    <input
                        className="rounded-md border border-[#e2e8f0] px-2 py-1.5 text-sm"
                        onChange={(e) => setRegion(e.target.value)}
                        value={region}
                    />
                </label>
            </div>

            <div className="grid gap-1 text-xs text-[#475569]">
                <span>
                    사진 (선택) — 순서대로 「사진 1」,「사진 2」… 로 본문에 배치됩니다
                    {images.length ? ` · ${images.length}장` : ''}
                </span>
                <div className="flex items-center gap-2">
                    <input accept="image/*" multiple onChange={(e) => void pickImages(e.target.files)} type="file" />
                    {images.length ? (
                        <Button
                            className="rounded-md border border-[#cbd5e1] px-2 py-1 text-[11px]"
                            onClick={() => setImages([])}
                            type="button"
                        >
                            비우기
                        </Button>
                    ) : null}
                </div>
            </div>

            <div className="flex items-center gap-2">
                <Button
                    className="rounded-md bg-[#1e40af] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                    disabled={busy || !body.trim() || !titleInput.trim() || !blogAccountId}
                    onClick={() => void submit()}
                    type="button"
                >
                    {busy ? '등록 중...' : (mode === 'publish' ? '🔴 발행 대기열에 등록' : '저장 대기열에 등록')}
                </Button>
                {selected ? (
                    <a
                        className="text-xs text-[#1d4ed8] underline"
                        href={`https://blog.naver.com/${selected.blog_id}/postwrite`}
                        rel="noreferrer"
                        target="_blank"
                    >
                        임시저장함 열기 ↗
                    </a>
                ) : null}
            </div>

            {message ? <p className="m-0 text-xs text-[#15803d]">{message}</p> : null}
            {error ? <p className="m-0 text-xs text-[#b91c1c]">{error}</p> : null}

            <div className="grid gap-1">
                <div className="flex items-center justify-between">
                    <h4 className="m-0 text-xs font-bold text-[#334155]">저장 현황</h4>
                    <Button
                        className="rounded-md border border-[#cbd5e1] px-2 py-1 text-[11px]"
                        onClick={() => void refresh()}
                        type="button"
                    >
                        새로고침
                    </Button>
                </div>
                {jobs.length === 0 ? (
                    <p className="m-0 text-xs text-[#94a3b8]">아직 요청이 없습니다.</p>
                ) : (
                    <ul className="m-0 grid list-none gap-1 p-0">
                        {jobs.map((j) => {
                            const st = STATUS_STYLE[j.status] ?? STATUS_STYLE.pending;
                            return (
                                <li
                                    className="flex items-center gap-2 rounded border border-[#f1f5f9] px-2 py-1.5 text-xs"
                                    key={j.id}
                                >
                                    <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${st.cls}`}>
                                        {st.label}
                                        {j.status === 'saved' && j.draft_seq ? ` ${j.draft_seq}` : ''}
                                    </span>
                                    <span className="flex-1 truncate text-[#334155]" title={j.title}>
                                        {j.title}
                                    </span>
                                    <span className="text-[11px] text-[#94a3b8]">{j.blog_id}</span>
                                    {j.status === 'saved' ? (
                                        <Button
                                            className="rounded border border-[#cbd5e1] px-1.5 py-0.5 text-[11px]"
                                            onClick={() => void clearSaveJob(j.id).then(refresh)}
                                            title="검수/발행을 마쳤으면 정리합니다(미검수 저장분 상한에서 빠집니다)"
                                            type="button"
                                        >
                                            검수완료
                                        </Button>
                                    ) : null}
                                    {j.status === 'fail' ? (
                                        <Button
                                            className="rounded border border-[#cbd5e1] px-1.5 py-0.5 text-[11px]"
                                            onClick={() => void retrySaveJob(j.id).then(refresh)}
                                            title={j.reason || ''}
                                            type="button"
                                        >
                                            재시도
                                        </Button>
                                    ) : null}
                                </li>
                            );
                        })}
                    </ul>
                )}
                {jobs.some((j) => j.status === 'fail') ? (
                    <p className="m-0 text-[11px] text-[#94a3b8]">
                        실패 사유는 각 항목의 재시도 버튼에 마우스를 올리면 보입니다.
                    </p>
                ) : null}
            </div>
        </div>
    );
}
