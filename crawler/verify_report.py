# 독립검증 — 보고 대상(오늘 26일 + 전날 25일) 글의 (1) 누락 0 (2) 순위 정확도.
#   A) 누락검증: 전체 활성블로그 RSS(KST) 26/25 글 ↔ DB 측정값 대조 → 빠진 글 적발.
#   B) 순위 독립검증: 각 글을 라이브 재측정 + '순위 사다리'(카운트된 콘텐츠 카드 나열)로 근거 출력 →
#      DB 저장값과 비교(불일치/변동 적발) + 사람이 화면과 대조 가능.
import sys, json, datetime
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
import truststore; truststore.inject_into_ssl()
import blog_rank_crawler as c
from urllib.parse import quote
import requests

c.MAX_POSTS_PER_BLOG = 15
TODAY = c.TODAY
d0 = datetime.date.fromisoformat(TODAY)
NDAYS = int(sys.argv[1]) if len(sys.argv) > 1 else 2          # 기본 26,25
TARGET = [(d0 - datetime.timedelta(days=k)).isoformat() for k in range(NDAYS)]
SAMPLE_25 = int(sys.argv[2]) if len(sys.argv) > 2 else 999    # 25일 라이브 검증 표본 수(기본 전부)

c.need_config()
accounts = c.sb_get("blog_accounts", {"is_active": "eq.true", "select": "id,name,blog_id,blog_url"})
posts_db = c.sb_get("blog_posts", {"select": "id,blog_account_id,post_url,title,keyword,keyword_manual,published_date,measurements", "limit": "9000"})
db_by_acc_url = {(p["blog_account_id"], p["post_url"]): p for p in posts_db}
name_of = {a["id"]: a["name"] for a in accounts}

# ── A) 누락검증: RSS(KST) 대상글 수집 → DB 측정 여부 대조 ──
print(f"===== A) 누락검증  대상날짜 {TARGET} =====", flush=True)
targets = []   # {acc, blog_id, url, title, pub, db}
miss_rss, miss_meas = [], []
for a in accounts:
    bid = a.get("blog_id") or c.parse_blog_url(a.get("blog_url", ""))[0] or ""
    if not bid:
        continue
    try:
        entries = c._rss_entries_light(bid)
    except Exception as exc:
        print(f"  [RSS실패] {a['name']}: {exc}", flush=True)
        continue
    for e in entries:
        if e.get("published_date") not in TARGET:
            continue
        db = db_by_acc_url.get((a["id"], e["url"]))
        m = next((x for x in (db.get("measurements") or []) if x.get("date") == TODAY), None) if db else None
        targets.append({"acc": a, "blog_id": bid, "url": e["url"], "title": e["title"], "pub": e["published_date"], "db": db, "m": m})
        if not db:
            miss_rss.append((a["name"], e["pub"] if "pub" in e else e["published_date"], e["title"][:30]))
        elif not m:
            miss_meas.append((a["name"], e["published_date"], e["title"][:30]))

by_day = {}
for t in targets:
    by_day.setdefault(t["pub"], []).append(t)
for d in TARGET:
    print(f"  {d}: 대상 {len(by_day.get(d, []))}글", flush=True)
print(f"  ▶ DB에 글 자체가 없음(미수집): {len(miss_rss)}건", flush=True)
for n, d, t in miss_rss:
    print(f"     - {n} | {d} | {t}", flush=True)
print(f"  ▶ 글은 있는데 오늘 측정 안 됨: {len(miss_meas)}건", flush=True)
for n, d, t in miss_meas:
    print(f"     - {n} | {d} | {t}", flush=True)


# ── 순위 사다리(통합탭): 카운트되는 콘텐츠 카드를 섹션·순위 순서로 나열 ──
def ladder_integrated(html_text, target_blog, target_log):
    blocks = c.extract_bootstrap_json(html_text)
    rows = []
    prev_area = None
    rank = 0
    hit_rank = None
    for b in blocks:
        try:
            j = json.loads(b)
        except Exception:
            continue
        if "ader.naver.com" in b:
            continue
        area = c._block_area(j)
        if c._is_web_area(area):
            continue
        if c._block_min_r(j) >= 999:
            continue
        if not c._is_content_card(j, b):
            continue
        if area != prev_area:
            rank = 0
            prev_area = area
        if area.startswith("ugB"):
            for r, prims in c._ugb_cards(j):
                rank += 1
                hit = any((target_log and lno == target_log) or (not target_log and bid == target_blog) for bid, lno in prims)
                rows.append((rank, area, list(prims), hit))
                if hit and hit_rank is None:
                    hit_rank = rank
        else:
            rank += 1
            ps, profiles = c._block_blog_entries(j)
            hit = c._entry_match(target_blog, target_log, ps, profiles)
            rows.append((rank, area, ps, hit))
            if hit and hit_rank is None:
                hit_rank = rank
    return rows, hit_rank


def kw_of(db):
    return (db.get("keyword_manual") or db.get("keyword") or "").strip()


# ── B) 순위 독립검증(라이브 재측정 + 사다리) ──
print(f"\n===== B) 순위 독립검증(라이브 재측정 vs DB저장) =====", flush=True)
# 26일 전부 + 25일 표본
order = [t for t in targets if t["pub"] == TARGET[0]]
rest = [t for t in targets if t["pub"] != TARGET[0]]
order += rest[:SAMPLE_25]
mismatch = []
for t in order:
    db = t["db"]
    if not db:
        continue
    kw = kw_of(db)
    blog_id, log_no = t["blog_id"], c.extract_log_no(t["url"])
    if not kw:
        print(f"\n[{t['pub']}] {t['acc']['name']} — 키워드 없음(스킵)", flush=True)
        continue
    # 라이브 통합탭
    url = f"https://m.search.naver.com/search.naver?query={quote(kw)}"
    code, htext = c._fetch_html(url)
    rows, hit = ladder_integrated(htext, blog_id, log_no) if code == 200 else ([], None)
    ti_live, ti_st, ws = c.measure_integrated_popular(kw, blog_id, log_no)
    bl_live, bl_st = c.measure_blogtab_real(kw, blog_id, log_no)
    m = t["m"] or {}
    ti_db = m.get("ti"); bl_db = m.get("bl"); ti_dbs = m.get("ti_status"); bl_dbs = m.get("bl_status")
    print(f"\n[{t['pub']}] {t['acc']['name']} · '{kw}' · logNo {log_no or '-'}", flush=True)
    print(f"   통합탭: 라이브 {ti_live if ti_st=='ok' else ti_st}  vs  DB {ti_db if ti_dbs=='ok' else ti_dbs}   | 사다리매칭 {hit}", flush=True)
    print(f"   블로그탭: 라이브 {bl_live if bl_st=='ok' else bl_st}  vs  DB {bl_db if bl_dbs=='ok' else bl_dbs}", flush=True)
    # 사다리(최대 hit+2 줄까지)
    lim = (hit + 2) if hit else 8
    for (r, area, prims, h) in rows[:lim]:
        ids = ",".join((f"{b}/{l}" if l else b) for b, l in list(prims)[:3])
        print(f"      {r:>2}. [{area}] {ids}{'   ★우리글' if h else ''}", flush=True)
    # 불일치 판정(둘 다 ok 인데 값이 다르면)
    if ti_st == "ok" and ti_dbs == "ok" and ti_live != ti_db:
        mismatch.append((t["acc"]["name"], t["pub"], "통합탭", ti_live, ti_db))
    if bl_st == "ok" and bl_dbs == "ok" and bl_live != bl_db:
        mismatch.append((t["acc"]["name"], t["pub"], "블로그탭", bl_live, bl_db))
    c._pause(c.REQUEST_DELAY)

print(f"\n===== 요약 =====", flush=True)
print(f"누락(DB없음) {len(miss_rss)} · 미측정 {len(miss_meas)} · 라이브vs DB 불일치 {len(mismatch)}", flush=True)
for n, d, k, lv, dv in mismatch:
    print(f"   불일치: {n} {d} {k} 라이브{lv}≠DB{dv}", flush=True)
