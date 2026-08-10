# 독립검증: 군포/오산 인기탭이 진짜인지 — 모바일 카페카드 + PC 통합검색(사용자가 보는 화면) 둘 다 확인.
import os, sys, json, re, html as H, requests
from urllib.parse import quote
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import blog_rank_crawler as c
c.need_config()
requests.packages.urllib3.disable_warnings()
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0 Safari/537.36'
REVIEW_RE = re.compile(r'https://s\.search\.naver\.com/p/review/\d+/search\.naver\?[^\s"\'<>]+')
CAFE_RE = re.compile(r'cafe\.naver\.com/[A-Za-z0-9_-]+/\d+')


def pc_pop(kw):
    """PC 통합검색(search.naver.com)에 카페 인기글 섹션이 실제 있나 — 사용자가 보는 기준."""
    su = f'https://search.naver.com/search.naver?query={quote(kw)}'
    try:
        html = requests.get(su, headers={'User-Agent': UA, 'Accept-Language': 'ko-KR'}, timeout=15, verify=False).text
    except Exception:
        return None
    for u in REVIEW_RE.findall(html):
        try:
            b = requests.get(H.unescape(u), headers={'User-Agent': UA, 'Referer': su}, timeout=15, verify=False).text
        except Exception:
            continue
        if len(b) > 1000 and '인기글' in b and CAFE_RE.search(b):
            return True
    return False


def cards(kw):
    code, html = c._fetch_html(f'https://m.search.naver.com/search.naver?query={quote(kw)}')
    for b in c.extract_bootstrap_json(html or ''):
        try:
            j = json.loads(b)
        except Exception:
            continue
        if c._is_popular_section(j):
            cc = c._ugb_cards_cafe(j)
            ads = c._ad_ranks_cafe(j)
            # r -> set((nm,club,art)); 광고 제외 + 카페 있는 것만
            out = {}
            for r, ids in cc.items():
                if r in ads or not ids:
                    continue
                out[r] = sorted(ids)
            return out
    return {}


tests = ['군포 회사보안', '오산 회사보안', '대전 회사보안', '창원 회사보안', '송파 회사보안', '평택 회사보안']
data = {}
for kw in tests:
    data[kw] = cards(kw)
    arts = set()
    for r, ids in data[kw].items():
        for (nm, club, art) in ids:
            arts.add((club, art))
    print(f'\n=== {kw} : 카페카드 {len(data[kw])}개 ===', flush=True)
    for r in sorted(data[kw]):
        for (nm, club, art) in data[kw][r]:
            print(f'   r{r}: {nm or club}/{art}', flush=True)

# 지역간 article 겹침 — 군포·오산 카드가 다른 지역과 동일하면 '전국 공용(가짜)'
def artset(kw):
    s = set()
    for r, ids in data[kw].items():
        for (nm, club, art) in ids:
            s.add((club, art))
    return s

print('\n===== 모바일 카페카드 vs PC 통합검색 =====', flush=True)
for kw in tests:
    pc = pc_pop(kw)
    print(f'  {kw}: 모바일카페 {len(data[kw])}개 · PC인기글 {"O" if pc else ("x" if pc is False else "?")}', flush=True)
