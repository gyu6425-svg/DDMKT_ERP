# DDMKT 카카오 자동검색 헬퍼
#   웹 '발송'이 ddmkt-kakao://send?c=<업체명>&m=<메시지> 를 열면 Windows가 이 스크립트를 실행한다.
#   동작: 카카오톡 PC '보이는 메인 창' 활성화 → 검색(돋보기🔍) 클릭 → 업체명 자동 입력 → 메시지를 클립보드에 준비.
#         사용자는 뜬 채팅방 클릭 → Ctrl+V → Enter 로 직접 전송. (자동 대량발송 아님 = 안전)
import sys, os, time, json, ctypes, urllib.parse
import ctypes.wintypes as wt

HERE = os.path.dirname(os.path.abspath(__file__))
CFG = os.path.join(HERE, "kakao_config.json")
u32 = ctypes.windll.user32
k32 = ctypes.windll.kernel32
u32.FindWindowW.restype = wt.HWND
u32.GetWindowRect.argtypes = [wt.HWND, ctypes.POINTER(wt.RECT)]

WNDENUMPROC = ctypes.WINFUNCTYPE(ctypes.c_bool, wt.HWND, wt.LPARAM)


def _title(hwnd):
    n = u32.GetWindowTextLengthW(hwnd)
    buf = ctypes.create_unicode_buffer(n + 1)
    u32.GetWindowTextW(hwnd, buf, n + 1)
    return buf.value


def find_kakao_main(require_visible=True):
    """타이틀 '카카오톡' 인 창 중 '보이고 크기가 충분한(=메인)' 창 HWND. 없으면 첫 매치."""
    found = []
    any_match = []

    def cb(hwnd, lparam):
        if _title(hwnd) == "카카오톡":
            any_match.append(hwnd)
            r = wt.RECT(); u32.GetWindowRect(hwnd, ctypes.byref(r))
            w, h = r.right - r.left, r.bottom - r.top
            vis = u32.IsWindowVisible(hwnd)
            if w > 200 and h > 300 and r.left > -10000 and (vis or not require_visible):
                found.append((hwnd, w * h))
        return True

    u32.EnumWindows(WNDENUMPROC(cb), 0)
    if found:
        found.sort(key=lambda x: -x[1])
        return found[0][0]
    return any_match[0] if any_match else 0


# ── 클립보드(Windows API, 안정적) ──
def set_clipboard(text: str):
    CF_UNICODETEXT, GMEM_MOVEABLE = 13, 0x0002
    k32.GlobalAlloc.restype = ctypes.c_void_p
    k32.GlobalLock.restype = ctypes.c_void_p
    k32.GlobalLock.argtypes = [ctypes.c_void_p]
    k32.GlobalUnlock.argtypes = [ctypes.c_void_p]
    u32.SetClipboardData.argtypes = [ctypes.c_uint, ctypes.c_void_p]
    u32.SetClipboardData.restype = ctypes.c_void_p
    data = text.encode("utf-16-le") + b"\x00\x00"
    for _ in range(5):
        if u32.OpenClipboard(0):
            break
        time.sleep(0.05)
    u32.EmptyClipboard()
    h = k32.GlobalAlloc(GMEM_MOVEABLE, len(data))
    ptr = k32.GlobalLock(h)
    ctypes.memmove(ptr, data, len(data))
    k32.GlobalUnlock(h)
    u32.SetClipboardData(CF_UNICODETEXT, h)
    u32.CloseClipboard()
    time.sleep(0.12)


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

    hwnd = find_kakao_main(require_visible=False)
    if not hwnd:
        set_clipboard(msg)
        u32.MessageBoxW(0, "카카오톡 PC가 실행돼 있지 않습니다.\n카톡을 먼저 켜주세요.", "DDMKT 카톡 자동검색", 0)
        return

    # 카톡 창 활성화(트레이 최소화 포함)
    u32.ShowWindow(hwnd, 5)  # SW_SHOW
    u32.ShowWindow(hwnd, 9)  # SW_RESTORE
    u32.BringWindowToTop(hwnd)
    u32.SetForegroundWindow(hwnd)
    time.sleep(0.5)

    # 복원된 뒤의 '보이는 메인 창' 좌표를 다시 잡는다.
    hwnd = find_kakao_main(require_visible=True) or hwnd
    rc = wt.RECT(); u32.GetWindowRect(hwnd, ctypes.byref(rc))
    try:
        cfg = json.load(open(CFG, encoding="utf-8"))
    except Exception:
        cfg = {}
    # 검색(돋보기🔍)은 창 '우상단'에 있음 → 우상단 모서리에서의 오프셋으로 위치 계산(창 이동에 강함).
    sx = rc.right - cfg.get("search_right_off", 60)
    sy = rc.top + cfg.get("search_top_off", 50)

    _click(sx, sy)
    time.sleep(0.4)
    _ctrl(VK_A); _tap(VK_DEL)
    set_clipboard(company)
    _ctrl(VK_V)
    time.sleep(0.5)

    # 검색 결과가 뜬 상태에서 멈춤. 메시지를 클립보드에 준비 → 사용자가 방 클릭 후 Ctrl+V + Enter.
    set_clipboard(msg)


if __name__ == "__main__":
    main()
