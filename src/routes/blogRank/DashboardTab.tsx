import { useState } from 'react';
import { todayKST, type BlogAccount, type BlogPost } from '../../api/blogRank';
import { lastM, prevM, renewLevel, type Tab } from './helpers';
import { Empty, Kpi, Panel, Tag } from './ui';
import { LowRemainModal } from './LowRemainModal';
import { RankMovesModal } from './RankMovesModal';
import { SameDayModal, type SameDayRow } from './SameDayModal';

export function DashboardTab({
    accounts,
    posts,
    onGo,
    onGoTracker10,
    onGoSheetBlog,
    onToast,
}: {
    accounts: BlogAccount[];
    posts: BlogPost[];
    onGo: (tab: Tab) => void;
    onGoTracker10: () => void;
    onGoSheetBlog: (name: string) => void;
    onToast: (m: string) => void;
}) {
    const [showLow, setShowLow] = useState(false);
    const [showMoves, setShowMoves] = useState(false);
    const [showSameDay, setShowSameDay] = useState(false);
    const [showPrevDay, setShowPrevDay] = useState(false);

    // 당일(오늘 발행)·전날(어제 발행) 측정 글 — 크롤링 현황과 동일 기준(오늘 측정 완료분).
    const today = todayKST();
    const yesterday = (() => {
        const [y, m, d] = today.split('-').map(Number);
        return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
    })();
    const mmdd = (iso: string) => {
        const [, mo, d] = iso.split('-');
        return `${Number(mo)}월${Number(d)}일`;
    };
    const rowsForPub = (pub: string): SameDayRow[] =>
        posts
            .filter((p) => (p.published_date || '').slice(0, 10) === pub && p.measurements.some((x) => x.date === today))
            .map((p) => ({
                post: p,
                account: accounts.find((a) => a.id === p.blog_account_id) ?? null,
                m: p.measurements.find((x) => x.date === today)!,
            }));
    const sameDayRows = rowsForPub(today);
    const prevDayRows = rowsForPub(yesterday);
    const nameOf = (id: string) => accounts.find((a) => a.id === id)?.name || '블로그';
    const withGoal = accounts.filter((a) => a.goal_count != null && a.remain_count != null);
    const done = withGoal.reduce((s, a) => s + ((a.goal_count || 0) - (a.remain_count || 0)), 0);
    const goal = withGoal.reduce((s, a) => s + (a.goal_count || 0), 0);
    const measured = posts.filter((p) => p.measurements.length);
    const inTen = measured.filter((p) => (lastM(p)?.ti ?? 99) <= 10).length;
    const lowCnt = accounts.filter((a) => a.remain_count != null && a.remain_count <= 3 && a.is_active).length;
    const stopCnt = accounts.filter((a) => !a.is_active).length;

    // 재계약 임박(잔여 ≤3, 활성) + 진행 중단. 잔여 1건↓=빨강(매우 임박), 2~3건=노랑. 빨강 1건부터 최상단.
    const attn = accounts
        .filter((a) => (a.remain_count != null && a.remain_count <= 3 && a.is_active) || !a.is_active)
        .map((a) => {
            const level = a.is_active ? renewLevel(a) : null;
            return {
                account: a,
                label: !a.is_active ? '중단' : '재계약',
                tag: (!a.is_active ? 'stop' : level === 'red' ? 'urgent' : 'low') as 'stop' | 'urgent' | 'low',
                why: !a.is_active
                    ? a.note || '진행 중단'
                    : `잔여 ${a.remain_count}건 · 재계약 ${level === 'red' ? '매우 임박' : '임박'}`,
            };
        })
        // 활성 재계약은 잔여 적을수록(=빨강 1건) 위로, 진행 중단은 맨 뒤.
        .sort((x, y) => {
            const kx = x.account.is_active ? x.account.remain_count ?? 999 : 1e6;
            const ky = y.account.is_active ? y.account.remain_count ?? 999 : 1e6;
            return kx - ky;
        });

    // 최근 순위 변동 = 직전 측정(=이전 크롤) vs 최신 측정(=다음 크롤)의 통합탭 순위 차이.
    //   measurements 는 날짜당 1건이라 '이전 04시 크롤 ↔ 다음 04시 크롤' 비교가 됨(지금 측정도 그날 1건만 갱신).
    //   두 측정이 모두 '순위 잡힘(ok)'이고, 순위가 2 이상 차이날 때만 표시(노이즈·권외/실패 제외).
    const moves = posts
        .filter((p) => p.measurements.length >= 2)
        .map((p) => {
            const prev = prevM(p);
            const last = lastM(p);
            const bothRanked = !!prev && !!last && prev.ti_status === 'ok' && last.ti_status === 'ok';
            return { p, d: bothRanked ? prev!.ti - last!.ti : 0 };
        })
        .filter((x) => Math.abs(x.d) >= 2)
        .sort((a, b) => Math.abs(b.d) - Math.abs(a.d)); // 변동 큰 순(맨 위=가장 큰 변동)
    const MOVES_PANEL = 5; // 패널엔 상위 5개만, 나머지는 '더보기' 모달

    // 웹사이트(업체 기준) 지표 패널은 현재 비활성(아래 JSX 주석). 신뢰도 낮아 보류 — 다시 켜면 변수 복구.

    return (
        <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Kpi
                    label="관리 블로그"
                    value={`${accounts.length}`}
                    sub={`진행 ${accounts.length - stopCnt} · 중단 ${stopCnt}`}
                    onClick={() => onGo('sheet')}
                />
                <Kpi
                    label="전체 진행률"
                    value={goal ? `${Math.round((done / goal) * 100)}%` : '—'}
                    accent="#1e40af"
                    sub={`발행 ${done} / 계약 ${goal}건`}
                />
                <Kpi
                    label="통합탭 10위 이내"
                    value={measured.length ? `${inTen}` : '—'}
                    accent="#059669"
                    sub={measured.length ? `측정 ${measured.length}건 중 · 눌러서 보기` : '크롤링 후 계산'}
                    onClick={measured.length ? onGoTracker10 : undefined}
                />
                <Kpi
                    label="잔여 3건 이하"
                    value={`${lowCnt}`}
                    accent={lowCnt ? '#d97706' : undefined}
                    sub="재계약 영업 타이밍 · 눌러서 보기"
                    onClick={() => setShowLow(true)}
                />
            </div>

            {/* 당일/전날 측정 글 — 보고 직결 KPI(크롤링 현황과 동일). 당일=노랑, 전날=보라. */}
            <div className="grid grid-cols-2 gap-3">
                <Kpi
                    label={`당일 측정 글 (${mmdd(today)})`}
                    value={`${sameDayRows.length}`}
                    accent="#eab308"
                    sub="오늘 발행분 · 눌러서 목록·발송"
                    onClick={() => setShowSameDay(true)}
                />
                <Kpi
                    label={`전날 측정 글 순위 (${mmdd(yesterday)})`}
                    value={`${prevDayRows.length}`}
                    accent="#7c3aed"
                    sub="어제 발행분 · 눌러서 순위목록"
                    onClick={() => setShowPrevDay(true)}
                />
            </div>



            {/* <Panel
                title="웹사이트 노출 (업체 기준)"
                sub="통합검색 '웹사이트' 섹션 · webkr API 추정값이라 신뢰도 낮음"
            >
                {webTracked.length ? (
                    <div className="grid grid-cols-3 gap-3">
                        <Kpi
                            label="추적 업체"
                            value={`${webTracked.length}`}
                            sub={`측정 ${webMeasured.length}개`}
                        />
                        <Kpi
                            label="노출 중"
                            value={`${webExposed}`}
                            accent="#7c3aed"
                            sub="웹사이트 섹션 내 노출"
                        />
                        <Kpi
                            label="10위 이내"
                            value={`${webIn10}`}
                            accent="#7c3aed"
                            sub="업체 기준"
                        />
                    </div>
                ) : (
                    <Empty text="아직 웹사이트 추적 업체가 없습니다 · '블로그 관리 시트' 탭에서 업체 '편집' → 회사 홈페이지·대표키워드를 등록하세요" />
                )}
            </Panel> */}

            <div className="grid gap-4 lg:grid-cols-2">
                <Panel title="재계약 임박 블로그" sub="잔여 1건↓ 빨강 · 2~3건 노랑 · 진행 중단">
                    {attn.length ? (
                        <div className="grid gap-1">
                            {attn.map(({ account, label, tag, why }) => (
                                <button
                                    className="flex items-center justify-between rounded-md px-2 py-2 text-left hover:bg-[#f8fafc]"
                                    key={account.id}
                                    onClick={() => onGoSheetBlog(account.name)}
                                    type="button"
                                >
                                    <span className="min-w-0">
                                        <span className="block text-sm font-semibold">{account.name}</span>
                                        <span className="block truncate text-xs text-[#94a3b8]">{why}</span>
                                    </span>
                                    <Tag kind={tag}>{label}</Tag>
                                </button>
                            ))}
                        </div>
                    ) : (
                        <Empty text="재계약 임박 블로그가 없어요" />
                    )}
                </Panel>

                <Panel
                    title="최근 순위 변동"
                    sub="이전 크롤 대비 통합탭 순위 2 이상 변동"
                    action={
                        moves.length > MOVES_PANEL ? (
                            <button
                                className="rounded-md border border-[#cbd5e1] bg-white px-2.5 py-1 text-xs font-semibold text-[#475569] hover:bg-[#f1f5f9]"
                                onClick={() => setShowMoves(true)}
                                type="button"
                            >
                                더보기 {moves.length}
                            </button>
                        ) : null
                    }
                >
                    {moves.length ? (
                        <div className="grid gap-1">
                            {moves.slice(0, MOVES_PANEL).map(({ p, d }) => (
                                <div
                                    className="flex items-center justify-between rounded-md px-2 py-2"
                                    key={p.id}
                                >
                                    <span className="min-w-0">
                                        <span className="block truncate text-xs font-semibold">
                                            {(p.title || '제목 없음').slice(0, 32)}
                                        </span>
                                        <span className="block text-xs text-[#94a3b8]">#{p.keyword || '-'}</span>
                                    </span>
                                    <span className="flex items-center gap-2 whitespace-nowrap">
                                        <span className="text-sm font-bold">{lastM(p)?.ti}위</span>
                                        <span
                                            className="text-xs font-bold"
                                            style={{ color: d > 0 ? '#dc2626' : '#1e40af' }}
                                        >
                                            {d > 0 ? `▲${d}` : `▼${Math.abs(d)}`}
                                        </span>
                                    </span>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <Empty text="이전 크롤 대비 통합탭 순위가 2 이상 바뀐 글이 여기 표시됩니다" />
                    )}
                </Panel>
            </div>

            {showLow ? (
                <LowRemainModal
                    accounts={accounts}
                    onClose={() => setShowLow(false)}
                    onGoBlog={(name) => {
                        setShowLow(false);
                        onGoSheetBlog(name);
                    }}
                />
            ) : null}
            {showMoves ? (
                <RankMovesModal moves={moves} nameOf={nameOf} onClose={() => setShowMoves(false)} />
            ) : null}
            {showSameDay ? (
                <SameDayModal
                    rows={sameDayRows}
                    dayLabel={mmdd(today)}
                    mode="publish"
                    onClose={() => setShowSameDay(false)}
                    onToast={onToast}
                />
            ) : null}
            {showPrevDay ? (
                <SameDayModal
                    rows={prevDayRows}
                    dayLabel={mmdd(yesterday)}
                    mode="rank"
                    onClose={() => setShowPrevDay(false)}
                    onToast={onToast}
                />
            ) : null}
        </div>
    );
}

// ───────────────────────── 관리 시트 ─────────────────────────
