# -*- coding: utf-8 -*-
"""점진 스캔 데몬 — 한가할 때 인기탭을 미리 판정해 캐시를 채운다.

  왜: 판정은 캐시되면 즉시지만, 캐시가 비면 고객이 몇 분을 기다린다. 미리 채워 두면
      온디맨드 조회가 항상 캐시 히트가 된다(느린 스캔의 근본 원인 제거).

  ★ 반드시 지키는 두 가지 — 이걸 어기면 고객 조회가 차단당한다.
    ① 전역 예산: CF egress 는 PC 를 늘려도 안 늘어나는 단일 버킷이다(실측 2026-08-06,
       약 300콜/10분). scan_budget_take() RPC 로 DB 한 곳에서 원자적으로 배분한다.
       데몬은 한도의 일부(기본 90/10분)만 쓰고 나머지는 고객 몫으로 남긴다.
    ② 양보: cafe_kw_requests 에 대기·처리중 요청이 있으면 즉시 멈춘다. 고객이 항상 먼저다.

  실행: python cafe_scan_daemon.py                  (계속 돌기)
        python cafe_scan_daemon.py --once           (한 계획만 처리하고 종료)
        python cafe_scan_daemon.py --share 60       (10분당 60콜만 사용)
        python cafe_scan_daemon.py --plan 누수탐지:서울,경기   (계획 1건 즉석 추가)
  전제: docs/cafe-scan-budget.sql 실행. cafe_scan_plan 에 제품키워드 등록.
"""
import sys
import os
import time
import socket
import datetime

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import truststore
truststore.inject_into_ssl()
import requests
from dotenv import load_dotenv

_HERE = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(_HERE, "..", ".env"))
load_dotenv(os.path.join(_HERE, ".env"))

import cafe_kw_probe as p
import cafe_kw_worker as w

SB = w.SB
H = w.H
WID = f"{socket.gethostname()}-{os.getpid()}"

SHARE = 90          # 데몬이 쓸 10분당 콜 수(실측 한도 300의 30%). 나머지는 온디맨드 몫.
CAP = 240           # 전역 한도(실측 300의 80%) — scan_budget_take 에 넘긴다.
CHUNK = 5           # 한 번에 예약·스캔할 콜 수. 이 값이 곧 '양보까지 걸리는 최대 지연'(5×2.5초=12초)
GAP = 2.5           # 콜 간격(초). 차단은 속도가 아니라 총량에 걸리지만 버스트는 피한다.
IDLE_SEC = 60       # 예산이 없거나 할 일이 없을 때 쉬는 시간
YIELD_SEC = 90      # 온디맨드 요청이 있어 양보할 때 쉬는 시간


def _ts():
    return datetime.datetime.now().strftime("%H:%M:%S")


def log(m):
    print(f"[{_ts()}] {m}", flush=True)


def busy():
    """고객 온디맨드 요청이 대기·처리중인가. 있으면 데몬은 즉시 비켜 준다."""
    try:
        r = requests.get(f"{SB}/rest/v1/cafe_kw_requests?status=in.(queued,claimed)&select=id&limit=1",
                         headers=H, timeout=10)
        return r.status_code == 200 and bool(r.json())
    except Exception:
        return True          # 확인 못 하면 긁지 않는다(안전 쪽으로)


def lease():
    """단일 실행 보장 — 리스를 잡거나 갱신한다. 내가 주인이면 True.
       재시작 루프(run_scan_daemon.bat)를 붙이면 실수로 두 개가 뜰 수 있는데, 그러면 각자
       share 만큼 가져가 예산이 배로 나간다. 리스는 만료가 있어 죽으면 자동으로 풀린다.
       ★ 리스 테이블이 없으면(구버전 SQL) 막지 않고 그냥 진행한다 — 있으면 지키고 없으면 종전대로."""
    try:
        r = requests.post(f"{SB}/rest/v1/rpc/scan_lease_take", headers=H,
                          json={"p_name": "cafe_scan_daemon", "p_holder": WID, "p_sec": 180}, timeout=15)
        if r.status_code == 404:
            return True
        if r.status_code != 200:
            log(f"⚠ 리스 RPC {r.status_code} {r.text[:100]} — 단일실행 보장 없이 진행")
            return True
        owner = (r.json() or "").strip('"')
        if owner != WID:
            log(f"다른 데몬이 실행 중({owner}) — 이 프로세스는 종료합니다")
            return False
        return True
    except Exception as e:
        log(f"⚠ 리스 확인 실패({e}) — 단일실행 보장 없이 진행")
        return True


def take(want, share):
    """전역 예산에서 want 콜 예약. 반환=실제 허용치(0이면 지금은 긁지 마라).

       ★ cap 에 전역한도(240)가 아니라 '데몬 몫'(share)을 넘긴다.
         원장은 온디맨드 콜까지 같이 기록하므로, 최근 10분 총 사용량이 share 를 넘으면 데몬은 0을 받는다.
         → 데몬은 항상 총량 90 안에서만 움직이고 나머지 150은 온디맨드 몫으로 남는다.
         버그였다(SUB4 실측 2026-08-06): 옛 코드는 cap=240 을 넘겨서, share=90 이 '계획 한 바퀴당'
         상한으로만 작동했다. run_plan 이 90콜 쓰고 60초 쉰 뒤 다음 계획에서 또 90콜을 써
         10분에 140콜이 나갔다(목표 90의 156%). share 는 '10분당'이어야 한다."""
    try:
        r = requests.post(f"{SB}/rest/v1/rpc/scan_budget_take", headers=H,
                          json={"want": want, "cap": share}, timeout=15)
        if r.status_code != 200:
            log(f"⚠ 예산 RPC 실패 {r.status_code} {r.text[:120]} — docs/cafe-scan-budget.sql 실행 필요")
            return 0
        return int(r.json() or 0)
    except Exception as e:
        log(f"⚠ 예산 조회 실패: {e}")
        return 0


def pick_plan():
    """가장 오래 안 돈 계획 1건. prio 작은 것 우선, 같으면 오래된 것."""
    try:
        r = requests.get(f"{SB}/rest/v1/cafe_scan_plan?active=is.true"
                         f"&select=id,product,sidos,include_dong,prio,done_count"
                         f"&order=prio.asc,last_run_at.asc.nullsfirst&limit=1", headers=H, timeout=15)
        if r.status_code != 200:
            log(f"⚠ 계획 조회 실패 {r.status_code} — docs/cafe-scan-budget.sql 실행 필요")
            return None
        rows = r.json()
        return rows[0] if rows else None
    except Exception as e:
        log(f"⚠ 계획 조회 실패: {e}")
        return None


def mark_plan(pid, done):
    try:
        requests.patch(f"{SB}/rest/v1/cafe_scan_plan?id=eq.{pid}", headers=H,
                       json={"last_run_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                             "done_count": done}, timeout=15)
    except Exception:
        pass


def pending_combos(plan):
    """이 계획에서 '아직 신뢰할 판정이 없는' 조합만 골라 돌려준다(prio 순 유지)."""
    sidos = [s for s in (plan.get("sidos") or "").replace(" ", "").split(",") if s]
    tokens = w._region_tokens_for(sidos, bool(plan.get("include_dong")))
    if not tokens:
        log(f"  지역 토큰 없음(sido={sidos}) — 계획 건너뜀")
        return [], 0
    product = (plan.get("product") or "").strip()
    kws, seen = [], set()
    for tok in tokens:
        kw = f"{tok} {product}"
        nk = kw.replace(" ", "")
        if nk not in seen:
            seen.add(nk)
            kws.append((tok, kw))
    cache = w._cache_get_many([kw for _, kw in kws])
    todo, done = [], 0
    for tok, kw in kws:
        c = cache.get(kw.replace(" ", ""))
        if c is not None and w._cache_trust(c):
            done += 1
            continue
        todo.append((tok, kw))
    return todo, done


def scan_one(tok, kw, product):
    """온디맨드와 완전히 같은 규약으로 판정·캐시한다 — 데몬이 채운 캐시를 고객이 그대로 쓰므로
       여기서 규칙이 갈라지면 '데몬이 본 것'과 '고객이 볼 것'이 달라진다."""
    r = p.classify(kw)
    if r.get("err"):
        return "err"
    if w._is_pop(r) and not w._topical(r.get("rows"), product, w._region_core(tok)):
        r = {"has_section": r.get("has_section"), "verdict": "비관련(오탐)",
             "theme": r.get("theme"), "rows": r.get("rows")}
    if w._is_pop(r):
        w._cache_put(kw, r, w._real_volume(kw))
        return "pop"
    w._cache_put(kw, r, None)
    return "neg"


def run_plan(plan, share):
    product = (plan.get("product") or "").strip()
    todo, done = pending_combos(plan)
    log(f"계획 #{plan['id']} '{product}' [{plan.get('sidos')}]"
        f"{' +동' if plan.get('include_dong') else ''} — 판정완료 {done} · 남은 {len(todo)}")
    if not todo:
        mark_plan(plan["id"], done)
        return 0
    used = pops = errs = 0
    while todo and used < share:
        if not lease():        # 한 계획이 share=90콜 ≈ 4분이라 리스(180초)가 도중에 만료된다 → 청크마다 갱신
            break
        if busy():
            log("  온디맨드 요청 감지 — 양보하고 대기")
            break
        n = take(min(CHUNK, share), share)
        if n <= 0:
            log(f"  10분 예산({share}콜) 소진 — 대기")
            break
        for _ in range(n):
            if not todo:
                break
            tok, kw = todo.pop(0)
            k = scan_one(tok, kw, product)
            used += 1
            if k == "pop":
                pops += 1
                done += 1
                log(f"  ★ {kw} — 인기탭")
            elif k == "neg":
                done += 1
            else:
                errs += 1
            time.sleep(GAP)
        # 청크마다 진행표시 저장 — 강제 종료돼도 어디까지 했는지 남고, 계획 순환(last_run_at)이 멈추지 않는다.
        mark_plan(plan["id"], done)
        if errs >= 5 and pops == 0 and used <= errs + 2:
            log("  연속 실패 — 차단으로 보고 중단")     # '0건'으로 위장하지 않는다
            break
    mark_plan(plan["id"], done)
    log(f"계획 #{plan['id']} 종료 — 이번에 {used}콜 · 인기탭 {pops} · 오류 {errs} · 남은 {len(todo)}")
    return used


def add_plan(spec):
    """'누수탐지:서울,경기' 형태로 계획 1건 추가(즉석 등록용)."""
    product, _, sidos = spec.partition(":")
    row = {"product": product.strip(), "sidos": (sidos or "서울,경기,인천").strip()}
    r = requests.post(f"{SB}/rest/v1/cafe_scan_plan",
                      headers={**H, "Prefer": "resolution=merge-duplicates,return=representation"},
                      json=row, timeout=20)
    log(f"계획 추가 {r.status_code} {r.text[:160]}")


def main():
    if not SB or not w.KEY:
        print("SUPABASE_URL/SERVICE_KEY 없음 (.env 확인)")
        return 1
    argv = sys.argv[1:]
    if "--plan" in argv:
        add_plan(argv[argv.index("--plan") + 1])
        return 0
    once = "--once" in argv
    share = int(argv[argv.index("--share") + 1]) if "--share" in argv else SHARE

    # 로컬 파일 캐시 OFF — DB 캐시(_cache_trust)만이 권위. 워커와 같은 규약(cafe_kw_worker.main 참고).
    p._USE_CACHE = False
    p._USE_CF = True                       # 항상 CF 분산IP — 사무실 IP 미노출
    log(f"=== 점진 스캔 데몬 시작 · {WID} · 데몬몫 {share}콜/10분(전역한도 {CAP}) ===")
    if not lease():
        return 0                       # 재시작 루프가 즉시 되살리지 않도록 정상 종료(0)
    prune_at = 0
    while True:
        if not lease():                # 매 라운드 갱신 — 죽으면 180초 뒤 자동으로 풀린다
            return 0
        if time.time() - prune_at > 3600:
            try:
                requests.post(f"{SB}/rest/v1/rpc/scan_budget_prune", headers=H, json={}, timeout=15)
            except Exception:
                pass
            prune_at = time.time()
        if busy():
            log("온디맨드 처리 중 — 양보")
            if once:
                return 0
            time.sleep(YIELD_SEC)
            continue
        plan = pick_plan()
        if not plan:
            log("할 계획 없음 — cafe_scan_plan 에 제품키워드를 넣어 주세요")
            if once:
                return 0
            time.sleep(IDLE_SEC * 5)
            continue
        run_plan(plan, share)
        if once:
            return 0
        time.sleep(IDLE_SEC)


if __name__ == "__main__":
    sys.exit(main() or 0)
