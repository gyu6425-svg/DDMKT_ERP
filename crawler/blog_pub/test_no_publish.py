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
_GUARD_FUNCS = {"_install_publish_guard", "_is_blocked_url", "_assert_not_published"}


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
    for p in (SAVE_PY, LISTENER_PY):
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
    check("T3 코드에 'posted' 상태 문자열 없음(카페 상태값 오염 방지)", not bad, "; ".join(bad))


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
    allowed = {"pending", "processing", "saved", "fail"}
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


def main():
    print("[blog_pub] 발행 경로 부재 정적검사")
    t1_block_consts_not_actionable()
    t2_guard_installed()
    t3_no_posted_state()
    t4_cli_defaults_dry()
    t5_save_selectors_have_text()
    t6_only_saved_terminal()
    t7_no_cafe_import()
    print(f"\n결과: 통과 {len(_passes)} · 실패 {len(_fails)}")
    if _fails:
        print("실패 항목: " + ", ".join(_fails))
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
