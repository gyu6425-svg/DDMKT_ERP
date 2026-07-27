import { useEffect, useState } from 'react';
import { createCustomerPublishJob } from '../../api/cafePublishQueue';
import { getCafeAccounts } from '../../api/cafeAccounts';

// 고객 셀프 카페 발행 — 고객 포털의 '카페 자동화 발행' 탭.
//   승인(active + publish_enabled)된 본인 카페 계정으로만 큐에 적재 → 그 고객 PC 에이전트가 발행.
//   company/board 는 서버(cafe_accounts + RLS)가 강제 — 여기선 대상만 표시.
//   ⚠️ MVP: 제목·본문·태그 직접 입력. 원고 자동생성(CF)·이미지 카드는 다음 단계에서 확장.
export function CafeCustomerPublish({ companyKey }: { companyKey: string }) {
    const [board, setBoard] = useState<string | null>(null);
    const [approved, setApproved] = useState<boolean | null>(null);
    const [title, setTitle] = useState('');
    const [body, setBody] = useState('');
    const [tags, setTags] = useState('');
    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

    useEffect(() => {
        let alive = true;
        void getCafeAccounts().then(({ data }) => {
            if (!alive) return;
            const a = data.find((x) => x.company_key === companyKey);
            setBoard(a?.board_name ?? null);
            // publish_enabled 컬럼이 아직 없을 수 있음 → 있으면 그 값, 없으면 active 로 판단.
            const pe = (a as { publish_enabled?: boolean } | undefined)?.publish_enabled;
            setApproved(!!a?.active && pe !== false);
        });
        return () => { alive = false; };
    }, [companyKey]);

    async function submit() {
        if (!title.trim() || !body.trim()) {
            setMsg({ ok: false, text: '제목과 본문을 입력해 주세요.' });
            return;
        }
        setBusy(true);
        setMsg(null);
        const tagList = tags.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 10);
        const { error, jobId } = await createCustomerPublishJob({
            title: title.trim(),
            body,
            images: [],
            tags: tagList,
        });
        setBusy(false);
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
                <p className="mx-auto mt-2 max-w-md text-sm text-[#94a3b8]">담당자에게 문의해 주세요. 승인되면 이 화면에서 바로 발행할 수 있습니다.</p>
            </div>
        );
    }

    return (
        <div className="grid gap-4">
            <div className="rounded-lg bg-[#eff6ff] px-4 py-3 text-sm text-[#1e40af]">
                발행 대상 게시판: <b>{board ?? '(확인 중)'}</b>
                <span className="ml-2 text-[#64748b]">— 발행하면 본인 카페의 이 게시판에 자동 게시됩니다.</span>
            </div>

            <label className="grid gap-1 text-sm font-semibold text-[#334155]">
                제목
                <input
                    className="rounded-lg border border-[#cbd5e1] px-3 py-2 text-sm font-normal"
                    maxLength={100}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="예) 광교동 입주청소 후기 정리"
                    value={title}
                />
            </label>

            <label className="grid gap-1 text-sm font-semibold text-[#334155]">
                본문
                <textarea
                    className="min-h-[220px] rounded-lg border border-[#cbd5e1] px-3 py-2 text-sm font-normal leading-relaxed"
                    onChange={(e) => setBody(e.target.value)}
                    placeholder="본문을 입력하세요. 문단은 빈 줄로 나눠 주세요."
                    value={body}
                />
            </label>

            <label className="grid gap-1 text-sm font-semibold text-[#334155]">
                태그 (선택, 쉼표로 구분 · 최대 10개)
                <input
                    className="rounded-lg border border-[#cbd5e1] px-3 py-2 text-sm font-normal"
                    onChange={(e) => setTags(e.target.value)}
                    placeholder="예) 광교동청소, 입주청소, 이사청소"
                    value={tags}
                />
            </label>

            {msg ? (
                <div className={`rounded-lg px-4 py-3 text-sm ${msg.ok ? 'bg-[#ecfdf5] text-[#047857]' : 'bg-[#fef2f2] text-[#b91c1c]'}`}>
                    {msg.text}
                </div>
            ) : null}

            <div className="flex items-center gap-3">
                <button
                    className="rounded-lg bg-[#1e40af] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                    disabled={busy}
                    onClick={submit}
                    type="button"
                >
                    {busy ? '등록 중…' : '발행하기'}
                </button>
                <span className="text-xs text-[#94a3b8]">등록 후 내 PC의 발행 프로그램이 순서대로 카페에 올립니다.</span>
            </div>
        </div>
    );
}
