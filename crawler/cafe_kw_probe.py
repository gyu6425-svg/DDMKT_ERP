# -*- coding: utf-8 -*-
"""키워드형 인기탭 스캐너 (발굴 전용·읽기).

  씨앗 키워드 → 네이버 자동완성으로 세부키워드 확장 → 각 세부키워드의 통합검색 SERP에서
  '인기글 테마 섹션'을 스캔해 (테마·광고/유기 슬롯·점유 카페/블로그·빈자리 판정)를 표로 낸다.

  배경: 인기탭 순위 경쟁은 '카테고리 섹션'이 아니라 '정확한 검색어' 단위로 벌어진다.
        브로드(향수)는 대형 카페가 독점하지만, 세부키워드(고체향수)는 경쟁이 옅어 진입 여지.
        → 지역형(지역+업종)의 '제품/주제版'. 측정은 blog_rank_crawler.measure_cafe_rank 그대로.

  실행:
    python cafe_kw_probe.py 향수                 # 씨앗 확장(자동완성) 후 세부키워드 일괄 스캔
    python cafe_kw_probe.py 향수 맛집 --depth 2   # 2단계 확장(세부의 세부까지)
    python cafe_kw_probe.py 고체향수 --no-expand  # 확장 없이 그 키워드만
    python cafe_kw_probe.py --self-test          # QA 자기검증(알려진 키워드로)

  이 PC(사무실 IP)에서만 돌린다(읽기 스캔). 대량 발행 아님.  [[cafe-scan-here]]
"""
import sys
import re
import json
from urllib.parse import quote

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
import truststore

truststore.inject_into_ssl()
import blog_rank_crawler as c  # 측정/차단회피/파싱 로직 재사용


# ── 자동완성(씨앗 → 세부키워드) ───────────────────────────────────────────────
def autocomplete(seed):
    """네이버 자동완성 → 세부키워드 리스트(씨앗 자신 제외)."""
    u = (
        f"https://ac.search.naver.com/nx/ac?q={quote(seed)}"
        "&con=1&frm=nx&ans=2&r_format=json&r_enc=UTF-8&r_unicode=0&st=100&run=2&rev=4&q_enc=UTF-8"
    )
    try:
        code, body = c._fetch_html(u)
        if code != 200:
            return []
        d = json.loads(body)
    except Exception:
        return []
    out = []
    for grp in d.get("items") or []:
        for row in grp:
            if isinstance(row, list) and row and isinstance(row[0], str):
                kw = row[0].strip()
                if kw and kw != seed:
                    out.append(kw)
    # 순서 유지 dedup
    seen = set()
    return [k for k in out if not (k in seen or seen.add(k))]


def expand(seeds, depth):
    """씨앗들을 depth 단계까지 자동완성으로 확장. depth=0 이면 씨앗 그대로."""
    result = []
    seen = set()

    def add(k):
        if k not in seen:
            seen.add(k)
            result.append(k)

    for s in seeds:
        add(s)
    if depth <= 0:
        return result
    frontier = list(seeds)
    for _ in range(depth):
        nxt = []
        for kw in frontier:
            for sub in autocomplete(kw):
                if sub not in seen:
                    add(sub)
                    nxt.append(sub)
            c._pause(0.6)
        frontier = nxt
    return result


# ── 인기글 섹션 스캔(1 키워드) ────────────────────────────────────────────────
def _section_title(j):
    hit = []

    def w(o):
        if isinstance(o, dict):
            for k, v in o.items():
                if k == "subjectTitle" and isinstance(v, str) and "인기글" in v:
                    hit.append(v.strip())
                w(v)
        elif isinstance(o, list):
            for x in o:
                w(x)

    w(j)
    return hit[0] if hit else None


def _rank_rows(j):
    """섹션 블록 → {원본r: {url, title}} (카페/블로그 링크가 붙은 카드만)."""
    rows = {}

    def w(o):
        if isinstance(o, dict):
            r = c._node_min_r(o)
            if isinstance(r, (int, float)) and not isinstance(r, bool) and r:
                title = o.get("title") or o.get("subject") or ""
                for kk in c._PRIMARY_NAV_FIELDS:
                    v = o.get(kk)
                    if isinstance(v, str) and ("cafe.naver.com" in v or "blog.naver.com" in v):
                        cur = rows.setdefault(int(r), {"url": v, "title": title})
                        if title and not cur.get("title"):
                            cur["title"] = title
            for kk, v in o.items():
                if kk in c._PRIMARY_EXCLUDE_KEYS:
                    continue
                w(v)
        elif isinstance(o, list):
            for x in o:
                w(x)

    w(j)
    return rows


def classify(kw):
    """키워드 1개 → 인기탭 판정 dict.
    {kw, has_section, theme, n_ad, n_organic, rows:[{rank,kind,who,article,title}], verdict, err}."""
    url = f"https://m.search.naver.com/search.naver?query={quote(kw)}"
    try:
        code, html = c._fetch_html(url)
    except Exception as e:
        return {"kw": kw, "err": str(e)[:50], "has_section": False}
    if code != 200:
        return {"kw": kw, "err": f"code {code}", "has_section": False}
    for b in c.extract_bootstrap_json(html):
        try:
            j = json.loads(b)
        except Exception:
            continue
        if not c._is_popular_section(j):
            continue
        theme = _section_title(j) or "?"
        ads = c._ad_ranks_cafe(j)
        cards = c._ugb_cards_cafe(j)  # {원본r: set((vanity,club,article))}
        raw = _rank_rows(j)
        organic = sorted(r for r in cards.keys() | raw.keys() if r not in ads)
        pos = {r: i + 1 for i, r in enumerate(organic)}
        rows = []
        for r in organic:
            u = raw.get(r, {}).get("url", "")
            title = re.sub(r"</?mark>|&quot;", "", raw.get(r, {}).get("title", "")).strip()
            kind = "카페" if "cafe.naver.com" in u else ("블로그" if "blog.naver.com" in u else "?")
            who, article = "", ""
            for (nm, _club, art) in cards.get(r, set()):
                who, article = nm or who, art or article
                kind = "카페"
            if not who:
                m = re.search(r"(?:cafe|blog)\.naver\.com/([^/?\"]+)(?:/(\d+))?", u)
                if m:
                    who, article = m.group(1), m.group(2) or ""
            rows.append({"rank": pos[r], "kind": kind, "who": who, "article": article, "title": title})
        # 판정
        cafe_rows = [x for x in rows if x["kind"] == "카페"]
        if not cafe_rows:
            verdict = "블로그섹션(카페없음)"
        else:
            from collections import Counter

            cnt = Counter(x["who"] for x in cafe_rows if x["who"])
            top, n = (cnt.most_common(1)[0] if cnt else ("", 0))
            verdict = f"카페독점({top})" if n >= 3 else "카페분산(기회)"
        return {
            "kw": kw, "has_section": True, "theme": theme,
            "n_ad": len(ads), "n_organic": len(organic), "rows": rows, "verdict": verdict,
        }
    return {"kw": kw, "has_section": False, "verdict": "섹션없음(광고·브랜드콘텐츠)"}


# ── 표 출력 ───────────────────────────────────────────────────────────────────
def scan(keywords, verbose=True):
    results = []
    for kw in keywords:
        r = classify(kw)
        results.append(r)
        if verbose:
            if r.get("err"):
                print(f"  [{kw}] ⚠ 오류 {r['err']}", flush=True)
            elif not r["has_section"]:
                print(f"  [{kw}] ❌ {r['verdict']}", flush=True)
            else:
                occ = ", ".join(
                    f"{x['rank']}위:{x['who']}" for x in r["rows"] if x["kind"] == "카페"
                ) or "(카페 없음)"
                print(
                    f"  [{kw}] ✅ 「{r['theme']}」 광고{r['n_ad']}·유기{r['n_organic']} | {r['verdict']} | {occ}",
                    flush=True,
                )
        c._pause(1.2)
    return results


# ── QA 자기검증 ───────────────────────────────────────────────────────────────
def self_test():
    """알려진 키워드로 파이프라인 검증. SERP 변동 가능 → 실패 시 단정 말고 보고."""
    print("=== QA self-test ===", flush=True)
    ok = 0
    total = 0

    def check(name, cond):
        nonlocal ok, total
        total += 1
        ok += 1 if cond else 0
        print(f"  [{'PASS' if cond else 'FAIL'}] {name}", flush=True)

    ac = autocomplete("향수")
    check(f"자동완성('향수') 비어있지 않음 ({len(ac)}개)", len(ac) > 0)
    c._pause(1.0)

    cases = [
        ("맛집", True, "맛집"),        # 맛집 인기글
        ("향수", True, "패션"),        # 패션·미용 인기글
        ("고체향수", True, None),      # 같은 섹션, 세부키워드도 인기글 있음
        ("다이어트", False, None),     # 인기글 없음(브랜드콘텐츠)
        ("임플란트", False, None),     # 인기글 없음
    ]
    for kw, want_section, theme_kw in cases:
        r = classify(kw)
        cond = r.get("has_section") == want_section
        if cond and theme_kw:
            cond = theme_kw in (r.get("theme") or "")
        detail = r.get("theme") if r.get("has_section") else r.get("verdict")
        check(f"classify('{kw}') 인기글={want_section} → {detail}", cond)
        c._pause(1.2)

    print(f"\n=== 결과 {ok}/{total} 통과 ===", flush=True)
    return ok == total


def main():
    args = sys.argv[1:]
    if "--self-test" in args:
        self_test()
        return
    no_expand = "--no-expand" in args
    depth = 1
    if "--depth" in args:
        try:
            depth = int(args[args.index("--depth") + 1])
        except Exception:
            depth = 1
    mx = 40
    if "--max" in args:
        try:
            mx = int(args[args.index("--max") + 1])
        except Exception:
            mx = 40
    seeds = [a for i, a in enumerate(args) if not a.startswith("--") and args[i - 1] not in ("--depth", "--max")]
    if not seeds:
        print("사용법: python cafe_kw_probe.py <씨앗키워드...> [--depth N] [--no-expand] [--max N] | --self-test")
        return
    kws = seeds if no_expand else expand(seeds, depth)
    kws = kws[:mx]
    print(f"=== 인기탭 스캔 · 씨앗 {seeds} → 대상 {len(kws)}키워드{' (확장없음)' if no_expand else f' (자동완성 depth {depth})'} ===", flush=True)
    results = scan(kws)
    farm = [r for r in results if r.get("has_section") and r.get("verdict", "").startswith("카페분산")]
    blogonly = [r for r in results if r.get("verdict", "").startswith("블로그섹션")]
    print("\n=== 요약 ===", flush=True)
    print(f"  인기탭 있음: {sum(1 for r in results if r.get('has_section'))}/{len(results)}", flush=True)
    print(f"  🎯 진입 기회(카페 분산): {', '.join(r['kw'] for r in farm) or '없음'}", flush=True)
    print(f"  🟡 블로그섹션(카페 무경쟁): {', '.join(r['kw'] for r in blogonly) or '없음'}", flush=True)


if __name__ == "__main__":
    main()
