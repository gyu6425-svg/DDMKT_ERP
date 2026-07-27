# -*- coding: utf-8 -*-
"""Phase2 검증(읽기 전용, 발행·스캔 없음). 라이브 무영향.
   1) sb_auth 로그인(publishable+내부계정) → JWT.
   2) cafe_publish_queue SELECT (RLS: authenticated + is_internal) → 통과하면 내부계정·JWT OK.
   3) CAFE_GENERATE_API 있으면 롱폼 1건 생성(우리 CF·우리 키) → {title,body} 확인.

실행(라이브 .env 안 건드리게 inline env 로):
  SUPABASE_URL=... SUPABASE_PUBLISHABLE_KEY=... \
  SUPABASE_AUTH_EMAIL=<내부계정> SUPABASE_AUTH_PASSWORD=<비번> \
  CAFE_GENERATE_API=https://<배포>/api/generate-cafe \
  python _verify_phase2.py
"""
import json
import os
import sys

import requests

import sb_auth

requests.packages.urllib3.disable_warnings()
SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")


def main():
    print("=== Phase2 검증 (읽기 전용) ===")
    print(f"  경로: {'publishable+내부JWT' if sb_auth.use_publishable() else '서비스키(레거시)'}")
    if not sb_auth.use_publishable():
        print("  ⚠️ publishable 경로가 아님 — SUPABASE_PUBLISHABLE_KEY/AUTH_EMAIL/AUTH_PASSWORD 확인.")

    # 1) 로그인
    try:
        h = sb_auth.headers("application/json")
        print(f"  [1] 로그인 OK (apikey={h['apikey'][:10]}… bearer={h['Authorization'][7:27]}…)")
    except Exception as e:
        print(f"  [1] ❌ 로그인 실패: {str(e)[:200]}"); sys.exit(1)

    # 2) RLS SELECT (내부계정만 통과)
    try:
        r = requests.get(f"{SUPABASE_URL}/rest/v1/cafe_publish_queue",
                         headers=sb_auth.headers(), params={"select": "id", "limit": "1"},
                         timeout=30, verify=False)
        if r.ok:
            print(f"  [2] SELECT OK (RLS 통과) — {len(r.json())}행")
        else:
            print(f"  [2] ❌ SELECT 거부 {r.status_code}: {r.text[:200]}")
            print("       → 이 계정이 is_internal()=false 이거나 RLS 미적용. profiles(is_active·client_id) 확인.")
            sys.exit(1)
    except Exception as e:
        print(f"  [2] ❌ SELECT 오류: {str(e)[:200]}"); sys.exit(1)

    # 3) CF 원고 생성(선택)
    api = os.environ.get("CAFE_GENERATE_API", "").strip()
    if not api:
        print("  [3] CAFE_GENERATE_API 미설정 — 원고 CF 검증 스킵.")
    else:
        try:
            payload = {"variant": "longform", "businessKind": "leak", "region": "테스트동네", "dong": ""}
            r = requests.post(api, headers={"Content-Type": "application/json"},
                              data=json.dumps(payload), timeout=150)
            d = r.json()
            if r.ok and d.get("body"):
                print(f"  [3] CF 원고 OK — 제목: {str(d.get('title'))[:40]} · 본문 {len(str(d.get('body')))}자")
            else:
                print(f"  [3] ❌ CF 원고 실패 {r.status_code}: {str(d)[:200]}")
        except Exception as e:
            print(f"  [3] ❌ CF 호출 오류: {str(e)[:200]}")
    print("=== 끝 ===")


if __name__ == "__main__":
    main()
