import type { BlogAccount, BlogPost } from '../../api/blogRank';
import { lastM, prevM, type Tab } from './helpers';
import { Empty, Kpi, Panel, Tag } from './ui';

export function DashboardTab({
    accounts,
    posts,
    onGo,
}: {
    accounts: BlogAccount[];
    posts: BlogPost[];
    onGo: (tab: Tab) => void;
}) {
    const withGoal = accounts.filter((a) => a.goal_count != null && a.remain_count != null);
    const done = withGoal.reduce((s, a) => s + ((a.goal_count || 0) - (a.remain_count || 0)), 0);
    const goal = withGoal.reduce((s, a) => s + (a.goal_count || 0), 0);
    const measured = posts.filter((p) => p.measurements.length);
    const inTen = measured.filter((p) => (lastM(p)?.ti ?? 99) <= 10).length;
    const lowCnt = accounts.filter((a) => a.remain_count != null && a.remain_count <= 3 && a.is_active).length;
    const stopCnt = accounts.filter((a) => !a.is_active).length;

    const attn = accounts
        .filter((a) => (a.remain_count != null && a.remain_count <= 3 && a.is_active) || !a.is_active)
        .map((a) => ({
            account: a,
            label: !a.is_active ? '중단' : '재계약',
            tag: !a.is_active ? 'stop' : 'low',
            why: !a.is_active ? a.note || '진행 중단' : `잔여 ${a.remain_count}건 · 재계약 시점 임박`,
        }));

    const moves = posts
        .filter((p) => p.measurements.length >= 2)
        .map((p) => ({ p, d: (prevM(p)?.ti ?? 0) - (lastM(p)?.ti ?? 0) }))
        .filter((x) => x.d !== 0)
        .sort((a, b) => Math.abs(b.d) - Math.abs(a.d))
        .slice(0, 6);

    // 웹사이트(업체 기준) 지표 패널은 현재 비활성(아래 JSX 주석). 신뢰도 낮아 보류 — 다시 켜면 변수 복구.

    return (
        <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Kpi label="관리 블로그" value={`${accounts.length}`} sub={`진행 ${accounts.length - stopCnt} · 중단 ${stopCnt}`} />
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
                    sub={measured.length ? `측정 ${measured.length}건 중` : '크롤링 후 계산'}
                />
                <Kpi
                    label="잔여 3건 이하"
                    value={`${lowCnt}`}
                    accent={lowCnt ? '#d97706' : undefined}
                    sub="재계약 영업 타이밍"
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
                <Panel title="오늘 챙겨야 할 블로그" sub="잔여 임박 · 진행 중단">
                    {attn.length ? (
                        <div className="grid gap-1">
                            {attn.map(({ account, label, tag, why }) => (
                                <button
                                    className="flex items-center justify-between rounded-md px-2 py-2 text-left hover:bg-[#f8fafc]"
                                    key={account.id}
                                    onClick={() => onGo('sheet')}
                                    type="button"
                                >
                                    <span className="min-w-0">
                                        <span className="block text-sm font-semibold">{account.name}</span>
                                        <span className="block truncate text-xs text-[#94a3b8]">{why}</span>
                                    </span>
                                    <Tag kind={tag as 'stop' | 'low'}>{label}</Tag>
                                </button>
                            ))}
                        </div>
                    ) : (
                        <Empty text="지금은 챙길 블로그가 없어요" />
                    )}
                </Panel>

                <Panel title="최근 순위 변동" sub="이전 대비 통합탭 순위 변화">
                    {moves.length ? (
                        <div className="grid gap-1">
                            {moves.map(({ p, d }) => (
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
                        <Empty text="측정이 2회 이상이면 변동이 표시됩니다" />
                    )}
                </Panel>
            </div>
        </div>
    );
}

// ───────────────────────── 관리 시트 ─────────────────────────
