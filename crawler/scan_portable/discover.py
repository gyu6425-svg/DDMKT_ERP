# -*- coding: utf-8 -*-
"""독립형 카페 인기탭 발굴 스캐너 (이식용) — requests 하나만 있으면 됨.
  · 판정 기준 = 본 ERP의 검증된 PC 통합검색 방식(scan_common._pc_pop 과 동일 로직).
      search.naver 리뷰 부트스트랩에 '인기글' + 카페링크가 실제 렌더되면 인기탭 O.
  · 이 PC가 '폰 테더링(통신사 모바일 IP)' 로 나가는 상태에서 돌려야 사무실 IP 를 안 태운다.
      실행 시 공인 IP 를 먼저 찍어 사무실 IP(218.233.16.38)면 경고한다.
  · 데이터 절약: 키워드당 ~1.5MB (참고용 개수 조회 생략한 라이트 버전).
  실행:  python discover.py           (keywords.txt 읽어 results.csv 저장)
"""
import sys, re, time, csv, html as H
try:
    sys.stdout.reconfigure(encoding='utf-8')   # 한글/기호 콘솔 깨짐 방지(파이썬 3.7+)
except Exception:
    pass
import requests
from urllib.parse import quote
requests.packages.urllib3.disable_warnings()

UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36'
REVIEW_RE = re.compile(r'https://s\.search\.naver\.com/p/review/\d+/search\.naver\?[^\s\"\'<>]+')
CAFE_RE = re.compile(r'cafe\.naver\.com/[A-Za-z0-9_-]+/\d+')
OFFICE_IP = '218.233.16.38'          # 사무실 유선 — 이 IP면 폰 테더링 안 잡힌 것
GAP_SEC = 1.0                        # 키워드 사이 간격(네이버 부담↓). 필요시 조절.


def egress_ip():
    """현재 나가는 공인 IP / ISP / 모바일 여부."""
    try:
        return requests.get('http://ip-api.com/json/?fields=query,isp,country,mobile,hosting', timeout=15).json()
    except Exception as e:
        return {'error': str(e)}


def is_popular(kw):
    """PC 통합검색에 카페 인기글 섹션이 실제 렌더되나. True/False, 오류면 None."""
    su = f'https://search.naver.com/search.naver?query={quote(kw)}'
    try:
        html = requests.get(su, headers={'User-Agent': UA, 'Accept-Language': 'ko-KR'}, timeout=20, verify=False).text
    except Exception:
        return None
    for u in REVIEW_RE.findall(html):
        try:
            b = requests.get(H.unescape(u), headers={'User-Agent': UA, 'Referer': su}, timeout=20, verify=False).text
        except Exception:
            continue
        if len(b) > 1000 and '인기글' in b and CAFE_RE.search(b):
            return True
    return False


def main():
    # 1) 공인 IP 안전 확인 --------------------------------------------------
    ip = egress_ip()
    q = ip.get('query')
    print('=' * 56)
    print(f"현재 공인 IP : {q}")
    print(f"통신사(ISP)  : {ip.get('isp')}   모바일={ip.get('mobile')}   국가={ip.get('country')}")
    print('=' * 56)
    if q == OFFICE_IP:
        print("\n[경고] 지금 '사무실 유선 IP' 로 나가고 있습니다!")
        print("       폰 USB 테더링을 켜고 랜선/와이파이를 끈 뒤 다시 실행하세요.")
        ans = input("       그래도 이 IP로 강행하려면  yes  입력(취소는 그냥 Enter): ").strip().lower()
        if ans != 'yes':
            print("중단했습니다."); return
    elif not q:
        print("\n[경고] 인터넷 연결 확인 실패. 폰 테더링/연결 상태를 확인하세요.")
        input("Enter 로 종료..."); return
    elif not ip.get('mobile'):
        print("\n[참고] 모바일 IP 가 아닙니다(유선/기타). 사무실만 아니면 스캔은 됩니다.")

    # 2) 키워드 로드 -------------------------------------------------------
    try:
        kws = [l.strip() for l in open('keywords.txt', encoding='utf-8')
               if l.strip() and not l.strip().startswith('#')]
    except FileNotFoundError:
        print("\n[오류] keywords.txt 가 없습니다. 같은 폴더에 키워드 목록 파일을 두세요.")
        input("Enter 로 종료..."); return
    if not kws:
        print("\n[오류] keywords.txt 가 비어 있습니다."); input("Enter 로 종료..."); return

    # 3) 스캔 + 저장 -------------------------------------------------------
    print(f"\n총 {len(kws)}개 키워드 스캔 시작 (키워드당 약 1.5MB, 간격 {GAP_SEC}s)\n")
    out = open('results.csv', 'w', encoding='utf-8-sig', newline='')
    w = csv.writer(out); w.writerow(['키워드', '인기탭'])
    hits, errs = [], 0
    t0 = time.time()
    for i, kw in enumerate(kws, 1):
        r = is_popular(kw)
        mark = 'O' if r is True else ('X' if r is False else '오류')
        if r is True:
            hits.append(kw)
        elif r is None:
            errs += 1
        w.writerow([kw, mark]); out.flush()
        print(f"[{i}/{len(kws)}] {kw}  ->  {mark}")
        if i < len(kws):
            time.sleep(GAP_SEC)
    out.close()

    # 4) 요약 --------------------------------------------------------------
    dt = int(time.time() - t0)
    print("\n" + '=' * 56)
    print(f"완료!  인기탭 O = {len(hits)}개 / 전체 {len(kws)}개  (오류 {errs}, {dt}초)")
    if hits:
        print("--- 인기탭 잡힌 키워드 ---")
        for h in hits:
            print("  * " + h)
    print("결과 파일: results.csv (엑셀로 열림)")
    input("\nEnter 로 종료...")


if __name__ == '__main__':
    main()
