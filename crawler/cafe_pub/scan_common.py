# [공용] 카페 인기탭 판정 — PC 통합검색(사용자가 실제 보는 화면) 기준.
#   교훈(2026-07-28): 모바일 m.search 부트스트랩은 PC 에 안 뜨는 인기글 섹션까지 잡아 과잉탐지
#     (군포/오산 회사보안 = 모바일 카페카드 3~4개인데 PC 인기글 없음 → 사용자가 아니라 함).
#   정확 기준 = PC 통합검색(search.naver.com)의 리뷰 부트스트랩에 '인기글' + 카페링크 존재.
#     (회사보안·소방업체·입주청소 전부 이 방식이 사용자 관측과 일치. 대전·창원·성남·목동 O / 군포 x)
import os, sys, json, re, html as H, requests
from urllib.parse import quote
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import blog_rank_crawler as c
requests.packages.urllib3.disable_warnings()

UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36'
REVIEW_RE = re.compile(r'https://s\.search\.naver\.com/p/review/\d+/search\.naver\?[^\s\"\'<>]+')
CAFE_RE = re.compile(r'cafe\.naver\.com/[A-Za-z0-9_-]+/\d+')

# 발굴 스캔 전용 IP 우회. SCAN_PROXY(예: http://ID:PW@호스트:포트, 또는 모바일 회선 프록시)를
#   설정하면 이 발굴 스캔만 그 IP로 나간다. 미설정=직결(기존 동작 그대로, 하위호환).
#   ⚠️ 이 프록시는 scan_common(발굴)에만 적용된다. 일일 순위 크롤(blog_rank_crawler)은
#      고객 대시보드 정확도를 위해 절대 프록시를 타지 않는다(우리 IP 유지).
_SP = os.environ.get('SCAN_PROXY', '').strip()
_PROXIES = {'http': _SP, 'https': _SP} if _SP else None


def _pc_pop(kw):
    """PC 통합검색에 카페 인기글 섹션이 실제 렌더되나(사용자가 보는 기준)."""
    su = f'https://search.naver.com/search.naver?query={quote(kw)}'
    try:
        html = requests.get(su, headers={'User-Agent': UA, 'Accept-Language': 'ko-KR'}, timeout=15, verify=False, proxies=_PROXIES).text
    except Exception:
        return False
    for u in REVIEW_RE.findall(html):
        try:
            b = requests.get(H.unescape(u), headers={'User-Agent': UA, 'Referer': su}, timeout=15, verify=False, proxies=_PROXIES).text
        except Exception:
            continue
        if len(b) > 1000 and '인기글' in b and CAFE_RE.search(b):
            return True
    return False


def _mobile_cafe_count(kw):
    """참고용 — 모바일 인기글 섹션 광고제외 카페 카드 수(상위 개수 표시).
    발굴 스캔 일관성을 위해 여기도 SCAN_PROXY 를 탄다(파싱만 blog_rank_crawler 재사용)."""
    try:
        html = requests.get(f'https://m.search.naver.com/search.naver?query={quote(kw)}',
                            headers={'User-Agent': UA, 'Accept-Language': 'ko-KR'},
                            timeout=15, verify=False, proxies=_PROXIES).text
    except Exception:
        return 0
    for b in c.extract_bootstrap_json(html or ''):
        try:
            j = json.loads(b)
        except Exception:
            continue
        if c._is_popular_section(j):
            cards = c._ugb_cards_cafe(j)
            ads = c._ad_ranks_cafe(j)
            return len([r for r, ids in cards.items() if ids and r not in ads])
    return 0


def cafe_popular(kw):
    """(인기탭 여부, 상위 개수). 판정=PC 통합검색. 개수=통과 시에만 모바일 카페카드 참고."""
    if not _pc_pop(kw):
        return (False, 0)
    return (True, _mobile_cafe_count(kw))
