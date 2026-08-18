import { useState } from 'react';
import { extractBlogId, insertBlogAccounts, findBlogAccountByUrl } from '../../../api/blogRank';

// 블로그 관리 시트 '가이드 추가' — 고정 라벨(삭제 불가) 옆 칸에 값을 입력하면 그대로 등록.
//   업체명/계약일자/계약건수/잔여건수/총 발행건수/발행 URL/기자단.
//   잔여건수 비우고 총 발행건수만 넣으면 잔여 = 계약 - 발행 으로 자동 계산.
type Key = 'name' | 'contract_date' | 'goal' | 'remain' | 'published' | 'blog_url' | 'reporter';
const FIELDS: { key: Key; label: string; type: string; ph: string }[] = [
    { key: 'name', label: '업체명', type: 'text', ph: '업체명 입력' },
    { key: 'contract_date', label: '계약일자', type: 'date', ph: '' },
    { key: 'goal', label: '계약건수', type: 'number', ph: '예: 30' },
    { key: 'remain', label: '잔여건수', type: 'number', ph: '예: 12 (비우면 자동)' },
    { key: 'published', label: '총 발행건수', type: 'number', ph: '예: 18 (계약-잔여)' },
    { key: 'blog_url', label: '발행 URL', type: 'text', ph: 'https://blog.naver.com/아이디' },
    { key: 'reporter', label: '기자단', type: 'text', ph: '기자단 입력' },
];

export function GuideAddForm({
    onReload,
    onToast,
}: {
    onReload: () => Promise<void>;
    onToast: (m: string) => void;
}) {
    const [open, setOpen] = useState(false);
    const [v, setV] = useState<Partial<Record<Key, string>>>({});
    const [saving, setSaving] = useState(false);
    const set = (k: Key, val: string) => setV((p) => ({ ...p, [k]: val }));
    const reset = () => setV({});

    const submit = async () => {
        const name = (v.name || '').trim();
        if (!name) {
            onToast('업체명을 입력하세요');
            return;
        }
        const url = (v.blog_url || '').trim();
        const goal = v.goal ? Number.parseInt(v.goal, 10) : null;
        const published = v.published ? Number.parseInt(v.published, 10) : null;
        let remain = v.remain ? Number.parseInt(v.remain, 10) : null;
        if (remain == null && goal != null && published != null) remain = goal - published; // 잔여 자동
        setSaving(true);
        // 같은 URL 이 이미 등록돼 있으면 '어느 업체'인지 알려준다 — duplicate key 원문만으론 알 수 없다.
        if (url) {
            const owner = await findBlogAccountByUrl(url);
            if (owner) {
                setSaving(false);
                onToast(`이미 등록된 발행 URL 입니다 — '${owner.name}'. 같은 블로그를 업체 두 개로 만들 수 없습니다.`);
                return;
            }
        }
        const { error } = await insertBlogAccounts([
            {
                name,
                // ★ URL 을 비우면 반드시 null — 빈 문자열로 넣으면 안 된다.
                //   blog_accounts.blog_url 은 unique 라 ''도 '값'으로 취급돼, URL 없이 등록할 수 있는
                //   업체가 딱 하나뿐이 된다(두 번째부터 duplicate key). NULL 은 여러 개 허용된다.
                //   실측 2026-08-18: 금융책사가 ''를 차지하고 있어 그 뒤 등록이 전부 실패했다.
                blog_url: url || null,
                blog_id: url ? extractBlogId(url) || null : null,
                contract_date: (v.contract_date || '').trim() || null,
                goal_count: goal,
                remain_count: remain,
                reporter: (v.reporter || '').trim() || null,
                is_active: true,
            },
        ]);
        setSaving(false);
        if (error) {
            // 중복 URL 은 원문(duplicate key ... blog_accounts_blog_url_key)이 무슨 말인지 알 수 없다 → 사람 말로.
            const msg = error.message || '';
            if (/null value in column .?blog_url/i.test(msg)) {
                // DB가 아직 NOT NULL — URL 없는 업체를 하나밖에 못 만든다.
                onToast('발행 URL 없이 등록하려면 docs/blog-url-nullable.sql 을 먼저 실행해야 합니다. 지금은 URL 을 입력해 주세요.');
            } else if (/duplicate key|blog_url_key/i.test(msg)) {
                onToast('이미 등록된 발행 URL 입니다 — 관리시트에서 그 업체를 찾아 수정하세요.');
            } else {
                onToast(`오류: ${msg}`);
            }
            return;
        }
        reset();
        await onReload();
        onToast(`${name} 등록 완료`);
    };

    return (
        <div className="rounded-xl border border-[#e2e8f0] bg-white">
            <button
                className="flex w-full items-center justify-between px-4 py-2.5 text-sm font-bold text-[#1e40af]"
                onClick={() => setOpen((o) => !o)}
                type="button"
            >
                <span>＋ 업체 추가 (가이드 입력)</span>
                <span className="text-xs text-[#94a3b8]">{open ? '접기 ▲' : '펼치기 ▼'}</span>
            </button>
            {open ? (
                <div className="grid gap-2 border-t border-[#e2e8f0] p-4">
                    {FIELDS.map((f) => (
                        <div className="flex items-center gap-2" key={f.key}>
                            <span className="w-24 shrink-0 text-sm font-semibold text-[#475569]">
                                {f.label} :
                            </span>
                            <input
                                className="h-9 w-full min-w-0 rounded-md border border-[#cbd5e1] bg-white px-3 text-sm"
                                onChange={(e) => set(f.key, e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && f.key !== 'name' && void submit()}
                                placeholder={f.ph}
                                type={f.type}
                                value={v[f.key] || ''}
                            />
                        </div>
                    ))}
                    <div className="mt-1 flex justify-end gap-2">
                        <button
                            className="rounded-md border border-[#cbd5e1] px-3 py-1.5 text-xs font-semibold text-[#64748b]"
                            onClick={reset}
                            type="button"
                        >
                            초기화
                        </button>
                        <button
                            className="rounded-md bg-[#1e40af] px-4 py-1.5 text-xs font-bold text-white disabled:opacity-50"
                            disabled={saving}
                            onClick={() => void submit()}
                            type="button"
                        >
                            {saving ? '등록 중…' : '등록'}
                        </button>
                    </div>
                </div>
            ) : null}
        </div>
    );
}
