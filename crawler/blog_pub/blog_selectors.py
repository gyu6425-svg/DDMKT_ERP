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
#   ⚠️ 아직 비워 둔다. Phase 0-A(2026-08-11, SUB1/dog6425)로 대부분 확정됐지만
#      SEL_BODY 와 EMPTY_COMPONENT_COUNT 가 probe_editor.py 결과 대기 중이다.
#      이 둘이 틀리면 '본문이 제목칸에 들어가거나' '비우기가 영원히 실패' 하므로 확정 전엔 열지 않는다.
CONFIRMED_ON = ""

# 글쓰기 페이지 프레임.
#   ✅ 실측 2026-08-11: /postwrite 는 **top-level 렌더**(#mainFrame 아님). resolve_ctx 가 page 를
#      먼저 검사하므로 이 힌트는 실제로 쓰이지 않는다. 구형 `?Redirect=Write` 진입(=#mainFrame)
#      호환을 위해 남겨 둔다. 프레임 3개 중 input_buffer(about:blank)·wtm.pstatic.net(광고)는 무관.
FRAME_HINT = r"mainFrame|PostWriteForm|editor"

# ── ✅ 실측 확정 2026-08-11 (SUB1, blog.naver.com/dog6425/postwrite, 신형 SmartEditor ONE) ──
# 제목 — ⚠️ 제목은 **자체 contenteditable 이 아니다**. 문서 전체가 단일 편집영역이고
#   [contenteditable=true] 는 문서에 딱 1개뿐이다. 그래서 예전 후보 3종은 전부 0개였다.
SEL_TITLE = [
    '.se-section-documentTitle .se-text-paragraph',
    '.se-title-text',
]

# 🔴 본문 — 제목과 반드시 분리해야 한다.
#   `.se-content .se-text-paragraph` 는 **제목+본문 2개**가 잡히고, DOM 순서상 제목이 먼저라
#   first() 를 쓰면 **본문이 제목칸에 들어간다**. 그래서 본문 전용 셀렉터를 따로 둔다.
#   ⏳ probe_editor.py 로 확정 대기 — 확정 전엔 CONFIRMED_ON 을 채우지 말 것.
SEL_BODY = [
    '.se-section-text .se-text-paragraph',
    '.se-component.se-text .se-text-paragraph',
]

# 에디터 컨테이너 — 프레임 판별·존재 확인용(타이핑 타깃 아님. 타이핑은 SEL_TITLE/SEL_BODY 로).
SEL_EDITOR = [
    '.se-content',
    '.se-container',
]
SEL_IMG_BTN = [
    'button[data-log="dot.img"]',        # ✅ =1
    'button.se-image-toolbar-button',
]
SEL_QUOTE_BTN = [
    'button[data-log="dot.quota"]',
    'button.se-quotation-toolbar-button',
]

# 🟢 저장(임시저장) 버튼 — ✅ =1 (실제 클래스 save_btn__bzc5B).
#   클래스가 빌드마다 바뀌는 **해시 클래스**라 텍스트 매칭이 오히려 정답이다.
#   **반드시 텍스트 제약 포함**. 클래스만 보는 폴백은 넣지 말 것(옆이 발행 버튼이다).
SEL_SAVE = [
    'button:has-text("저장")',
    'a:has-text("저장")',
]
# 저장 개수 — ✅ 별도 버튼(save_count_btn), 현재 "0". 예전 후보(.text__count)는 0개였다.
SEL_DRAFT_COUNT = [
    'button[class*=save_count_btn]',
]

# ✅ 빈 문서의 .se-component 개수 = 2 (documentTitle 1 + text 1). 실측 2026-08-11.
#   ⚠️ 카페는 1 이었다. 그대로 뒀으면 `n <= 1` 이 영원히 거짓이라 비우기가 **항상 실패**하고
#      모든 작업이 죽었을 것이다.
EMPTY_COMPONENT_COUNT = 2

# Ctrl+A 가 제목까지 선택하는가 — ⏳ 미확정(빈 문서에서 재서 선택 텍스트가 ""라 저신뢰).
#   ⚠️ 이게 False(=컴포넌트 단위 스코프)라면 더 큰 문제다: Ctrl+A 로는 **본문만** 지워지고
#      복원된 이전 글의 **제목이 남는다** → 우리 제목이 그 뒤에 이어붙는다.
#      그래서 _clear_editor 는 제목/본문을 각각 비우고, 비운 결과를 검증한다.
SELECT_ALL_INCLUDES_TITLE = None

# ✅ '비어 있음' 판정 — 실측 2026-08-11 로 확정된 마크업 기준.
#   빈 문단은 이렇게 생겼다:
#     <span class="se-ff-nanumgothic … __se-node"></span>       ← 내용 노드(빈칸)
#     <span class="se-placeholder __se_placeholder">제목</span>  ← 플레이스홀더
#   판정은 blog_common.CONTENT_TEXT_JS 가 `.se-text-paragraph .__se-node` 만 읽어서 한다.
#
#   ⚠️ 왜 이 경로로 왔는지(같은 실수 반복 방지):
#     1차 시도 = 플레이스홀더를 **문자열로 빼기** → "#모두의회고" 처럼 네이버가 날마다 바꾸는
#        프롬프트가 있어 목록으로 못 쫓아감.
#     2차 시도 = `.se-content` innerText 에서 placeholder 요소만 제거 → 그 컨테이너 안에
#        **편집기 UI 가 같이 들어있어** 빈 문서에서도 "위치이동/제목 배경/구분선1…인용구6"
#        같은 툴바 텍스트가 남음(SUB1 실측). 스코프가 너무 넓었다.
#     3차(현재) = 문단의 **내용 노드만** 읽기. 툴바·메뉴가 원천적으로 안 들어온다.
PLACEHOLDER_CLASS_HINTS = ["placeholder", "__se_placeholder"]

# ── 🔴 차단 전용 — 이 값들은 오직 '막기 위해' 존재한다. 클릭·goto 인자로 절대 쓰지 말 것. ──
#    test_no_publish.py 가 이 상수들이 클릭 경로로 흘러가지 않는지 정적으로 검사한다.
#   ✅ 실측 2026-08-11: 발행=publish_btn__m9KHH / 예약발행=reserve_btn__Km5Xh (둘 다 해시 클래스).
#      해시는 빌드마다 바뀌므로 텍스트 + [class*=] 부분매칭을 함께 건다.
BLOCK_CLICK_SELECTORS = [
    'button:has-text("발행")',
    'a:has-text("발행")',
    'button:has-text("예약")',
    '[class*="publish_btn"]',
    '[class*="reserve_btn"]',
    '[class*="publish"]',
]

# 🟢 발행 POST 엔드포인트 — ✅ 실측으로 **저장과 분리 확인**(2026-08-11). 가드 #1 사용 가능.
#      발행(공개)        POST blog.naver.com/RabbitWrite.naver          ← 차단 대상
#      저장(자동저장)     POST blog.naver.com/RabbitAutoSaveWrite.naver
#      저장(저장버튼)     POST blog.naver.com/RabbitTempPostWrite.naver
#   ⚠️ 부분문자열 함정: 셋 다 "Write" 를 포함한다. 그래서 "write" 같은 조각으로 막으면 저장까지 죽는다.
#      "rabbitwrite.naver" 는 AutoSaveWrite/TempPostWrite 의 부분문자열이 **아니므로** 유니크하다
#      (rabbit 다음이 각각 autosave/temppost 라 연속 매칭이 성립하지 않음). 이 조각만 신뢰한다.
BLOCK_URL_PARTS = [
    "rabbitwrite.naver",     # ✅ 실측 확정
    # 아래는 미확인 추정(모바일/구버전 대비). 위 저장 엔드포인트와 겹치지 않는 것만 남긴다.
    "postwritepublish",
    "publishpost",
]
# 저장 요청(차단 예외). ⚠️ 정확한 철자를 외워 쓰지 말고 **모호하지 않은 접두어**만 쓴다 —
#   'RabbitTempPostWrite' 를 손으로 옮기다 p 하나를 빠뜨리는 실수가 실제로 있었다(SUB1 회신).
#   'rabbitautosave'/'rabbittemp' 는 발행 엔드포인트와 절대 겹치지 않으면서 오타 위험이 없다.
SAVE_URL_PARTS = [
    "rabbitautosave",
    "rabbittemp",
]

# 🔴 저장 성공 판정용 — 이 둘을 **반드시 구분**해야 한다.
#   네이버는 타이핑 중에도 RabbitAutoSaveWrite 로 **알아서 임시저장**을 만든다(실측:
#   diag 때 저장카운터 "0" → probe 때 "1" 로 저절로 증가). 그래서 '카운터가 늘었다'를
#   성공 근거로 쓰면 **저장 버튼을 안 눌러도 성공으로 기록**된다(거짓 성공).
#   → 성공 판정은 '저장 버튼 클릭 이후 SAVE_CLICK_URL_PART 응답이 왔는가'로 한다.
SAVE_CLICK_URL_PART = "rabbittemp"      # 저장 버튼이 쏘는 요청(RabbitTempPostWrite)
AUTOSAVE_URL_PART = "rabbitautosave"    # 자동저장 — 성공 근거로 쓰면 안 됨

# 저장 후 여기로 이동했다면 **발행된 것** — 최고 심각도 경보 + 중단.
PUBLISHED_URL_PATTERNS = [
    r"logNo=",
    r"/PostView\.naver",
]


def confirmed():
    return bool(CONFIRMED_ON.strip())
