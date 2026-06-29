# -*- coding: utf-8 -*-
"""
발행보고 무인 자동발송 — 당일 올라온 글을 감지해 그 업체 상담톡 방으로 자동 발송.

흐름:
  1) blog_posts 에서 '오늘 발행(published_date=오늘)' 글을 조회 (활성 업체만)
  2) 이미 보낸 글(sent_log.json / DB report_sent_at)은 건너뜀  ← 중복방지
  3) 발행보고 메시지(buildPublishReportMessage 양식 동일) 생성
  4) send_biz.send_many 로 카카오 비즈니스 웹에 자동 발송(정확일치 방만)
  5) 성공분만 sent_log + DB(report_sent_at) 기록

전제: run_chrome.bat 로 띄운 '디버깅 크롬'이 카카오 비즈니스에 로그인된 채 떠 있어야 함.

사용:
  python auto_report.py            # 오늘 미발송분 자동발송
  python auto_report.py --dry      # 무엇을 보낼지만 출력(실제 발송 X)
  python auto_report.py --date 2026-06-29   # 특정 날짜분
  옵션: --max N (일일 상한, 기본 80)
"""
import argparse
import datetime
import json
import os
import sys

try:  # 윈도 백신/프록시의 TLS 인터셉션 환경에서 OS 신뢰저장소로 SSL 검증 통과(크롤러와 동일)
    import truststore
    truststore.inject_into_ssl()
except Exception:
    pass

import requests
from dotenv import load_dotenv

import send_biz

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

HERE = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(HERE, "..", ".env"))

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")
SENT_LOG = os.path.join(HERE, "sent_log.json")


def _headers():
    return {
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
        "Content-Type": "application/json",
    }


def sb_get(path, params=None):
    r = requests.get(f"{SUPABASE_URL}/rest/v1/{path}", headers=_headers(), params=params, timeout=30)
    r.raise_for_status()
    return r.json()


def sb_patch(path, params, payload):
    try:
        r = requests.patch(
            f"{SUPABASE_URL}/rest/v1/{path}", headers=_headers(),
            params=params, data=json.dumps(payload), timeout=30,
        )
        r.raise_for_status()
    except Exception as e:
        # report_sent_at 컬럼이 아직 없으면 조용히 패스(로컬 sent_log 가 중복방지 담당)
        print(f"[auto_report] DB report_sent_at 기록 실패(무시): {e}", flush=True)


def load_sent():
    try:
        with open(SENT_LOG, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def save_sent(d):
    with open(SENT_LOG, "w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False, indent=0)


def build_message(account, post, today):
    """report.ts buildPublishReportMessage 와 100% 동일 양식."""
    pub = (post.get("published_date") or today)[:10]
    _, mo, d = pub.split("-")
    date_label = f"{int(mo)}월 {int(d)}일"
    link = post.get("post_url") or account.get("blog_url") or ""
    frac = ""
    g, r = account.get("goal_count"), account.get("remain_count")
    if g is not None and r is not None:
        frac = f" ({r}/{g})"
    return f"담당자님 안녕하세요 :)\n금일 발행 건 링크 전달 드립니다~!\n\n{account.get('name')}{frac} - {date_label}\n{link}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry", action="store_true", help="발송 대상만 출력(실제 발송 X)")
    ap.add_argument("--date", default=datetime.date.today().isoformat(), help="발행일(YYYY-MM-DD, 기본 오늘)")
    ap.add_argument("--max", type=int, default=80, help="일일 발송 상한(차단 회피)")
    ap.add_argument("--cdp", default=send_biz.DEFAULT_CDP)
    a = ap.parse_args()

    if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
        print("환경변수 SUPABASE_URL / SUPABASE_SERVICE_KEY 필요(crawler/.env)", flush=True)
        sys.exit(1)

    today = a.date

    # 활성 업체 맵
    accounts = sb_get("blog_accounts", {
        "select": "id,name,blog_url,goal_count,remain_count,is_active,kakao_room",
        "is_active": "eq.true",
    }) if _has_kakao_room() else sb_get("blog_accounts", {
        "select": "id,name,blog_url,goal_count,remain_count,is_active",
        "is_active": "eq.true",
    })
    acc_by_id = {x["id"]: x for x in accounts}

    # 오늘 발행 글
    posts = sb_get("blog_posts", {
        "select": "id,blog_account_id,post_url,title,published_date",
        "published_date": f"eq.{today}",
    })

    sent = load_sent()
    items, meta = [], {}
    for p in posts:
        if p["id"] in sent:
            continue  # 이미 발송(중복방지)
        acc = acc_by_id.get(p["blog_account_id"])
        if not acc:
            continue  # 비활성/없음
        company = (acc.get("kakao_room") or acc.get("name") or "").strip()
        if not company:
            continue
        items.append({"key": p["id"], "company": company, "message": build_message(acc, p, today)})
        meta[p["id"]] = {"company": company, "title": p.get("title")}
        if len(items) >= a.max:
            print(f"[auto_report] 일일 상한 {a.max} 도달 — 나머지는 다음 회차로", flush=True)
            break

    print(f"[auto_report] {today} 발행 {len(posts)}건 중 미발송 {len(items)}건", flush=True)
    for it in items:
        print(f"  · {it['company']}", flush=True)

    if not items:
        print("[auto_report] 보낼 게 없습니다.", flush=True)
        return
    if a.dry:
        print("[auto_report] --dry: 실제 발송 안 함.", flush=True)
        print("\n--- 미리보기(첫 건) ---\n" + items[0]["message"], flush=True)
        return

    results = send_biz.send_many(items, a.cdp, delay=4.0)

    now = datetime.datetime.now().isoformat(timespec="seconds")
    ok_ids, fails = [], []
    for r in results:
        if r["ok"]:
            ok_ids.append(r["key"])
            sent[r["key"]] = now
        else:
            fails.append((meta.get(r["key"], {}).get("company"), r["reason"]))

    save_sent(sent)
    # DB 에도 best-effort 기록(웹 UI 에서 '자동발송됨' 표시용)
    for pid in ok_ids:
        sb_patch("blog_posts", {"id": f"eq.{pid}"}, {"report_sent_at": now})

    print(f"\n[auto_report] ✅ 발송 {len(ok_ids)}건 / ❌ 실패 {len(fails)}건", flush=True)
    for company, reason in fails:
        print(f"  실패: {company} ({reason})", flush=True)


_HAS_ROOM = None


def _has_kakao_room():
    """blog_accounts.kakao_room 컬럼 존재 여부(없으면 name 사용)."""
    global _HAS_ROOM
    if _HAS_ROOM is None:
        try:
            sb_get("blog_accounts", {"select": "kakao_room", "limit": "1"})
            _HAS_ROOM = True
        except Exception:
            _HAS_ROOM = False
    return _HAS_ROOM


if __name__ == "__main__":
    main()
