# -*- coding: utf-8 -*-
"""발굴 스캔 IP 우회 검증기 — SCAN_PROXY 가 발굴 스캔에 쓸 만한지 4가지를 실측한다.
  실행:  set SCAN_PROXY=http://ID:PW@호스트:포트   (모바일회선/한국주거 프록시)
         py _scan_ip_check.py
  SCAN_PROXY 미설정이면 '직결(우리 IP)' 정보만 보여준다.
검사: ①한국 IP인가 ②모바일/주거 vs 데이터센터 ③우리 IP와 인기탭 결과 일치(제일 중요) ④속도.
"""
import os, sys, time, json, requests
requests.packages.urllib3.disable_warnings()
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

SP = os.environ.get('SCAN_PROXY', '').strip()
PROXY = {'http': SP, 'https': SP} if SP else None
# 인기탭 충실도 비교용 표본(이미 관측된 정답: 대전/창원 O, 군포 x 등과 대조하기 좋은 키워드).
SAMPLE_KW = ['대전 회사보안', '창원 회사보안', '군포 회사보안', '강남 입주청소']


def _ipinfo(proxies):
    """ip-api 로 국가·지역·ISP·모바일/프록시/호스팅 플래그 조회."""
    try:
        r = requests.get('http://ip-api.com/json/?fields=status,country,regionName,city,isp,org,as,mobile,proxy,hosting,query',
                         proxies=proxies, timeout=20)
        return r.json()
    except Exception as e:
        return {'status': 'fail', 'error': str(e)}


def _fmt(d):
    if d.get('status') != 'success':
        return f"  조회 실패: {d.get('error') or d}"
    flags = []
    if d.get('mobile'): flags.append('모바일')
    if d.get('hosting'): flags.append('호스팅/DC')
    if d.get('proxy'): flags.append('프록시탐지')
    kind = ' · '.join(flags) if flags else '주거(추정)'
    return (f"  IP={d.get('query')}  국가={d.get('country')}  지역={d.get('regionName')}/{d.get('city')}\n"
            f"  ISP={d.get('isp')}  ORG={d.get('org')}  {d.get('as')}\n"
            f"  성격: {kind}")


def main():
    print('=' * 60)
    print('[1] 직결(우리 IP) 정보')
    direct = _ipinfo(None)
    print(_fmt(direct))

    if not PROXY:
        print('\n※ SCAN_PROXY 미설정 → 프록시 검증 생략.')
        print('  set SCAN_PROXY=http://ID:PW@호스트:포트  후 다시 실행하세요.')
        return

    print('\n[2] 프록시(SCAN_PROXY) 정보')
    t0 = time.time()
    prox = _ipinfo(PROXY)
    dt = time.time() - t0
    print(_fmt(prox))
    print(f'  응답시간: {dt:.1f}s')

    # 판정 로직
    print('\n' + '=' * 60)
    print('[3] 한국 인기탭 충실도 — 직결 vs 프록시 (제일 중요)')
    import scan_common as sc
    mismatch = 0
    for kw in SAMPLE_KW:
        # 직결
        os.environ.pop('SCAN_PROXY', None); sc._PROXIES = None
        d_pop = sc.cafe_popular(kw)[0]
        # 프록시
        sc._PROXIES = PROXY
        p_pop = sc.cafe_popular(kw)[0]
        same = '일치' if d_pop == p_pop else '★불일치★'
        if d_pop != p_pop: mismatch += 1
        print(f"  {kw:14s} 직결={d_pop!s:5s}  프록시={p_pop!s:5s}  → {same}")
        time.sleep(1)

    print('\n' + '=' * 60)
    print('[판정]')
    kr = prox.get('country') == 'South Korea'
    dc = prox.get('hosting')
    print(f"  ① 한국 IP: {'✅ 예' if kr else '❌ 아니오(해외 → 탈락)'}")
    print(f"  ② 성격: {'⚠️ 데이터센터(왜곡 위험)' if dc else '✅ 모바일/주거'}")
    print(f"  ③ 인기탭 충실도: {'✅ 전부 일치' if mismatch == 0 else f'❌ {mismatch}건 불일치(현지화 틀어짐 → 부적합)'}")
    ok = kr and (not dc) and mismatch == 0
    print('\n  ===> ' + ('✅ 발굴 스캔에 사용 가능' if ok else '❌ 부적합 — 다른 한국 주거/모바일 IP 필요'))


if __name__ == '__main__':
    main()
