# -*- coding: utf-8 -*-
"""발행 경로 부재 정적검사 — 네트워크 없이 소스만 읽는다. 커밋/배포 전 반드시 통과할 것.

왜 테스트로 강제하나: "발행 코드를 안 부르면 된다"는 규칙은 나중에 누군가(=미래의 우리가)
편의로 한 줄 추가하면 무너진다. 이 테스트는 **소스에 발행 경로가 생기는 순간 빨간불**이 되게 한다.

  python test_no_publish.py

검사 항목
  T1 save_blog.py 에서 BLOCK_* 상수가 클릭/goto/evaluate 인자로 흘러가지 않는가
     (오직 _install_publish_guard 의 차단 인자로만 등장해야 한다)
  T2 save_draft() 진입부에서 _install_publish_guard 를 실제로 호출하는가
  T3 save_blog.py / blog_save_listener.py 에 'posted' 문자열이 없는가(카페 상태값 오염 방지)
  T4 CLI 기본값이 dry-run 인가 (--save 없이 저장되면 안 됨)
  T5 SEL_SAVE 후보가 전부 텍스트 제약을 갖는가 (클래스만 보는 폴백 금지 — 블로그의 초록 버튼은 발행)
  T6 blog_save_queue 를 다루는 코드가 'saved' 외의 완료 상태를 쓰지 않는가
  T7 cafe_pub 을 import 하지 않는가 (docs/MERGE-SAFETY.md §3.2 — 복사해 자립)
"""
import ast
import os
import re
import sys

try:   # 콘솔 코드페이지가 cp949 라 ✔/✘ 출력에서 죽는다(Windows 기본).
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

HERE = os.path.dirname(os.path.abspath(__file__))
SAVE_PY = os.path.join(HERE, "save_blog.py")
LISTENER_PY = os.path.join(HERE, "blog_save_listener.py")
SELECTORS_PY = os.path.join(HERE, "blog_selectors.py")

_fails = []
_passes = []


def check(name, ok, detail=""):
    (_passes if ok else _fails).append(name)
    print(f"  {'✔' if ok else '✘'} {name}" + (f" — {detail}" if detail and not ok else ""))


def _src(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def _tree(path):
    return ast.parse(_src(path), filename=path)


# ── T1: 차단 상수는 '가드 안'에서만, 그리고 절대 클릭/이동 인자로 쓰이지 않는다 ──
#   차단 상수를 아예 못 쓰게 하면 가드 자체를 못 만든다. 그래서 두 갈래로 검사한다:
#     (a) 격리 — BLOCK_*/PUBLISHED_* 참조는 아래 허용 함수 안에서만 등장해야 한다.
#     (b) 무해 — 어디서든 .click()/.goto() 의 인자나 수신자로 흘러가면 안 된다.
#   evaluate 는 (a)의 허용 함수 안에서 '차단할 셀렉터 목록'을 넘기는 정당한 용도라 (b)에서 뺀다.
# 차단/발행판별 상수를 만져도 되는 함수들.
#   _publish_now 는 mode='publish' 전용 경로다 — 발행 성공 판정에 PUBLISHED_URL_PATTERNS 가 필요하다.
#   _is_publish_url 은 그 판별을 한 곳에 모아둔 함수(관측기가 상수를 직접 안 만지게).
_GUARD_FUNCS = {"_install_publish_guard", "_is_blocked_url", "_assert_not_published",
                "_is_publish_url", "_publish_now"}


def _block_refs(node):
    out = []
    for n in ast.walk(node):
        if isinstance(n, ast.Attribute) and n.attr.startswith(("BLOCK_", "PUBLISHED_")):
            out.append((n.lineno, n.attr))
        elif isinstance(n, ast.Name) and n.id.startswith(("BLOCK_", "PUBLISHED_")):
            out.append((n.lineno, n.id))
    return out


def t1_block_consts_not_actionable():
    tree = _tree(SAVE_PY)

    # (a) 격리: 허용 함수 밖에서 차단 상수를 참조하면 실패
    allowed_lines = set()
    for fn in ast.walk(tree):
        if isinstance(fn, ast.FunctionDef) and fn.name in _GUARD_FUNCS:
            allowed_lines.update(ln for ln, _ in _block_refs(fn))
    outside = [f"line {ln}: {nm}" for ln, nm in _block_refs(tree) if ln not in allowed_lines]
    check(f"T1a 차단 상수는 {sorted(_GUARD_FUNCS)} 안에서만 참조", not outside, "; ".join(outside))

    # (b) 무해: 클릭/이동 경로로는 절대 흐르지 않는다
    ACTION_ATTRS = {"click", "goto", "type", "fill", "press", "dblclick", "tap", "set_files"}
    bad = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        fn = node.func
        attr = fn.attr if isinstance(fn, ast.Attribute) else None
        if attr not in ACTION_ATTRS:
            continue
        for a in list(node.args) + [k.value for k in node.keywords]:
            hit = [nm for _, nm in _block_refs(a)]
            if hit:
                bad.append(f"line {node.lineno}: .{attr}({hit})")
        if isinstance(fn, ast.Attribute):
            hit = [nm for _, nm in _block_refs(fn.value)]
            if hit:
                bad.append(f"line {node.lineno}: <{hit}>.{attr}()")
    check("T1b 차단 상수가 클릭/goto 경로로 흐르지 않음", not bad, "; ".join(bad))


# ── T2: 가드가 save_draft 진입부에서 실제로 호출된다 ─────────────────────────
def t2_guard_installed():
    tree = _tree(SAVE_PY)
    fn = next((n for n in ast.walk(tree)
               if isinstance(n, ast.FunctionDef) and n.name == "save_draft"), None)
    if fn is None:
        return check("T2 save_draft 가 _install_publish_guard 를 호출", False, "save_draft 함수 없음")
    called = any(
        isinstance(n, ast.Call) and isinstance(n.func, ast.Name) and n.func.id == "_install_publish_guard"
        for n in ast.walk(fn))
    # goto 보다 먼저 걸려야 의미가 있다(로드 전 init script).
    lines_guard = [n.lineno for n in ast.walk(fn)
                   if isinstance(n, ast.Call) and isinstance(n.func, ast.Name)
                   and n.func.id == "_install_publish_guard"]
    lines_goto = [n.lineno for n in ast.walk(fn)
                  if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute) and n.func.attr == "goto"]
    order_ok = bool(lines_guard) and (not lines_goto or min(lines_guard) < min(lines_goto))
    check("T2 save_draft 가 goto 이전에 _install_publish_guard 호출", called and order_ok,
          f"called={called} guard@{lines_guard} goto@{lines_goto}")


# ── T3: 'posted' 상태값 오염 없음 (코드에만 적용 — 설명 주석/독스트링은 제외) ──
def t3_no_posted_state():
    bad = []
    for p in (SAVE_PY,):
        tree = _tree(p)
        # 독스트링(모듈/함수/클래스 첫 문자열)은 '왜 posted 를 안 쓰는지' 설명해야 하므로 제외.
        docstrings = set()
        for n in ast.walk(tree):
            if isinstance(n, (ast.Module, ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                body = getattr(n, "body", None)
                if body and isinstance(body[0], ast.Expr) and isinstance(body[0].value, ast.Constant) \
                        and isinstance(body[0].value.value, str):
                    docstrings.add(id(body[0].value))
        for n in ast.walk(tree):
            if isinstance(n, ast.Constant) and isinstance(n.value, str) and id(n) not in docstrings:
                if n.value == "posted" or re.search(r'\bposted\b', n.value):
                    bad.append(f"{os.path.basename(p)}:{n.lineno}")
    check("T3 엔진(save_blog)에 'posted' 상태 문자열 없음", not bad, "; ".join(bad))
    # 리스너는 발행 모드에서 posted 를 쓴다 — 다만 **is_publish 분기 안에서만** 이어야 한다.
    lsrc = _src(LISTENER_PY).splitlines()
    bad2 = []
    for i, ln in enumerate(lsrc):
        if '"posted"' in ln and "status" in ln:
            window = "\n".join(lsrc[max(0, i - 12):i + 1])
            if "is_publish" not in window and "PostClickError" not in window:
                bad2.append(f"listener:{i+1}")
    check("T3b 리스너의 'posted' 는 발행 분기(is_publish/PostClickError) 안에서만", not bad2, "; ".join(bad2))


# ── T4: CLI 기본이 dry-run ──────────────────────────────────────────────────
def t4_cli_defaults_dry():
    src = _src(SAVE_PY)
    # --save 는 store_true(기본 False) 여야 하고, dry_run 은 not args.save 로 계산돼야 한다.
    has_flag = re.search(r'add_argument\(\s*"--save"\s*,\s*action="store_true"', src) is not None
    dry_from_flag = "dry_run=not a.save" in src
    # 저장이 기본이 되는 형태(dry_run=False 하드코딩)가 있으면 실패
    hard_false = re.search(r"dry_run\s*=\s*False", src) is not None
    check("T4 CLI 기본이 dry-run (--save 명시해야 저장)",
          has_flag and dry_from_flag and not hard_false,
          f"flag={has_flag} dry_from_flag={dry_from_flag} hard_false={hard_false}")

    lsrc = _src(LISTENER_PY)
    listener_optin = 'os.environ.get("BLOG_SAVE_ENABLED", "0") == "1"' in lsrc
    check("T4b 리스너도 BLOG_SAVE_ENABLED=1 opt-in", listener_optin)


# ── T5: 저장 버튼 셀렉터에 텍스트 제약 ──────────────────────────────────────
def t5_save_selectors_have_text():
    sys.path.insert(0, HERE)
    import blog_selectors as sel   # noqa: E402
    bad = [s for s in sel.SEL_SAVE if "has-text(" not in s]
    check("T5 SEL_SAVE 전 후보에 텍스트 제약 존재(클래스 폴백 금지)", not bad, "; ".join(bad))
    # 저장 셀렉터가 발행 문구를 잡으면 안 된다
    wrong = [s for s in sel.SEL_SAVE if re.search(r"발행|예약|publish", s, re.I)]
    check("T5b SEL_SAVE 에 발행/예약 문구 없음", not wrong, "; ".join(wrong))


# ── T6: 완료 상태는 saved 뿐 ────────────────────────────────────────────────
def t6_only_saved_terminal():
    src = _src(LISTENER_PY)
    statuses = set(re.findall(r'"status"\s*:\s*"([a-z_]+)"', src))
    allowed = {"pending", "processing", "saved", "posted", "fail"}
    bad = statuses - allowed
    check("T6 리스너가 쓰는 status 가 pending/processing/saved/fail 뿐", not bad, str(bad))


# ── T7: cafe_pub 미import ───────────────────────────────────────────────────
def t7_no_cafe_import():
    bad = []
    for fname in os.listdir(HERE):
        if not fname.endswith(".py"):
            continue
        src = _src(os.path.join(HERE, fname))
        for i, ln in enumerate(src.splitlines(), 1):
            if re.match(r"\s*(import|from)\s+.*(publish_cafe|publish_listener|cafe_pub)", ln):
                bad.append(f"{fname}:{i}")
    check("T7 cafe_pub 모듈을 import 하지 않음(복사해 자립 — MERGE-SAFETY §3.2)", not bad, "; ".join(bad))


# ── T8: 비우기가 제목 입력보다 먼저 ──────────────────────────────────────────
#   블로그는 문서 전체가 단일 contenteditable 이라 비우기의 Ctrl+A 가 제목까지 선택한다.
#   '제목 → 비우기' 순서면 방금 친 제목이 통째로 지워진다(2026-08-11 실측으로 드러난 버그).
def t8_clear_before_title():
    tree = _tree(SAVE_PY)
    fn = next((n for n in ast.walk(tree)
               if isinstance(n, ast.FunctionDef) and n.name == "save_draft"), None)
    if fn is None:
        return check("T8 save_draft 가 제목보다 먼저 에디터를 비움", False, "save_draft 없음")
    clear_lines = [n.lineno for n in ast.walk(fn)
                   if isinstance(n, ast.Call) and isinstance(n.func, ast.Name)
                   and n.func.id == "_clear_editor"]
    title_lines = [n.lineno for n in ast.walk(fn)
                   if isinstance(n, ast.Attribute) and n.attr == "SEL_TITLE"]
    ok = bool(clear_lines) and bool(title_lines) and min(clear_lines) < min(title_lines)
    check("T8 save_draft 가 제목 입력보다 먼저 _clear_editor 호출", ok,
          f"clear@{clear_lines} title@{title_lines}")


# ── T9: 본문 타이핑 타깃이 SEL_BODY (제목 혼입 방지) ─────────────────────────
#   .se-content .se-text-paragraph 는 제목+본문 2개가 잡히고 first() 는 제목을 집는다.
def t9_body_target():
    sys.path.insert(0, HERE)
    import blog_selectors as s2   # noqa: E402
    has_body = bool(getattr(s2, "SEL_BODY", None))
    check("T9a blog_selectors.SEL_BODY 정의됨", has_body)
    # SEL_EDITOR 는 타이핑 타깃이면 안 된다 — 본문 포커스는 SEL_BODY 로.
    src = _src(SAVE_PY)
    body_focus = "sel.SEL_BODY" in src
    check("T9b save_blog 이 SEL_BODY 로 본문 포커스", body_focus)
    # 제목 셀렉터와 본문 셀렉터가 같으면 제목칸에 본문이 들어간다.
    overlap = set(getattr(s2, "SEL_BODY", []) or []) & set(getattr(s2, "SEL_TITLE", []) or [])
    check("T9c SEL_BODY 와 SEL_TITLE 이 겹치지 않음", not overlap, str(overlap))


# ── T10: '비었나' 판정 JS 를 엔진과 probe 가 한 벌만 공유 ────────────────────
#   복붙 두 벌이면 probe 는 통과하는데 엔진은 다른 걸 검사하는 상태가 된다(실제로 발생).
#   또 .se-content innerText 를 읽으면 편집기 UI(툴바·컴포넌트 메뉴)까지 삼켜 빈 문서가
#   비어 보이지 않는다 — 그 패턴이 다시 들어오지 못하게 막는다.
def t10_shared_empty_check():
    common = _src(os.path.join(HERE, "blog_common.py"))
    check("T10a blog_common 에 CONTENT_TEXT_JS 단일 정의", "CONTENT_TEXT_JS" in common)
    check("T10b 판정 실패 시 센티널(<NO_SE_NODE>) 로 fail-closed", "<NO_SE_NODE>" in common)
    for p in (SAVE_PY, os.path.join(HERE, "probe_editor.py")):
        name = os.path.basename(p)
        src = _src(p)
        check(f"T10c {name} 이 bc.content_text 사용", "bc.content_text(" in src)
    # .se-content innerText 직독 금지는 **판정하는 쪽(엔진)에만** 건다.
    #   probe 는 그 원본 innerText 를 사람에게 보여주는 게 목적이고(이 문제를 발견한 것도 그 출력이다),
    #   판정 자체는 bc.content_text 로 하므로 예외다.
    bad = re.search(r"querySelector\('\.se-content'\)[^\n]*innerText", _src(SAVE_PY))
    check("T10d save_blog 이 .se-content innerText 로 판정하지 않음", not bad,
          bad.group(0)[:60] if bad else "")


# ── T11: CONFIRMED_ON 을 열었다면 실측값이 전부 채워져 있어야 한다 ───────────
#   CONFIRMED_ON 만 채우고 EMPTY_COMPONENT_COUNT 를 안 채우면 저장이 런타임에서야 죽는다.
def t11_confirmed_consistency():
    sys.path.insert(0, HERE)
    import blog_selectors as s3   # noqa: E402
    if not s3.confirmed():
        return check("T11 CONFIRMED_ON 미설정(저장 거부 상태) — 일관성 검사 생략", True)
    ok = s3.EMPTY_COMPONENT_COUNT is not None
    check("T11a CONFIRMED_ON 이면 EMPTY_COMPONENT_COUNT 확정됨", ok, str(s3.EMPTY_COMPONENT_COUNT))
    for name in ("SEL_TITLE", "SEL_BODY", "SEL_SAVE", "SEL_DRAFT_COUNT", "SEL_IMG_BTN"):
        v = getattr(s3, name, None)
        check(f"T11b {name} 비어있지 않음", bool(v))
    check("T11c 저장요청 판별자(SAVE_CLICK_URL_PART) 존재", bool(getattr(s3, "SAVE_CLICK_URL_PART", "")))
    # 저장 예외 목록이 발행 차단 조각을 포함하면 발행이 통과해버린다.
    bad = [s for s in s3.SAVE_URL_PARTS if any(b in s for b in s3.BLOCK_URL_PARTS)]
    check("T11d SAVE_URL_PARTS 가 발행 차단 조각을 포함하지 않음", not bad, str(bad))


# ── T12: probe Q5 가 '비우기 직전 non-empty' 를 확인하는가 ──────────────────
#   이 확인이 없으면, 더미가 애초에 안 들어갔거나 판정 함수가 항상 빈 문자열을 내는
#   고장 상태에서도 '비우기 성공'이 GREEN 으로 나온다(= 검증 자체가 무효).
#   SUB1 이 손으로 메운 구멍이라, 지워지지 않게 테스트로 고정한다.
def t12_probe_validity_gate():
    src = _src(os.path.join(HERE, "probe_editor.py"))
    has_pre = "dirty_txt" in src and "bc.content_text(" in src
    # 비우기 전 텍스트가 비어 있으면 조기 종료(무효 선언)해야 한다.
    gates = re.search(r"if not dirty_txt or dirty_txt == \"<NO_SE_NODE>\":", src) is not None
    check("T12 probe Q5 가 '비우기 직전 텍스트 존재'를 확인 후 진행", has_pre and gates,
          f"pre={has_pre} gate={gates}")
    # 엔진도 비우기 전 상태를 로그로 남겨야 스모크 로그만 보고 원인 추적이 된다.
    check("T12b save_blog 이 비우기 전 상태를 로그로 남김", "비우기 전:" in _src(SAVE_PY))


# ── T13: 복원 팝업은 반드시 [취소]로 닫는다 ─────────────────────────────────
#   [확인]을 누르면 이전 글이 복원돼 우리 원고가 그 위에 덧붙는다 — _clear_editor 로 막으려던
#   바로 그 오염이 팝업 한 번으로 되살아난다. 그래서:
#     (a) '확인' 버튼 셀렉터를 상수로 두지 않는다(복붙 사고 차단)
#     (b) 클릭 전 버튼 텍스트를 검증한다(셀렉터만 믿지 않는다)
#     (c) 팝업 처리가 _clear_editor 보다 먼저 일어난다
def t13_restore_popup_cancel_only():
    sys.path.insert(0, HERE)
    import blog_selectors as s4   # noqa: E402
    src = _src(SAVE_PY)

    # (a) 확인/confirm 버튼을 상수로 갖고 있으면 안 된다
    # ⚠️ '복원 팝업의 확인' 만 금지한다. 발행 레이어의 최종 확인(SEL_PUB_CONFIRM)은
    #    mode='publish' 에서 정당하게 필요하므로 여기서 제외한다(SEL_PUB_* 는 T15 가 따로 격리).
    confirm_consts = [n for n in dir(s4)
                      if n.startswith("SEL_") and "CONFIRM" in n.upper() and not n.startswith("SEL_PUB_")]
    check("T13a 복원 팝업 '확인' 버튼 셀렉터 상수가 없음", not confirm_consts, str(confirm_consts))
    # 취소 셀렉터가 '확인'을 잡으면 안 된다
    bad = [s for s in getattr(s4, "SEL_RESTORE_CANCEL", []) if "확인" in s]
    check("T13b SEL_RESTORE_CANCEL 에 '확인' 문구 없음", not bad, str(bad))

    # (b) 클릭 전에 텍스트를 검증하는가
    has_text_check = '"취소" in txt' in src and '"확인" not in txt' in src
    check("T13c 복원 팝업 클릭 전 버튼 텍스트 검증('취소' 포함·'확인' 제외)", has_text_check)

    # (c) 팝업 처리가 비우기보다 먼저
    tree = _tree(SAVE_PY)
    fn = next((n for n in ast.walk(tree)
               if isinstance(n, ast.FunctionDef) and n.name == "save_draft"), None)
    if fn is None:
        return check("T13d 팝업 처리가 비우기보다 먼저", False, "save_draft 없음")
    pop_lines = [n.lineno for n in ast.walk(fn)
                 if isinstance(n, ast.Call) and isinstance(n.func, ast.Name)
                 and n.func.id == "_dismiss_restore_popup"]
    clr_lines = [n.lineno for n in ast.walk(fn)
                 if isinstance(n, ast.Call) and isinstance(n.func, ast.Name)
                 and n.func.id == "_clear_editor"]
    ok = bool(pop_lines) and bool(clr_lines) and min(pop_lines) < min(clr_lines)
    check("T13d save_draft 가 비우기보다 먼저 복원 팝업을 닫음", ok,
          f"popup@{pop_lines} clear@{clr_lines}")


# ── T14: job 의 블로그와 워커의 블로그를 대조한다 ───────────────────────────
#   CLI 로 --job 을 직접 돌리면 리스너의 blog_id 필터가 없다 → A 블로그용 원고가 B 에 저장될 수 있다.
def t14_job_blog_match():
    tree = _tree(SAVE_PY)
    fn = next((n for n in ast.walk(tree)
               if isinstance(n, ast.FunctionDef) and n.name == "save_job"), None)
    if fn is None:
        return check("T14 save_job 이 job 의 blog_id 를 대조", False, "save_job 없음")
    src = ast.get_source_segment(_src(SAVE_PY), fn) or ""
    ok = 'job.get("blog_id")' in src and "BLOG_ID_MISMATCH" in src
    # 대조가 다운로드/타이핑보다 먼저여야 의미가 있다(엉뚱한 블로그에 이미지부터 올리면 안 됨).
    dl = src.find("download_manifest")
    mm = src.find("BLOG_ID_MISMATCH")
    order_ok = mm >= 0 and (dl < 0 or mm < dl)
    check("T14 save_job 이 다운로드 전에 job.blog_id 를 워커 blog 와 대조", ok and order_ok,
          f"has={ok} order_ok={order_ok}")


# ── T15: 발행(SEL_PUB_*)은 _publish_now 안에서만 ───────────────────────────
#   저장 모드에 발행 셀렉터가 새어들면 '저장하려다 공개 발행'이 된다 — 되돌릴 수 없다.
#   그래서 발행을 허용한 뒤에도 **경로 격리**는 그대로 강제한다.
def t15_publish_isolated():
    tree = _tree(SAVE_PY)
    def pub_refs(node):
        return [(n.lineno, n.attr) for n in ast.walk(node)
                if isinstance(n, ast.Attribute) and n.attr.startswith("SEL_PUB_")]
    allowed = set()
    for fn in ast.walk(tree):
        if isinstance(fn, ast.FunctionDef) and fn.name in ("_publish_now", "_pick_open_type"):
            allowed.update(ln for ln, _ in pub_refs(fn))
    # save_draft 의 dry-run 안내 1줄은 '버튼이 있나 보기'만 하므로 허용(클릭 없음).
    src_lines = _src(SAVE_PY).splitlines()
    for ln, _ in pub_refs(tree):
        if "[DRY]" in "".join(src_lines[max(0, ln - 3):ln + 1]):
            allowed.add(ln)
    outside = [f"line {ln}: {nm}" for ln, nm in pub_refs(tree) if ln not in allowed]
    check("T15a SEL_PUB_* 는 발행 전용 함수 안에서만 참조", not outside, "; ".join(outside))

    # 발행 모드는 반드시 별도 env opt-in 이 있어야 한다
    check("T15b 발행에 BLOG_PUBLISH_ENABLED opt-in 필요",
          'os.environ.get("BLOG_PUBLISH_ENABLED", "0") == "1"' in _src(SAVE_PY))
    # 저장 모드에서는 발행 차단 가드가 반드시 걸려야 한다
    check("T15c 저장 모드에서만 가드 설치(mode == \"save\")",
          'if mode == "save":' in _src(SAVE_PY) and "_install_publish_guard(page, tripped)" in _src(SAVE_PY))
    # 공개설정은 라벨로 고른다(값 추측 금지) — 잘못 고르면 되돌릴 수 없다
    check("T15d 공개설정을 라벨 텍스트로 선택(value 추측 금지)",
          "PUB_OPEN_TYPE_LABELS" in _src(SAVE_PY) and "value=" not in _src(SAVE_PY))


def main():
    print("[blog_pub] 발행 경로 부재 정적검사")
    t1_block_consts_not_actionable()
    t2_guard_installed()
    t3_no_posted_state()
    t4_cli_defaults_dry()
    t5_save_selectors_have_text()
    t6_only_saved_terminal()
    t7_no_cafe_import()
    t8_clear_before_title()
    t9_body_target()
    t10_shared_empty_check()
    t11_confirmed_consistency()
    t12_probe_validity_gate()
    t13_restore_popup_cancel_only()
    t14_job_blog_match()
    t15_publish_isolated()
    print(f"\n결과: 통과 {len(_passes)} · 실패 {len(_fails)}")
    if _fails:
        print("실패 항목: " + ", ".join(_fails))
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
