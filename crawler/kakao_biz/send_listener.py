# -*- coding: utf-8 -*-
"""
카톡 발송 리스너 — 웹 '발송' 버튼이 쌓은 큐(report_send_requests)를 폴링해
카카오 비즈니스 웹(send_biz)으로 발송한다. (웹은 PC 자동화를 직접 못 돌려서 이 브릿지가 필요)

흐름:
  웹 버튼 → report_send_requests(pending) → [이 리스너] send_biz.send_many → 검증된 것만 done
  · kind=publish/missed: 성공 시 blog_posts.report_sent_at 기록(+ report_send_fail 비움) → 웹 '발송 리스트'
  · kind=rank: 순위 성과보고 (post DB 갱신 없음, 웹은 localStorage 로 버튼 상태 관리)
  · 실패: 요청 status=fail + (publish/missed면) report_send_fail 기록 → 웹 '누락 건'

전제: run_chrome.bat(헤드리스 카톡 비즈 로그인 크롬)이 떠 있어야 함.

실행: python send_listener.py
"""
import datetime
import sys
import time

import auto_report as ar  # sb_get/sb_patch/load_sent/save_sent 재사용
import send_biz

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

POLL_SEC = 4
BATCH = 5  # 한 번에 처리할 요청 수


def _patch_post(pid, payload):
    """blog_posts 단건 패치(컬럼 없으면 auto_report.sb_patch 가 조용히 무시)."""
    ar.sb_patch("blog_posts", {"id": f"eq.{pid}"}, payload)


def main():
    if not ar.SUPABASE_URL or not ar.SUPABASE_SERVICE_KEY:
        print("환경변수 SUPABASE_URL / SUPABASE_SERVICE_KEY 필요(crawler/.env)", flush=True)
        sys.exit(1)
    print(f"[발송 리스너 시작] report_send_requests 폴링(간격 {POLL_SEC}s) — Ctrl+C 종료", flush=True)
    while True:
        try:
            reqs = ar.sb_get("report_send_requests", {
                "status": "eq.pending", "order": "created_at.asc",
                "limit": str(BATCH), "select": "*",
            })
        except Exception as e:
            print(f"폴링 오류(테이블 없음?): {e}", flush=True)
            time.sleep(8)
            continue
        if not reqs:
            time.sleep(POLL_SEC)
            continue

        # 선점(processing) — 중복 처리 방지
        items = []
        for r in reqs:
            rid = r["id"]
            ar.sb_patch("report_send_requests", {"id": f"eq.{rid}"}, {"status": "processing"})
            items.append({
                "key": rid, "company": r.get("company"), "message": r.get("message"),
                "post_id": r.get("post_id"), "kind": r.get("kind") or "publish",
            })

        print(f"[{datetime.datetime.now():%H:%M:%S}] 발송 {len(items)}건 처리", flush=True)
        results = send_biz.send_many(
            [{"key": it["key"], "company": it["company"], "message": it["message"]} for it in items],
            send_biz.DEFAULT_CDP, delay=4.0,
        )
        rmap = {x["key"]: x for x in results}
        sent = ar.load_sent()
        now = datetime.datetime.now().isoformat(timespec="seconds")

        for it in items:
            res = rmap.get(it["key"], {})
            rid = it["key"]; pid = it.get("post_id"); kind = it["kind"]
            if res.get("ok"):
                ar.sb_patch("report_send_requests", {"id": f"eq.{rid}"}, {"status": "done", "done_at": now})
                if pid and kind in ("publish", "missed"):
                    _patch_post(pid, {"report_sent_at": now})   # 발송 리스트 반영
                    _patch_post(pid, {"report_send_fail": None})  # 누락 건에서 제거(있었다면)
                    sent[pid] = now
                elif pid and kind == "rank":
                    _patch_post(pid, {"rank_sent_at": now})     # 전날 순위 발송 리스트 반영
                print(f"  ✅ {it['company']} ({kind})", flush=True)
            else:
                reason = res.get("reason", "?")
                ar.sb_patch("report_send_requests", {"id": f"eq.{rid}"}, {"status": "fail", "reason": reason})
                if pid and kind in ("publish", "missed"):
                    _patch_post(pid, {"report_send_fail": reason})  # 누락 건(발송 실패)에 기록
                print(f"  ❌ {it['company']} ({kind}) — {reason}", flush=True)

        ar.save_sent(sent)


if __name__ == "__main__":
    main()
