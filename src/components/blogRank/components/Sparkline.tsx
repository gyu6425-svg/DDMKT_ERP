import type { BlogPost } from '../../../api/blogRank';

export function Sparkline({ post }: { post: BlogPost }) {
    const pts = post.measurements;
    if (pts.length < 2) {
        return <span className="text-[11px] text-[#94a3b8]">측정 {pts.length}회</span>;
    }
    const W = 140;
    const H = 40;
    const padL = 4;
    const padR = 10;
    const padT = 6;
    const padB = 5;
    const maxRank = Math.max(15, ...pts.map((m) => Math.max(m.ti, m.bl)));
    const x = (i: number) => padL + (i / (pts.length - 1)) * (W - padL - padR);
    const y = (r: number) => padT + ((r - 1) / (maxRank - 1)) * (H - padT - padB);
    const line = (key: 'ti' | 'bl') => pts.map((m, i) => `${x(i)},${y(m[key])}`).join(' ');
    const li = pts.length - 1;
    return (
        <svg height={H} viewBox={`0 0 ${W} ${H}`} width={W}>
            <line
                stroke="#e2e8f0"
                strokeDasharray="3 3"
                strokeWidth="1"
                x1={padL}
                x2={W - padR}
                y1={y(10)}
                y2={y(10)}
            />
            <polyline fill="none" points={line('ti')} stroke="#059669" strokeWidth="2" />
            <polyline fill="none" points={line('bl')} stroke="#1e40af" strokeWidth="2" />
            <circle cx={x(li)} cy={y(pts[li].ti)} fill="#059669" r="2.6" />
            <circle cx={x(li)} cy={y(pts[li].bl)} fill="#1e40af" r="2.6" />
        </svg>
    );
}

// ───────────────────────── 시트 붙여넣기 모달 ─────────────────────────
