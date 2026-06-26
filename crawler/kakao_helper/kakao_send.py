# DDMKT 카카오 자동검색 헬퍼
#   웹 '발송' 버튼이 ddmkt-kakao://send?c=<업체명>&m=<메시지> 를 열면 Windows가 이 스크립트를 실행한다.
#   동작: 카카오톡 PC 활성화 → 검색창에 업체명 자동 입력(검색까지 자동) → 메시지를 클립보드에 준비.
#         사용자는 뜬 채팅방을 클릭 → Ctrl+V → Enter 로 직접 전송. (자동 대량발송 아님 = 안전)
import sys, os, time, json, ctypes, urllib.parse
import ctypes.wintypes as wt

HERE = os.path.dirname(os.path.abspath(__file__))
CFG = os.path.join(HERE, "kakao_config.json")
u32 = ctypes.windll.user32
u32.FindWindowW.restype = wt.HWND
u32.GetWindowRect.argtypes = [wt.HWND, ctypes.POINTER(wt.RECT)]


def set_clipboard(text):
    import tkinter
    r = tkinter.Tk(); r.withdraw()
    r.clipboard_clear(); r.clipboard_append(text); r.update()
    time.sleep(0.15); r.destroy()


VK_CTRL, VK_V, VK_A, VK_DEL = 0x11, 0x56, 0x41, 0x2E
def _key(vk, up=False): u32.keybd_event(vk, 0, 2 if up else 0, 0)
def _tap(vk): _key(vk); time.sleep(0.03); _key(vk, True); time.sleep(0.05)
def _ctrl(vk): _key(VK_CTRL); time.sleep(0.02); _tap(vk); _key(VK_CTRL, True); time.sleep(0.06)


def _click(x, y):
    u32.SetCursorPos(int(x), int(y)); time.sleep(0.12)
    u32.mouse_event(0x0002, 0, 0, 0, 0); time.sleep(0.04); u32.mouse_event(0x0004, 0, 0, 0, 0)
    time.sleep(0.12)


def main():
    if len(sys.argv) < 2:
        return
    p = urllib.parse.parse_qs(urllib.parse.urlparse(sys.argv[1]).query)
    company = (p.get("c") or [""])[0].strip()
    msg = (p.get("m") or [""])[0]
    if not company:
        return

    hwnd = u32.FindWindowW(None, "카카오톡")
    if not hwnd:
        u32.MessageBoxW(0, "카카오톡 PC가 실행돼 있지 않습니다.\n카톡을 먼저 켜주세요.", "DDMKT 카톡 자동검색", 0)
        # 카톡이 없어도 메시지는 클립보드에 넣어둔다(직접 붙여넣기 대비)
        set_clipboard(msg)
        return

    # 카톡 창 활성화
    u32.ShowWindow(hwnd, 9)  # SW_RESTORE
    u32.SetForegroundWindow(hwnd)
    time.sleep(0.35)

    rc = wt.RECT(); u32.GetWindowRect(hwnd, ctypes.byref(rc))
    try:
        cfg = json.load(open(CFG, encoding="utf-8"))
    except Exception:
        cfg = {}
    sx = rc.left + int((rc.right - rc.left) * cfg.get("search_x_ratio", 0.5))
    sy = rc.top + cfg.get("search_y_off", 95)

    # 검색창 클릭 → 기존 검색어 지우기 → 업체명 붙여넣기(검색)
    _click(sx, sy)
    _ctrl(VK_A); _tap(VK_DEL)
    set_clipboard(company); _ctrl(VK_V)
    time.sleep(0.5)

    # 검색 결과가 뜬 상태에서 멈춤. 메시지를 클립보드에 준비 → 사용자가 방 클릭 후 Ctrl+V + Enter.
    set_clipboard(msg)


if __name__ == "__main__":
    main()
