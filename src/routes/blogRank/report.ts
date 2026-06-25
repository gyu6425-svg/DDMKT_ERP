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

// 보고서 링크 = '측정에 쓴 바로 그 네이버 검색'으로 연결해야 고객이 보는 순위 = 보고서 순위.
//   crawler/functions 의 측정 URL(TI_URL/BL_URL, m.search.naver.com)과 반드시 동일해야 한다.
//   PC search.naver.com 으로 보내면 모바일 측정값과 순위가 달라져 신뢰가 깨짐 → m.search 고정.
const tiSearchUrl = (kw: string): string =>
    `https://m.search.naver.com/search.naver?query=${encodeURIComponent(kw)}`;
const blSearchUrl = (kw: string): string =>
    `https://m.search.naver.com/search.naver?ssc=tab.m_blog.all&query=${encodeURIComponent(kw)}`;

// 카카오톡 공유(JavaScript SDK) 앱 키. developers.kakao.com '든든한 마케팅 성과보고' 앱 JS 키.
//   비어 있으면 버튼이 '설정 안내' 알림만 띄운다(키 없이 발송 불가).
//   ※ JS 키는 공개되어도 되는 클라이언트 키(도메인 등록으로 보호). REST/Admin 키와 다름.
const KAKAO_JS_KEY = 'b6992ad148e994c2022d648fdb386ca8';

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
                const kw = kwOf(p);
                // 통합탭 순위 → 네이버 통합검색, 블로그탭 순위 → 네이버 블로그탭 (그 키워드로 검색한 화면)
                const tiCell = kw
                    ? `<a class="ranklink" href="${escapeHtml(tiSearchUrl(kw))}" target="_blank" rel="noopener" title="네이버 통합검색에서 이 키워드 순위 확인">${escapeHtml(ti)}</a>`
                    : escapeHtml(ti);
                const blCell = kw
                    ? `<a class="ranklink" href="${escapeHtml(blSearchUrl(kw))}" target="_blank" rel="noopener" title="네이버 블로그탭에서 이 키워드 순위 확인">${escapeHtml(bl)}</a>`
                    : escapeHtml(bl);
                return `<tr class="${ranked ? '' : 'muted'}">
<td class="rank ti">${tiCell}</td>
<td class="rank bl">${blCell}</td>
<td class="kw">${escapeHtml(kw || '—')}</td>
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

    const reportName = account.name || '성과 보고';
    const kkSummary = `[${reportName}] 네이버 노출 성과 보고 (기준일 ${today})\n통합탭 10위 이내 ${top10}개 · 측정 ${measured.length}개\n자세한 순위는 첨부 리포트를 확인해 주세요.`;
    const appUrl =
        (typeof window !== 'undefined' && window.location && window.location.origin) ||
        'https://ddmkt-erp.pages.dev';
    const jsLit = (v: unknown): string => JSON.stringify(v).replace(/</g, '\\u003c');

    return `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>성과보고서 ${escapeHtml(account.name)}</title>
<meta property="og:type" content="website">
<meta property="og:title" content="${escapeHtml(reportName)} 블로그 성과 보고">
<meta property="og:description" content="통합탭 10위 이내 ${top10}개 · 30위 이내 ${top30}개 · 기준일 ${escapeHtml(today)} | 든든한 마케팅 성과보고">
<meta property="og:image" content="https://ddmkt-erp.pages.dev/og-report.png">
<meta name="twitter:card" content="summary_large_image">
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
  td.rank { font-weight:800; }
  td.rank.ti { color:#059669; }   /* 통합탭 = 초록 */
  td.rank.bl { color:#1e40af; }   /* 블로그탭 = 파랑 */
  th.th-ti { color:#059669; } th.th-bl { color:#1e40af; }
  a.ranklink { color:inherit; text-decoration:none; } a.ranklink:hover { text-decoration:underline; }
  tr.muted td { color:#94a3b8; }
  td.title { max-width:320px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  td.title a { color:#1e40af; text-decoration:none; } td.title a:hover { text-decoration:underline; }
  td.date { color:#94a3b8; white-space:nowrap; }
  .empty { text-align:center; color:#94a3b8; padding:28px; }
  .foot { margin-top:24px; color:#94a3b8; font-size:11px; }
  .btns { margin:18px 0; display:flex; gap:8px; } .btns button { font-size:14px; padding:8px 16px; border-radius:8px; border:0; background:#1e40af; color:#fff; font-weight:700; cursor:pointer; }
  .btns button.kakao { background:#FEE500; color:#191600; display:inline-flex; align-items:center; gap:6px; }
  .btns button.copy { background:#0f766e; }
  @media print { .btns { display:none; } body { padding:0; } }
</style></head><body>
<div class="btns">
  <button onclick="window.print()">인쇄 / PDF로 저장</button>
  <button class="kakao" onclick="sendKakao()"><span aria-hidden="true">💬</span> 카카오톡 발송</button>
  <button class="copy" onclick="copyLink()">🔗 링크 복사</button>
</div>
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
  <thead><tr><th class="th-ti">통합탭 순위</th><th class="th-bl">블로그탭 순위</th><th>키워드</th><th>제목</th><th>발행일</th><th>측정일</th></tr></thead>
  <tbody>${tableRows}</tbody>
</table>
<div class="foot">통합탭=네이버 통합검색 인기글 노출 순위 · 블로그탭=블로그 카테고리 순위 · '권외'는 30위 밖(노출 작업 진행 중) · 측정일이 오래됐으면 '지금 측정'으로 갱신 후 출력하세요.</div>
<script src="https://t1.kakaocdn.net/kakao_js_sdk/2.7.4/kakao.min.js" crossorigin="anonymous"></script>
<script>
var KAKAO_JS_KEY = ${jsLit(KAKAO_JS_KEY)};
var KK_SUMMARY = ${jsLit(kkSummary)};
var KK_LINK = (window.location && window.location.href && window.location.href.indexOf('about:') !== 0)
  ? window.location.href : ${jsLit(appUrl)};
function reportUrl(){
  return (window.location && window.location.href && window.location.href.indexOf('about:')!==0) ? window.location.href : KK_LINK;
}
function sendKakao(){
  var url = reportUrl();
  if (navigator.share) { navigator.share({ title: '네이버 노출 성과 보고', text: KK_SUMMARY, url: url }).catch(function(){}); }
  else { copyLink(); }
}
function copyLink(){
  var url = reportUrl();
  function done(){ alert('보고서 링크를 복사했습니다.\\n카카오톡 대화창에 붙여넣어 보내세요.\\n\\n' + url); }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(done, function(){ window.prompt('이 링크를 길게 눌러 복사하세요:', url); });
  } else { window.prompt('이 링크를 길게 눌러 복사하세요:', url); }
}
setTimeout(function(){window.focus();},100);
</script>
</body></html>`;
}

// 성과 보고서를 '호스팅'(/r/:id)으로 열어 카톡 링크가 생기게 한다(트래커 보고서와 동일 방식).
//   1) 클릭 즉시 새 창(팝업차단 회피) → 2) HTML 을 서버리스에 저장 → 3) /r/{id} 로 이동. 실패 시 인라인 폴백.
export async function openBlogReport(account: BlogAccount, posts: BlogPost[]): Promise<boolean> {
    const w = window.open('', '_blank');
    if (!w) return false;
    w.document.write(
        '<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>성과 보고서</title></head>' +
            '<body style="font-family:\'Apple SD Gothic Neo\',\'Malgun Gothic\',sans-serif;padding:48px;color:#475569;font-size:15px">성과 보고서를 생성하는 중입니다…</body></html>',
    );
    const html = buildBlogReportHtml(account, posts);
    try {
        const res = await fetch('/api/report-share', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ html, title: `${account.name} 블로그 성과 보고서` }),
        });
        const data = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
        if (res.ok && data.id) {
            w.location.href = `/r/${data.id}`;
            return true;
        }
        throw new Error(data.error || `share ${res.status}`);
    } catch {
        w.document.open();
        w.document.write(html);
        w.document.close();
        return true;
    }
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
                const kw = kwOf(p);
                // 블로그 주소 클릭 → (키워드 있으면) 네이버 통합검색으로 이동: 고객이 실제 노출 순위를 직접 확인.
                const addrCell = url
                    ? `<a href="${escapeHtml(kw ? tiSearchUrl(kw) : url)}" target="_blank" rel="noopener" title="${kw ? '네이버 통합검색에서 이 키워드 순위 확인' : '블로그로 이동'}">${escapeHtml(url)}</a>`
                    : '—';
                // 순위 숫자도 각 탭(통합/블로그) 네이버 검색으로 연결 — 측정과 동일한 화면.
                const tiCell = kw
                    ? `<a class="ranklink" href="${escapeHtml(tiSearchUrl(kw))}" target="_blank" rel="noopener" title="네이버 통합검색에서 순위 확인">${escapeHtml(fmtRank(m, 'ti'))}</a>`
                    : escapeHtml(fmtRank(m, 'ti'));
                const blCell = kw
                    ? `<a class="ranklink" href="${escapeHtml(blSearchUrl(kw))}" target="_blank" rel="noopener" title="네이버 블로그탭에서 순위 확인">${escapeHtml(fmtRank(m, 'bl'))}</a>`
                    : escapeHtml(fmtRank(m, 'bl'));
                return `<tr class="${ranked ? '' : 'muted'}">
<td>${escapeHtml(acc?.name || '—')}</td>
<td class="title">${addrCell}</td>
<td class="date">${escapeHtml(p.published_date || '—')}</td>
<td class="kw">${escapeHtml(kw || '—')}</td>
<td class="rank">${tiCell}</td>
<td>${blCell}</td>
</tr>`;
            })
            .join('') || '<tr><td colspan="6" class="empty">표시할 글이 없습니다.</td></tr>';

    // 카카오 공유용 요약/링크(보고서 팝업 스크립트에 주입).
    const reportName = (rows[0] && accById.get(rows[0].blog_account_id)?.name) || '성과 보고';
    const kkSummary = `[${reportName}] 네이버 노출 성과 보고 (기준일 ${today})\n통합탭 10위 이내 ${top10}개 · 측정 ${measured.length}개\n자세한 순위는 첨부 리포트를 확인해 주세요.`;
    const appUrl =
        (typeof window !== 'undefined' && window.location && window.location.origin) ||
        'https://ddmkt-erp.pages.dev';
    // 인라인 <script> 안전 주입: JSON.stringify 는 '/' 를 escape 안 하므로 '<'(즉 </script>)만 추가로 막는다.
    const jsLit = (v: unknown): string => JSON.stringify(v).replace(/</g, '\\u003c');

    return `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(reportName)} · 네이버 노출 성과 보고서</title>
<!-- 카카오톡/메신저 링크 미리보기 카드(Open Graph) — 링크 보낼 때 제목·설명 카드로 표시 -->
<meta property="og:type" content="website">
<meta property="og:title" content="${escapeHtml(reportName)} · 네이버 노출 성과 보고">
<meta property="og:description" content="통합탭 10위 이내 ${top10}개 · 측정 ${measured.length}개 · 기준일 ${escapeHtml(today)} | 든든한 마케팅 성과보고">
<meta property="og:image" content="https://ddmkt-erp.pages.dev/og-report.png">
<meta name="twitter:card" content="summary_large_image">
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
  a.ranklink { color:inherit; text-decoration:none; } a.ranklink:hover { text-decoration:underline; }
  td.date,td.kw { white-space:nowrap; }
  .empty { text-align:center; color:#94a3b8; padding:28px; }
  .foot { margin-top:22px; color:#94a3b8; font-size:11px; }
  .btns { margin:18px 0; display:flex; gap:8px; } .btns button { font-size:14px; padding:8px 16px; border-radius:8px; border:0; background:#1e40af; color:#fff; font-weight:700; cursor:pointer; }
  .btns button.kakao { background:#FEE500; color:#191600; display:inline-flex; align-items:center; gap:6px; }
  .btns button.copy { background:#0f766e; }
  @media print { .btns { display:none; } body { padding:0; } }
</style></head><body>
<div class="btns">
  <button onclick="window.print()">인쇄 / PDF로 저장</button>
  <button class="kakao" onclick="sendKakao()"><span aria-hidden="true">💬</span> 카카오톡 발송</button>
  <button class="copy" onclick="copyLink()">🔗 링크 복사</button>
</div>
<div class="head"><h1>순위 트래커 성과 보고서</h1>
<div class="sub">네이버 통합검색/블로그탭 노출 순위 · 기준일 ${escapeHtml(today)}</div></div>
<div class="kpi">총 ${rows.length}개 글 · 통합탭 <span>10위 이내 ${top10}개</span> (측정 ${measured.length}개)</div>
<table>
  <thead><tr><th>업체명</th><th>블로그 주소</th><th>발행 날짜</th><th>키워드</th><th>통합탭 순위</th><th>블로그탭 순위</th></tr></thead>
  <tbody>${tableRows}</tbody>
</table>
<div class="foot">통합탭=네이버 통합검색 노출 순위 · 블로그탭=블로그 카테고리 순위 · 순위/주소를 누르면 네이버 검색이 열려 실제 노출 순위를 확인할 수 있습니다 · '권외'는 30위 밖 · 측정일이 오래됐으면 측정 후 출력하세요.</div>
<script src="https://t1.kakaocdn.net/kakao_js_sdk/2.7.4/kakao.min.js" crossorigin="anonymous"></script>
<script>
var KAKAO_JS_KEY = ${jsLit(KAKAO_JS_KEY)};
var KK_SUMMARY = ${jsLit(kkSummary)};
// 호스팅된 보고서(/r/:id)에서 열렸으면 그 페이지 주소를 공유(고객이 링크로 실제 화면 확인).
//   인라인 폴백(about:blank)일 땐 앱 주소로 대체.
var KK_LINK = (window.location && window.location.href && window.location.href.indexOf('about:') !== 0)
  ? window.location.href : ${jsLit(appUrl)};
function reportUrl(){
  return (window.location && window.location.href && window.location.href.indexOf('about:')!==0) ? window.location.href : KK_LINK;
}
// 카카오톡 발송 = '그냥 링크'로 보낸다(카카오 '앱 공유 메시지'는 받는 사람 동의 루프에 갇혀 못 씀).
//   공유 시트(navigator.share)에서 카카오톡 선택 → 일반 링크 메시지 → 받는 사람은 동의 없이 바로 열림.
//   링크엔 OG 카드(제목·요약·썸네일)가 붙어 예쁘게 표시. 공유 시트 미지원이면 링크 복사.
function sendKakao(){
  var url = reportUrl();
  if (navigator.share) {
    navigator.share({ title: '네이버 노출 성과 보고', text: KK_SUMMARY, url: url }).catch(function(){});
  } else {
    copyLink();
  }
}
// 링크 복사 — 호스팅된 보고서 주소(/r/:id)를 복사. 카톡 등 어디든 붙여넣어 전송(모바일/PC 공통, 가장 확실).
function copyLink(){
  var url = (window.location && window.location.href && window.location.href.indexOf('about:')!==0) ? window.location.href : KK_LINK;
  function done(){ alert('보고서 링크를 복사했습니다.\\n카카오톡 대화창에 붙여넣어 보내세요.\\n\\n' + url); }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(done, function(){ window.prompt('이 링크를 길게 눌러 복사하세요:', url); });
  } else {
    window.prompt('이 링크를 길게 눌러 복사하세요:', url);
  }
}
setTimeout(function(){window.focus();},100);
</script>
</body></html>`;
}

// 성과 보고서를 '호스팅'(/r/:id)으로 열어 카톡으로 보낼 공유 링크가 생기게 한다.
//   1) 사용자 클릭 즉시 새 창 열기(팝업차단 회피) → 2) HTML 을 서버리스에 저장(공유 id) →
//   3) 그 창을 /r/{id} 로 이동. 저장 실패 시 인라인(document.write)으로라도 보여준다(폴백).
export async function openTrackerReport(posts: BlogPost[], accounts: BlogAccount[]): Promise<boolean> {
    const w = window.open('', '_blank');
    if (!w) return false;
    w.document.write(
        '<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>성과 보고서</title></head>' +
            '<body style="font-family:\'Apple SD Gothic Neo\',\'Malgun Gothic\',sans-serif;padding:48px;color:#475569;font-size:15px">성과 보고서를 생성하는 중입니다…</body></html>',
    );
    const html = buildTrackerReportHtml(posts, accounts);
    try {
        const res = await fetch('/api/report-share', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ html, title: '순위 트래커 성과 보고서' }),
        });
        const data = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
        if (res.ok && data.id) {
            w.location.href = `/r/${data.id}`;
            return true;
        }
        throw new Error(data.error || `share ${res.status}`);
    } catch {
        // 호스팅 실패 → 인라인으로라도 보고서 표시(카톡 링크는 앱 주소로 폴백).
        w.document.open();
        w.document.write(html);
        w.document.close();
        return true;
    }
}
