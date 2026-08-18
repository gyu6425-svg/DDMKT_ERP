import { useEffect, useState } from 'react';
import { getBlogAccounts, insertBlogAccounts, deleteBlogAccount, extractBlogId, type BlogAccount } from '../../api/blogRank';
import { BlogRankProvider } from '../blogRank/lib/BlogRankContext';
import { TrackerTab } from '../blogRank/pages/TrackerTab';
import { LEAK_TRACK_CLIENT_ID } from '../../api/leakErp';
import { Card, Field, Th, Td, Empty, INPUT_CLS } from './ui';

// 누수탐지 블로그 — 관리시트(블로그 등록·목록) + 순위 트래커(계약관리 미연동).
//   순위 트래커는 회사ERP 블로그 트래커를 누수 client_id 로 스코프해 재사용. 크롤러가 자동 측정.
const TABS = [
    { key: 'sheet', label: '관리 시트' },
    { key: 'tracker', label: '순위 트래커' },
] as const;
type Tab = (typeof TABS)[number]['key'];

function BlogSheet({ notify }: { notify: (m: string) => void }) {
    const [rows, setRows] = useState<BlogAccount[]>([]);
    const [name, setName] = useState('');
    const [url, setUrl] = useState('');
    const [busy, setBusy] = useState(false);

    const load = async () => {
        const { data } = await getBlogAccounts(LEAK_TRACK_CLIENT_ID);
        setRows(data ?? []);
    };
    useEffect(() => { void load(); }, []);

    const add = async () => {
        if (!name.trim() || !url.trim()) { notify('!블로그 이름과 주소를 입력하세요'); return; }
        setBusy(true);
        const { error } = await insertBlogAccounts([{
            name: name.trim(), blog_url: url.trim(), blog_id: extractBlogId(url) || null,
            client_id: LEAK_TRACK_CLIENT_ID,
        }]);
        setBusy(false);
        if (error) { notify('!등록 실패: ' + error.message); return; }
        setName(''); setUrl(''); notify('블로그 등록 완료'); void load();
    };

    const remove = async (id: string) => {
        if (!window.confirm('이 블로그를 삭제할까요?')) return;
        const { error } = await deleteBlogAccount(id);
        if (error) { notify('!삭제 실패: ' + error.message); return; }
        void load();
    };

    return (
        <Card title={`누수탐지 블로그 (${rows.length})`}>
            <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_2fr_auto]">
                <Field label="블로그 이름"><input className={INPUT_CLS} value={name} onChange={(e) => setName(e.target.value)} placeholder="예) 누수탐지연구소" /></Field>
                <Field label="블로그 주소"><input className={INPUT_CLS} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://blog.naver.com/아이디" /></Field>
                <div className="flex items-end">
                    <button type="button" disabled={busy} onClick={() => void add()} className="h-9 rounded-md bg-[#1e40af] px-4 text-sm font-bold text-white hover:bg-[#1e3a8a] disabled:opacity-50">등록</button>
                </div>
            </div>
            <div className="overflow-x-auto">
                <table className="w-full min-w-[520px] border-collapse text-sm">
                    <thead><tr className="border-b border-[#e2e8f0]"><Th>이름</Th><Th>블로그 ID</Th><Th>주소</Th><Th align="center">삭제</Th></tr></thead>
                    <tbody>
                        {rows.length ? rows.map((r) => (
                            <tr key={r.id} className="border-b border-[#f1f5f9]">
                                <Td>{r.name}</Td>
                                <Td>{r.blog_id || '—'}</Td>
                                <Td><a className="text-[#2563eb] hover:underline" href={r.blog_url || undefined} target="_blank" rel="noreferrer">{r.blog_url}</a></Td>
                                <Td align="center"><button type="button" onClick={() => void remove(r.id)} className="rounded border border-[#fecaca] px-2 py-0.5 text-[11px] font-bold text-[#dc2626] hover:bg-[#fef2f2]">삭제</button></Td>
                            </tr>
                        )) : <tr><td colSpan={4}><Empty>등록된 블로그가 없습니다. 위에서 추가하세요.</Empty></td></tr>}
                    </tbody>
                </table>
            </div>
        </Card>
    );
}

export default function LeakBlogTab({ notify }: { notify: (m: string) => void }) {
    const [tab, setTab] = useState<Tab>('sheet');
    return (
        <div className="flex min-w-0 flex-col gap-4">
            <div>
                <h2 className="m-0 text-base font-bold text-[#0f172a]">누수탐지 블로그</h2>
                <p className="m-0 mt-0.5 text-xs text-[#64748b]">누수탐지 블로그 관리시트 · 순위 트래커 (계약관리와 별개)</p>
            </div>
            <div className="flex gap-1 border-b border-[#e2e8f0]">
                {TABS.map((t) => (
                    <button key={t.key} type="button" onClick={() => setTab(t.key)}
                        className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold ${tab === t.key ? 'border-[#1e40af] text-[#1e40af]' : 'border-transparent text-[#94a3b8] hover:text-[#475569]'}`}>
                        {t.label}
                    </button>
                ))}
            </div>
            {tab === 'sheet'
                ? <BlogSheet notify={notify} />
                : <BlogRankProvider customerMode previewClientId={LEAK_TRACK_CLIENT_ID}><TrackerTab /></BlogRankProvider>}
        </div>
    );
}
