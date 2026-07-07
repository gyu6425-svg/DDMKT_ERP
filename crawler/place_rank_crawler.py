# -*- coding: utf-8 -*-
# 네이버 플레이스 순위 크롤러 — place_accounts x place_keywords 를 매일 측정.
#   방식: pcmap.place.naver.com/place/list?query=키워드 HTML의 __APOLLO_STATE__에서
#         placeList(...).businesses.items(순서 리스트)를 읽어 광고(adId) 제외 후 place_id 위치 = 순위.
#   저장: place_keywords.measurements(jsonb) 에 오늘자 {date, rank, status} upsert(그날값 덮어쓰기).
#   블로그 크롤러와 동일하게 service key + PostgREST, truststore, 요청 딜레이 사용.
import os
import re
import sys
import json
import time
import random
import datetime
import urllib.parse

try:
    import truststore
    truststore.inject_into_ssl()
except Exception:
    pass
import requests

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

HERE = os.path.dirname(os.path.abspath(__file__))


def _load_env():
    # .env(키=값) 로드 — 이미 os.environ 에 있으면 유지.
    path = os.path.join(HERE, ".env")
    if os.path.exists(path):
        for line in open(path, encoding="utf-8"):
            line = line.strip()
            if "=" in line and not line.startswith("#"):
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())


_load_env()
SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")
REQUEST_DELAY = float(os.environ.get("CRAWL_DELAY", "2.0"))
MAX_PAGES = int(os.environ.get("PLACE_MAX_PAGES", "2"))  # 50개/page → 2page=100위까지 스캔
TODAY = datetime.date.today().isoformat()

UA = (
    "Mozilla/5.0 (Linux; Android 13; SM-S918N) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36"
)
OUT_OF_RANK = 999  # 스캔 범위 내 미발견(권외)


def _pause():
    time.sleep(REQUEST_DELAY + random.uniform(0, REQUEST_DELAY * 0.5))


# ---- Supabase REST ----
def sb_headers(extra=None):
    h = {"apikey": SUPABASE_SERVICE_KEY, "Authorization": "Bearer " + SUPABASE_SERVICE_KEY}
    if extra:
        h.update(extra)
    return h


def sb_get(path, params=None):
    r = requests.get(f"{SUPABASE_URL}/rest/v1/{path}", headers=sb_headers(), params=params, timeout=30)
    r.raise_for_status()
    return r.json()


def sb_patch(path, params, payload):
    r = requests.patch(
        f"{SUPABASE_URL}/rest/v1/{path}",
        headers=sb_headers({"Content-Type": "application/json", "Prefer": "return=minimal"}),
        params=params,
        data=json.dumps(payload),
        timeout=30,
    )
    r.raise_for_status()
    return r


# ---- 순위 측정 ----
def _extract_apollo(html):
    anchor = "window.__APOLLO_STATE__ = "
    i = html.find(anchor)
    if i < 0:
        anchor = "window.__APOLLO_STATE__="
        i = html.find(anchor)
    if i < 0:
        return None
    j = i + len(anchor)
    depth = 0
    instr = False
    esc = False
    start = j
    for k in range(j, len(html)):
        ch = html[k]
        if instr:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                instr = False
        else:
            if ch == '"':
                instr = True
            elif ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    try:
                        return json.loads(html[start : k + 1])
                    except Exception:
                        return None
    return None


def _ordered_refs(state):
    # placeList(...).businesses.items = 순서 ref 리스트. 없으면 상태 삽입순 폴백.
    found = []

    def scan(obj):
        if found:
            return
        if isinstance(obj, list):
            if obj and isinstance(obj[0], dict) and "BusinessesItem" in str(obj[0].get("__ref", "")):
                for x in obj:
                    if isinstance(x, dict) and "__ref" in x:
                        found.append(x["__ref"])
                return
            for x in obj:
                scan(x)
        elif isinstance(obj, dict):
            for v in obj.values():
                scan(v)

    scan(state.get("ROOT_QUERY", {}))
    if not found:
        scan(state)
    if not found:
        found = [k for k in state if k.startswith("PlaceListBusinessesItem:")]
    return found


def measure_place_rank(place_id, keyword):
    """(rank:int, status:str) 반환. status: ok|out|fail. rank는 광고 제외 1-based, 권외면 OUT_OF_RANK."""
    place_id = str(place_id).strip()
    kwq = urllib.parse.quote(keyword)
    rank = 0
    for page in range(1, MAX_PAGES + 1):
        start = (page - 1) * 50 + 1
        url = f"https://pcmap.place.naver.com/place/list?query={kwq}&start={start}"
        try:
            r = requests.get(url, headers={"User-Agent": UA, "Accept-Language": "ko"}, timeout=20)
            r.encoding = "utf-8"
            if r.status_code != 200:
                return OUT_OF_RANK, "fail"
            state = _extract_apollo(r.text)
            if state is None:
                return OUT_OF_RANK, "fail"
        except Exception:
            return OUT_OF_RANK, "fail"
        refs = _ordered_refs(state)
        if not refs:
            break  # 더 이상 결과 없음
        for ref in refs:
            v = state.get(ref, {})
            if not isinstance(v, dict):
                continue
            if v.get("adId"):  # 광고 제외
                continue
            rank += 1
            if str(v.get("id")) == place_id:
                return rank, "ok"
        if len(refs) < 50:
            break  # 마지막 페이지
        _pause()
    return OUT_OF_RANK, "out"


def upsert_today(measurements, rec):
    recs = [m for m in (measurements or []) if m.get("date") != TODAY]
    recs.append(rec)
    return recs


def main():
    if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
        print("SUPABASE_URL / SUPABASE_SERVICE_KEY 미설정(.env 확인)")
        return
    accounts = {a["id"]: a for a in sb_get("place_accounts", {"is_active": "eq.true", "select": "*"})}
    keywords = sb_get("place_keywords", {"select": "*"})
    print(f"플레이스 순위 크롤 시작 — 업체 {len(accounts)} · 키워드 {len(keywords)} · {TODAY}")
    done = 0
    for row in keywords:
        acc = accounts.get(row.get("place_account_id"))
        if not acc:
            continue
        place_id = (acc.get("place_id") or "").strip()
        kw = (row.get("keyword") or "").strip()
        if not place_id or not kw:
            continue
        # 오늘 이미 측정했으면 스킵.
        if any(m.get("date") == TODAY for m in (row.get("measurements") or [])):
            continue
        rank, status = measure_place_rank(place_id, kw)
        recs = upsert_today(row.get("measurements"), {"date": TODAY, "rank": rank, "status": status})
        sb_patch("place_keywords", {"id": f"eq.{row['id']}"}, {"measurements": recs})
        disp = f"{rank}위" if status == "ok" else ("권외" if status == "out" else "실패")
        print(f"  [{acc.get('name')}] {kw} -> {disp}")
        done += 1
        _pause()
    print(f"완료 — {done}건 측정")


if __name__ == "__main__":
    main()
