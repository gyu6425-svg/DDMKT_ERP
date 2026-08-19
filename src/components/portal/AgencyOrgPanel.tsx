import { useEffect, useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { getMyOrg, type MyOrg } from '../../api/orgs';

// 고객 포털 '조직 관리' — 대행사로 로그인한 고객이 자기 조직만 본다.
//   읽기 전용이다. 소속 지정·대행사 전환·코드 발급/폐기는 내부(어드민 조직 관리)에서만 한다.
//   근거: 대행사가 스스로 하위를 붙였다 뗐다 하면 우리 쪽 정산 근거(누가 누구 밑이었나)가 흔들린다.
//   ※ 하위 업체가 대행사에 넣는 접수는 대행사가 자기 시스템에서 관리한다(우리는 관여하지 않음).

const fmtDate = (s: string | null) => (s ? s.slice(0, 10) : '-');

export default function AgencyOrgPanel() {
    const { profile } = useAuth();
    // 내부 미리보기(?as=업체) 지원 — 어드민이 대행사 화면을 그대로 확인할 수 있게.
    const asParam = new URLSearchParams(window.location.search).get('as') || '';
    const clientId = asParam || profile?.client_id || '';

    const [org, setOrg] = useState<MyOrg>({ me: null, children: [], invites: [] });
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState('');
    const [copied, setCopied] = useState('');

    useEffect(() => {
        if (!clientId) { setLoading(false); return; }
        let alive = true;
        setLoading(true);
        void getMyOrg(clientId).then(({ data, error }) => {
            if (!alive) return;
            setOrg(data);
            setErr(error || '');
            setLoading(false);
        });
        return () => { alive = false; };
    }, [clientId]);

    const copy = (code: string) => {
        void navigator.clipboard?.writeText(code);
        setCopied(code);
        window.setTimeout(() => setCopied(''), 1500);
    };

    if (loading) return <div className="py-16 text-center text-sm text-[#94a3b8]">불러오는 중…</div>;

    // 대행사가 아닌 고객이 주소로 직접 들어온 경우. 메뉴에는 애초에 안 뜬다.
    if (!org.me?.is_agency) {
        return (
            <div className="rounded-xl border border-dashed border-[#cbd5e1] bg-[#f8fafc] px-6 py-14 text-center text-sm text-[#64748b]">
                대행사 계정에서만 볼 수 있는 화면입니다.
                {err ? <div className="mt-2 text-[#dc2626]">{err}</div> : null}
            </div>
        );
    }

    const live = org.invites.filter((i) => i.active);
    const usedAny = org.invites.some((i) => i.used_count > 0);

    return (
        <section className="grid gap-5">
            <header className="flex flex-wrap items-center gap-2">
                <h2 className="m-0 text-[20px] font-bold text-[#0f172a]">조직 관리</h2>
                <span className="rounded-full bg-[#ede9fe] px-2 py-0.5 text-[11px] font-bold text-[#6d28d9]">대행사</span>
                <span className="text-[13px] text-[#94a3b8]">{org.me.company}</span>
            </header>

            {/* 요약 */}
            <div className="grid grid-cols-2 gap-3 max-[600px]:grid-cols-1">
                <div className="rounded-xl border border-[#e2e8f0] p-4">
                    <div className="text-[12px] font-semibold text-[#64748b]">하위 업체</div>
                    <div className="mt-1 text-[26px] font-bold text-[#0f172a]">{org.children.length}<span className="ml-1 text-[15px] font-semibold text-[#94a3b8]">곳</span></div>
                </div>
                <div className="rounded-xl border border-[#e2e8f0] p-4">
                    <div className="text-[12px] font-semibold text-[#64748b]">사용 가능한 초대 코드</div>
                    <div className="mt-1 text-[26px] font-bold text-[#0f172a]">{live.length}<span className="ml-1 text-[15px] font-semibold text-[#94a3b8]">개</span></div>
                </div>
            </div>

            {/* 초대 코드 — 하위 업체를 붙이는 유일한 경로. 대행사가 직접 전달한다. */}
            <div className="rounded-xl border border-[#e2e8f0] p-4">
                <div className="mb-1 text-[14px] font-bold text-[#0f172a]">초대 코드</div>
                <p className="m-0 mb-3 text-[13px] leading-6 text-[#64748b]">
                    하위 업체가 회원가입 화면의 <b>초대 코드</b> 칸에 이 코드를 넣으면, 승인 후 아래 목록에 나타납니다.
                    {' '}코드 발급·폐기가 필요하시면 담당자에게 요청해 주세요.
                </p>
                {live.length ? (
                    <div className="flex flex-wrap gap-2">
                        {live.map((i) => (
                            <button
                                className="inline-flex items-center gap-2 rounded-lg border border-[#a7f3d0] bg-[#ecfdf5] px-3 py-1.5 text-[13px] font-bold text-[#065f46] hover:bg-[#d1fae5]"
                                key={i.code}
                                onClick={() => copy(i.code)}
                                title="클릭하면 복사됩니다"
                                type="button"
                            >
                                {i.code}
                                <span className="font-normal opacity-70">
                                    {i.used_count}{i.max_uses ? `/${i.max_uses}` : ''}회 사용
                                </span>
                                <span className="text-[11px] font-semibold text-[#059669]">
                                    {copied === i.code ? '복사됨' : '복사'}
                                </span>
                            </button>
                        ))}
                    </div>
                ) : (
                    <div className="rounded-lg border border-dashed border-[#cbd5e1] px-4 py-6 text-center text-[13px] text-[#94a3b8]">
                        발급된 코드가 없습니다. 담당자에게 요청해 주세요.
                    </div>
                )}
            </div>

            {/* 하위 업체 */}
            <div className="rounded-xl border border-[#e2e8f0]">
                <div className="border-b border-[#e2e8f0] px-4 py-3 text-[14px] font-bold text-[#0f172a]">
                    하위 업체 <span className="text-[#94a3b8]">{org.children.length}</span>
                </div>
                {org.children.length ? (
                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[440px] border-collapse text-[13px]">
                            <thead>
                                <tr className="text-left text-[12px] text-[#64748b]">
                                    <th className="px-4 py-2 font-semibold">업체명</th>
                                    <th className="px-4 py-2 font-semibold">상태</th>
                                    <th className="px-4 py-2 font-semibold">등록일</th>
                                </tr>
                            </thead>
                            <tbody>
                                {org.children.map((c) => (
                                    <tr className="border-t border-[#f1f5f9]" key={c.id}>
                                        <td className="px-4 py-2.5 font-semibold text-[#0f172a]">{c.company}</td>
                                        <td className="px-4 py-2.5 text-[#64748b]">{c.status || '-'}</td>
                                        <td className="px-4 py-2.5 text-[#94a3b8]">{fmtDate(c.created_at)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                ) : usedAny ? (
                    // 코드가 이미 쓰였는데 하위가 0곳 = 권한(RLS)이 아직 안 열린 것.
                    //   "아직 없습니다"로 보이면 원인을 찾는 데 한참 걸린다(실제로 오늘 그랬다).
                    <div className="px-4 py-10 text-center text-[13px] leading-6 text-[#b45309]">
                        사용된 초대 코드가 있는데 하위 업체가 조회되지 않습니다.
                        <br />
                        담당자에게 문의해 주세요(조회 권한 설정 필요).
                    </div>
                ) : (
                    <div className="px-4 py-12 text-center text-[13px] text-[#94a3b8]">
                        아직 하위 업체가 없습니다. 위 초대 코드를 전달해 가입시켜 주세요.
                    </div>
                )}
            </div>

            {err ? <p className="m-0 text-[13px] text-[#dc2626]">{err}</p> : null}
        </section>
    );
}
