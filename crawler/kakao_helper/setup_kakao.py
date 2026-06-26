# DDMKT 카카오 자동검색 — 설치/보정 스크립트
#   1) ddmkt-kakao:// 프로토콜을 현재 사용자(HKCU, 관리자 불필요)에 등록 → 웹 발송 버튼이 헬퍼를 실행할 수 있게.
#   2) 카카오톡 '검색창' 위치 보정(검색창 좌표를 창 비율로 저장).
#   실행: python setup_kakao.py   (한 번만 하면 됨)
import sys, os, time, json, winreg, ctypes
import ctypes.wintypes as wt

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, "kakao_send.py")
CFG = os.path.join(HERE, "kakao_config.json")
PYW = sys.executable.replace("python.exe", "pythonw.exe")  # 콘솔창 없이 실행


def register_protocol():
    base = r"Software\Classes\ddmkt-kakao"
    with winreg.CreateKey(winreg.HKEY_CURRENT_USER, base) as k:
        winreg.SetValueEx(k, "", 0, winreg.REG_SZ, "URL:DDMKT Kakao")
        winreg.SetValueEx(k, "URL Protocol", 0, winreg.REG_SZ, "")
    cmd = f'"{PYW}" "{SCRIPT}" "%1"'
    with winreg.CreateKey(winreg.HKEY_CURRENT_USER, base + r"\shell\open\command") as k:
        winreg.SetValueEx(k, "", 0, winreg.REG_SZ, cmd)
    print("[1/2] 프로토콜 등록 완료 →", cmd)


def calibrate_search_box():
    import kakao_send
    u32 = ctypes.windll.user32
    u32.GetWindowRect.argtypes = [wt.HWND, ctypes.POINTER(wt.RECT)]
    hwnd = kakao_send.find_kakao_main(require_visible=True)
    if not hwnd:
        print("[2/2] 보정 실패 — 카카오톡 PC '메인 창'이 화면에 보이게 켜고 다시 실행하세요(트레이 최소화 X).")
        return
    print("\n[2/2] 검색 아이콘 위치 보정")
    print("  카카오톡 창 '우상단'의 검색(돋보기 🔍) 아이콘에 마우스 커서를 올려두세요.")
    print("  (친구추가(사람+) 아이콘 아니라 '돋보기🔍' 입니다!)")
    for i in range(6, 0, -1):
        print(f"   {i}초 후 현재 마우스 위치를 검색 아이콘으로 저장합니다...", end="\r")
        time.sleep(1)
    pt = wt.POINT(); u32.GetCursorPos(ctypes.byref(pt))
    rc = wt.RECT(); u32.GetWindowRect(hwnd, ctypes.byref(rc))
    right_off = rc.right - pt.x   # 우상단 모서리에서 왼쪽으로 얼마
    top_off = pt.y - rc.top       # 위쪽 모서리에서 아래로 얼마
    if not (0 < right_off < (rc.right - rc.left) and 0 < top_off < 200):
        print(f"\n  ⚠ 커서가 카톡 창 우상단 검색칸이 아닌 것 같습니다(right_off={right_off}, top_off={top_off}).")
        print("    카톡 메인 창을 보이게 한 뒤, 돋보기🔍 위에 커서를 두고 다시 실행하세요.")
        return
    json.dump({"search_right_off": int(right_off), "search_top_off": int(top_off)}, open(CFG, "w", encoding="utf-8"))
    print(f"\n  저장됨 → 우상단 기준 오프셋: 왼쪽 {right_off}px, 아래 {top_off}px ({CFG})")


if __name__ == "__main__":
    register_protocol()
    calibrate_search_box()
    print("\n완료! 이제 웹에서 '발송'을 누르면 카톡이 켜지고 업체명으로 자동 검색됩니다.")
    print("(검색 위치가 안 맞으면 카톡 창 크기·위치 고정 후 python setup_kakao.py 다시 실행)")
