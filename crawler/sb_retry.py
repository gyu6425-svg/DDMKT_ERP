# -*- coding: utf-8 -*-
"""Supabase REST 호출용 재시도 세션 — 카페 계열 스크립트 공용.

왜 필요한가 (2026-08-19 컷오버)
  백엔드가 AWS 관리형에서 **사무실 PC → Hyper-V → Docker → Cloudflare 터널**로 바뀌었다.
  끊길 수 있는 구간이 훨씬 많아졌고, 그중 하나만 잠깐 흔들려도 그 사이클 작업이 통째로 날아간다.
  blog_rank_crawler 는 자체 _SB 세션으로 이미 보호되지만, 카페 계열 4개 파일
  (cafe_rank_sync · cafe_board_crawl · cafe_contract_sync · cafe_token_sync)은 맨 requests 를 써
  보호 밖에 있었다(독립검증 지적).

★ POST 를 재시도해도 되는지는 **파일마다 다르다**. 그래서 기본은 끄고, 호출부에서 명시적으로 켠다.
  · 켜도 되는 것 : upsert(on_conflict / Prefer: resolution=merge-duplicates) 또는 idem_key 로 막힌 INSERT
  · 켜면 안 되는 것 : 그냥 INSERT — 응답만 유실되고 서버엔 들어간 경우 재시도가 중복을 만든다
    (유니크 제약이 있으면 중복 대신 409 가 나서 '등록실패' 로그가 거짓으로 쌓인다)

★ respect_retry_after_header=False 필수.
  urllib3 기본값(True)이면 429/503 에 붙어 오는 Retry-After 를 그대로 믿고 최대 6시간 잠든다.
  경로에 터널·게이트웨이가 있어 그 헤더가 실제로 올 수 있고, 그러면 요청 하나가 아무 로그도 없이
  밤을 통째로 삼킨다. 무인 작업에서는 '죽는 것'보다 '조용히 오래 자는 것'이 더 나쁘다.
"""
import requests

TIMEOUT = (10, 30)          # (연결, 응답) 초 — 한 요청이 붙잡을 수 있는 시간을 좁게 묶는다


def session(allow_post=False, pool=20):
    """재시도가 붙은 requests.Session 을 만든다. 실패해도 맨 세션을 돌려줘 스크립트는 계속 돈다."""
    s = requests.Session()
    try:
        from requests.adapters import HTTPAdapter
        from urllib3.util.retry import Retry
        methods = ["GET", "PATCH"] + (["POST"] if allow_post else [])
        retry = Retry(
            total=4, connect=4, read=3, status=3,
            backoff_factor=1.0,                       # 실측 사다리: 0 → 2 → 4 → 8초 (합 14초)
            status_forcelist=(408, 429, 500, 502, 503, 504,
                              # ★ Cloudflare 고유 5xx — 터널이 재기동하는 몇 초 동안 실제로 이게 온다.
                              #   2026-08-19 터널 재시작을 실측하다 확인: 530 두 번 뒤 200.
                              #   표준 5xx 만 넣어두면 이 창을 못 넘겨 그 요청이 그대로 실패한다.
                              #   520~527 = origin 오류/타임아웃, 530 = origin 도달 불가.
                              520, 521, 522, 523, 524, 525, 526, 527, 530),
            allowed_methods=frozenset(methods),
            raise_on_status=False,
            respect_retry_after_header=False,         # 위 주석 참조 — 절대 True 로 두지 말 것
        )
        for scheme in ("https://", "http://"):        # 내부 IP 로 바꿔도 재시도가 사라지지 않게
            s.mount(scheme, HTTPAdapter(max_retries=retry, pool_maxsize=pool))
    except Exception as exc:
        print(f"  ! DB 재시도 설정 실패({exc}) — 재시도 없이 진행합니다", flush=True)
    return s
