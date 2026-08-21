# -*- coding: utf-8 -*-
"""노션 고객 안내 페이지 발행 — docs/notion/*.md → 「ERP 사용 방법」 아래 하위 페이지 2장.

   구성:
     ERP 사용 방법 (부모, NOTION_PARENT_PAGE_ID)
     ├ 표지·아이콘 / 시작하기 3카드 / 상세 2카드 / 바로가기 / 문의   ← 매번 다시 그린다
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
     python notion_publish.py             발행
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

ERP_URL = "https://ddmkt-erp.pages.dev"
BRAND = "Marketing Agency I 든든한마케팅"
# 표지 이미지는 노션이 제공하는 기본 그라데이션을 쓴다 — 외부 호스팅이 필요 없고 링크가 안 죽는다.
COVER = "https://www.notion.so/images/page-cover/gradients_8.png"

# (원본 파일, 노션 제목, 아이콘, 카드 설명, 카드 색, 표지)
PAGES = [
    ("01-충전-요청.md", "💳 충전 요청 — 발행 건수 받기", "💳",
     "신청 → 금액 통보 → 입금 → 건수 지급.\n발행 건수를 받는 절차입니다.",
     "blue_background", "https://www.notion.so/images/page-cover/gradients_3.png"),
    ("02-카페-배포-접수.md", "📝 카페 배포 접수 — 주문서 작성", "📝",
     "준비물 · 배포 종류 · 키워드 방식.\n무엇을 어떻게 발행할지 넣는 곳입니다.",
     "green_background", "https://www.notion.so/images/page-cover/gradients_10.png"),
]

# 시작하기 3단계 — 표 대신 카드로 늘어놓는다.
STEPS = [
    ("1️⃣", "발행 건수를 충전합니다", "고객 ERP → 카페 → 충전 요청"),
    ("2️⃣", "주문서를 넣습니다", "고객 ERP → 카페 → 주문서 작성"),
    ("3️⃣", "담당자가 세팅하고 발행합니다", "진행 상황은 순위 트래커에서"),
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


# ── 블록 조립 helper ────────────────────────────────────────────────
def t(s, **ann):
    o = {"type": "text", "text": {"content": s}}
    if ann:
        o["annotations"] = ann
    return o


def a(s, url):
    return {"type": "text", "text": {"content": s, "link": {"url": url}}}


def blk(kind, **body):
    return {"object": "block", "type": kind, kind: body}


def para(*rt):
    return blk("paragraph", rich_text=list(rt))


def callout(icon, color, rich, children=None):
    b = {"icon": {"type": "emoji", "emoji": icon}, "color": color, "rich_text": rich}
    if children:
        b["children"] = children
    return {"object": "block", "type": "callout", "callout": b}


def cols(cards):
    """2단·3단 배치. column 은 최소 2개여야 한다."""
    return blk("column_list", children=[
        {"object": "block", "type": "column", "column": {"children": [c]}} for c in cards
    ])


# ── API ────────────────────────────────────────────────────────────
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


def load_md(name: str) -> str:
    p = DOCS / name
    if not p.exists():
        sys.exit(f"원천 파일이 없습니다: {p}")
    body = re.sub(r"<!--.*?-->", "", p.read_text(encoding="utf-8"), flags=re.S)  # 내부 메모 제거
    return re.sub(r"\n{3,}", "\n\n", body).strip()


def money_check(name: str, text: str) -> list[str]:
    return [f"{name}:{i}  {ln.strip()[:110]}"
            for i, ln in enumerate(text.splitlines(), 1) if MONEY.search(ln)]


def children_of(pid: str) -> list[dict]:
    out, cur = [], None
    while True:
        q = "?page_size=100" + (f"&start_cursor={cur}" if cur else "")
        j = req("GET", f"/blocks/{pid}/children{q}")
        out += j.get("results", [])
        if not j.get("has_more"):
            return out
        cur = j.get("next_cursor")


def dress(pid: str, icon: str, cover: str) -> None:
    """아이콘·표지. 있고 없고가 첫인상을 가른다."""
    req("PATCH", f"/pages/{pid}", json={
        "icon": {"type": "emoji", "emoji": icon},
        "cover": {"type": "external", "external": {"url": cover}},
    })


def upsert_child(parent: str, title: str, md: str, icon: str, cover: str, existing: dict) -> str:
    pid = existing.get(title)
    if pid:
        # 본문 전체 교체 — 돌릴 때마다 블록이 쌓이지 않게 하는 가장 단순한 방법.
        #   본문 형식은 {type, <type>:{new_str}} 이다. operation 으로 감싸면 400 이 난다.
        #   allow_deleting_content 는 켜지 않는다. 하위 페이지가 딸려 지워지면 API 가 막아 준다.
        req("PATCH", f"/pages/{pid}/markdown",
            json={"type": "replace_content", "replace_content": {"new_str": md}})
        print(f"  · 갱신  {title}", flush=True)
    else:
        pid = req("POST", "/pages", json={
            "parent": {"page_id": parent},
            "properties": {"title": [{"text": {"content": title}}]},
            "markdown": md,
        })["id"]
        print(f"  · 생성  {title}", flush=True)
    dress(pid, icon, cover)
    # 맨 끝에 돌아가는 길 — 하위 페이지만 공개했을 때 고객이 갈 곳이 없으면 그대로 이탈한다.
    req("PATCH", f"/blocks/{pid}/children", json={"children": [
        blk("divider"),
        callout("🔗", "gray_background", [a("고객 ERP 로그인 →", ERP_URL)], [
            para(t("계정이 없으시면 담당자에게 말씀해 주세요.", color="gray"))]),
    ]})
    return pid


def rebuild_parent(parent: str, ids: list[str]) -> None:
    """부모 본문을 다시 그린다.
       ★ child_page 블록은 절대 건드리지 않는다 — 그건 하위 페이지 자체라 지우면 내용이 날아간다."""
    doomed = [b["id"] for b in children_of(parent) if b.get("type") != "child_page"]
    for bid in doomed:
        req("DELETE", f"/blocks/{bid}")
    if doomed:
        print(f"  · 부모 본문 정리 {len(doomed)}블록(하위 페이지는 그대로)", flush=True)

    dress(parent, "📘", COVER)

    blocks = [
        para(t(BRAND, bold=True, color="gray")),
        # ★ ERP 주소는 맨 위. 안내를 아무리 잘 써도 갈 곳을 못 찾으면 아무 일도 안 일어난다.
        callout("🖥️", "blue_background",
                [t("ERP 사이트 ", bold=True), a(ERP_URL, ERP_URL)],
                [para(t("접수와 충전은 모두 여기서 합니다. 계정이 없으시면 담당자에게 말씀해 주세요.",
                        color="gray"))]),
        para(t("카페 배포는 "), t("선불", bold=True, color="red"),
             t("입니다. 발행 건수를 충전한 뒤 주문서를 넣으시면 저희가 대신 발행합니다. "
               "건수가 0이면 주문서 접수 버튼이 잠깁니다.")),
        blk("divider"),

        blk("heading_2", rich_text=[t("🌠 시작하기")]),
        cols([callout(ic, "gray_background", [t(head, bold=True)],
                      [para(t(sub, color="gray"))]) for ic, head, sub in STEPS]),
        blk("divider"),

        blk("heading_2", rich_text=[t("📖 자세한 안내")]),
        para(t("아래 두 장을 눌러 보세요. 하는 시점이 달라 나눠 두었습니다.", color="gray")),
        cols([callout(PAGES[i][2], PAGES[i][4],
                      [{"type": "mention", "mention": {"page": {"id": ids[i]}},
                        "annotations": {"bold": True}}],
                      [para(t(PAGES[i][3], color="gray"))])
              for i in range(len(PAGES))]),
        blk("divider"),

        blk("heading_2", rich_text=[t("🔗 바로가기")]),
        callout("🔗", "gray_background", [a("고객 ERP 로그인 →", ERP_URL)], [
            para(t("로그인하시면 화면 안에 단계별 안내(📖 가이드 보기)가 있어 "
                   "처음이셔도 그대로 따라 하시면 됩니다. 계정이 없으시면 담당자에게 말씀해 주세요.",
                   color="gray"))]),

        blk("heading_2", rich_text=[t("💬 문의")]),
        callout("💬", "yellow_background", [t("궁금하신 사항이 있으시다면 편하게 말씀해 주세요", bold=True)], [
            para(t("카카오톡 채널 · 담당자 직통")),
            para(t("비용은 상품·수량·기간에 따라 달라져 담당자가 안내드립니다.", color="gray"))]),
    ]
    req("PATCH", f"/blocks/{parent}/children", json={"children": blocks})
    print("  · 부모 카드 배치 완료", flush=True)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="금액 검사만")
    args = ap.parse_args()

    bodies, hits = {}, []
    for fname, title, *_ in PAGES:
        md = load_md(fname)
        bodies[title] = md
        hits += money_check(fname, md)
    if hits:
        print("금액으로 읽힐 수 있는 표현이 있습니다 — 발행하지 않습니다.", flush=True)
        for h in hits:
            print("  " + h, flush=True)
        sys.exit(1)
    print(f"금액 검사 통과 · {len(PAGES)}장", flush=True)
    if args.check:
        return

    parent = os.environ.get("NOTION_PARENT_PAGE_ID", "")
    if not parent:
        sys.exit("NOTION_PARENT_PAGE_ID 가 없습니다.")
    existing = {b["child_page"]["title"]: b["id"]
                for b in children_of(parent) if b.get("type") == "child_page"}
    ids = [upsert_child(parent, title, bodies[title], icon, cover, existing)
           for _, title, icon, _, _, cover in PAGES]
    rebuild_parent(parent, ids)

    print("\n발행 완료. 하위 페이지마다 노션에서 '웹에 게시'를 켜 주세요(API 로는 못 켭니다).", flush=True)
    for (_, title, *_), pid in zip(PAGES, ids):
        print(f"  {title}\n    https://app.notion.com/p/{pid.replace('-', '')}", flush=True)


if __name__ == "__main__":
    main()
