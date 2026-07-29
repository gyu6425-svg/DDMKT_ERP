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
import os
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


# ── 지역형 배제 + 니치 소싱(제목 마이닝 · 연관검색어) ─────────────────────────
# 지역 신호: 행정구역 접미(시/군/구/동/읍/면/리/도) 토큰 + 주요 도시·상권명.
_REGION_SUFFIX = re.compile(r"[가-힣]{1,4}(시|군|구|동|읍|면|리|도)\b")
_REGION_WORDS = set(
    "서울 부산 대구 인천 광주 대전 울산 세종 수원 성남 용인 고양 부천 안산 안양 남양주 화성 평택 "
    "의정부 파주 김포 광명 군포 하남 오산 이천 안성 포천 여주 양평 시흥 김해 창원 진주 양산 거제 "
    "천안 아산 청주 충주 전주 군산 익산 목포 여수 순천 포항 경주 구미 안동 강릉 원주 춘천 속초 제주 "
    "홍대 강남 이태원 성수 명동 신촌 건대 잠실 압구정 가로수길 연남 망원 을지로 종로 여의도 판교".split()
)
# 니치가 아닌 잡토큰(제목/연관에서 걸러낼 것) — 형용사·일반명사·메타.
_STOP = set(
    "추천 후기 모음 사랑 종류 서열 가격 순위 브랜드 명품 관련 개요 역사 취미 효과 용도 더보기 방법 "
    "좋은 좋아하는 고르는 최고 인기 요즘 올해 신상 문서 정보 검색 blog zip best top".split()
)


def is_regional(kw):
    if _REGION_SUFFIX.search(kw):
        return True
    return any(w in kw for w in _REGION_WORDS)


# 브랜드/고유명 니치 배제 — 사용자 요청: '니치향수·남자향수'(유형·속성) OK / '향수조말론·구어망드향수'
#   (브랜드·고유명) 배제. 일반 유형어만 남긴다. cafe_brand_block.txt(한 줄 1개, # 주석)로 무한 확장.
_BRAND = set(
    "샤넬 디올 조말론 딥디크 딥티크 톰포드 바이레도 크리드 입생로랑 랑방 불가리 에르메스 베르사체 "
    "안나수이 메종마르지엘라 마르지엘라 구찌 프라다 버버리 겔랑 펜할리곤스 아쿠아디파르마 르라보 "
    "산타마리아노벨라 루이비통 아르마니 조르지오아르마니 몽블랑 나르시소 마크제이콥스 로에베 끌로에 "
    "클로에 지방시 겐조 카르띠에 킬리안 프레데릭말 아닉구딸 세르주루텐 구어망드 올리브영 다이소".split()
)
_BRAND_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "cafe_brand_block.txt")
try:
    if os.path.exists(_BRAND_FILE):
        with open(_BRAND_FILE, encoding="utf-8") as _f:
            _BRAND |= {ln.strip() for ln in _f if ln.strip() and not ln.lstrip().startswith("#")}
except Exception:
    pass


def is_brandish(kw):
    """키워드에 브랜드/고유명 토큰이 들어가면 True(=제외 대상)."""
    return any(b in kw for b in _BRAND)


# ── 네이버 플레이스(placeId) → 업체 키워드 ────────────────────────────────────
# 입력한 플레이스 주소/ID의 업종·플레이스키워드를 뽑아 인기탭 스캔 시드로 쓴다.
#   (place_rank_crawler 와 동일한 모바일 UA. m.place 홈 HTML의 keywordList/category 파싱.)
import requests  # noqa: E402

_PLACE_UA = (
    "Mozilla/5.0 (Linux; Android 13; SM-S918N) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36"
)


def parse_place_id(s):
    """map.naver.com/p/entry/place/1066951825… 또는 그냥 숫자 ID → placeId."""
    m = re.search(r"/place/(\d{6,})", s) or re.search(r"\b(\d{6,})\b", s)
    return m.group(1) if m else None


def place_info(pid):
    """placeId → {name, cats, keywords}. m.place 홈 HTML 파싱."""
    u = f"https://m.place.naver.com/place/{pid}/home"
    try:
        r = requests.get(
            u,
            headers={"User-Agent": _PLACE_UA, "Accept-Language": "ko", "Referer": "https://m.place.naver.com/"},
            timeout=20,
        )
        r.encoding = "utf-8"
        body = r.text
    except Exception:
        return None
    if r.status_code != 200:
        return None
    name = (re.findall(r'"name"\s*:\s*"([^"]{1,40})"', body) or ["?"])[0]
    cats = list(dict.fromkeys(re.findall(r'"category"\s*:\s*"([^"]{1,20})"', body)))
    kws = []
    for blk in re.findall(r'"keywordList"\s*:\s*\[([^\]]{2,400})\]', body):
        kws += re.findall(r'"([^"]{2,20})"', blk)
    if not kws:
        for blk in re.findall(r'"keyword[s]?"\s*:\s*\[([^\]]{2,400})\]', body):
            kws += re.findall(r'"([^"]{2,20})"', blk)
    return {"pid": pid, "name": name, "cats": cats, "keywords": list(dict.fromkeys(kws))}


def related_keywords(seed):
    """SERP 연관검색어 → 씨앗과 결합할 수식어 후보(정제)."""
    url = f"https://m.search.naver.com/search.naver?query={quote(seed)}"
    try:
        _code, html = c._fetch_html(url)
    except Exception:
        return []
    rel = re.findall(r'"(?:keyword|relateKeyword|text)"\s*:\s*"([^"]{2,12})"', html)
    out = []
    for w in rel:
        w = w.strip()
        if not re.fullmatch(r"[가-힣]{2,8}", w):  # 한글 전용(영문 파편 min·channels 배제)
            continue
        if w == seed or w in _STOP or is_regional(w):
            continue
        out.append(w)
    seen = set()
    return [w for w in out if not (w in seen or seen.add(w))]


def mine_niches(seed):
    """씨앗의 '인기글' 제목에서 (수식어+씨앗) 형태의 니치를 캐낸다(예: 향수→고체향수·중동향수)."""
    url = f"https://m.search.naver.com/search.naver?query={quote(seed)}"
    try:
        _code, html = c._fetch_html(url)
    except Exception:
        return []
    titles = []
    for b in c.extract_bootstrap_json(html):
        try:
            j = json.loads(b)
        except Exception:
            continue
        if not c._is_popular_section(j):
            continue

        def w(o):
            if isinstance(o, dict):
                t = o.get("title") or o.get("subject")
                if isinstance(t, str) and t.strip():
                    titles.append(re.sub(r"</?mark>|&quot;", "", t).strip())
                for k, v in o.items():
                    if k in c._PRIMARY_EXCLUDE_KEYS:
                        continue
                    w(v)
            elif isinstance(o, list):
                for x in o:
                    w(x)

        w(j)
    cands = []
    for t in titles:
        for m in re.finditer(rf"([가-힣]{{2,6}})\s?{seed}", t):  # 수식어+씨앗(한글 전용)
            mod = m.group(1)
            if not mod or mod == seed or mod in _STOP or is_regional(mod):
                continue
            if mod.endswith(("맘", "님", "네", "씨", "러", "족", "일상")):  # 작성자 닉네임 파편 배제
                continue
            cands.append((mod + seed).replace(" ", ""))
    seen = set()
    return [k for k in cands if not (k in seen or seen.add(k))]


def niche_candidates(seed, limit=18):
    """씨앗 → 지역형 배제한 상품/유형 니치 후보(제목마이닝 + 연관검색어 결합 + 접두 자동완성)."""
    out = []
    seen = set()

    def add(k):
        # 씨앗은 무조건 포함. 그 외엔 지역형·브랜드/고유명 배제.
        if k and k not in seen and not is_regional(k) and (k == seed or not is_brandish(k)):
            seen.add(k)
            out.append(k)

    add(seed)
    for k in mine_niches(seed):  # 향수→고체향수·중동향수… (핵심 소스)
        add(k)
    for w in related_keywords(seed):  # 샤넬·조말론… → 샤넬향수
        add(w + seed)
        add(seed + w)
    for k in autocomplete(seed):  # 접두 복합어(향수쇼핑몰 등)
        add(k)
    return out[:limit]


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
    niche = "--niche" in args
    place = "--place" in args
    seeds = [a for i, a in enumerate(args) if not a.startswith("--") and args[i - 1] not in ("--depth", "--max")]
    if not seeds:
        print("사용법: python cafe_kw_probe.py <씨앗|플레이스URL> [--place] [--niche] [--depth N] [--max N] | --self-test")
        return
    if place:  # 플레이스 주소/ID → 업종·플레이스키워드로 인기탭 스캔
        pid = parse_place_id(seeds[0])
        info = place_info(pid) if pid else None
        if not info:
            print(f"플레이스 조회 실패: {seeds[0]} (placeId 추출/조회 불가)")
            return
        print(f"=== 플레이스 {pid} · {info['name']} ({', '.join(info['cats'][:3]) or '업종?'}) ===", flush=True)
        print(f"  플레이스 키워드: {', '.join(info['keywords'][:15]) or '(없음)'}", flush=True)
        base = [k for k in (info["cats"][:2] + info["keywords"]) if not is_regional(k) and not is_brandish(k)]
        base = list(dict.fromkeys(base))
        if niche:  # 각 업체 키워드를 니치까지 확장
            kws = []
            for s in base:
                for k in niche_candidates(s, 6):
                    if k not in kws:
                        kws.append(k)
        else:
            kws = base
        kws = kws[:mx]
        print(f"\n=== 인기탭 스캔 · 시드 {len(kws)}{' (니치 확장)' if niche else ''} ===", flush=True)
        results = scan(kws)
        farm = [r for r in results if r.get("has_section") and r.get("verdict", "").startswith("카페분산")]
        blogonly = [r for r in results if r.get("verdict", "").startswith("블로그섹션")]
        print("\n=== 요약 ===", flush=True)
        print(f"  업체: {info['name']} · {', '.join(info['cats'][:3])}", flush=True)
        print(f"  인기탭 있음: {sum(1 for r in results if r.get('has_section'))}/{len(results)}", flush=True)
        print(f"  🎯 진입 기회(카페 분산): {', '.join(r['kw'] for r in farm) or '없음'}", flush=True)
        print(f"  🟡 블로그섹션(카페 무경쟁): {', '.join(r['kw'] for r in blogonly) or '없음'}", flush=True)
        return
    if niche:  # 지역형 배제 + 상품/유형 니치(향수→고체향수 방식)
        kws = []
        seen = set()
        for s in seeds:
            for k in niche_candidates(s, mx):
                if k not in seen:
                    seen.add(k)
                    kws.append(k)
        mode = " (니치 · 지역형 배제)"
    elif no_expand:
        kws = seeds[:mx]
        mode = " (확장없음)"
    else:
        kws = expand(seeds, depth)[:mx]
        mode = f" (자동완성 depth {depth})"
    print(f"=== 인기탭 스캔 · 씨앗 {seeds} → 대상 {len(kws)}키워드{mode} ===", flush=True)
    results = scan(kws)
    # 씨앗과 같은 카테고리 테마만 진짜 니치 — 다른 테마로 새는 고유명(정지용향수=문학·책 등) 배제.
    seed_cat = ""
    if niche and results:
        seed_r = next((r for r in results if r["kw"] in seeds and r.get("has_section")), results[0])
        seed_cat = (seed_r.get("theme") or "").replace("인기글", "").strip()

    def same_cat(r):
        return not seed_cat or seed_cat in (r.get("theme") or "")

    farm = [
        r for r in results
        if r.get("has_section") and r.get("verdict", "").startswith("카페분산") and same_cat(r)
    ]
    offcat = [
        r for r in results
        if r.get("has_section") and r.get("verdict", "").startswith("카페분산") and not same_cat(r)
    ]
    blogonly = [r for r in results if r.get("verdict", "").startswith("블로그섹션") and same_cat(r)]
    print("\n=== 요약 ===", flush=True)
    print(f"  인기탭 있음: {sum(1 for r in results if r.get('has_section'))}/{len(results)}", flush=True)
    if seed_cat:
        print(f"  씨앗 카테고리: {seed_cat}", flush=True)
    print(f"  🎯 진입 기회(같은 카테고리·카페 분산): {', '.join(r['kw'] for r in farm) or '없음'}", flush=True)
    print(f"  🟡 블로그섹션(카페 무경쟁): {', '.join(r['kw'] for r in blogonly) or '없음'}", flush=True)
    if niche and offcat:
        print(f"  ⚪ 다른 카테고리로 샘(참고·제외): {', '.join(r['kw'] for r in offcat)}", flush=True)


if __name__ == "__main__":
    main()
