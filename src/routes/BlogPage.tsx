import { useRef, useState } from 'react';
import { generateBlog, type GenerateBlogInput } from '../api/aiBlog';
import { logApiUsage } from '../api/apiUsage';
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

    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState('');
    const [error, setError] = useState('');
    const [copied, setCopied] = useState(false);
    const abortRef = useRef<AbortController | null>(null);

    const run = async () => {
        if (!topic.trim()) {
            setError('주제를 입력해주세요.');
            return;
        }
        setError('');
        setResult('');
        setLoading(true);

        const controller = new AbortController();
        abortRef.current = controller;
        const startedAt = Date.now();

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
            void logApiUsage({
                elapsed_ms: Date.now() - startedAt,
                model: 'blog',
                provider: 'openai',
                status: 'success',
                total_tokens: output.usage?.total_tokens ?? null,
                user_email: user?.email ?? null,
            });
        } catch (caught) {
            const message = caught instanceof Error ? caught.message : '생성에 실패했습니다.';
            setError(message);
            void logApiUsage({
                elapsed_ms: Date.now() - startedAt,
                error_message: message,
                model: 'blog',
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

    return (
        <section className="grid gap-4">
            <div>
                <p className="m-0 text-sm text-[#64748b]">
                    AI로 네이버 블로그용 SEO 글을 생성합니다
                </p>
            </div>

            <div className="grid gap-4 lg:grid-cols-[380px_minmax(0,1fr)]">
                {/* 입력 */}
                <div className="grid h-fit gap-3 rounded-[8px] border border-[#e2e8f0] bg-white p-4">
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <label className="block text-xs font-semibold text-[#334155]">
            <span className="mb-1 block">{label}</span>
            {children}
        </label>
    );
}

export default BlogPage;
