# -*- coding: utf-8 -*-
"""카페 인기탭 스캔 자가점검(카나리) — 오탐·누락이 생기면 사람이 눈치채기 전에 먼저 신고한다.

  왜: 지금까지의 사고(통짜매칭·시도토큰 누락·빈200·호스트 로테이션·차단은폐)는 전부
      '결과가 조용히 적게 나오는' 형태였다. 그래서 사장님이 "몇 개 안 나오는데?"라고
      말해야만 발견됐다. 이 스크립트는 그 탐지를 자동화한다.

  점검 3종(하루 1회, 총 ~40콜):
    ① 골든셋 — 인기탭이 있다고 실측 확인된 키워드가 여전히 잡히는가? (누락 감시)
    ② 음성 표본 재검증 — 캐시가 '없음'이라 한 것 중 실제로 있는 건 없는가? (위음성 감시)
    ③ 벤티지 카나리 — 같은 호스트에서 CF와 직접이 일치하는가? (경로 회귀 감시)

  실행: python cafe_kw_audit.py          (결과를 콘솔+cafe_kw_audit.log 에 기록)
        python cafe_kw_audit.py --quiet  (이상 있을 때만 출력 — 스케줄러용)
  종료코드: 0=정상 / 1=이상 감지 / 2=점검 불가(차단) / 3=DB 기록 실패(결과가 증발 — 스케줄러 이력에 드러남)
"""
import sys
import os
import time
import random
import datetime

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
import truststore

truststore.inject_into_ssl()
import requests
from dotenv import load_dotenv

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _HERE)
load_dotenv(os.path.join(_HERE, "..", ".env"))
load_dotenv(os.path.join(_HERE, ".env"))
requests.packages.urllib3.disable_warnings()

import cafe_kw_probe as p
import cafe_kw_worker as W

SB = os.getenv("SUPABASE_URL", "").rstrip("/")
KEY = os.getenv("SUPABASE_SERVICE_KEY") or os.getenv("SUPABASE_KEY") or ""
H = {"apikey": KEY, "Authorization": f"Bearer {KEY}"}
LOG = os.path.join(_HERE, "cafe_kw_audit.log")

# ① 골든셋 — 2026-08-05 실측으로 인기탭 확인된 조합(업종·지역 분산).
#    이게 깨지면 판정 로직이나 스캔 경로가 회귀한 것이다.
GOLDEN = [
    "서울 소방업체", "강남 소방업체", "광진 소방업체", "금천 소방업체",
    "강남 누수탐지", "수원 누수탐지",
    "강남 입주청소", "송파 입주청소",
    "인천 줄눈시공", "강남 줄눈시공",
    "서울 간병인", "수원 간병인",
]
# ③ 벤티지 카나리 — CF와 직접을 같은 호스트로 비교(불일치 기준선 0).
VANTAGE = ["강남 소방업체", "광진 소방업체", "강남 누수탐지", "송파 입주청소"]

NEG_SAMPLE = 12          # ② 음성 표본 수
FN_ALERT = 0.10          # 위음성률 경보 임계(표본이 작아 보수적으로)
GAP = 1.2


def _report(status, ok, summary, alerts, **kw):
    """결과를 DB(cafe_kw_audit)에 남긴다 — 로그 파일에만 두면 아무도 안 본다.
       ERP 카페 대시보드가 최근 행을 읽어 이상 시 상단 배너로 띄운다. 전제: docs/cafe-kw-audit.sql
       ★ 기록 실패를 성공으로 넘기지 않는다 — 실패하면 False 를 반환해 종료코드 3으로 끝낸다.
         (SUB4 지적 2026-08-06: 테이블 미생성 상태에서 예약작업이 '결과 0(성공)'으로 찍혀
          카나리가 매일 돌지만 결과가 증발하는 걸 아무도 눈치채지 못했다.)"""
    body = {"ok": ok, "status": status, "summary": summary,
            "alerts": alerts or None, "worker": os.environ.get("COMPUTERNAME") or "?"}
    body.update(kw)
    try:
        r = requests.post(f"{SB}/rest/v1/cafe_kw_audit", headers={**H, "Content-Type": "application/json"},
                          json=[body], timeout=15, verify=False)
        if r.status_code >= 300:
            _log(f"  ⚠ DB 기록 실패 HTTP {r.status_code}: {r.text[:160]}")
            if r.status_code == 404:
                _log("     → docs/cafe-kw-audit.sql 을 Supabase SQL Editor 에서 1회 실행하세요.")
            return False
        return True
    except Exception as e:
        _log(f"  ⚠ DB 기록 실패: {e}")
        return False


def _log(msg):
    line = f"[{datetime.datetime.now():%Y-%m-%d %H:%M:%S}] {msg}"
    print(line, flush=True)
    try:
        with open(LOG, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except Exception:
        pass


def _pop(kw):
    """운영과 동일 경로로 판정. 캐시는 끄고 실제 SERP 를 본다. (판정불가면 None)"""
    r = p._classify_live(kw)
    if r.get("err"):
        return None, r.get("err")
    return W._is_pop(r), r.get("verdict")


def main():
    quiet = "--quiet" in sys.argv
    p._USE_CACHE = False
    p._USE_CF = True                      # 운영 기본 경로(CF)로 점검
    alerts = []

    # ① 골든셋 — 있어야 할 게 있는가
    #    ⚠ 판정불가(차단)를 '통과'로 세면 안 된다 — 못 잰 걸 정상이라고 보고하는 게 이 시스템의 고질병이었다.
    miss, undet = [], []
    for kw in GOLDEN:
        ok, why = _pop(kw)
        if ok is None:
            undet.append(kw)
            _log(f"  [골든] {kw}: 판정불가({why})")
        elif not ok:
            miss.append(kw)
        time.sleep(GAP)
    tested = len(GOLDEN) - len(undet)
    if miss:
        alerts.append(f"골든셋 누락 {len(miss)}/{tested}: {', '.join(miss)}")
    # 표본의 상당수를 못 쟀으면 '정상'이라고 말할 수 없다 → 점검 자체를 실패로 보고한다.
    if len(undet) > len(GOLDEN) * 0.3:
        msg = (f"점검 불가 — 골든셋 {len(undet)}/{len(GOLDEN)}건이 차단으로 판정불가. "
               f"CF 차단이 풀린 뒤 다시 실행하세요(다른 스캔과 겹치지 않는 시간에).")
        _log("⚠ " + msg)
        wrote = _report("blocked", False, msg, [msg],
                        golden_ok=tested - len(miss), golden_n=tested, golden_undet=len(undet))
        return 2 if wrote else 3

    # ② 음성 표본 재검증 — 없다고 한 게 정말 없는가
    fn = []
    try:
        rows = requests.get(f"{SB}/rest/v1/cafe_kw_targets", headers=H, timeout=30, verify=False,
                            params={"select": "keyword", "has_section": "eq.false",
                                    "scanned_by": "like.*/m", "limit": "400"}).json()
    except Exception:
        rows = []
    pool = [x["keyword"] for x in rows if isinstance(x, dict)]
    sample = random.sample(pool, min(NEG_SAMPLE, len(pool)))
    for kw in sample:
        ok, _ = _pop(kw)
        if ok:
            fn.append(kw)
        time.sleep(GAP)
    if sample:
        rate = len(fn) / len(sample)
        if rate > FN_ALERT:
            alerts.append(f"위음성률 {rate:.0%} ({len(fn)}/{len(sample)}): {', '.join(fn)}")

    # ③ 벤티지 카나리 — CF와 직접이 같은 호스트에서 일치하는가
    dis = []
    for kw in VANTAGE:
        p._USE_CF = True
        a, _ = _pop(kw)
        time.sleep(GAP)
        p._USE_CF = False
        b, _ = _pop(kw)
        time.sleep(GAP)
        if a is not None and b is not None and a != b:
            dis.append(f"{kw}(CF={a}/직접={b})")
    p._USE_CF = True
    if dis:
        alerts.append(f"CF-직접 불일치 {len(dis)}건: {', '.join(dis)}")

    summary = (f"골든 {tested - len(miss)}/{tested} 확인(판정불가 {len(undet)}) · "
               f"음성표본 {len(sample)}건 중 실제양성 {len(fn)} · 벤티지 불일치 {len(dis)}/{len(VANTAGE)}")
    stat = dict(golden_ok=tested - len(miss), golden_n=tested, golden_undet=len(undet),
                fn_sample=len(sample), fn_hit=len(fn), vantage_dis=len(dis))
    if alerts:
        _log("⚠ 인기탭 스캔 이상 감지 — " + summary)
        for a in alerts:
            _log("   · " + a)
        wrote = _report("alert", False, summary, alerts, **stat)
        return 1 if wrote else 3
    wrote = _report("ok", True, summary, None, **stat)
    if not wrote:
        _log("⚠ 점검은 정상이나 결과를 DB에 남기지 못했습니다 — 이력이 증발합니다(종료코드 3).")
        return 3
    if not quiet:
        _log("✅ 정상 — " + summary)
    return 0


if __name__ == "__main__":
    sys.exit(main())
