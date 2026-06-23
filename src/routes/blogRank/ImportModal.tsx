import { useState } from 'react';
import { extractBlogId, insertBlogAccounts, updateBlogAccount, type BlogAccount } from '../../api/blogRank';

export function ImportModal({
    existing,
    onClose,
    onReload,
    onToast,
}: {
    existing: BlogAccount[];
    onClose: () => void;
    onReload: () => Promise<void>;
    onToast: (message: string) => void;
}) {
    const [text, setText] = useState('');
    const [saving, setSaving] = useState(false);

    // 한 줄을 칸으로 분리. 탭이 있으면 탭, 없으면 슬래시(/). URL·날짜 속 내부 슬래시는 보호 후 분리(깨짐 방지).
    const splitFields = (line: string): string[] => {
        if (line.includes('\t')) {
            return line.split('\t').map((c) => c.trim());
        }
        const prot: string[] = [];
        const mark = (m: string) => {
            prot.push(m);
            return `\uF8FF${prot.length - 1}\uF8FF`;
        };
        let s = line.replace(/(?:https?:\/\/)?[\w.-]+\.[a-z]{2,}(?:\/[^\s]*)?/gi, mark); // URL/도메인 보호
        s = s.replace(/\d{1,4}\/\d{1,2}\/\d{1,4}/g, mark); // 2026/06/23 형식 날짜 보호
        return s
            .split('/')
            .map((c) => c.replace(/\uF8FF(\d+)\uF8FF/g, (_, i) => prot[Number(i)]).trim());
    };
    const toNum = (v: string | undefined): number | null => {
        const m = (v || '').match(/\d+/);
        return m ? Number(m[0]) : null;
    };
    // 계약일자: '~월~일'만 입력하면 연도 자동 — 현재 월보다 크면 작년(미래월=지난해), 작거나 같으면 올해.
    const parseContractDate = (v: string | undefined): string | null => {
        const s = (v || '').trim();
        if (!s) return null;
        if (/\d{4}/.test(s)) return s; // 이미 연도 포함이면 그대로
        const m = s.match(/(\d{1,2})\s*[월./-]\s*(\d{1,2})/);
        if (!m) return s; // '월/일' 형식 아니면 원문 유지
        const month = Number(m[1]);
        const day = Number(m[2]);
        if (month < 1 || month > 12 || day < 1 || day > 31) return s;
        const now = new Date();
        const curMonth = now.getMonth() + 1;
        const year = month > curMonth ? now.getFullYear() - 1 : now.getFullYear();
        return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    };

    const doImport = async () => {
        const raw = text.trim();
        if (!raw) {
            return;
        }
        const existingUrls = new Set(existing.map((a) => a.blog_url));
        const existingNames = new Set(existing.map((a) => a.name));
        const payloads: Array<Partial<BlogAccount>> = [];
        let skippedDup = 0; // 이미 등록됨(중복)
        let skippedNoUrl = 0; // 발행 URL 없음

        raw.split('\n').forEach((line) => {
            const trimmed = line.trim();
            if (!trimmed) {
                return;
            }
            // 붙여넣기 고정 순서(탭 또는 / 구분):
            // 업체명 / 계약일자 / 계약건수 / 잔여건수 / 총 발행건수 / 발행 URL / 기자단
            let f = splitFields(trimmed);
            // 맨 앞 행번호(첫 칸이 숫자만) 제거 — 업체명은 숫자만일 수 없음.
            if (f.length > 1 && /^\d+$/.test(f[0])) {
                f = f.slice(1);
            }
            const blogUrl =
                f[5] && f[5].includes('blog.naver.com')
                    ? f[5]
                    : f.find((c) => c && c.includes('blog.naver.com'));
            if (!blogUrl) {
                skippedNoUrl += 1;
                return;
            }
            const name =
                f[0] && !f[0].includes('http') && !f[0].includes('blog.naver.com')
                    ? f[0]
                    : extractBlogId(blogUrl) || '블로그';
            if (
                existingUrls.has(blogUrl) ||
                existingNames.has(name) ||
                payloads.some((p) => p.blog_url === blogUrl)
            ) {
                skippedDup += 1;
                return;
            }
            payloads.push({
                blog_id: extractBlogId(blogUrl),
                blog_url: blogUrl,
                name,
                manager: null, // 담당자는 비워두고 등록 후 프롬프트에서 입력
                contract_date: parseContractDate(f[1]),
                goal_count: toNum(f[2]),
                remain_count: toNum(f[3]),
                weekly: f[4] || null, // 총 발행건수
                reporter: f[6] || null,
                // 금액·아이디·비밀번호·발행관리시트·특이사항·연락처는 등록 후 편집에서 따로 입력
                is_active: true,
            });
        });

        if (!payloads.length) {
            const reasons = [
                skippedDup ? `이미 등록됨 ${skippedDup}건` : '',
                skippedNoUrl ? `발행 URL 없음 ${skippedNoUrl}건` : '',
            ]
                .filter(Boolean)
                .join(' · ');
            onToast(`등록할 항목이 없습니다${reasons ? ` (${reasons})` : ''}`);
            return;
        }

        setSaving(true);
        const { data, error } = await insertBlogAccounts(payloads);
        setSaving(false);
        if (error) {
            onToast(`오류: ${error.message}`);
            return;
        }
        await onReload();
        const skipNote =
            skippedDup || skippedNoUrl
                ? ` · 건너뜀 ${skippedDup ? `이미등록 ${skippedDup}` : ''}${skippedDup && skippedNoUrl ? '/' : ''}${skippedNoUrl ? `URL없음 ${skippedNoUrl}` : ''}`
                : '';
        onToast(`${payloads.length}개 등록 완료${skipNote}`);
        // 등록 직후 담당자 입력 프롬프트(담당은 시트에 없어 비워둔 상태) — 바로 채울 수 있게.
        if (data && data.length) {
            setMgrPrompt(data);
        } else {
            onClose();
        }
    };

    // 담당자 일괄 입력
    const [mgrPrompt, setMgrPrompt] = useState<BlogAccount[] | null>(null);
    const [mgrInputs, setMgrInputs] = useState<Record<string, string>>({});
    const [mgrSaving, setMgrSaving] = useState(false);

    const saveManagers = async () => {
        if (!mgrPrompt) return;
        setMgrSaving(true);
        for (const acc of mgrPrompt) {
            const m = (mgrInputs[acc.id] || '').trim();
            if (m) {
                await updateBlogAccount(acc.id, { manager: m });
            }
        }
        setMgrSaving(false);
        await onReload();
        onToast('담당자 저장 완료');
        onClose();
    };

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
            onMouseDown={(e) => e.target === e.currentTarget && onClose()}
        >
            <div className="w-[min(620px,94vw)] rounded-2xl bg-white p-6">
                {mgrPrompt ? (
                    <>
                        <h3 className="m-0 text-lg font-bold">담당자 입력</h3>
                        <p className="mt-1 mb-3 text-sm text-[#64748b]">
                            방금 등록한 <b>{mgrPrompt.length}개</b> 업체의 담당자를 입력하세요. (담당은 시트에 없어
                            비워둔 상태 · 비워두고 나중에 편집에서 수정도 가능)
                        </p>
                        <div className="grid max-h-[52vh] gap-2 overflow-y-auto">
                            {mgrPrompt.map((acc, i) => (
                                <label
                                    className="grid grid-cols-[1fr_1.4fr] items-center gap-2 text-sm"
                                    key={acc.id}
                                >
                                    <span className="truncate font-semibold text-[#334155]">{acc.name}</span>
                                    <input
                                        autoFocus={i === 0}
                                        className="h-9 rounded-md border border-[#cbd5e1] bg-white px-2 text-sm"
                                        onChange={(e) =>
                                            setMgrInputs((s) => ({ ...s, [acc.id]: e.target.value }))
                                        }
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                                e.preventDefault();
                                                void saveManagers();
                                            }
                                        }}
                                        placeholder="담당자를 입력하세요"
                                        value={mgrInputs[acc.id] || ''}
                                    />
                                </label>
                            ))}
                        </div>
                        <div className="mt-4 flex justify-end gap-2">
                            <button
                                className="rounded-md border border-[#cbd5e1] px-4 py-2 text-sm font-semibold text-[#64748b]"
                                onClick={onClose}
                                type="button"
                            >
                                건너뛰기
                            </button>
                            <button
                                className="rounded-md bg-[#1e40af] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                                disabled={mgrSaving}
                                onClick={() => void saveManagers()}
                                type="button"
                            >
                                {mgrSaving ? '저장 중...' : '저장'}
                            </button>
                        </div>
                    </>
                ) : (
                    <>
                        <h3 className="m-0 text-lg font-bold">시트 붙여넣기 등록</h3>
                        <p className="mt-1 mb-3 text-sm text-[#64748b]">
                            한 줄에 블로그 하나. <b>엑셀에서 행을 복사해 붙여넣으면</b> 됩니다(탭 구분). 칸 순서는 아래
                            고정 순서입니다(빈 칸은 비워두면 됨):
                            <br />
                            <span className="mt-1 inline-block rounded bg-[#f1f5f9] px-1.5 py-1 text-xs">
                                업체명 / 계약일자 / 계약건수 / 잔여건수 / 총 발행건수 / 발행 URL / 기자단
                            </span>
                            <br />
                            <b>계약일자</b>는 <b>“7월 15일”</b>처럼 월·일만 적으면 연도 자동(현재 월보다 크면 작년,
                            작거나 같으면 올해). <b>담당자</b>는 등록 후 바로 입력하는 창이 뜹니다. (금액·아이디·비밀번호·발행관리시트·특이사항은
                            등록 후 편집에서 입력 · 직접 칠 땐 / 구분도 가능 · 블로그 URL만 붙여도 등록)
                        </p>
                        <textarea
                            className="min-h-[160px] w-full resize-y rounded-md border-2 border-dashed border-[#cbd5e1] bg-[#f8fafc] px-3 py-2 font-mono text-xs"
                            onChange={(e) => setText(e.target.value)}
                            placeholder={
                                '참조와이엘\t7월 15일\t30건\t25건\t주5회\thttps://blog.naver.com/puleenbe\t장지영\nhttps://blog.naver.com/bau_j2'
                            }
                            value={text}
                        />
                        <div className="mt-4 flex justify-end gap-2">
                            <button
                                className="rounded-md border border-[#cbd5e1] px-4 py-2 text-sm font-semibold text-[#64748b]"
                                onClick={onClose}
                                type="button"
                            >
                                닫기
                            </button>
                            <button
                                className="rounded-md bg-[#1e40af] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                                disabled={saving}
                                onClick={() => void doImport()}
                                type="button"
                            >
                                {saving ? '등록 중...' : '등록하기'}
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}

// ───────────────────────── 공용 ─────────────────────────
