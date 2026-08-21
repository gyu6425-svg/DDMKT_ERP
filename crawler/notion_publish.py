# -*- coding: utf-8 -*-
"""공개 고객 안내 페이지 발행 — docs/notion/프로그램-스펙.md → 노션 페이지.

   ★ 이것은 '동기화'가 아니라 '발행'이다. 주기 실행하지 않는다.
     ERP → 노션으로 자동으로 흘려보낼 값이 실제로는 하나도 없다(검증 2026-08-21):
     자동화할 수 있는 값(단가)은 전부 공개 금지이고, 공개해도 되는 값(마감시간·최소수량)은
     ERP에 원천이 없다. 파이프를 깔아 두면 언젠가 단가가 그 파이프로 새어 나간다.
     그래서 원천은 위 마크다운 파일 하나이고, 사람이 고친 뒤 손으로 이 스크립트를 돌린다.

   ★ 발행 전 금액 검사를 강제한다. 걸리면 발행하지 않는다.
     공개 페이지에 단가가 한 번 뜨면 대행사가 하부에 붙인 마진이 즉시 역산되고,
     노션 공개 페이지는 검색엔진·공개 API로 캐시되어 지워도 남는다.

   전제(사람이 먼저 해 둘 것 — API로는 안 되는 일):
     1) app.notion.com/developers/connections 에서 내부 연동 생성 → 토큰(ntn_...) 발급
     2) 부모로 쓸 노션 페이지를 만들고 그 페이지의 ••• → Connections → 연동 추가
     3) .env 에 NOTION_TOKEN, NOTION_PARENT_PAGE_ID (발행 후에는 NOTION_PAGE_ID 도)
     4) 최초 1회 노션 화면에서 '웹에 게시' 토글 — 이건 API에 엔드포인트가 없다

   실행:
     python notion_publish.py --check        금액 검사만(발행 안 함)
     python notion_publish.py --dry-run      보낼 내용을 화면에 출력
     python notion_publish.py                실제 발행(처음이면 생성, 이후 전체 교체)
"""
import os
import re
import sys
import pathlib
import argparse
import requests
import truststore

truststore.inject_into_ssl()
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent
SPEC = ROOT / "docs" / "notion" / "프로그램-스펙.md"

for envp in (HERE / ".env", ROOT / ".env"):
    if envp.exists():
        for line in envp.read_text(encoding="utf-8", errors="ignore").splitlines():
            m = re.match(r'^([A-Z_]+)\s*=\s*"?([^"\n\r]+)"?', line)
            if m and m.group(1) not in os.environ:
                os.environ[m.group(1)] = m.group(2).strip()

API = "https://api.notion.com/v1"
# Views API·마크다운 API가 이 버전부터다. 올릴 때는 릴리스 노트를 먼저 볼 것.
NOTION_VERSION = "2026-03-11"

# 금액으로 읽힐 만한 것 전부. 느슨하게 잡아 오탐이 나는 편이 낫다 —
#   놓치면 되돌릴 수 없고, 오탐은 사람이 30초면 확인한다.
MONEY = re.compile(r"[0-9][0-9,]{2,}\s*원|₩|\d+\s*만\s*원|부가세|VAT|공급가|단가|토큰\s*\d", re.I)


def load_spec() -> str:
    if not SPEC.exists():
        sys.exit(f"원천 파일이 없습니다: {SPEC}")
    # HTML 주석(<!-- -->)은 내부 메모다 — 공개 페이지로 내보내지 않는다.
    body = re.sub(r"<!--.*?-->", "", SPEC.read_text(encoding="utf-8"), flags=re.S)
    return re.sub(r"\n{3,}", "\n\n", body).strip()


def money_check(text: str) -> list[tuple[int, str]]:
    hits = []
    for i, line in enumerate(text.splitlines(), 1):
        if MONEY.search(line):
            hits.append((i, line.strip()))
    return hits


def _hd() -> dict:
    tok = os.environ.get("NOTION_TOKEN", "")
    if not tok:
        sys.exit("NOTION_TOKEN 이 없습니다 — .env 에 넣어 주세요(내부 연동 토큰, ntn_ 로 시작).")
    return {"Authorization": f"Bearer {tok}", "Notion-Version": NOTION_VERSION,
            "Content-Type": "application/json"}


def create_page(md: str, parent: str, title: str) -> str:
    """부모 페이지 아래에 새로 만든다. 만들고 나면 id 를 .env 에 적어 둘 것."""
    r = requests.post(f"{API}/pages", headers=_hd(), timeout=60, json={
        "parent": {"page_id": parent},
        "properties": {"title": [{"text": {"content": title}}]},
        "markdown": md,
    })
    if r.status_code >= 300:
        sys.exit(f"생성 실패 {r.status_code}: {r.text[:400]}")
    return r.json()["id"]


def replace_page(md: str, page_id: str) -> None:
    """본문 전체 교체 — 돌릴 때마다 블록이 쌓이지 않게 하는 유일하게 단순한 방법.
       allow_deleting_content 는 켜지 않는다. 하위 페이지가 딸려 지워지면 API 가 막아 주고,
       그때는 사람이 노션에서 직접 확인하는 편이 맞다."""
    r = requests.patch(f"{API}/pages/{page_id}/markdown", headers=_hd(), timeout=120,
                       json={"operation": {"type": "replace_content", "content": md}})
    if r.status_code >= 300:
        sys.exit(f"갱신 실패 {r.status_code}: {r.text[:400]}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="금액 검사만")
    ap.add_argument("--dry-run", action="store_true", help="보낼 내용만 출력")
    ap.add_argument("--title", default="든든한마케팅 · 고객 안내")
    a = ap.parse_args()

    md = load_spec()
    hits = money_check(md)
    if hits:
        print("금액으로 읽힐 수 있는 표현이 있습니다 — 발행하지 않습니다.", flush=True)
        for n, line in hits:
            print(f"  {SPEC.name}:{n}  {line[:110]}", flush=True)
        sys.exit(1)
    print(f"금액 검사 통과 · {len(md.splitlines())}줄", flush=True)
    if a.check:
        return
    if a.dry_run:
        print("-" * 60)
        print(md)
        return

    page = os.environ.get("NOTION_PAGE_ID", "")
    if page:
        replace_page(md, page)
        print(f"갱신 완료 · page {page}", flush=True)
        return
    parent = os.environ.get("NOTION_PARENT_PAGE_ID", "")
    if not parent:
        sys.exit("NOTION_PARENT_PAGE_ID 가 없습니다 — 부모로 쓸 노션 페이지 id 를 .env 에 넣어 주세요.")
    pid = create_page(md, parent, a.title)
    print(f"생성 완료 · page {pid}", flush=True)
    print(f"  .env 에 NOTION_PAGE_ID={pid} 를 추가하면 다음부터는 갱신으로 돕니다.", flush=True)
    print("  노션 화면에서 '웹에 게시'를 한 번 켜 주세요 — API 로는 켤 수 없습니다.", flush=True)


if __name__ == "__main__":
    main()
