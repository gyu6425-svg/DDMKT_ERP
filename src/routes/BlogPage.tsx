import { useEffect, useRef, useState } from 'react';
import { generateBlog, type GenerateBlogInput } from '../api/aiBlog';
import { logApiUsage } from '../api/apiUsage';
import {
    getBlogOperators,
    getBlogOutputs,
    parseBlogTitle,
    saveBlogOutput,
    type BlogOutput,
} from '../api/blogOutputs';
import { computeRecordCostUsd, extractTokenBreakdown, formatKrw, formatUsd } from '../lib/apiPricing';
import { WORK_CATEGORIES, categoryLabel } from '../lib/categories';
import { useAuth } from '../hooks/useAuth';
import Button from '../components/Button';

const TONES: Array<{ value: NonNullable<GenerateBlogInput['tone']>; label: string }> = [
    { label: '정보형', value: 'info' },
    { label: '후기형', value: 'review' },
    { label: '홍보형', value: 'promo' },
    { label: '스토리텔링', value: 'story' },
];

const LENGTHS: Array<{ value: NonNullable<GenerateBlogInput['length']>; label: string }> = [
    { label: '짧게', value: 'short' },
    { label: '보통', value: 'medium' },
    { label: '길게', value: 'long' },
];

function BlogPage() {
    const { user } = useAuth();

    const [topic, setTopic] = useState('');
    const [industry, setIndustry] = useState('');
    const [audience, setAudience] = useState('');
    const [keywords, setKeywords] = useState('');
    const [tone, setTone] = useState<NonNullable<GenerateBlogInput['tone']>>('info');
    const [length, setLength] = useState<NonNullable<GenerateBlogInput['length']>>('medium');
    const [includeHashtags, setIncludeHashtags] = useState(true);
    const [category, setCategory] = useState('');
    const [operatorName, setOperatorName] = useState(
        () => localStorage.getItem('erp_operator_name') || '',
    );

    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState('');
    const [error, setError] = useState('');
    const [copied, setCopied] = useState(false);
    const [lastUsage, setLastUsage] = useState<{
        input: number;
        output: number;
        total: number;
        cost: number;
    } | null>(null);
    const abortRef = useRef<AbortController | null>(null);

    // 상위 탭(생성/작업 기록). 한 컴포넌트라 탭 전환해도 생성은 계속 진행된다.
    const [view, setView] = useState<'create' | 'gallery'>('create');
    const [galleryRefreshKey, setGalleryRefreshKey] = useState(0);

    const run = async () => {
        if (!topic.trim()) {
            setError('주제를 입력해주세요.');
            return;
        }
        setError('');
        setResult('');
        setLastUsage(null);
        setLoading(true);

        const controller = new AbortController();
        abortRef.current = controller;
        const startedAt = Date.now();
        const runCategory = category;

        try {
            const output = await generateBlog({
                audience,
                includeHashtags,
                industry,
                keywords,
                length,
                signal: controller.signal,
                tone,
                topic,
            });
            setResult(output.text);
            const breakdown = extractTokenBreakdown(output.usage);
            setLastUsage({
                cost: computeRecordCostUsd({
                    model: 'gpt-5.5',
                    provider: 'openai',
                    usage_raw: output.usage ?? null,
                }),
                input: breakdown.input,
                output: breakdown.output,
                total: breakdown.total,
            });
            void logApiUsage({
                cost_usd: computeRecordCostUsd({
                    model: 'gpt-5.5',
                    provider: 'openai',
                    usage_raw: output.usage ?? null,
                }),
                elapsed_ms: Date.now() - startedAt,
                model: 'blog',
                operator_name: operatorName || null,
                provider: 'openai',
                status: 'success',
                total_tokens: output.usage?.total_tokens ?? null,
                usage_raw: output.usage ?? null,
                user_email: user?.email ?? null,
            });

            // 작업 기록 저장(작업자·카테고리·시간 + 제목/본문). 실패해도 생성엔 영향 없음.
            void saveBlogOutput({
                category: runCategory || '',
                category_label: categoryLabel(runCategory),
                content: output.text,
                length,
                operator_name: operatorName || null,
                title: parseBlogTitle(output.text) || topic.trim(),
                tone,
                topic: topic.trim(),
            }).then(() => setGalleryRefreshKey((key) => key + 1));
        } catch (caught) {
            const message = caught instanceof Error ? caught.message : '생성에 실패했습니다.';
            setError(message);
            void logApiUsage({
                elapsed_ms: Date.now() - startedAt,
                error_message: message,
                model: 'blog',
                operator_name: operatorName || null,
                provider: 'openai',
                status: 'error',
                user_email: user?.email ?? null,
            });
        } finally {
            setLoading(false);
            abortRef.current = null;
        }
    };

    const stop = () => abortRef.current?.abort();

    const copy = async () => {
        await navigator.clipboard.writeText(result);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
    };

    const useFromGallery = (text: string) => {
        setResult(text);
        setView('create');
    };

    return (
        <section className="grid gap-4">
            <div>
                <p className="m-0 text-sm text-[#64748b]">
                    AI로 네이버 블로그용 SEO 글을 생성합니다
                </p>
            </div>

            <div className="flex gap-1 border-b border-[#e2e8f0]">
                {([['create', '생성'], ['gallery', '작업 기록']] as const).map(([key, label]) => (
                    <button
                        className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold ${
                            view === key
                                ? 'border-[#1e40af] text-[#1e40af]'
                                : 'border-transparent text-[#94a3b8]'
                        }`}
                        key={key}
                        onClick={() => setView(key)}
                        type="button"
                    >
                        {label}
                    </button>
                ))}
            </div>

            {view === 'gallery' ? (
                <BlogGalleryView onUse={useFromGallery} refreshKey={galleryRefreshKey} />
            ) : null}

            <div
                className={`grid gap-4 lg:grid-cols-[380px_minmax(0,1fr)] ${
                    view === 'create' ? '' : 'hidden'
                }`}
            >
                {/* 입력 */}
                <div className="grid h-fit gap-3 rounded-[8px] border border-[#e2e8f0] bg-white p-4">
                    <Field label="내 이름(작업자)">
                        <input
                            className="erp-input"
                            onChange={(event) => {
                                setOperatorName(event.target.value);
                                localStorage.setItem('erp_operator_name', event.target.value);
                            }}
                            placeholder="예: 홍길동 (작업 기록에 남습니다)"
                            value={operatorName}
                        />
                    </Field>
                    <Field label="주제 / 키워드 *">
                        <input
                            className="erp-input"
                            onChange={(event) => setTopic(event.target.value)}
                            placeholder="예: 강남 치과 임플란트 후기"
                            value={topic}
                        />
                    </Field>
                    <div className="grid grid-cols-2 gap-3">
                        <Field label="업종">
                            <input
                                className="erp-input"
                                onChange={(event) => setIndustry(event.target.value)}
                                placeholder="예: 치과"
                                value={industry}
                            />
                        </Field>
                        <Field label="타깃 독자">
                            <input
                                className="erp-input"
                                onChange={(event) => setAudience(event.target.value)}
                                placeholder="예: 30대 직장인"
                                value={audience}
                            />
                        </Field>
                    </div>
                    <Field label="카테고리 (작업 기록 분류)">
                        <select
                            className="erp-input"
                            onChange={(event) => setCategory(event.target.value)}
                            value={category}
                        >
                            <option value="">미지정</option>
                            {WORK_CATEGORIES.map((c) => (
                                <option key={c.id} value={c.id}>
                                    {c.name}
                                </option>
                            ))}
                        </select>
                    </Field>
                    <Field label="포함 키워드 (쉼표로 구분)">
                        <input
                            className="erp-input"
                            onChange={(event) => setKeywords(event.target.value)}
                            placeholder="예: 임플란트, 비용, 보험"
                            value={keywords}
                        />
                    </Field>
                    <Field label="톤">
                        <div className="flex flex-wrap gap-1.5">
                            {TONES.map((option) => (
                                <Button
                                    className={`rounded-md px-3 py-1.5 text-xs font-semibold ${
                                        tone === option.value
                                            ? 'bg-[#1e40af] text-white'
                                            : 'border border-[#cbd5e1] text-[#64748b]'
                                    }`}
                                    key={option.value}
                                    onClick={() => setTone(option.value)}
                                    type="button"
                                >
                                    {option.label}
                                </Button>
                            ))}
                        </div>
                    </Field>
                    <Field label="분량">
                        <div className="flex gap-1.5">
                            {LENGTHS.map((option) => (
                                <Button
                                    className={`flex-1 rounded-md px-3 py-1.5 text-xs font-semibold ${
                                        length === option.value
                                            ? 'bg-[#1e40af] text-white'
                                            : 'border border-[#cbd5e1] text-[#64748b]'
                                    }`}
                                    key={option.value}
                                    onClick={() => setLength(option.value)}
                                    type="button"
                                >
                                    {option.label}
                                </Button>
                            ))}
                        </div>
                    </Field>
                    <label className="flex items-center gap-2 text-sm text-[#334155]">
                        <input
                            checked={includeHashtags}
                            onChange={(event) => setIncludeHashtags(event.target.checked)}
                            type="checkbox"
                        />
                        해시태그 포함
                    </label>

                    {error ? (
                        <p className="m-0 rounded-md bg-[#fee2e2] px-3 py-2 text-xs text-[#dc2626]">
                            {error}
                        </p>
                    ) : null}

                    <div className="flex gap-2">
                        <Button
                            className="flex-1 rounded-md bg-[#1e40af] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
                            disabled={loading}
                            onClick={() => void run()}
                            type="button"
                        >
                            {loading ? '생성 중...' : '✨ 글 생성'}
                        </Button>
                        {loading ? (
                            <Button
                                className="rounded-md border border-[#cbd5e1] px-4 py-2.5 text-sm font-semibold text-[#64748b]"
                                onClick={stop}
                                type="button"
                            >
                                중단
                            </Button>
                        ) : null}
                    </div>
                </div>

                {/* 결과 */}
                <div className="grid h-fit gap-2 rounded-[8px] border border-[#e2e8f0] bg-white p-4">
                    <div className="flex items-center justify-between">
                        <h3 className="m-0 text-sm font-bold text-[#0f172a]">결과</h3>
                        {lastUsage ? (
                            <span className="text-xs text-[#64748b]">
                                이번 글 토큰 {lastUsage.total.toLocaleString('ko-KR')}
                                <span className="text-[#94a3b8]">
                                    {' '}
                                    (입력 {lastUsage.input.toLocaleString('ko-KR')}/출력{' '}
                                    {lastUsage.output.toLocaleString('ko-KR')})
                                </span>{' '}
                                · {formatUsd(lastUsage.cost)} · {formatKrw(lastUsage.cost)}
                            </span>
                        ) : null}
                        {result ? (
                            <Button
                                className="rounded-md border border-[#cbd5e1] px-3 py-1.5 text-xs font-semibold"
                                onClick={() => void copy()}
                                type="button"
                            >
                                {copied ? '복사됨 ✓' : '복사'}
                            </Button>
                        ) : null}
                    </div>
                    {loading && !result ? (
                        <p className="m-0 py-16 text-center text-sm text-[#94a3b8]">
                            AI가 글을 작성하고 있습니다...
                        </p>
                    ) : result ? (
                        <textarea
                            className="min-h-[460px] w-full resize-y whitespace-pre-wrap rounded-md border border-[#e2e8f0] bg-[#f8fafc] px-3 py-2 text-sm leading-relaxed text-[#1f2937]"
                            onChange={(event) => setResult(event.target.value)}
                            value={result}
                        />
                    ) : (
                        <p className="m-0 py-16 text-center text-sm text-[#94a3b8]">
                            왼쪽에서 조건을 입력하고 글을 생성하세요
                        </p>
                    )}
                </div>
            </div>
        </section>
    );
}

// 작업 기록 갤러리 — 카테고리(블로그 대시보드 동일 탭 스타일)·작업자별 필터. 카드 클릭 시 편집기로 불러오기.
function BlogGalleryView({
    onUse,
    refreshKey,
}: {
    onUse: (text: string) => void;
    refreshKey: number;
}) {
    const [items, setItems] = useState<BlogOutput[]>([]);
    const [operators, setOperators] = useState<string[]>([]);
    const [category, setCategory] = useState('');
    const [operator, setOperator] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        let alive = true;
        setLoading(true);
        setError('');
        void getBlogOutputs({ category, operator })
            .then(({ data, error: loadError }) => {
                if (!alive) return;
                if (loadError) {
                    setError(
                        '작업 기록을 불러오지 못했습니다. Supabase 에서 blog_outputs 테이블을 만들었는지 확인하세요.',
                    );
                }
                setItems(data);
            })
            .finally(() => {
                if (alive) setLoading(false);
            });
        return () => {
            alive = false;
        };
    }, [category, operator, refreshKey]);

    useEffect(() => {
        let alive = true;
        void getBlogOperators().then(({ operators: ops }) => {
            if (alive) setOperators(ops);
        });
        return () => {
            alive = false;
        };
    }, [refreshKey]);

    const categoryTabs: Array<{ id: string; name: string }> = [
        { id: '', name: '전체' },
        ...WORK_CATEGORIES,
    ];

    return (
        <div className="rounded-[8px] border border-[#e2e8f0] bg-white p-4">
            <div className="mb-3">
                <strong className="text-[15px] text-[#0f172a]">작업 기록</strong>
                <p className="mt-1 mb-0 text-xs text-[#64748b]">
                    생성한 글이 작업자·카테고리·시간과 함께 자동 저장됩니다. (카드를 누르면 편집기로 불러옵니다)
                </p>
            </div>

            <div className="mb-3 flex flex-wrap gap-1 border-b border-[#e2e8f0]">
                {categoryTabs.map((c) => (
                    <button
                        className={`-mb-px border-b-2 px-3 py-2 text-sm font-semibold ${
                            category === c.id
                                ? 'border-[#1e40af] text-[#1e40af]'
                                : 'border-transparent text-[#94a3b8]'
                        }`}
                        key={c.id || 'all'}
                        onClick={() => setCategory(c.id)}
                        type="button"
                    >
                        {c.name}
                    </button>
                ))}
            </div>

            <div className="mb-4 flex items-center gap-2">
                <span className="text-xs font-semibold text-[#64748b]">작업자</span>
                <select
                    className="h-9 rounded-md border border-[#cbd5e1] bg-white px-2 text-sm"
                    onChange={(event) => setOperator(event.target.value)}
                    value={operator}
                >
                    <option value="">전체</option>
                    {operators.map((op) => (
                        <option key={op} value={op}>
                            {op}
                        </option>
                    ))}
                </select>
            </div>

            {error ? (
                <p className="m-0 rounded-md bg-[#fee2e2] px-4 py-3 text-sm text-[#dc2626]">{error}</p>
            ) : loading ? (
                <p className="m-0 text-sm text-[#64748b]">불러오는 중…</p>
            ) : items.length === 0 ? (
                <p className="m-0 text-sm text-[#94a3b8]">아직 저장된 작업물이 없습니다.</p>
            ) : (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {items.map((item) => (
                        <button
                            className="flex h-full flex-col rounded-md border border-[#e2e8f0] bg-[#f8fafc] p-3 text-left transition hover:border-[#1e40af]"
                            key={item.id}
                            onClick={() => onUse(item.content || '')}
                            title="편집기로 불러오기"
                            type="button"
                        >
                            <div className="mb-1 flex items-start justify-between gap-1">
                                <span className="line-clamp-2 text-sm font-semibold text-[#0f172a]">
                                    {item.title || item.topic || '제목 없음'}
                                </span>
                                {item.category_label ? (
                                    <span className="shrink-0 rounded bg-[#ede9fe] px-1.5 py-0.5 text-[10px] font-semibold text-[#7c3aed]">
                                        {item.category_label}
                                    </span>
                                ) : null}
                            </div>
                            <p className="m-0 line-clamp-4 flex-1 whitespace-pre-wrap text-xs leading-5 text-[#475569]">
                                {item.content || ''}
                            </p>
                            <div className="mt-2 flex items-center justify-between text-[10px] text-[#94a3b8]">
                                <span className="font-semibold text-[#64748b]">
                                    {item.operator_name || '미지정'}
                                </span>
                                <span>
                                    {new Date(item.created_at).toLocaleString('ko-KR', {
                                        day: '2-digit',
                                        hour: '2-digit',
                                        minute: '2-digit',
                                        month: '2-digit',
                                    })}
                                </span>
                            </div>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <label className="block text-xs font-semibold text-[#334155]">
            <span className="mb-1 block">{label}</span>
            {children}
        </label>
    );
}

export default BlogPage;
