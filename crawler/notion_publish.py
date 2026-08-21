# -*- coding: utf-8 -*-
"""노션 고객 안내 페이지 발행 — docs/notion/*.md → 「ERP 사용 방법」 아래 하위 페이지 2장.

   구성:
     ERP 사용 방법 (부모, NOTION_PARENT_PAGE_ID)
     ├ 카드 2장(2단 배치)  ← 이 스크립트가 매번 다시 그린다
     ├ 💳 충전 요청 — 발행 건수 받기      (01-충전-요청.md)
     └ 📝 카페 배포 접수 — 주문서 작성    (02-카페-배포-접수.md)

   ★ 이것은 '동기화'가 아니라 '발행'이다. 주기 실행하지 않는다.
     ERP → 노션으로 자동으로 흘려보낼 값이 실제로는 하나도 없다(검증 2026-08-21):
     자동화할 수 있는 값(단가)은 전부 공개 금지이고, 공개해도 되는 값(마감시간·최소수량)은
     ERP에 원천이 없다. 파이프를 깔아 두면 언젠가 단가가 그 파이프로 새어 나간다.

   ★ 발행 전 금액 검사를 강제한다. 걸리면 발행하지 않는다.
     공개 페이지에 단가가 한 번 뜨면 대행사가 하부에 붙인 마진이 즉시 역산되고,
     노션 공개 페이지는 검색엔진·공개 API로 캐시되어 지워도 남는다.

   전제(사람이 먼저 해 둘 것 — API로는 안 되는 일):
     1) app.notion.com/developers → 내부 연동 생성 → Access token(ntn_...)
     2) 부모 페이지 ••• → 연결 → 그 연동 추가
     3) .env 에 NOTION_TOKEN, NOTION_PARENT_PAGE_ID
     4) 하위 페이지마다 '웹에 게시' 1회 토글 — API에 엔드포인트가 없다

   실행:
     python notion_publish.py --check     금액 검사만
     python notion_publish.py             발행(하위 페이지 갱신 + 부모 카드 재구성)
"""
import os
import re
import sys
import time
import pathlib
import argparse
import requests
import truststore

truststore.inject_into_ssl()
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent
DOCS = ROOT / "docs" / "notion"

# (원본 파일, 노션 페이지 제목, 카드 아이콘, 카드 한 줄 설명)
PAGES = [
    ("01-충전-요청.md", "💳 충전 요청 — 발행 건수 받기", "💳",
     "발행 건수를 받는 절차입니다. 신청 → 금액 통보 → 입금 → 건수 지급."),
    ("02-카페-배포-접수.md", "📝 카페 배포 접수 — 주문서 작성", "📝",
     "무엇을 어떻게 발행할지 넣는 곳입니다. 준비물과 키워드 방식."),
]

for envp in (HERE / ".env", ROOT / ".env"):
    if envp.exists():
        for line in envp.read_text(encoding="utf-8", errors="ignore").splitlines():
            m = re.match(r'^([A-Z_]+)\s*=\s*"?([^"\n\r]+)"?', line)
            if m and m.group(1) not in os.environ:
                os.environ[m.group(1)] = m.group(2).strip()

API = "https://api.notion.com/v1"
NOTION_VERSION = "2026-03-11"   # Views·마크다운 API가 이 버전부터

# 금액으로 읽힐 만한 것 전부. 느슨하게 잡아 오탐이 나는 편이 낫다 —
#   놓치면 되돌릴 수 없고, 오탐은 사람이 30초면 확인한다.
MONEY = re.compile(r"[0-9][0-9,]{2,}\s*원|₩|\d+\s*만\s*원|부가세|VAT|공급가|단가|토큰\s*\d", re.I)


def load_md(name: str) -> str:
    p = DOCS / name
    if not p.exists():
        sys.exit(f"원천 파일이 없습니다: {p}")
    # HTML 주석은 내부 메모다 — 공개 페이지로 내보내지 않는다.
    body = re.sub(r"<!--.*?-->", "", p.read_text(encoding="utf-8"), flags=re.S)
    return re.sub(r"\n{3,}", "\n\n", body).strip()


def money_check(name: str, text: str) -> list[str]:
    return [f"{name}:{i}  {ln.strip()[:110]}"
            for i, ln in enumerate(text.splitlines(), 1) if MONEY.search(ln)]


def hd() -> dict:
    tok = os.environ.get("NOTION_TOKEN", "")
    if not tok:
        sys.exit("NOTION_TOKEN 이 없습니다 — .env 에 넣어 주세요(내부 연동 토큰, ntn_ 로 시작).")
    return {"Authorization": f"Bearer {tok}", "Notion-Version": NOTION_VERSION,
            "Content-Type": "application/json"}


def req(method: str, path: str, **kw):
    """연동당 평균 초당 3회 제한 — 429 면 Retry-After 를 지킨다."""
    for _ in range(5):
        r = requests.request(method, f"{API}{path}", headers=hd(), timeout=120, **kw)
        if r.status_code == 429:
            time.sleep(float(r.headers.get("Retry-After", "2")))
            continue
        if r.status_code >= 300:
            sys.exit(f"{method} {path} 실패 {r.status_code}: {r.text[:400]}")
        time.sleep(0.35)
        return r.json() if r.text else {}
    sys.exit(f"{method} {path} — 재시도 한도 초과")


def child_pages(parent: str) -> dict:
    """부모 아래 하위 페이지 {제목: id}. 제목으로 찾아 재사용해야 돌릴 때마다 새로 생기지 않는다."""
    out, cur = {}, None
    while True:
        q = f"?page_size=100" + (f"&start_cursor={cur}" if cur else "")
        j = req("GET", f"/blocks/{parent}/children{q}")
        for b in j.get("results", []):
            if b.get("type") == "child_page":
                out[b["child_page"]["title"]] = b["id"]
        if not j.get("has_more"):
            return out
        cur = j.get("next_cursor")


def upsert_child(parent: str, title: str, md: str, existing: dict) -> str:
    pid = existing.get(title)
    if pid:
        # 본문 전체 교체 — 돌릴 때마다 블록이 쌓이지 않게 하는 가장 단순한 방법.
        req("PATCH", f"/pages/{pid}/markdown",
            json={"operation": {"type": "replace_content", "content": md}})
        print(f"  · 갱신  {title}", flush=True)
        return pid
    j = req("POST", "/pages", json={
        "parent": {"page_id": parent},
        "properties": {"title": [{"text": {"content": title}}]},
        "markdown": md,
    })
    print(f"  · 생성  {title}", flush=True)
    return j["id"]


def card(icon: str, pid: str, desc: str) -> dict:
    """카드 한 장 = 콜아웃. 제목은 페이지 멘션이라 눌러서 바로 들어간다."""
    return {"object": "block", "type": "callout", "callout": {
        "icon": {"type": "emoji", "emoji": icon},
        "color": "gray_background",
        "rich_text": [{"type": "mention", "mention": {"page": {"id": pid}},
                       "annotations": {"bold": True}}],
        "children": [{"object": "block", "type": "paragraph", "paragraph": {
            "rich_text": [{"type": "text", "text": {"content": desc},
                           "annotations": {"color": "gray"}}]}}],
    }}


def rebuild_parent(parent: str, ids: list[str]) -> None:
    """부모 본문을 카드 배치로 다시 그린다.
       ★ child_page 블록은 절대 건드리지 않는다 — 그건 하위 페이지 자체라 지우면 내용이 날아간다."""
    cur = None
    doomed = []
    while True:
        q = "?page_size=100" + (f"&start_cursor={cur}" if cur else "")
        j = req("GET", f"/blocks/{parent}/children{q}")
        doomed += [b["id"] for b in j.get("results", []) if b.get("type") != "child_page"]
        if not j.get("has_more"):
            break
        cur = j.get("next_cursor")
    for bid in doomed:
        req("DELETE", f"/blocks/{bid}")
    if doomed:
        print(f"  · 부모 본문 정리 {len(doomed)}블록(하위 페이지는 그대로)", flush=True)

    blocks = [
        {"object": "block", "type": "heading_1", "heading_1": {
            "rich_text": [{"type": "text", "text": {"content": "ERP 사용 방법"}}]}},
        {"object": "block", "type": "paragraph", "paragraph": {
            "rich_text": [{"type": "text", "text": {
                "content": "카페 배포는 선불입니다. 발행 건수를 충전한 뒤 주문서를 넣으시면 저희가 대신 발행합니다."}}]}},
        # 2단 배치 — 한 줄로 늘어놓지 않고 카드 두 장을 나란히 둔다.
        {"object": "block", "type": "column_list", "column_list": {"children": [
            {"object": "block", "type": "column", "column": {
                "children": [card(PAGES[i][2], ids[i], PAGES[i][3])]}}
            for i in range(len(PAGES))
        ]}},
        {"object": "block", "type": "paragraph", "paragraph": {"rich_text": []}},
        {"object": "block", "type": "callout", "callout": {
            "icon": {"type": "emoji", "emoji": "💬"},
            "color": "blue_background",
            "rich_text": [{"type": "text", "text": {
                "content": "궁금하신 것은 담당자에게 편하게 말씀해 주세요. 비용은 상품·수량·기간에 따라 달라져 담당자가 안내드립니다."}}]}},
    ]
    req("PATCH", f"/blocks/{parent}/children", json={"children": blocks})
    print("  · 부모 카드 배치 완료", flush=True)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="금액 검사만")
    a = ap.parse_args()

    bodies, hits = {}, []
    for fname, title, _, _ in PAGES:
        md = load_md(fname)
        bodies[title] = md
        hits += money_check(fname, md)
    if hits:
        print("금액으로 읽힐 수 있는 표현이 있습니다 — 발행하지 않습니다.", flush=True)
        for h in hits:
            print("  " + h, flush=True)
        sys.exit(1)
    print(f"금액 검사 통과 · {len(PAGES)}장", flush=True)
    if a.check:
        return

    parent = os.environ.get("NOTION_PARENT_PAGE_ID", "")
    if not parent:
        sys.exit("NOTION_PARENT_PAGE_ID 가 없습니다.")
    existing = child_pages(parent)
    ids = [upsert_child(parent, title, bodies[title], existing) for _, title, _, _ in PAGES]
    rebuild_parent(parent, ids)

    print("\n발행 완료. 하위 페이지마다 노션에서 '웹에 게시'를 켜 주세요(API 로는 못 켭니다).", flush=True)
    for (_, title, _, _), pid in zip(PAGES, ids):
        print(f"  {title}\n    https://app.notion.com/p/{pid.replace('-', '')}", flush=True)


if __name__ == "__main__":
    main()
