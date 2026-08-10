# [main 전용] '{지역} 회사보안' 인기글 스캔 — 새 발행 지역 찾기. ⛔ sub에서 실행 금지.
import requests, re, html as H
from urllib.parse import quote
requests.packages.urllib3.disable_warnings()
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36'
REVIEW_RE = re.compile(r'https://s\.search\.naver\.com/p/review/\d+/search\.naver\?[^\s"\'<>\\]+')
CAFE_RE = re.compile(r'cafe\.naver\.com/[A-Za-z0-9_-]+/\d+')

def has_pop(kw):
    su = f'https://search.naver.com/search.naver?query={quote(kw)}'
    try:
        html = requests.get(su, headers={'User-Agent': UA, 'Accept-Language': 'ko-KR'}, timeout=15, verify=False).text
    except Exception:
        return False
    for u in REVIEW_RE.findall(html):
        try:
            b = requests.get(H.unescape(u), headers={'User-Agent': UA, 'Referer': su}, timeout=15, verify=False).text
        except Exception:
            continue
        if len(b) > 1000 and '인기글' in b and CAFE_RE.search(b):
            return True
    return False

DONE = {'성남', '서초', '송파', '분당', '부천', '안양', '용인'}   # 이미 발행됨
REGIONS = [
    '종로','서울중구','용산','성동','광진','동대문','중랑','성북','강북','도봉','노원','은평',
    '서대문','마포','양천','강서','구로','금천','영등포','동작','관악','강동','강남',
    '수원','고양','성남','용인','부천','안산','안양','남양주','화성','평택','의정부','파주',
    '시흥','김포','광명','군포','오산','하남','의왕','구리','인천','판교','일산','동탄','위례','청라','송도',
]
hits = []
for r in REGIONS:
    ok = has_pop(f'{r} 회사보안')
    tag = ('★새 발행가능' if ok and r not in DONE else ('(이미함)' if r in DONE else ''))
    print(('O ' if ok else 'x ') + f'{r} 회사보안 {tag}', flush=True)
    if ok and r not in DONE:
        hits.append(r)
print('\n★ 미발행 인기글 지역:', ', '.join(hits) if hits else '(없음)')
