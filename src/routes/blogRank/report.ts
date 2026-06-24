import { todayKST, type BlogAccount, type BlogMeasurement, type BlogPost } from '../../api/blogRank';
import { amountTotal, fmtWon, lastM } from './helpers';

const escapeHtml = (v: unknown): string =>
    String(v ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

// 화면(RankCell/fmtRank)과 동일 규칙: 측정 없으면 대기, fail=실패, out/>30=권외, 그 외 N위.
const fmtRank = (m: BlogMeasurement | null, key: 'ti' | 'bl'): string => {
    if (!m) return '측정대기';
    const status = key === 'ti' ? m.ti_status : m.bl_status;
    const v = key === 'ti' ? m.ti : m.bl;
    if (status === 'fail') return '실패';
    if (status === 'out' || v > 30) return '권외';
    return `${v}위`;
};
// 정렬용: 통합탭 노출 순위(작을수록 위). 측정대기/권외/실패는 맨 뒤로.
const tiSortKey = (m: BlogMeasurement | null): number => {
    if (!m) return 9999;
    if (m.ti_status === 'fail') return 9998;
    if (m.ti_status === 'out' || m.ti > 30) return 999;
    return m.ti;
};

const kwOf = (p: BlogPost): string => p.keyword_manual || p.keyword || '';

export function buildBlogReportHtml(account: BlogAccount, posts: BlogPost[]): string {
    const today = todayKST();
    const rows = [...posts].sort((a, b) => tiSortKey(lastM(a)) - tiSortKey(lastM(b)));
    const measured = rows.filter((p) => lastM(p));
    const top10 = rows.filter((p) => {
        const m = lastM(p);
        return m && m.ti_status !== 'fail' && m.ti_status !== 'out' && m.ti <= 10;
    }).length;
    const top30 = rows.filter((p) => {
        const m = lastM(p);
        return m && m.ti_status !== 'fail' && m.ti_status !== 'out' && m.ti <= 30;
    }).length;

    const tableRows =
        rows
            .map((p) => {
                const m = lastM(p);
                const ti = fmtRank(m, 'ti');
                const bl = fmtRank(m, 'bl');
                const ranked = m && m.ti_status !== 'fail' && m.ti_status !== 'out' && m.ti <= 30;
                return `<tr class="${ranked ? '' : 'muted'}">
<td class="rank">${escapeHtml(ti)}</td>
<td>${escapeHtml(bl)}</td>
<td class="kw">${escapeHtml(kwOf(p) || '—')}</td>
<td class="title">${
                    p.post_url
                        ? `<a href="${escapeHtml(p.post_url)}" target="_blank" rel="noopener">${escapeHtml(p.title || '제목 없음')}</a>`
                        : escapeHtml(p.title || '제목 없음')
                }</td>
<td class="date">${escapeHtml(p.published_date || '—')}</td>
<td class="date">${escapeHtml(m?.date || '—')}</td>
</tr>`;
            })
            .join('') ||
        '<tr><td colspan="6" class="empty">측정된 글이 없습니다. \'지금 측정\'을 먼저 실행해 주세요.</td></tr>';

    return `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<title>성과보고서 ${escapeHtml(account.name)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: 'Apple SD Gothic Neo','Malgun Gothic',sans-serif; color:#0f172a; margin:0; padding:32px; }
  .head { display:flex; justify-content:space-between; align-items:flex-end; border-bottom:3px solid #1e40af; padding-bottom:12px; }
  h1 { margin:0; font-size:24px; }
  .sub { color:#64748b; font-size:13px; }
  .meta { display:flex; gap:24px; margin-top:16px; flex-wrap:wrap; }
  .meta div { font-size:14px; } .meta b { color:#1e40af; }
  .kpi { margin-top:20px; padding:16px 20px; background:#eff6ff; border-radius:10px; font-size:16px; font-weight:700; color:#1e3a8a; }
  .kpi span { color:#059669; }
  table { width:100%; border-collapse:collapse; margin-top:18px; font-size:13px; }
  th,td { border-bottom:1px solid #e2e8f0; padding:8px 10px; text-align:left; }
  th { background:#f1f5f9; color:#475569; font-size:12px; }
  td.rank { font-weight:800; color:#1e40af; }
  tr.muted td { color:#94a3b8; }
  td.title { max-width:320px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  td.title a { color:#1e40af; text-decoration:none; } td.title a:hover { text-decoration:underline; }
  td.date { color:#94a3b8; white-space:nowrap; }
  .empty { text-align:center; color:#94a3b8; padding:28px; }
  .foot { margin-top:24px; color:#94a3b8; font-size:11px; }
  .btns { margin:18px 0; } .btns button { font-size:14px; padding:8px 16px; border-radius:8px; border:0; background:#1e40af; color:#fff; font-weight:700; cursor:pointer; }
  @media print { .btns { display:none; } body { padding:0; } }
</style></head><body>
<div class="btns"><button onclick="window.print()">인쇄 / PDF로 저장</button></div>
<div class="head">
  <div><h1>${escapeHtml(account.name)} 블로그 성과 보고서</h1>
  <div class="sub">네이버 통합검색 노출 순위 기준 · 기준일 ${escapeHtml(today)}</div></div>
</div>
<div class="meta">
  <div>계약일자 <b>${escapeHtml(account.contract_date || '—')}</b></div>
  <div>계약금액 <b>${amountTotal(account) ? `${fmtWon(amountTotal(account))}원` : '—'}</b></div>
  <div>주 발행 <b>${escapeHtml(account.weekly || '—')}</b></div>
</div>
<div class="kpi">총 ${rows.length}개 키워드 추적 · 네이버 통합탭 <span>1페이지(10위 이내) 노출 ${top10}개</span> · 30위 이내 ${top30}개 (측정 ${measured.length}개)</div>
<table>
  <thead><tr><th>통합탭 순위</th><th>블로그탭</th><th>키워드</th><th>제목</th><th>발행일</th><th>측정일</th></tr></thead>
  <tbody>${tableRows}</tbody>
</table>
<div class="foot">통합탭=네이버 통합검색 인기글 노출 순위 · 블로그탭=블로그 카테고리 순위 · '권외'는 30위 밖(노출 작업 진행 중) · 측정일이 오래됐으면 '지금 측정'으로 갱신 후 출력하세요.</div>
<script>setTimeout(function(){window.focus();},100);</script>
</body></html>`;
}

// 새 창에 보고서를 띄운다(사용자가 인쇄→PDF로 저장 = 다운로드). 팝업 차단 시 false.
export function openBlogReport(account: BlogAccount, posts: BlogPost[]): boolean {
    const html = buildBlogReportHtml(account, posts);
    const w = window.open('', '_blank');
    if (!w) return false;
    w.document.write(html);
    w.document.close();
    return true;
}

// ── 순위 트래커 성과 보고서(글 단위, 여러 블로그) ──
// 컬럼: 업체명 · 블로그 주소 · 발행 날짜 · 키워드 · 통합탭 순위 · 블로그탭 순위
export function buildTrackerReportHtml(posts: BlogPost[], accounts: BlogAccount[]): string {
    const today = todayKST();
    const accById = new Map(accounts.map((a) => [a.id, a]));
    const rows = [...posts].sort((a, b) => tiSortKey(lastM(a)) - tiSortKey(lastM(b)));
    const measured = rows.filter((p) => lastM(p));
    const top10 = rows.filter((p) => {
        const m = lastM(p);
        return m && m.ti_status !== 'fail' && m.ti_status !== 'out' && m.ti <= 10;
    }).length;

    const tableRows =
        rows
            .map((p) => {
                const acc = accById.get(p.blog_account_id);
                const m = lastM(p);
                const ranked = m && m.ti_status !== 'fail' && m.ti_status !== 'out' && m.ti <= 30;
                const url = p.post_url || acc?.blog_url || '';
                return `<tr class="${ranked ? '' : 'muted'}">
<td>${escapeHtml(acc?.name || '—')}</td>
<td class="title">${
                    url
                        ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(url)}</a>`
                        : '—'
                }</td>
<td class="date">${escapeHtml(p.published_date || '—')}</td>
<td class="kw">${escapeHtml(kwOf(p) || '—')}</td>
<td class="rank">${escapeHtml(fmtRank(m, 'ti'))}</td>
<td>${escapeHtml(fmtRank(m, 'bl'))}</td>
</tr>`;
            })
            .join('') || '<tr><td colspan="6" class="empty">표시할 글이 없습니다.</td></tr>';

    return `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<title>순위 트래커 성과 보고서</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: 'Apple SD Gothic Neo','Malgun Gothic',sans-serif; color:#0f172a; margin:0; padding:32px; }
  .head { border-bottom:3px solid #1e40af; padding-bottom:12px; }
  h1 { margin:0; font-size:24px; }
  .sub { color:#64748b; font-size:13px; }
  .kpi { margin-top:18px; padding:14px 18px; background:#eff6ff; border-radius:10px; font-size:15px; font-weight:700; color:#1e3a8a; }
  .kpi span { color:#059669; }
  table { width:100%; border-collapse:collapse; margin-top:16px; font-size:13px; }
  th,td { border-bottom:1px solid #e2e8f0; padding:8px 10px; text-align:left; }
  th { background:#f1f5f9; color:#475569; font-size:12px; }
  td.rank { font-weight:800; color:#1e40af; }
  tr.muted td { color:#94a3b8; }
  td.title { max-width:340px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  td.title a { color:#1e40af; text-decoration:none; } td.title a:hover { text-decoration:underline; }
  td.date,td.kw { white-space:nowrap; }
  .empty { text-align:center; color:#94a3b8; padding:28px; }
  .foot { margin-top:22px; color:#94a3b8; font-size:11px; }
  .btns { margin:18px 0; } .btns button { font-size:14px; padding:8px 16px; border-radius:8px; border:0; background:#1e40af; color:#fff; font-weight:700; cursor:pointer; }
  @media print { .btns { display:none; } body { padding:0; } }
</style></head><body>
<div class="btns"><button onclick="window.print()">인쇄 / PDF로 저장</button></div>
<div class="head"><h1>순위 트래커 성과 보고서</h1>
<div class="sub">네이버 통합검색/블로그탭 노출 순위 · 기준일 ${escapeHtml(today)}</div></div>
<div class="kpi">총 ${rows.length}개 글 · 통합탭 <span>10위 이내 ${top10}개</span> (측정 ${measured.length}개)</div>
<table>
  <thead><tr><th>업체명</th><th>블로그 주소</th><th>발행 날짜</th><th>키워드</th><th>통합탭 순위</th><th>블로그탭 순위</th></tr></thead>
  <tbody>${tableRows}</tbody>
</table>
<div class="foot">통합탭=네이버 통합검색 노출 순위 · 블로그탭=블로그 카테고리 순위 · '권외'는 30위 밖 · 측정일이 오래됐으면 측정 후 출력하세요.</div>
<script>setTimeout(function(){window.focus();},100);</script>
</body></html>`;
}

export function openTrackerReport(posts: BlogPost[], accounts: BlogAccount[]): boolean {
    const w = window.open('', '_blank');
    if (!w) return false;
    w.document.write(buildTrackerReportHtml(posts, accounts));
    w.document.close();
    return true;
}
