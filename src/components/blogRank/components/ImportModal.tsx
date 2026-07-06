import { useState } from 'react';
import { extractBlogId, insertBlogAccounts, updateBlogAccount, type BlogAccount } from '../../../api/blogRank';
import { findCol, num, parseTsvGrid } from '../../../lib/contractImport';

// 미리 채워둘 머리글(탭 구분) — 실제 시트 컬럼과 동일. 사용자는 이 아래에 데이터만 붙여넣음.
const BLOG_HEADER =
    '업체명\t연락처\t계약일자\t금액\t계약건수\t잔여건수\t주 발행건수\t아이디\t비밀번호\t발행 관리시트\t발행 URL\t기자단\t특이사항';

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
    const [text, setText] = useState(BLOG_HEADER + '\n'); // 머리글 미리채움 → 아래에 데이터만 붙여넣기
    const [saving, setSaving] = useState(false);

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
        let skippedNoUrl = 0; // 발행 URL·업체명 없음

        // 머리글 기반 파싱(따옴표 여러 줄 셀=특이사항 지원). 첫 행=머리글, 컬럼은 이름으로 매칭(순서 무관).
        const grid = parseTsvGrid(raw);
        if (grid.length < 2) {
            onToast('머리글 아래에 데이터를 붙여넣어 주세요.');
            return;
        }
        const H = grid[0].map((s) => s.trim());
        const iName = findCol(H, ['업체명', '업체']);
        const iContact = findCol(H, ['연락처']);
        const iDate = findCol(H, ['계약일자', '계약일']);
        const iAmount = findCol(H, ['금액']);
        const iGoal = findCol(H, ['계약건수']);
        const iRemain = findCol(H, ['잔여']);
        const iWeekly = findCol(H, ['주발행', '발행건수']);
        const iLoginId = findCol(H, ['아이디']);
        const iLoginPw = findCol(H, ['비밀번호', '비번']);
        const iSheet = findCol(H, ['관리시트', '발행관리']);
        const iUrl = findCol(H, ['발행URL', 'URL', '블로그']);
        const iReporter = findCol(H, ['기자단']);
        const iNote = findCol(H, ['특이사항', '비고']);

        let mismatch = 0; // 칸 수가 헤더와 다른 줄(정렬 어긋남 의심)
        for (const c of grid.slice(1)) {
            const g = (idx: number) => (idx >= 0 ? (c[idx] || '').trim() : '');
            const nonEmpty = c.some((x) => (x || '').trim());
            if (nonEmpty && c.length !== H.length) mismatch += 1;
            const name = g(iName);
            const urlCell = g(iUrl);
            const blogUrl = urlCell.includes('blog.naver.com')
                ? urlCell
                : c.find((x) => x && x.includes('blog.naver.com')) || '';
            // 발행 관리시트 = 헤더 위치값이 시트 URL이면 그대로, 아니면 구글시트 링크를 내용으로 탐지.
            const sheetCell = g(iSheet);
            const manageUrl = /docs\.google|spreadsheets/.test(sheetCell)
                ? sheetCell
                : c.find((x) => /docs\.google|spreadsheets/.test(x || '')) || '';
            if (!blogUrl) {
                // 발행 URL 없으면 등록 불가(크롤 대상 아님). 완전 빈 줄은 조용히 건너뜀.
                if (name || c.some((x) => (x || '').trim())) skippedNoUrl += 1;
                continue;
            }
            const finalName = name || extractBlogId(blogUrl) || '블로그';
            if (
                (blogUrl && existingUrls.has(blogUrl)) ||
                existingNames.has(finalName) ||
                payloads.some((p) => (blogUrl && p.blog_url === blogUrl) || p.name === finalName)
            ) {
                skippedDup += 1;
                continue;
            }
            const amt = g(iAmount) ? num(g(iAmount)) : null;
            payloads.push({
                name: finalName,
                contact: g(iContact) || null,
                contract_date: parseContractDate(g(iDate)),
                amounts: amt ? [{ amount: amt }] : null, // 금액 → 누적 계약금액 내역 1건
                goal_count: toNum(g(iGoal)),
                remain_count: toNum(g(iRemain)),
                weekly: g(iWeekly) || null,
                login_id: g(iLoginId) || null,
                login_pw: g(iLoginPw) || null,
                manage_sheet_url: manageUrl || null,
                blog_url: blogUrl,
                blog_id: extractBlogId(blogUrl),
                reporter: g(iReporter) || null,
                note: g(iNote) || null,
                manager: null, // 담당자는 등록 후 프롬프트
                is_active: true,
            });
        }

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
        const mmNote = mismatch ? ` · ⚠ 칸 수 불일치 ${mismatch}줄(연락처 등 빈 칸도 유지 필요)` : '';
        onToast(`${payloads.length}개 등록 완료${skipNote}${mmNote}`);
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
                            <b>맨 윗줄(머리글)은 그대로 두고</b>, 그 아래에 엑셀 행을 복사해 붙여넣으세요(탭 구분).
                            컬럼은 <b>머리글 이름으로 자동 인식</b>(순서 무관). <b>특이사항이 여러 줄</b>이어도 그대로 붙여넣으면 됩니다.
                            <br />
                            <b>계약일자</b>는 <b>“4월 28일”</b>처럼 월·일만 적으면 연도 자동. <b>담당자</b>는 등록 후 입력 창이 뜹니다.
                            (발행 URL이 있어야 등록됨)
                        </p>
                        <textarea
                            className="min-h-[200px] w-full resize-y rounded-md border-2 border-dashed border-[#cbd5e1] bg-[#f8fafc] px-3 py-2 font-mono text-xs"
                            onChange={(e) => setText(e.target.value)}
                            spellCheck={false}
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
