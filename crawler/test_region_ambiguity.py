# -*- coding: utf-8 -*-
"""회귀 테스트 — '지역명과 같은 일반명사' 오탐(예산 인테리어)을 거르되 진짜 지역은 안 죽인다.

실행: python test_region_ambiguity.py       (네이버 호출 0 — 저장된 인기글 제목으로만 판정)

왜 픽스처인가: 이 판정은 실제 인기글 제목에 달려 있는데, 규칙을 손볼 때마다 네이버를 다시
  긁으면 차단 예산을 태우고 결과도 그때그때 달라져 비교가 안 된다. 2026-08-06 실측 28조합을
  그대로 박제해 두고 규칙만 바꿔 가며 잰다.
"""
import sys
import os
import json
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cafe_kw_worker as w

FIX = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures", "region_ambiguity.json")
# 제목을 사람이 읽고 라벨한 것. 나머지 조합은 전부 '진짜 그 지역 글'이었다.
FALSE_POSITIVE = {"예산 인테리어"}      # 예산군이 아니라 '인테리어 예산(비용)' 글


def main():
    data = json.load(open(FIX, encoding="utf-8"))
    fn = fp = 0
    for d in data:
        key = f"{d['tok']} {d['product']}"
        keep = w._topical(d["rows"], d["product"], w._region_core(d["tok"]))
        want = key not in FALSE_POSITIVE
        if want and not keep:
            fn += 1
            print(f"  ✗ 위음성 — 진짜 지역인데 탈락: {key}")
        if not want and keep:
            fp += 1
            print(f"  ✗ 오탐 통과 — 일반명사인데 채택: {key}")
    print(f"조합 {len(data)}건 · 위음성 {fn} · 오탐통과 {fp}")
    if fn or fp:
        print("실패 — 규칙이 회귀했습니다.")
        return 1
    print("✅ 통과")
    return 0


if __name__ == "__main__":
    sys.exit(main())
