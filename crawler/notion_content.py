# -*- coding: utf-8 -*-
"""노션 고객 안내 — 하위 페이지 본문(블록 구조).

   ★ 왜 마크다운이 아니라 블록인가.
     마크다운으로 올리면 콜아웃·컬러 카드·2단 배치·토글을 못 만든다. 전부 밋밋한 문단이 된다.
     보기 좋게 만들려면 블록으로 직접 짜는 수밖에 없다(마크다운 API가 만들 수 있는 블록이 제한적).
   ★ 제목(h1)을 본문에 넣지 않는다. 노션이 페이지 제목을 이미 크게 보여 줘서 두 번 나온다.
   ★ 금액을 한 글자도 쓰지 말 것 — notion_publish.py 가 블록 안 글자를 훑어 검사하고 거부한다.
   ★ 화면 세부(버튼 위치·칸 이름)는 쓰지 않는다. 화면이 바뀌면 여기가 먼저 거짓말이 된다.
   ★ 카드 설명은 한 줄을 넘기지 않는다 — 아래 MAXLEN 참고. 넘기면 발행 전에 막힌다.
"""

ERP_URL = "https://ddmkt-erp.pages.dev"

# 칸 수별 설명 글자 수 상한. 넘으면 그 카드만 두 줄이 되어 혼자 키가 커진다.
#   노션에 카드 높이를 지정하는 방법이 없어서, 높이를 맞추는 유일한 방법이 글자 수를 맞추는 것이다.
#   (실측 2026-08-21: 3칸에서 "계좌이체 · 카드 · 기타" 12자가 두 줄로 넘어갔다.)
MAXLEN = {2: 16, 3: 9, 4: 7}


# ── 블록 조립 ───────────────────────────────────────────────────────
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


def h2(s):
    return blk("heading_2", rich_text=[t(s)])


def div():
    return blk("divider")


def callout(icon, color, rich, children=None):
    b = {"icon": {"type": "emoji", "emoji": icon}, "color": color, "rich_text": rich}
    if children:
        b["children"] = children
    return {"object": "block", "type": "callout", "callout": b}


def card(icon, title, desc, color="gray_background"):
    """카드 한 장 = 제목 굵게 + 회색 설명 한 줄."""
    c = callout(icon, color, [t(title, bold=True)],
                [para(t(desc, color="gray"))] if desc else None)
    c["_desc"] = desc or ""      # cols() 의 길이 검사용. 전송 전에 떼어 낸다.
    return c


def cols(cards):
    """나란히 놓기. column 은 2개 이상이어야 한다.

       ★ width_ratio 를 직접 준다. 안 주면 노션이 내용 길이에 맞춰 칸을 다르게 잡아
         카드 폭이 제각각이 된다(실측 2026-08-21).
       ★ 설명 길이도 여기서 막는다. 한 장만 두 줄이 되면 그 줄 전체가 어긋나 보인다."""
    n = len(cards)
    cap = MAXLEN.get(n, 12)
    for c in cards:
        d = c.pop("_desc", "")
        if len(d) > cap:
            raise ValueError(f"{n}칸 카드 설명이 {cap}자를 넘습니다({len(d)}자): {d!r}")
    r = round(1.0 / n, 4)
    return blk("column_list", children=[
        {"object": "block", "type": "column", "column": {"width_ratio": r, "children": [c]}}
        for c in cards
    ])


def toggle(q, ans):
    return blk("toggle", rich_text=[t(q, bold=True)],
               children=[para(t(line)) for line in ans.split("\n")])


def erp_top():
    return callout("🖥️", "blue_background",
                   [t("ERP 사이트 ", bold=True), a(ERP_URL, ERP_URL)],
                   [para(t("접수와 충전은 모두 여기서 합니다.", color="gray"))])


def erp_bottom():
    return callout("🔗", "gray_background", [a("고객 ERP 로그인 →", ERP_URL)],
                   [para(t("계정이 없으시면 담당자에게 말씀해 주세요.", color="gray"))])


# ── 💳 충전 요청 ────────────────────────────────────────────────────
def charge_page():
    return [
        erp_top(),
        callout("⚠️", "red_background",
                [t("선불입니다", bold=True)],
                [para(t("발행 건수가 0이면 주문서 접수 버튼이 잠깁니다. 충전이 먼저입니다.")),
                 para(t("발행 1건에 건수 1이 차감됩니다.", color="gray"))]),

        h2("🔷 세 단계로 끝납니다"),
        cols([
            card("📨", "1. 신청", "방식·건수 적기"),
            card("💬", "2. 금액 통보", "담당자가 안내"),
            card("🏦", "3. 입금·지급", "입금 후 지급"),
        ]),
        div(),

        h2("① 신청하기"),
        cols([
            card("💳", "결제 방식", "계좌이체 · 카드"),
            card("🔢", "건수", "필요한 발행 수"),
            card("📤", "충전 요청", "누르면 접수"),
        ]),
        para(t("결제 방식은 계좌이체 · 카드결제 · 기타 중에서 고르세요. "
               "건수는 나중에 추가하시면 누적됩니다.", color="gray")),
        callout("🚫", "orange_background",
                [t("이 단계에서는 아직 입금하지 마세요", bold=True)],
                [para(t("금액을 먼저 통보받습니다. 미리 보내시면 확인이 오히려 늦어집니다.",
                        color="gray"))]),
        div(),

        h2("② 상태 보기"),
        para(t("신청한 건이 목록에 쌓이고, 상태가 이렇게 바뀝니다.", color="gray")),
        cols([
            card("📥", "접수", "확인 중"),
            card("💬", "금액 통보", "입금할 차례"),
            card("🔎", "입금 확인 중", "통장 확인 중"),
            card("✅", "충전완료", "지급 끝"),
        ]),
        div(),

        h2("③ 입금하고 알리기"),
        cols([
            card("🏦", "입금 계좌 확인", "은행 · 번호 · 예금주"),
            card("✅", "계좌이체 완료", "입금자명 적고 누르기"),
        ]),
        para(t("계좌는 금액 통보와 함께 주황색 상자로 전달됩니다 — 통보 전에는 보이지 않습니다. "
               "「계좌이체 완료」를 눌러 주셔야 담당자에게 확인 요청이 갑니다.", color="gray")),
        callout("📛", "yellow_background",
                [t("입금자명이 통장 이름과 다르면 미리 알려 주세요", bold=True)],
                [para(t("이름이 다르면 통장에서 찾지 못해 확인이 늦어집니다.", color="gray"))]),
        div(),

        h2("🏢 소속 대행사가 있는 업체라면"),
        callout("🏢", "purple_background",
                [t("우리가 아니라 소속 대행사에 신청합니다", bold=True)],
                [para(t("절차는 같습니다. 금액 통보와 입금 확인을 대행사 담당자가 합니다.")),
                 para(t("한 번에 처리 중인 신청은 하나뿐입니다 — 이번 건이 끝나야 다음 신청이 됩니다.",
                        color="gray"))]),
        div(),

        h2("❓ 자주 묻는 질문"),
        toggle("입금했는데 건수가 안 들어옵니다",
               "「계좌이체 완료」를 누르셨는지 확인해 주세요. 그 버튼을 눌러야 담당자에게 확인 요청이 갑니다.\n"
               "입금자명이 통장 이름과 다르면 확인이 늦어집니다."),
        toggle("한 번에 여러 건 신청할 수 있나요",
               "하부 업체는 한 번에 한 건입니다. 이번 건이 끝나야 다음 신청이 됩니다."),
        toggle("충전한 건수는 언제까지 쓸 수 있나요",
               "소진할 때까지 남아 있습니다. 추가 충전분은 누적됩니다."),
        toggle("비용은 얼마입니까",
               "상품 · 수량 · 기간에 따라 달라집니다. 담당자가 안내드립니다."),
        div(),
        erp_bottom(),
    ]


# ── 📝 카페 배포 접수 ───────────────────────────────────────────────
def deploy_page():
    return [
        erp_top(),
        callout("⚠️", "orange_background",
                [t("먼저 충전이 되어 있어야 합니다", bold=True)],
                [para(t("발행 건수가 0이면 접수 버튼이 잠깁니다. 충전 방법은 「충전 요청」 안내를 봐 주세요.",
                        color="gray"))]),

        h2("🎒 무엇을 준비해 오셔야 하나"),
        cols([
            card("🏷", "업체명", "글에 그대로 노출"),
            card("🔑", "네이버 계정", "대신 발행에 필요"),
            card("📋", "카페 · 게시판", "어디에 올릴지"),
        ]),
        cols([
            card("🖼", "사진", "배너 · 실사"),
            card("🔍", "키워드 · 지역", "방식에 따라 다름"),
            card("🔐", "2단계 인증", "쓰시면 꼭 체크"),
        ]),
        callout("🔐", "red_background",
                [t("2단계 인증을 쓰신다면 접수할 때 반드시 체크해 주세요", bold=True)],
                [para(t("체크하지 않으면 자동 로그인이 막혀 발행이 시작되지 않습니다.", color="gray"))]),
        div(),

        h2("📦 배포 종류"),
        cols([
            card("📄", "일반 배포", "적어 주신 키워드 그대로", "gray_background"),
            card("🔥", "인기탭 배포", "인기글 진입 키워드만", "green_background"),
        ]),
        para(t("인기탭 배포를 고르시면 아래 키워드 방식을 하나 더 고르시게 됩니다.", color="gray")),

        h2("🔑 키워드 잡는 방식"),
        # 카드에는 '무엇을 준비하나'만. 언제 쓰는지는 아래 한 줄로 몰아 둔다 —
        #   카드마다 두 줄씩 넣으면 줄바꿈 위치가 달라져 높이가 어긋난다.
        cols([
            card("📍", "지역형", "지역+키워드"),
            card("🏪", "키워드형", "플레이스 주소"),
            card("✍️", "직접 입력형", "키워드 목록"),
            card("🌐", "정보형", "단어 · 주소"),
        ]),
        para(t("지역형 = 원하는 지역에 노출하고 싶을 때 · 키워드형 = 플레이스로 우리 업체 키워드를 잡을 때 · "
               "직접 입력형 = 키워드를 직접 적을 때 · 정보형 = 홈페이지·블로그에서 뽑아 낼 때",
               color="gray")),
        callout("💡", "yellow_background",
                [t("제품 키워드는 적고 「추가」를 눌러야 담깁니다", bold=True)],
                [para(t("적기만 하고 넘어가면 빠집니다.", color="gray"))]),
        div(),

        h2("🖼 사진"),
        cols([
            card("🎨", "메인배너", "글 맨 위 이미지"),
            card("📷", "실사사진", "현장 · 시공"),
            card("📣", "배너", "글 끝 이미지"),
        ]),
        para(t("실사 사진은 많을수록 좋습니다. 올리면 자동으로 압축됩니다. "
               "사진이 없어도 접수는 되지만 글 품질이 떨어집니다.", color="gray")),
        div(),

        h2("📅 발행 일정 · 건수"),
        cols([
            card("📆", "미션 시작일", "언제부터 발행"),
            card("📊", "일 발행건수", "하루 최대 5건"),
            card("🎯", "총 발행건수", "이번 전체 건수"),
        ]),
        callout("🙌", "blue_background",
                [t("키워드가 모자라도 접수하실 수 있습니다", bold=True)],
                [para(t("총 발행건수보다 고르신 키워드가 적으면 「나머지는 맡길게요」를 고르세요. "
                        "남은 건수의 키워드는 담당자가 선정합니다.", color="gray"))]),
        div(),

        h2("🚀 접수 후"),
        cols([
            card("📥", "접수", "주문서 들어옴"),
            card("🛠", "세팅중", "담당자 준비 중"),
            card("✅", "완료", "발행 끝"),
        ]),
        callout("📈", "green_background",
                [t("발행된 글은 순위 트래커에서 보실 수 있습니다", bold=True)],
                [para(t("발행일 · 제목 · 키워드 · 최근 순위 · 5위 24시간 달성 여부가 매일 갱신됩니다.")),
                 para(t("성과 기준은 인기글 테마섹션 5위를 24시간 유지하는 것입니다.", color="gray"))]),
        div(),

        h2("❓ 자주 묻는 질문"),
        toggle("접수 버튼이 회색이고 눌리지 않습니다",
               "발행 건수가 0이거나, 적으신 총 발행건수가 남은 건수보다 많은 경우입니다.\n"
               "처리 중인 주문서가 있으면 그 건수도 미리 잡혀 있습니다. 충전하시면 열립니다."),
        toggle("접수한 내용을 고치고 싶습니다",
               "담당자에게 말씀해 주세요."),
        toggle("2단계 인증을 쓰고 있습니다",
               "접수할 때 반드시 체크해 주세요. 안 하시면 발행이 시작되지 않습니다."),
        toggle("사진이 없어도 되나요",
               "접수는 됩니다. 다만 글 품질이 떨어집니다. 현장 사진이 있으면 꼭 올려 주세요."),
        div(),
        erp_bottom(),
    ]


PAGE_BODIES = {
    "01": charge_page,
    "02": deploy_page,
}
