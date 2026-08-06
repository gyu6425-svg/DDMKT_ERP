# -*- coding: utf-8 -*-
"""지역 토큰 마스터 적재 — 행정(시도·시군구·동·읍면) + 역세권(지하철역)을 cafe_region_token 에 모은다.

  왜: 스캔의 '지역 축'이 지금은 cafe_region_dong(행정동)뿐이라 역세권·신도시가 통째로 빠진다.
      실측(2026-08-06): 네일 역세권 57%·신도시 43%, 입주청소 신도시 60%. 놓치면 손실이 크다.
      kind 별 prio 로 '좋은 것부터' 스캔하고 목표 건수를 채우면 멈추는 구조를 위한 마스터.

  안전: 네이버 지역검색 API(openapi, 공식 키·일 25,000콜)만 쓴다. m.search 스크랩(CF·차단 대상)은
        전혀 안 쓰므로 캐시 치유·온디맨드 스캔과 자원이 겹치지 않는다.

  실행: python build_region_token.py                 (수도권 — 기본)
        python build_region_token.py --all           (전국 17시도)
        python build_region_token.py --sido 서울 경기
        python build_region_token.py --no-station    (행정 토큰만, API 0콜)
  결과: cafe_region_token upsert + crawler/region_token.json 백업
  전제: docs/cafe-region-token.sql 실행. crawler/.env 의 NAVER_CLIENT_ID/SECRET.
"""
import sys
import os
import re
import json
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
import truststore

truststore.inject_into_ssl()
import requests
from dotenv import load_dotenv

_HERE = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(_HERE, "..", ".env"))
load_dotenv(os.path.join(_HERE, ".env"))
requests.packages.urllib3.disable_warnings()

SB = os.getenv("SUPABASE_URL", "").rstrip("/")
KEY = os.getenv("SUPABASE_SERVICE_KEY") or os.getenv("SUPABASE_KEY") or ""
H = {"apikey": KEY, "Authorization": f"Bearer {KEY}", "Content-Type": "application/json"}
CID = os.getenv("NAVER_CLIENT_ID", "")
CSEC = os.getenv("NAVER_CLIENT_SECRET", "")
OUT = os.path.join(_HERE, "region_token.json")

SUDO = ["서울", "경기", "인천"]
ALL_SIDO = ["서울", "부산", "대구", "인천", "광주", "대전", "울산", "세종",
            "경기", "강원", "충북", "충남", "전북", "전남", "경북", "경남", "제주"]

# 실측 적중률 기반 우선순위(작을수록 먼저 스캔)
PRIO = {"sido": 10, "sigungu": 20, "newtown": 30, "district": 30,
        "station": 40, "dong": 50, "eupmyeon": 60, "sigungu_suffix": 60}

# 신도시·상권 — 행정구역이 아니라 마스터에 없다. 실측 적중률이 높아 별도 큐레이션.
NEWTOWN = {
    "경기": ["동탄", "판교", "위례", "미사", "다산", "별내", "운정", "삼송", "향동", "고덕",
             "옥정", "지축", "배곧", "죽전", "수지", "광교", "구래", "고촌", "한강신도시"],
    "인천": ["송도", "청라", "영종", "검단"],
    "서울": ["마곡", "문정", "상암"],
}


def _log(m):
    print(m, flush=True)


def _sb_all(table, params):
    rows, off = [], 0
    while True:
        p = dict(params); p.update({"limit": "1000", "offset": str(off)})
        r = requests.get(f"{SB}/rest/v1/{table}", headers=H, params=p, timeout=40, verify=False).json()
        if not isinstance(r, list) or not r:
            break
        rows += r
        if len(r) < 1000:
            break
        off += 1000
    return rows


_SUF = r"(특별자치시|특별자치도|특별시|광역시|자치시|자치구|시|군|구)$"


def clean_dong(name):
    """행정동명 정제 → 스캔 가능한 토큰들. 손실 0이 목표.
       '교현·안림동' → 교현동·안림동 / '상계3·동' → 상계동 / '성수1가동' → 성수동 / '종로1·2·3·4가동' → 종로동
       ⚠️ 2글자 동명(창동·길동·중동)을 버리면 안 된다 — {2,5} 정규식이 이걸 통째로 날렸다."""
    name = (name or "").strip()
    if not name:
        return []
    tail = name[-1] if name[-1] in "동읍면" else ""
    if not tail:
        return []
    body = name[:-1]
    out = []
    for part in re.split(r"[·,]", body):
        part = re.sub(r"\d+가?$", "", part.strip())      # 성수1가 → 성수, 상계3 → 상계
        part = re.sub(r"[^가-힣]", "", part)
        if len(part) >= 1:
            out.append(part + tail)
    return [t for t in dict.fromkeys(out) if len(t) >= 2]


def harvest_stations(pairs):
    """(구, 동) 목록 → 지하철역 이름. 네이버 지역검색 API. 병렬 6, 공식 쿼터(일 25,000)."""
    hdr = {"X-Naver-Client-Id": CID, "X-Naver-Client-Secret": CSEC}
    found = {}

    def one(pair):
        gu, dong = pair
        try:
            r = requests.get("https://openapi.naver.com/v1/search/local.json", headers=hdr, timeout=20,
                             params={"query": f"{gu} {dong} 지하철역", "display": 5})
            if r.status_code != 200:
                return None          # 실패를 '역 없음'과 구분한다
            out = []
            for it in (r.json().get("items") or []):
                t = re.sub(r"<[^>]+>", "", it.get("title") or "")
                t = t.split()[0] if t else ""                 # '강남역 신분당선' → '강남역'
                t = re.sub(r"\([^)]*\)", "", t).strip()        # '광교(경기대)역' → '광교역'
                t = re.sub(r"[^가-힣0-9역]", "", t)
                if t.endswith("역") and 3 <= len(t) <= 8:
                    out.append((t, it.get("address") or ""))
            return out
        except Exception:
            return []

    # ⚠️ openapi 도 QPS 제한이 있다 — 병렬 6으로 무스로틀 실행하니 767콜이 7초(110 req/s)에 끝나고
    #   역이 81개만 잡혔다(검증 때는 610개). 대부분 조용히 실패한 것. 청크 사이에 쉬어 준다.
    def sweep(todo, par, chunk, rest):
        failed = []
        with ThreadPoolExecutor(max_workers=par) as ex:
            for i in range(0, len(todo), chunk):
                part = todo[i:i + chunk]
                for pair, res in zip(part, ex.map(one, part)):
                    if res is None:
                        failed.append(pair)
                        continue
                    for t, addr in res:
                        found.setdefault(t, addr)
                time.sleep(rest)
        return failed

    # 실패분은 더 느리게 재시도한다 — 1차(병렬3)에서도 절반이 QPS로 떨어졌다.
    todo = list(pairs)
    for par, chunk, rest in ((3, 30, 1.0), (2, 20, 1.5), (1, 10, 1.5)):
        todo = sweep(todo, par, chunk, rest)
        if not todo:
            break
        _log(f"    (실패 {len(todo)}건 → 재시도)")
    if todo:
        _log(f"    ⚠ 최종 조회 실패 {len(todo)}건")
    return found


def main():
    if "--all" in sys.argv:
        sidos = ALL_SIDO
    elif "--sido" in sys.argv:
        i = sys.argv.index("--sido")
        sidos = [a for a in sys.argv[i + 1:] if not a.startswith("--")] or SUDO
    else:
        sidos = SUDO
    do_station = "--no-station" not in sys.argv
    _log(f"=== 지역 토큰 적재 · 범위 {sidos} · 역세권 {'ON' if do_station else 'OFF'} ===")

    inlist = ",".join(f'"{s}"' for s in sidos)
    rows = _sb_all("cafe_region_dong", {"select": "sido,gu,dong", "sido": f"in.({inlist})", "order": "gu.asc,dong.asc"})
    _log(f"  행정 원본 {len(rows)}행")

    toks = {}   # token -> dict

    def put(token, kind, sido=None, gu=None, source="region_dong"):
        token = (token or "").strip()
        if len(token) < 2:
            return
        cur = toks.get(token)
        if cur and PRIO.get(cur["kind"], 99) <= PRIO.get(kind, 99):
            cur["dup"] = cur.get("dup", 1) + 1
            return
        toks[token] = {"token": token, "kind": kind, "sido": sido, "gu": gu,
                       "prio": PRIO.get(kind, 50), "dup": (cur or {}).get("dup", 1), "source": source}

    # ① 시도
    for s in sidos:
        put(s, "sido", sido=s)
    # ② 시군구(기본형/접미형) + ③ 동·읍면
    dup_counter = Counter()
    for r in rows:
        sido, gu, dong = r.get("sido"), (r.get("gu") or "").strip(), (r.get("dong") or "").strip()
        for part in gu.split():
            m = re.match(r"^(.+?시)(.+구)$", part)
            for pc in ([m.group(1), m.group(2)] if m else [part]):
                base = re.sub(_SUF, "", pc)
                if len(base) >= 2:
                    put(base, "sigungu", sido=sido, gu=gu)
                    put(pc, "sigungu_suffix", sido=sido, gu=gu)
                else:
                    put(pc, "sigungu", sido=sido, gu=gu)
        for t in clean_dong(dong):
            kind = "eupmyeon" if t[-1] in "읍면" else "dong"
            put(t, kind, sido=sido, gu=gu)
            dup_counter[t] += 1
    for t, n in dup_counter.items():
        if t in toks and n > 1:
            toks[t]["dup"] = n          # 동명이지 — 발행 시 지역 귀속 주의 신호

    # ④ 신도시·상권(큐레이션)
    for sido, names in NEWTOWN.items():
        if sido in sidos:
            for n in names:
                put(n, "newtown", sido=sido, source="curated")

    # ⑤ 역세권
    if do_station:
        if not (CID and CSEC):
            _log("  ⚠ NAVER_CLIENT_ID/SECRET 없음 — 역세권 수확 건너뜀")
        else:
            pairs = sorted({((r.get("gu") or "").split()[-1], (r.get("dong") or "").strip())
                            for r in rows if r.get("dong")})
            _log(f"  역세권 수확 시작 — 조회 {len(pairs)}콜(공식 API, 일 25,000)")
            t0 = time.time()
            st = harvest_stations(pairs)
            _log(f"  역 {len(st)}개 수확 · {time.time()-t0:.0f}초")
            for name, addr in st.items():
                sd = next((s for s in ALL_SIDO if addr.startswith(s) or addr.startswith(s + "특별") or addr.startswith(s + "광역")), None)
                put(name, "station", sido=sd, source="local_api")

    data = sorted(toks.values(), key=lambda x: (x["prio"], x["token"]))
    json.dump(data, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    kinds = Counter(x["kind"] for x in data)
    _log(f"  토큰 {len(data)}개 → {OUT}")
    _log(f"  종류별: {dict(kinds)}")
    _log(f"  동명이지(dup>=2): {sum(1 for x in data if x.get('dup', 1) > 1)}개")

    # DB 적재(테이블 없으면 안내만)
    ok = 0
    for i in range(0, len(data), 500):
        chunk = [{**x, "active": True} for x in data[i:i + 500]]
        r = requests.post(f"{SB}/rest/v1/cafe_region_token", headers={**H, "Prefer": "resolution=merge-duplicates"},
                          json=chunk, timeout=40, verify=False)
        if r.status_code >= 300:
            _log(f"  ⚠ DB 적재 실패 HTTP {r.status_code}: {r.text[:160]}")
            if r.status_code == 404:
                _log("     → docs/cafe-region-token.sql 을 Supabase SQL Editor 에서 1회 실행하세요.")
            _log(f"     (JSON 백업은 {OUT} 에 있으니 SQL 실행 후 다시 돌리면 됩니다)")
            return 3
        ok += len(chunk)
    _log(f"=== 완료 · DB 적재 {ok}개 ===")
    return 0


if __name__ == "__main__":
    sys.exit(main())
