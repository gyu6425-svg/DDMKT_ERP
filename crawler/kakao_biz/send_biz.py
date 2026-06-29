# -*- coding: utf-8 -*-
"""
카카오 비즈니스 채팅(웹) 자동 발송 — 핵심 엔진. (CDP 접속 방식)

[왜 CDP 접속인가]
Playwright가 직접 띄운 크롬은 navigator.webdriver=true 라서 카카오가 자동화로 감지 →
로그인이 무한 반복된다. 그래서 '평범한 크롬'을 사람이 직접 띄워 로그인하고(=정상 세션),
이 스크립트는 그 크롬에 CDP(원격 디버깅)로 '붙어서' 조종한다. 카카오 눈엔 정상 크롬.

[준비 — 크롬을 디버깅 모드로 띄우기]  ※ run_chrome.bat 이 대신 해줌
  chrome.exe --remote-debugging-port=9222 --user-data-dir="<여기>/chrome_profile" "<채팅URL>"
  → 뜬 크롬에서 카카오 비즈니스에 1회 로그인(세션은 chrome_profile/ 에 유지)

[셀렉터] (2026-06-29 직접 확인, 난독화 없음)
  * 채팅방 검색칸 : input[placeholder*="채팅방 이름"]   (로그인칸도 class=tf_g 라 placeholder로 구분)
  * 메시지 입력창 : textarea[placeholder*="메시지"]
  * 전송 버튼     : button.btn_submit                    (글자 입력 전엔 .disabled)

[사용]
  python send_biz.py --diag --company "장규진"
  python send_biz.py --company "장규진" --message "테스트"
  옵션: --no-send (전송 직전까지만)  /  --cdp http://127.0.0.1:9222
"""
import argparse
import ctypes
import os
import sys
import time

from playwright.sync_api import sync_playwright

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

HERE = os.path.dirname(os.path.abspath(__file__))
CHATS_URL = "https://business.kakao.com/_bTxbXn/chats"
DEFAULT_CDP = "http://127.0.0.1:9222"

SEL_SEARCH = 'input[placeholder*="채팅방 이름"]'   # 채팅방 검색칸
SEL_MSGBOX = 'textarea.tf_g'                         # 메시지 입력창(검색칸은 input.tf_g 라 구분됨)
SEL_SEND = "button.btn_submit"                       # 전송 버튼


def _log(msg):
    print(f"[kakao_biz] {msg}", flush=True)


def _focus_kakao_window():
    """디버깅 크롬 창을 OS 차원에서 강제로 맨 앞(포그라운드)으로.
    백그라운드/뒤에 있으면 크롬이 페이지를 throttle 해서 가상리스트 클릭이 방을 안 연다.
    백그라운드 프로세스의 SetForegroundWindow 제한은 ALT키 입력 + AttachThreadInput 으로 우회."""
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
                    if "카카오비즈니스" in buf.value:  # 디버깅 크롬 창 제목(…카카오비즈니스 파트너센터)
                        targets.append(h)
            return True

        u.EnumWindows(EP(cb), 0)
        if not targets:
            return False
        h = targets[0]
        u.keybd_event(0x12, 0, 0, 0)   # ALT down (SetForegroundWindow 제한 해제 트릭)
        u.keybd_event(0x12, 0, 2, 0)   # ALT up
        fg = u.GetForegroundWindow()
        t1 = u.GetWindowThreadProcessId(fg, 0)
        t2 = u.GetWindowThreadProcessId(h, 0)
        u.AttachThreadInput(t1, t2, True)
        u.ShowWindow(h, 9)             # SW_RESTORE(최소화 해제)
        u.BringWindowToTop(h)
        u.SetForegroundWindow(h)
        u.AttachThreadInput(t1, t2, False)
        return True
    except Exception:
        return False


def _connect(p, cdp_url):
    """디버깅 모드로 떠 있는 크롬에 CDP 로 붙고, 카카오 채팅 페이지(단일·활성)를 반환."""
    browser = p.chromium.connect_over_cdp(cdp_url)
    ctx = browser.contexts[0] if browser.contexts else browser.new_context()
    kakao_pages = [pg for pg in ctx.pages if "business.kakao.com" in (pg.url or "")]
    if kakao_pages:
        page = kakao_pages[0]
        # 중복 카카오 탭은 닫는다(여러 탭이면 백그라운드 탭을 조종하게 돼 클릭이 먹지 않음 → 혼선 제거)
        for extra in kakao_pages[1:]:
            try:
                extra.close()
            except Exception:
                pass
    else:
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
    # ⚠️ 탭을 '활성(앞으로)' 상태로. 백그라운드 탭은 가상 리스트가 클릭에 반응 안 함.
    try:
        page.bring_to_front()
    except Exception:
        pass
    # 항상 채팅 목록으로 새로고침 → 직전에 방이 열린 채 남아 검색칸이 가려지는 문제 방지
    page.goto(CHATS_URL, wait_until="domcontentloaded")
    return browser, page


def _ensure_logged_in(page) -> bool:
    try:
        page.wait_for_selector(SEL_SEARCH, timeout=8000)
        return True
    except Exception:
        _log("❌ 채팅 검색칸이 없음 → 그 크롬에서 카카오 비즈니스 로그인이 필요합니다.")
        return False


def diag(company, cdp_url):
    with sync_playwright() as p:
        browser, page = _connect(p, cdp_url)
        if not _ensure_logged_in(page):
            return
        sb = page.locator(SEL_SEARCH).first
        sb.click(); sb.fill(""); sb.fill(company); page.keyboard.press("Enter")
        _log(f"검색: {company}")
        time.sleep(2.0)
        rows = page.evaluate(
            """(name) => {
                const out = [];
                for (const el of document.querySelectorAll('a, li, [role=button], button, strong, span, div')) {
                    const t = (el.innerText||'').trim();
                    if (!t || !t.includes(name) || t.length > 80) continue;
                    out.push(el.tagName + ' | cls:' + el.className + ' | txt:' + t.replace(/\\s+/g,' ').slice(0,50));
                }
                return out.slice(0, 30);
            }""",
            company,
        )
        _log("=== '%s' 포함 후보 ===" % company)
        for r in rows:
            print(r, flush=True)

        # 방을 열고 입력창/버튼 구조도 떠본다
        room = page.locator("a.link_chat").filter(has=page.get_by_text(company, exact=True))
        if room.count():
            room.first.click()
            _log("방 열기 → 입력영역 구조:")
            time.sleep(2.0)
            comp = page.evaluate(
                """() => {
                    const out = [];
                    for (const e of document.querySelectorAll('textarea,[contenteditable="true"],input')) {
                        const r = e.getBoundingClientRect();
                        out.push(e.tagName + ' | cls:' + e.className
                            + ' | ph:' + (e.placeholder||'') + ' | aria:' + (e.getAttribute('aria-label')||'')
                            + ' | vis:' + (r.width>0 && r.height>0));
                    }
                    out.push('--- 버튼 ---');
                    for (const b of document.querySelectorAll('button')) {
                        const t=(b.innerText||b.getAttribute('aria-label')||'').trim().slice(0,16);
                        if(t) out.push('"'+t+'" | cls:'+b.className);
                    }
                    return out;
                }"""
            )
            for r in comp:
                print(r, flush=True)
        browser.close()


def _open_room(page, company):
    """검색 → 방 고유 ID 추출 → 방 URL로 '직접 이동'해서 연다. 입력창(mb) locator 반환, 실패면 None.
    ⚠️ 리스트 항목 '클릭'은 방마다·창상태마다 불안정(어떤 방은 클릭해도 안 열림)하지만,
       label[for="chat-select-<채팅ID>"] 의 ID로 /chats/<ID> 에 직접 goto 하면 100% 열린다.
       이름 정확일치(exact)로 찾은 방만 대상 → 잘못된 방 발송 방지."""
    sb = page.locator(SEL_SEARCH).first
    sb.click(); sb.fill(""); sb.fill(company); page.keyboard.press("Enter")
    _log(f"검색: {company}")
    time.sleep(2.0)
    room = page.locator("a.link_chat").filter(has=page.get_by_text(company, exact=True))
    cnt = room.count()
    if cnt == 0:
        return None, "no_room"
    if cnt > 1:
        _log(f"⚠️ '{company}' 동일이름 {cnt}개 → 첫 번째")
    # 방 항목이 속한 li 의 label[for=chat-select-<ID>] 에서 채팅방 고유 ID 추출
    chat_id = room.first.evaluate(
        """el => {
            const li = el.closest('li');
            const lab = li && li.querySelector('label[for^="chat-select-"]');
            return lab ? lab.getAttribute('for').replace('chat-select-', '') : null;
        }"""
    )
    if not chat_id:
        return None, "no_id"
    page.goto(f"{CHATS_URL}/{chat_id}", wait_until="domcontentloaded")
    mb = page.locator(SEL_MSGBOX).first
    try:
        mb.wait_for(state="visible", timeout=12000)
        return mb, "ok"
    except Exception:
        # 입력창이 없으면 상담 세션 만료/완료(능동발송 불가) → 스킵
        return None, "no_msgbox"


def _send_one(page, company, message, no_send=False):
    """이미 연결된 page 로 1건 발송 + '실제 발송됐는지 검증'.
    검증 = 전송 클릭 후 입력창이 '비워졌는가'(카카오가 메시지를 수락하면 입력창을 비운다).
    검증 안 되면 재시도, 끝내 안 되면 실패로 보고(오발송/누락 방지). (ok, reason) 반환.
    reason: sent | no_room | no_msgbox | unverified | error:<...>"""
    company = (company or "").strip()
    try:
        _focus_kakao_window()
        try:
            page.bring_to_front()
        except Exception:
            pass
        page.goto(CHATS_URL, wait_until="domcontentloaded")
        page.wait_for_selector(SEL_SEARCH, timeout=15000)

        mb, why = _open_room(page, company)
        if mb is None:
            if why == "no_room":
                _log(f"❌ '{company}' 정확일치 방 없음 → 스킵(안전).")
            else:
                _log("❌ 입력창 안 뜸(상담 세션 만료/완료 추정) → 스킵.")
            return False, why
        _log("방 열기")

        if no_send:
            mb.click(); mb.fill(message)
            _log("✋ dry: 전송 직전까지(발송 안 함).")
            return True, "dry"

        # 발송 + 검증 재시도(최대 3회). 검증 = 입력창이 비워짐.
        for attempt in range(3):
            mb.click(); mb.fill(message)
            time.sleep(0.4)
            try:
                page.wait_for_selector(f"{SEL_SEND}:not(.disabled)", timeout=4000)
            except Exception:
                pass
            try:
                page.locator(SEL_SEND).first.click()
            except Exception:
                pass
            # 검증: 입력창이 비워졌는가(= 카카오가 발송 수락) — 최대 6초 폴링
            cleared = False
            for _ in range(12):
                time.sleep(0.5)
                try:
                    if (mb.input_value() or "").strip() == "":
                        cleared = True
                        break
                except Exception:
                    pass
            if cleared:
                _log("✅ 전송 + 검증완료(입력창 비워짐)")
                return True, "sent"
            _log(f"⚠️ 검증 실패(입력창 안 비워짐) → 재시도 {attempt + 1}/3")
            time.sleep(1.0)
        _log("❌ 발송 검증 실패 → 미발송으로 보고")
        return False, "unverified"
    except Exception as e:
        _log(f"오류: {e}")
        return False, f"error:{e}"
    finally:
        # 발송 후 목록 복귀(방이 열린 채 남아 다음 건이 막히는 것 방지)
        try:
            page.goto(CHATS_URL, wait_until="domcontentloaded")
        except Exception:
            pass


def send(company, message, cdp_url, no_send=False) -> bool:
    with sync_playwright() as p:
        browser, page = _connect(p, cdp_url)
        page.set_default_timeout(20000)
        try:
            if not _ensure_logged_in(page):
                return False
            ok, _ = _send_one(page, company, message, no_send)
        finally:
            browser.close()  # 연결만 종료(크롬 창은 유지)
        return ok


def send_many(items, cdp_url, no_send=False, delay=4.0):
    """여러 건을 한 연결로 발송. items: [{key, company, message}].
    반환: [{key, ok, reason}]. 발송 사이 delay 초(차단 회피)."""
    results = []
    with sync_playwright() as p:
        browser, page = _connect(p, cdp_url)
        page.set_default_timeout(20000)
        try:
            if not _ensure_logged_in(page):
                return [{"key": it.get("key"), "ok": False, "reason": "not_logged_in"} for it in items]
            for i, it in enumerate(items):
                ok, reason = _send_one(page, it.get("company"), it.get("message"), no_send)
                results.append({"key": it.get("key"), "ok": ok, "reason": reason})
                if i < len(items) - 1:
                    time.sleep(delay)
        finally:
            browser.close()
    return results


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--diag", action="store_true", help="검색 후 방 목록 구조 진단")
    ap.add_argument("--company", help="업체명(= 채팅방 이름)")
    ap.add_argument("--message", help="보낼 메시지")
    ap.add_argument("--no-send", action="store_true", help="전송 직전까지만(실제 발송 안 함)")
    ap.add_argument("--cdp", default=DEFAULT_CDP, help="크롬 원격 디버깅 주소")
    a = ap.parse_args()

    if a.diag:
        if not a.company:
            ap.error("--diag 에는 --company 필요")
        diag(a.company, a.cdp)
        return
    if not a.company or a.message is None:
        ap.error("--company 와 --message 를 주거나 --diag 를 쓰세요.")
    ok = send(a.company, a.message, a.cdp, no_send=a.no_send)
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
