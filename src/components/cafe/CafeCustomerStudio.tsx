import { useEffect, useState } from 'react';
import { generateCafe, generateCafeReview } from '../../api/cafeWriter';
import { createCustomerPublishJob } from '../../api/cafePublishQueue';
import { getCafeAccounts } from '../../api/cafeAccounts';

// 고객 셀프 카페 발행 스튜디오 (고객 ERP > 카페 > "카페 자동화 발행" 탭)
//   흐름: 승인 확인 → 키워드/주제 입력 → [원고 자동생성](CF) → 제목·본문 편집 → [발행하기].
//   발행 = createCustomerPublishJob → 큐 → 고객 PC 에이전트가 자기 카페에 게시.
//   company/board 는 서버(cafe_accounts + RLS)가 강제, 위조 불가.
//
//   ⚠️ 내일 이어서 할 것(TODO):
//     - 이미지 카드 자동생성(generateCafeCard) + 미리보기·순서. 지금은 텍스트 발행(images:[]).
//     - 발행 현황 목록(내 큐 상태: pending/posted/done) 표시.
//     - 톤/글자수/분량 옵션 노출, 원고 형식검사(마커) — 이미지 붙일 때 필요.
//     - 내부 CafeStudioTab 자산(고정 배너·실사) 재사용 여부 결정.

type Tone = 'review' | 'info' | 'story' | 'talk';
const TONES: { key: Tone; name: string }[] = [
    { key: 'review', name: '후기형' },
    { key: 'info', name: '정보형' },
    { key: 'story', name: '스토리형' },
    { key: 'talk', name: '대화형' },
];

export function CafeCustomerStudio({ companyKey }: { companyKey: string }) {
    const [board, setBoard] = useState<string | null>(null);
    const [brandDefault, setBrandDefault] = useState('');
    const [approved, setApproved] = useState<boolean | null>(null);

    // 입력
    const [keyword, setKeyword] = useState('');
    const [region, setRegion] = useState('');
    const [brand, setBrand] = useState('');
    const [business, setBusiness] = useState('');
    const [tone, setTone] = useState<Tone>('review');
    const [tags, setTags] = useState('');

    // 생성 결과(편집 가능)
    const [title, setTitle] = useState('');
    const [body, setBody] = useState('');

    const [genBusy, setGenBusy] = useState(false);
    const [pubBusy, setPubBusy] = useState(false);
    const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

    useEffect(() => {
        let alive = true;
        void getCafeAccounts().then(({ data }) => {
            if (!alive) return;
            const a = data.find((x) => x.company_key === companyKey);
            setBoard(a?.board_name ?? null);
            setBrandDefault(a?.display_name ?? '');
            if (!brand && a?.display_name) setBrand(a.display_name);
            const pe = (a as { publish_enabled?: boolean } | undefined)?.publish_enabled;
            setApproved(!!a?.active && pe !== false);
        });
        return () => { alive = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [companyKey]);

    async function generate() {
        if (!keyword.trim()) {
            setMsg({ ok: false, text: '주제(키워드)를 입력해 주세요. 예) 광교동 입주청소' });
            return;
        }
        setGenBusy(true);
        setMsg(null);
        try {
            // 1) 카드 소재(구조화 원고) 생성 → 2) 그 소재로 후기 본문 생성(layout:'bottom' = 사진 마커 없는 순수 본문).
            const g = await generateCafe({
                keyword: keyword.trim(),
                region: region.trim() || undefined,
                brand: brand.trim() || brandDefault || undefined,
                business: business.trim() || undefined,
            });
            const rv = await generateCafeReview({
                keyword: keyword.trim(),
                region: region.trim() || undefined,
                brand: brand.trim() || brandDefault || undefined,
                business: business.trim() || undefined,
                content: g.content,
                tone,
                count: 6,
                layout: 'bottom',
            });
            setTitle(rv.title || '');
            setBody(rv.reviewBody || '');
            setMsg({ ok: true, text: '원고를 생성했습니다. 내용을 확인·수정한 뒤 발행하세요.' });
        } catch (e) {
            setMsg({ ok: false, text: (e as Error).message || '원고 생성에 실패했습니다.' });
        } finally {
            setGenBusy(false);
        }
    }

    async function publish() {
        if (!title.trim() || !body.trim()) {
            setMsg({ ok: false, text: '제목과 본문이 필요합니다. 먼저 원고를 생성하거나 입력하세요.' });
            return;
        }
        setPubBusy(true);
        setMsg(null);
        const tagList = tags.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 10);
        const { error, jobId } = await createCustomerPublishJob({
            title: title.trim(),
            body,
            images: [], // TODO(내일): 이미지 카드 생성 붙이면 여기에 dataURL 배열
            tags: tagList,
        });
        setPubBusy(false);
        if (error) {
            setMsg({ ok: false, text: (error as { message?: string }).message || '발행 등록에 실패했습니다.' });
            return;
        }
        setMsg({ ok: true, text: `발행 등록 완료 — 대기열에 담겼습니다. 잠시 후 카페에 게시됩니다. (#${(jobId || '').slice(0, 8)})` });
        setTitle('');
        setBody('');
        setTags('');
    }

    if (approved === false) {
        return (
            <div className="rounded-xl border border-dashed border-[#cbd5e1] bg-[#f8fafc] px-6 py-16 text-center">
                <div className="text-base font-semibold text-[#475569]">카페 자동화 발행이 아직 승인되지 않았습니다</div>
                <p className="mx-auto mt-2 max-w-md text-sm text-[#94a3b8]">담당자에게 문의해 주세요. 승인되면 이 화면에서 바로 원고 생성·발행이 가능합니다.</p>
            </div>
        );
    }

    const inputCls = 'h-10 rounded-lg border border-[#cbd5e1] bg-white px-3 text-sm';

    return (
        <div className="grid gap-4">
            <div className="rounded-lg bg-[#eff6ff] px-4 py-3 text-sm text-[#1e40af]">
                발행 대상 게시판: <b>{board ?? '(확인 중)'}</b>
                <span className="ml-2 text-[#64748b]">— 발행하면 본인 카페의 이 게시판에 자동 게시됩니다.</span>
            </div>

            {/* 입력 */}
            <div className="rounded-xl border border-[#e2e8f0] bg-white p-4">
                <div className="mb-3 text-[13px] font-bold text-[#334155]">1. 주제 입력 후 원고 자동생성</div>
                <div className="grid gap-3 sm:grid-cols-2">
                    <label className="grid gap-1 text-xs font-semibold text-[#475569]">
                        주제 · 키워드 (필수)
                        <input className={inputCls} onChange={(e) => setKeyword(e.target.value)} placeholder="예) 광교동 입주청소" value={keyword} />
                    </label>
                    <label className="grid gap-1 text-xs font-semibold text-[#475569]">
                        지역 (선택)
                        <input className={inputCls} onChange={(e) => setRegion(e.target.value)} placeholder="예) 수원 광교동" value={region} />
                    </label>
                    <label className="grid gap-1 text-xs font-semibold text-[#475569]">
                        업체명
                        <input className={inputCls} onChange={(e) => setBrand(e.target.value)} placeholder={brandDefault || '업체명'} value={brand} />
                    </label>
                    <label className="grid gap-1 text-xs font-semibold text-[#475569]">
                        업종 (선택)
                        <input className={inputCls} onChange={(e) => setBusiness(e.target.value)} placeholder="예) 입주청소" value={business} />
                    </label>
                    <label className="grid gap-1 text-xs font-semibold text-[#475569]">
                        말투
                        <select className={inputCls} onChange={(e) => setTone(e.target.value as Tone)} value={tone}>
                            {TONES.map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}
                        </select>
                    </label>
                </div>
                <button
                    className="mt-3 h-10 rounded-lg bg-[#4338ca] px-5 text-sm font-bold text-white hover:bg-[#3730a3] disabled:opacity-50"
                    disabled={genBusy}
                    onClick={generate}
                    type="button"
                >
                    {genBusy ? '원고 생성 중… (최대 1~2분)' : '원고 자동생성'}
                </button>
            </div>

            {/* 편집 */}
            <div className="rounded-xl border border-[#e2e8f0] bg-white p-4">
                <div className="mb-3 text-[13px] font-bold text-[#334155]">2. 확인·수정 후 발행</div>
                <label className="grid gap-1 text-xs font-semibold text-[#475569]">
                    제목
                    <input className={inputCls} maxLength={100} onChange={(e) => setTitle(e.target.value)} placeholder="원고 생성 시 자동 입력됩니다" value={title} />
                </label>
                <label className="mt-3 grid gap-1 text-xs font-semibold text-[#475569]">
                    본문
                    <textarea className="min-h-[260px] rounded-lg border border-[#cbd5e1] bg-white px-3 py-2 text-sm font-normal leading-relaxed" onChange={(e) => setBody(e.target.value)} placeholder="원고 생성 시 자동 입력됩니다. 직접 수정할 수 있습니다." value={body} />
                </label>
                <label className="mt-3 grid gap-1 text-xs font-semibold text-[#475569]">
                    태그 (선택, 쉼표로 구분 · 최대 10개)
                    <input className={inputCls} onChange={(e) => setTags(e.target.value)} placeholder="예) 광교동청소, 입주청소, 이사청소" value={tags} />
                </label>

                {msg ? (
                    <div className={`mt-3 rounded-lg px-4 py-3 text-sm ${msg.ok ? 'bg-[#ecfdf5] text-[#047857]' : 'bg-[#fef2f2] text-[#b91c1c]'}`}>
                        {msg.text}
                    </div>
                ) : null}

                <div className="mt-3 flex items-center gap-3">
                    <button
                        className="h-10 rounded-lg bg-[#0f766e] px-5 text-sm font-bold text-white hover:bg-[#115e59] disabled:opacity-50"
                        disabled={pubBusy || genBusy}
                        onClick={publish}
                        type="button"
                    >
                        {pubBusy ? '등록 중…' : '발행하기'}
                    </button>
                    <span className="text-xs text-[#94a3b8]">등록 후 내 PC의 발행 프로그램이 순서대로 카페에 올립니다(즉시 게시 아님).</span>
                </div>
            </div>
        </div>
    );
}
