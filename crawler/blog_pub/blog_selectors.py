# -*- coding: utf-8 -*-
"""네이버 블로그 스마트에디터 셀렉터 — **Phase 0 실측으로 채우는 파일**.

⚠️ 파일명이 `blog_selectors.py` 인 이유: `selectors` 는 **파이썬 표준 라이브러리 모듈명**이다.
   이 폴더를 sys.path 맨 앞에 넣는 순간 asyncio/Playwright 가 import 하는 stdlib selectors 를
   이 파일이 가려버려 런타임에 엉뚱하게 깨진다. 절대 `selectors.py` 로 되돌리지 말 것.

🔴 지금은 전부 '미확정 후보'다. CONFIRMED_ON 이 비어 있으면 save_blog.py 가 실제 저장을 거부한다.
   확정 절차:
     1) SUB1 에서 run_chrome_blog.bat 으로 크롬(포트 9235) 띄우고 대상 블로그에 1회 수동 로그인
     2) python diag_blog.py            → 프레임/입력칸/버튼 덤프
     3) python diag_blog.py --record   → 사람이 '저장'을 누를 때 나가는 POST URL 기록
        (⚠️ '발행'은 테스트 블로그에서만 눌러 볼 것. 기록 목적은 **차단 대상 확정**이다.)
     4) 덤프 결과로 아래 값을 채우고 CONFIRMED_ON 에 날짜를 적는다 → 커밋

왜 이렇게까지 하나 (독립검증 지적):
  · 카페 SEL_SUBMIT 은 `['a.BaseButton--skinGreen:has-text("등록")', 'a.BaseButton--skinGreen', ...]` 로
    **텍스트 조건 없는 클래스 폴백**을 갖는다. 카페에선 초록 버튼이 '등록' 하나뿐이라 안전했지만,
    블로그에서 그 발상을 복붙하면 **저장 버튼 옆의 발행 버튼을 누른다**. 폴백 금지.
  · 셀렉터를 추측으로 채우고 돌리면 '실패'가 아니라 '엉뚱한 클릭'이 된다.
"""

# ── Phase 0 확정 표시 — 실측 후 'YYYY-MM-DD' 를 적을 것. 비어 있으면 저장 모드 거부. ──
CONFIRMED_ON = ""

# 글쓰기 페이지가 iframe 안이면 그 프레임 URL/이름에 매칭할 정규식(top-level 이면 "" 로 둘 것).
#   네이버 블로그는 blog.naver.com/<id>?Redirect=Write 진입 시 #mainFrame 안에서 렌더되는 경우가 있다.
FRAME_HINT = r"mainFrame|PostWriteForm|editor"

# ── 아래는 전부 '후보'. Phase 0 로 확정할 것. ──
SEL_TITLE = [
    '.se-documentTitle [contenteditable="true"]',
    '.se-title-text [contenteditable="true"]',
    'textarea[placeholder*="제목"]',
]
SEL_EDITOR = [
    '.se-content .se-text-paragraph',
    '.se-content',
    '.se-container [contenteditable="true"]',
]
SEL_IMG_BTN = [
    'button[data-log="dot.img"]',
    'button.se-image-toolbar-button',
]
SEL_QUOTE_BTN = [
    'button[data-log="dot.quota"]',
    'button.se-quotation-toolbar-button',
]

# 🟢 저장(임시저장) 버튼 — **반드시 텍스트 제약 포함**. 클래스만 보는 폴백은 넣지 말 것.
SEL_SAVE = [
    'button:has-text("저장")',
    'a:has-text("저장")',
]
# 저장 개수 표시("저장 3") — 저장 성공 판정의 근거. 없으면 판정을 다른 신호로 대체해야 한다.
SEL_DRAFT_COUNT = [
    'button:has-text("저장") .text__count',
    '.header__save .text__count',
]

# ── 🔴 차단 전용 — 이 값들은 오직 '막기 위해' 존재한다. 클릭·goto 인자로 절대 쓰지 말 것. ──
#    test_no_publish.py 가 이 상수들이 클릭 경로로 흘러가지 않는지 정적으로 검사한다.
BLOCK_CLICK_SELECTORS = [
    'button:has-text("발행")',
    'a:has-text("발행")',
    '.publish_btn__ounNb',
    '[class*="publish"]',
    'button:has-text("예약")',
]
# 발행 POST 엔드포인트 URL 조각(소문자 비교). page.route 로 abort 한다.
#   ⚠️ Phase 0 에서 '저장'과 '발행'이 **같은 엔드포인트**를 쓰는 것으로 확인되면,
#      이 목록을 비우고(저장까지 막히므로) DOM 가드(#2)와 사후 RSS 검증(#4)에만 의존해야 한다.
#      그 경우 selectors.py 주석에 그 사실을 반드시 기록할 것.
BLOCK_URL_PARTS = [
    "/blogpostpublish",
    "postwritepublish",
    "rabbitwrite.naver",
    "publishpost",
]
# 저장 요청으로 확인된 엔드포인트(차단 예외). Phase 0 --record 로 채운다.
SAVE_URL_PARTS = []

# 저장 후 여기로 이동했다면 **발행된 것** — 최고 심각도 경보 + 중단.
PUBLISHED_URL_PATTERNS = [
    r"logNo=",
    r"/PostView\.naver",
]


def confirmed():
    return bool(CONFIRMED_ON.strip())
