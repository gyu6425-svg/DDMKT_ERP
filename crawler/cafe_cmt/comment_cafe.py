# -*- coding: utf-8 -*-
"""
네이버 카페 댓글 자동작성 — 핵심 엔진 (CDP 접속). cafe_pub/publish_cafe.py 구조를 '복사'해 자립.

[왜 복사인가] main 이 publish_cafe.py 를 자주 리팩터링한다(순위/발행 개선). cross-import 하면
  병합은 깨끗해도 런타임이 조용히 깨진다 → 이 파일은 publish_cafe 를 import 하지 않고 독립.
  (docs/MERGE-SAFETY.md 참고)

[왜 CDP 접속인가] Playwright가 띄운 크롬은 자동화 감지 → 캡차/2FA 반복.
  사람이 run_chrome_login.bat 로 1회 로그인(세션은 chrome_profile/), 이 스크립트는 CDP로 붙어서 조종.

[준비]
  1) run_chrome_login.bat → 네이버 로그인(최초 1회). ★발행(9223)과 별도 프로필/포트(9224).
  2) 평소: run_chrome.bat(헤드리스, 포트 9224) 실행 → 이 스크립트가 CDP로 접속.
  3) ../.env 의 SUPABASE_* 재사용. cafe_cmt/.env 에 댓글 설정(CAFE_CMT_*).

[사용]
  python comment_cafe.py --diag --url <글주소>       # 댓글창 구조 덤프(셀렉터 확정용)
  python comment_cafe.py --job <id> --no-send        # 큐 1건: 댓글 입력만(등록 직전까지)
  python comment_cafe.py --job <id>                  # 등록까지
  옵션: --cdp http://127.0.0.1:9224

⚠️ 댓글창 셀렉터(SEL_CMT_*)는 카페 UI 버전에 따라 다르다. 최초 1회 --diag 로 확정한 뒤 커밋.
"""
import argparse
import ctypes
import os
import re
import sys
import time
import json
import pathlib
import requests
from urllib.parse import unquote

from playwright.sync_api import sync_playwright

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass
requests.packages.urllib3.disable_warnings()

import accounts as acct

HERE = os.path.dirname(os.path.abspath(__file__))
# 기본(첫 번째) 계정의 CDP. 멀티계정은 accounts.txt 참조 — acct.cdp_for(<계정명>).
DEFAULT_CDP = acct.cdp_for(None)         # 기본 9224 (발행 9223·카카오 9222와 분리)


# ── 환경(../.env SUPABASE + cafe_cmt/.env CAFE_CMT_*) ──
def _load_env():
    for p in [os.path.join(HERE, ".env"), os.path.join(HERE, "..", ".env")]:
        try:
            for line in pathlib.Path(p).read_text(encoding="utf-8", errors="ignore").splitlines():
                m = re.match(r'^([A-Z_]+)\s*=\s*"?([^"\n\r]+)"?', line)
                if m and m.group(1) not in os.environ:
                    os.environ[m.group(1)] = m.group(2).strip()
        except Exception:
            pass
_load_env()
SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")
# ⚠️ _load_env() 뒤에서 읽어야 cafe_cmt/.env 설정이 반영된다(독립검증 m7).
#   account=계정별 1회 허용(여러 계정이 같은 글에 각각 1개) / global=글당 1개만.
DEDUP_SCOPE = os.environ.get("CAFE_CMT_DEDUP_SCOPE", "account").strip().lower()

# ── 셀렉터 (✅ 확정: 2026-07-16 ddmkt2 / cafe.naver.com/ca-fe 새 UI, --diag 로 확인) ──
#   댓글창=textarea.comment_inbox_text, 등록=a.button.btn_register (댓글 iframe 안). 나머지는 폴백.
SEL_CMT_BOX = [
    'textarea.comment_inbox_text',
    'textarea[placeholder*="댓글"]',
    '.CommentWriter textarea',
    '.comment_inbox textarea',
    '[contenteditable="true"][data-log*="comment"]',
]
SEL_CMT_SUBMIT = [
    'a.button.btn_register',
    'button.btn_register',
    'a:has-text("등록")',
    'button:has-text("등록")',
]
# ── 대댓글(답글) 셀렉터 (✅ 확정: 2026-07-20 ddmkt2) ──
#   댓글 항목마다 "답글쓰기"(a.comment_info_button)가 있고, 누르면 그 댓글 아래에
#   답글용 입력창/등록버튼이 '추가로' 생긴다 — 클래스는 댓글용과 동일하다.
#   그래서 답글은 "새로 늘어난 마지막 것"을 써야 한다(첫 번째는 일반 댓글창).
SEL_REPLY_OPEN = 'a.comment_info_button'


def _log(m):
    print(f"[cafe_cmt] {m}", flush=True)


def _headers():
    return {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}", "Content-Type": "application/json"}


def sb_get(path, params=None):
    r = requests.get(f"{SUPABASE_URL}/rest/v1/{path}", headers=_headers(), params=params, timeout=30, verify=False)
    r.raise_for_status()
    return r.json()


def sb_patch(path, params, payload, tries=4):
    """상태 기록. ⚠️ 예전엔 오류를 통째로 삼켜서(raise_for_status 없음) 게시 성공 후
    done 표시가 실패하면 작업이 pending 으로 남아 **같은 댓글이 두 번 게시**됐다.
    짧게 재시도하고, 그래도 안 되면 예외를 올려 호출부가 알게 한다."""
    last = None
    for i in range(tries):
        try:
            r = requests.patch(f"{SUPABASE_URL}/rest/v1/{path}", headers={**_headers(), "Prefer": "return=minimal"},
                               params=params, data=json.dumps(payload), timeout=30, verify=False)
            r.raise_for_status()
            return r
        except Exception as e:
            last = e
            time.sleep(1.5 * (i + 1))
    raise RuntimeError(f"SB_PATCH_FAILED: {str(last)[:150]}")


def sb_insert(path, payload):
    r = requests.post(f"{SUPABASE_URL}/rest/v1/{path}", headers={**_headers(), "Prefer": "return=minimal"},
                      data=json.dumps(payload), timeout=30, verify=False)
    r.raise_for_status()
    return r


def article_key(url):
    """글 식별 키 = 카페 글 번호(articleid/…/articles/N). URL 형식(구주소·iframe·ca-fe)이 달라도
    같은 글이면 같은 키가 나오도록 정규화. 중복 댓글 방지에 사용."""
    u = url or ""
    for _ in range(2):   # iframe_url_utf8 은 이중 인코딩 → 두 번 디코드
        u = unquote(u)
    m = (re.search(r'articleid=(\d+)', u)
         or re.search(r'/articles/(\d+)', u)
         # 단축형 cafe.naver.com/<카페명>/<글번호> (ca-fe/cafes 경로는 위에서 이미 처리)
         or re.search(r'cafe\.naver\.com/[^/?#]+/(\d+)(?:[/?#]|$)', u))
    return m.group(1) if m else (url or "").strip()


def club_id(url):
    """URL 에서 카페 식별자(clubid 숫자, 없으면 카페 영문명)."""
    u = url or ""
    m = re.search(r'clubid=(\d+)', u)
    if m:
        return m.group(1)
    m = re.search(r'cafe\.naver\.com/([^/?#]+)', u)
    return m.group(1) if m else ""


def article_uid(url):
    """카페까지 구분하는 글 고유키 = '카페:글번호'.
    ⚠️ article_key(글번호만)는 카페가 달라도 번호가 같으면 충돌한다(ddnusu#2 vs thebanclean#2).
       중복 판정·글별 그룹핑은 이 uid 로 해야 다른 카페의 같은 번호 글을 안 섞는다."""
    return f"{club_id(url)}:{article_key(url)}"


def already_commented(url, exclude_id=None, account=None):
    """이 글에 이미 (완료/처리중) 댓글 잡이 있으면 True — 중복 댓글 방지.

    DEDUP_SCOPE=account(기본): '같은 계정'이 같은 글에 두 번 달지 못하게만 막는다
      → 계정이 여러 개면 계정마다 1개씩 달릴 수 있음(멀티계정 마케팅 용도).
    DEDUP_SCOPE=global      : 계정 불문 글당 댓글 1개만 허용.
    """
    key = article_key(url)
    if not key:
        return False
    uid = article_uid(url)   # 카페까지 구분(다른 카페의 같은 번호 글과 충돌 방지)
    params = {
        "status": "in.(done,processing)", "select": "id,article_url,account",
        "order": "created_at.desc", "limit": "500",
    }
    if DEDUP_SCOPE != "global":
        # 계정별 판정. ⚠️ 웹 수동예약은 account=null, 워처 예약은 계정명이 들어가는데
        #   둘 다 '기본 계정'이면 같은 아이디다 → null 과 기본계정명을 한 묶음으로 봐야
        #   같은 아이디가 한 글에 두 번 다는 걸 막는다(독립검증 M5).
        canon = acct.canonical_name(account)
        if canon and canon == acct.default_account()["name"]:
            params["or"] = f"(account.is.null,account.eq.{canon})"
        elif canon:
            params["account"] = f"eq.{canon}"
        else:
            params["account"] = "is.null"
    try:
        rows = sb_get("cafe_comment_queue", params)
    except Exception as e:
        # ⚠️ 조회 실패를 '중복 없음'으로 취급하면 마이그레이션 전에 중복 댓글이 쏟아진다.
        #   호출부가 판단하도록 올린다(독립검증 M2).
        raise RuntimeError(f"DEDUP_QUERY_FAILED: {str(e)[:120]}")
    for r in rows:
        if exclude_id and r.get("id") == exclude_id:
            continue
        if article_uid(r.get("article_url", "")) == uid:
            return True
    return False


def _focus_naver_window():
    """디버깅 크롬 창을 맨 앞으로(에디터/입력 안정). cafe_pub 와 동일 트릭."""
    try:
        u = ctypes.windll.user32
        targets = []
        EP = ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_void_p, ctypes.c_void_p)

        def cb(h, _l):
            if u.IsWindowVisible(h):
                n = u.GetWindowTextLengthW(h)
                if n:
                    buf = ctypes.create_unicode_buffer(n + 1)
                    u.GetWindowTextW(h, buf, n + 1)
                    if ("네이버" in buf.value) or ("카페" in buf.value) or ("NAVER" in buf.value):
                        targets.append(h)
            return True

        u.EnumWindows(EP(cb), 0)
        if not targets:
            return False
        h = targets[0]
        u.keybd_event(0x12, 0, 0, 0); u.keybd_event(0x12, 0, 2, 0)
        fg = u.GetForegroundWindow()
        t1 = u.GetWindowThreadProcessId(fg, 0); t2 = u.GetWindowThreadProcessId(h, 0)
        u.AttachThreadInput(t1, t2, True)
        u.ShowWindow(h, 9); u.BringWindowToTop(h); u.SetForegroundWindow(h)
        u.AttachThreadInput(t1, t2, False)
        return True
    except Exception:
        return False


def _box_text(box):
    """댓글창 현재 텍스트를 타입 안전하게 읽는다. <textarea/input> → input_value,
    contenteditable → inner_text. 둘 다 못 읽으면 None(=확인 불가, 성공으로 오판 금지)."""
    try:
        return box.input_value()
    except Exception:
        pass
    try:
        return box.inner_text()
    except Exception:
        return None


def _posted_check(scope, box, body):
    """등록 확인이 애매할 때 '정말 안 달렸는지'를 목록 본문으로 재확인.

    ⚠️ 이게 없으면: 등록은 됐는데 확인만 실패 → 리스너가 재시도 대상으로 보고 다시 게시 →
       **같은 댓글/답글이 최대 5번 달린다**(답글은 중복판정도 건너뛰므로 특히 위험).
       입력창(box)에 남아있는 글자는 제외해야 오판하지 않는다."""
    k = (body or "").strip()[:24]
    if len(k) < 6:
        return False
    try:
        return bool(scope.evaluate("""([k, box]) => {
          const els = [...document.querySelectorAll('.comment_text_view, .text_comment, li')];
          return els.some(e => (!box || !e.contains(box)) && (e.innerText || '').includes(k));
        }""", [k, box]))
    except Exception:
        return False   # 확인 자체가 안 되면 '안 달렸다'고 단정하지 않고 호출부가 판단


def _connect(p, cdp_url):
    # timeout 을 짧게(기본 180초 → 20초). 크롬이 좀비(포트는 열렸는데 CDP 무응답)면
    #   기본값으로는 180초씩 멈춰 데몬 전체가 마비된다(2026-07-22 실제 사고). 빨리 실패시켜
    #   재시도 대상으로 돌리고, 워치독이 크롬을 되살리게 한다.
    browser = p.chromium.connect_over_cdp(cdp_url, timeout=20000)
    ctx = browser.contexts[0] if browser.contexts else browser.new_context()
    # 도우미 프로세스가 잠깐 여는 탭은 작업 탭으로 오인·선택하지 않는다.
    #   keep_alive.py → #keepalive, watch_new_posts.py → #watch.
    #   watch 마커는 필터에 빠져 있어서, 워처가 스크랩 중인 탭을 리스너가 가로채
    #   Target closed 가 나는 경로가 남아 있었다.
    def _helper(u):
        u = u or ""
        return ("keepalive" in u) or ("#watch" in u) or ("watch=1" in u)

    pages = [pg for pg in ctx.pages if "naver.com" in (pg.url or "") and not _helper(pg.url)]
    # ⚠️ 폴백으로 ctx.pages[0] 을 쓰면, 부팅 직후처럼 도우미 탭밖에 없을 때 방금 걸러낸 그 탭을
    #    도로 집어 워처가 스크랩 중인 페이지를 goto 로 덮어쓴다(→ Target closed). 새 탭을 연다.
    page = pages[0] if pages else ctx.new_page()
    try:
        page.bring_to_front()
    except Exception:
        pass
    return page


def _find_in_frames(page, selectors, timeout=4000):
    """댓글창은 iframe(cafe_main) 안에 있을 수 있음 → 모든 프레임에서 후보 셀렉터를 탐색.
    (프레임, 로케이터) 반환. 없으면 (None, None)."""
    deadline = time.time() + timeout / 1000.0
    while time.time() < deadline:
        for fr in page.frames:
            for s in selectors:
                try:
                    loc = fr.locator(s).first
                    if loc.count() and loc.is_visible():
                        return fr, loc
                except Exception:
                    continue
        page.wait_for_timeout(300)
    return None, None


def _goto_article(page, url):
    page.goto(url, wait_until="domcontentloaded")
    page.wait_for_timeout(2500)
    cur = page.url or ""
    if re.search(r"nid\.naver\.com|nidlogin", cur):
        raise RuntimeError("LOGIN_REQUIRED: 네이버 로그인 필요 — 크롬 9224 에서 로그인하세요")
    # 삭제/비공개 글: 그 글 주소로 갔는데 글번호가 사라지고 카페 홈으로 튕기면 = 글 없음.
    #   댓글창이 없어 '입력창 못 찾음'으로 5번 재시도하던 걸(삭제된 #54 실측) 즉시 포기시킨다.
    #   정상 글은 최종 URL 에 글번호가 남아(article_key 일치) 오탐 없음(실측: #55 유지 / #54 홈).
    aid = article_key(url)
    if aid and aid.isdigit() and article_key(cur) != aid:
        raise RuntimeError(f"글 없음(삭제/비공개): #{aid} — 재시도 안 함")


def diag(page, url):
    """대상 글의 댓글 영역 구조 덤프 — 셀렉터 확정용."""
    if url:
        _goto_article(page, url)
    _log(f"URL: {page.url}")
    _log(f"frame 수: {len(page.frames)}")
    for f in page.frames:
        _log(f"  frame: {(f.url or '')[:90]}")
    js = """() => {
      const pick = (sel) => [...document.querySelectorAll(sel)].slice(0,10).map(e=>({t:e.tagName,c:(e.className||'').toString().slice(0,60),ph:e.getAttribute('placeholder')||'',txt:(e.innerText||'').slice(0,16)}));
      return { textareas: pick('textarea'), buttons: pick('button,a[role=button],a.button'), editable: pick('[contenteditable=true]') };
    }"""
    for fr in page.frames:
        try:
            info = fr.evaluate(js)
            if info["textareas"] or info["editable"]:
                _log(f"[frame {(fr.url or '')[:50]}] textarea: " + json.dumps(info["textareas"], ensure_ascii=False))
                _log(f"[frame {(fr.url or '')[:50]}] 등록버튼후보: " + json.dumps([b for b in info["buttons"] if "등록" in (b.get("txt") or "")], ensure_ascii=False))
        except Exception:
            continue


def write_comment(page, url, body, no_send=False):
    """대상 글로 이동 → 댓글창에 body 입력 → (등록). posted_url 또는 예외."""
    _goto_article(page, url)
    _focus_naver_window()
    fr, box = _find_in_frames(page, SEL_CMT_BOX, timeout=6000)
    if not box:
        raise RuntimeError("댓글 입력창 못 찾음 — --diag 로 SEL_CMT_BOX 확정 필요")
    try:
        box.scroll_into_view_if_needed()
    except Exception:
        pass
    box.click()
    page.wait_for_timeout(200)
    # textarea 는 fill, contenteditable 은 type 로 입력
    try:
        box.fill(body)
    except Exception:
        page.keyboard.type(body)
    page.wait_for_timeout(300)
    if no_send:
        _log("no_send: 댓글 입력만 완료(사람이 '등록' 클릭).")
        return None
    # 등록 버튼(같은 프레임 우선 → 페이지 전체)
    sub = None
    for s in SEL_CMT_SUBMIT:
        try:
            loc = (fr or page).locator(s).first
            if loc.count() and loc.is_visible():
                sub = loc; break
        except Exception:
            continue
    if not sub:
        _, sub = _find_in_frames(page, SEL_CMT_SUBMIT, timeout=3000)
    if not sub:
        raise RuntimeError("댓글 등록 버튼 못 찾음 — --diag 로 SEL_CMT_SUBMIT 확정 필요")
    alerts = []
    page.on("dialog", lambda d: (alerts.append(d.message), d.dismiss()))
    sub.click()
    # 검증: 등록 성공 시 입력창이 '비워진다'. 단 입력했던 내용이 실제로 사라진 것만 성공으로 인정.
    #   input_value()/inner_text() 를 못 읽으면(contenteditable·detach) None → 성공으로 오판하지 않고 계속 대기.
    #   (오판 성공은 '등록 안 됐는데 완료 처리'라 오판 실패보다 위험 → 확인 불가는 성공으로 치지 않음)
    confirmed = False
    for _ in range(30):          # 8초 -> 12초 (느린 응답에서 정상 게시가 실패로 오판되던 문제)
        page.wait_for_timeout(400)
        # 등록되면 입력창이 비워지거나, 폼/요소가 DOM 에서 떨어져 나간다.
        #   답글 경로엔 이 처리가 있는데 댓글 경로엔 없어서, 실제로 달린 댓글이
        #   '등록 미확정' 으로 영구 실패 처리된 적이 있다.
        try:
            if not box.is_visible():
                confirmed = True
                break
        except Exception:
            confirmed = True     # 요소 자체가 사라짐 = 등록됨
            break
        cur = _box_text(box)
        if cur is not None and cur.strip() == "":
            confirmed = True
            break
    if confirmed:
        return page.url
    # 확인 실패 = '안 달렸다'가 아니다. 목록에 실제로 올라왔는지 보고, 올라왔으면 성공 처리한다.
    if _posted_check(fr or page, box, body):
        _log("등록 확인은 실패했지만 목록에 반영됨 — 성공 처리(중복 게시 방지).")
        return page.url
    if alerts:
        # 도배 방지·권한 없음 같은 알림은 재시도해봐야 계속 막히고 계정만 위험해진다.
        #   → 재시도 목록에 안 걸리는 문구로 올려 영구 실패시킨다.
        raise RuntimeError(f"네이버 알림으로 등록 거부(재시도 안 함): {alerts[-1]}")
    raise RuntimeError("댓글 등록 확인 실패 (등록 미확정 — 입력창 비워짐 확인 불가)")


def write_reply(page, url, target_body, body, no_send=False):
    """대댓글 — target_body(우리가 단 댓글 문구)를 가진 댓글을 찾아 '답글쓰기' 후 작성.

    답글창은 댓글창과 클래스가 같고 클릭 시 '추가로' 생기므로, 클릭 전후 개수를 비교해
    새로 생긴 마지막 입력창/등록버튼을 쓴다(첫 번째를 쓰면 일반 댓글이 달려버린다).
    """
    _goto_article(page, url)
    _focus_naver_window()

    # 댓글 목록이 있는 프레임 찾기
    fr = None
    for f in page.frames:
        try:
            if f.locator(SEL_REPLY_OPEN).count() > 0:
                fr = f
                break
        except Exception:
            continue
    if not fr:
        raise RuntimeError("답글쓰기 버튼 못 찾음 — 댓글이 없거나 셀렉터 변경")

    # 대상 댓글 찾기: 그 댓글 문구를 포함한 항목의 '답글쓰기' 클릭
    key = (target_body or "").strip()[:20]
    if not key:
        raise RuntimeError("답글 대상(reply_to_body) 없음")
    idx = fr.evaluate("""(k) => {
      const btns = [...document.querySelectorAll('a.comment_info_button')];
      for (let i = 0; i < btns.length; i++) {
        const li = btns[i].closest('li') || btns[i].parentElement;
        if (li && (li.innerText || '').includes(k)) return i;
      }
      return -1;
    }""", key)
    if idx < 0:
        raise RuntimeError(f"대상 댓글 못 찾음(삭제됐거나 아직 미반영): '{key[:16]}'")

    before_box = fr.locator('textarea.comment_inbox_text').count()
    fr.locator(SEL_REPLY_OPEN).nth(idx).click()
    page.wait_for_timeout(1200)
    if fr.locator('textarea.comment_inbox_text').count() <= before_box:
        raise RuntimeError("답글 입력창이 열리지 않음")

    # ⚠️ 답글창은 댓글창과 클래스가 같다. DOM 마지막(.last)은 페이지 하단의 '메인 댓글창'이라
    #   그걸 쓰면 답글이 아니라 일반 댓글로 달린다(실제로 그렇게 잘못 달린 적 있음).
    #   → 반드시 '그 댓글 항목(li) 안에 새로 생긴' 입력창을 써야 한다.
    box = fr.evaluate_handle("""(k) => {
      const btns = [...document.querySelectorAll('a.comment_info_button')];
      for (const b of btns) {
        const li = b.closest('li');
        if (!li || !(li.innerText || '').includes(k)) continue;
        // 그 댓글 항목 안, 없으면 바로 다음 형제(답글 폼이 형제로 붙는 스킨 대비)
        let t = li.querySelector('textarea.comment_inbox_text');
        if (!t && li.nextElementSibling) t = li.nextElementSibling.querySelector('textarea.comment_inbox_text');
        if (t) return t;
      }
      return null;
    }""", key)
    if not box or not box.as_element():
        raise RuntimeError("답글 입력창을 대상 댓글 안에서 못 찾음(구조 변경?)")
    box = box.as_element()
    box.scroll_into_view_if_needed()
    box.click()
    page.wait_for_timeout(200)
    try:
        box.fill(body)
    except Exception:
        page.keyboard.type(body)
    page.wait_for_timeout(300)
    if no_send:
        _log("no_send: 답글 입력만 완료(사람이 '등록' 클릭).")
        return None

    # 등록 버튼도 같은 답글 폼 안에서 찾는다(메인 댓글창 등록버튼을 누르면 안 됨).
    btn = fr.evaluate_handle("""(k) => {
      const btns = [...document.querySelectorAll('a.comment_info_button')];
      for (const b of btns) {
        const li = b.closest('li');
        if (!li || !(li.innerText || '').includes(k)) continue;
        let r = li.querySelector('a.button.btn_register, button.btn_register');
        if (!r && li.nextElementSibling) r = li.nextElementSibling.querySelector('a.button.btn_register, button.btn_register');
        if (r) return r;
      }
      return null;
    }""", key)
    if not btn or not btn.as_element():
        raise RuntimeError("답글 등록 버튼을 대상 댓글 안에서 못 찾음")
    alerts = []
    page.on("dialog", lambda d: (alerts.append(d.message), d.dismiss()))
    btn.as_element().click()
    # 검증: 등록되면 (a) 답글 폼이 통째로 사라지거나 (b) 입력창이 비워진다.
    #   댓글과 달리 답글은 폼이 제거되는 쪽이라, 비워짐만 보면 성공인데도 실패로 오판한다
    #   (실제로 정상 게시된 답글이 '등록 미확정'으로 fail 처리된 적 있음).
    for _ in range(30):                          # 8초 -> 12초(댓글 경로와 동일하게)
        page.wait_for_timeout(400)
        try:
            gone = not box.is_visible()          # 폼이 사라짐 = 등록됨
        except Exception:
            gone = True                          # 요소 자체가 DOM 에서 떨어져 나감
        if gone:
            return page.url
        cur = _box_text(box)
        if cur is not None and cur.strip() == "":
            return page.url
    # 답글은 재시도 시 중복 판정을 건너뛰므로, 여기서 실제 게시 여부를 반드시 확인해야 한다.
    if _posted_check(fr, box, body):
        _log("등록 확인은 실패했지만 목록에 반영됨 — 성공 처리(중복 답글 방지).")
        return page.url
    if alerts:
        raise RuntimeError(f"네이버 알림으로 등록 거부(재시도 안 함): {alerts[-1]}")
    raise RuntimeError("답글 등록 확인 실패 (등록 미확정)")


def comment_job(job, cdp_url=DEFAULT_CDP, no_send=False):
    """큐 1건 처리 — 일반 댓글 또는 대댓글(reply_to_body 가 있으면). (posted_url 또는 예외)"""
    url = job.get("article_url") or ""
    body = job.get("body") or ""
    target = (job.get("reply_to_body") or "").strip()
    if not url or not body:
        raise RuntimeError("article_url/body 누락")
    kind = "답글" if target else "댓글"
    _log(f"{kind} 처리: {url[:56]} — {body[:20]}...")
    with sync_playwright() as p:
        page = _connect(p, cdp_url)
        if target:
            return write_reply(page, url, target, body, no_send=no_send)
        return write_comment(page, url, body, no_send=no_send)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--diag", action="store_true")
    ap.add_argument("--url", help="댓글 달 글 주소(diag/단건 테스트)")
    ap.add_argument("--job", help="cafe_comment_queue id")
    ap.add_argument("--no-send", action="store_true")
    ap.add_argument("--cdp", default=DEFAULT_CDP)
    args = ap.parse_args()
    if args.diag:
        with sync_playwright() as p:
            diag(_connect(p, args.cdp), args.url)
        return
    if args.job:
        rows = sb_get("cafe_comment_queue", {"id": f"eq.{args.job}", "select": "*"})
        if not rows:
            _log("해당 job 없음"); return
        out = comment_job(rows[0], args.cdp, no_send=args.no_send)
        _log(f"완료: {out or '(no_send)'}")
        return
    _log("사용: --diag --url <글주소>  |  --job <id> [--no-send]")


if __name__ == "__main__":
    main()
