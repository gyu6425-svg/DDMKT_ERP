# -*- mode: python ; coding: utf-8 -*-
"""DDMKT 카페 고객 발행 에이전트 — PyInstaller onedir 스펙.
빌드: pyinstaller agent.spec --noconfirm   (crawler/cafe_pub 에서)

원칙(핸드오프 Phase3):
  · --onedir (COLLECT). ❌ onefile 금지 — temp 압축해제로 __file__/데이터 경로 가정이 깨지고 백신 오탐.
  · ❌ `playwright install` 하지 않는다 — 크로미움 번들 불필요(시스템 크롬에 CDP attach).
  · 서드파티 4개(playwright·requests·truststore·pillow)만.
  · agent.env·chrome_profile·assets·logs 는 exe 옆 데이터 폴더(런타임 생성/다운로드) — 번들 금지.
"""
from PyInstaller.utils.hooks import collect_all, collect_submodules

# playwright: 드라이버(node+패키지)까지 통째로. (크로미움은 attach 라 불필요)
pw_datas, pw_bins, pw_hidden = collect_all('playwright')

# 이름으로만 import 되는(정적 추적 안 되는) 에이전트 모듈 + 서드파티.
hidden = pw_hidden + [
    'publish_listener', 'publish_cafe', 'nusu2_api', 'sb_auth',
    'cafe_auto_publish_nusu2', 'cafe_auto_publish_ddclean',
    'requests', 'truststore',
    'PIL', 'PIL._imaging', 'PIL.Image', 'PIL.ImageEnhance', 'PIL.ImageOps',
]

a = Analysis(
    ['agent_main.py'],
    pathex=['.'],
    binaries=pw_bins,
    datas=pw_datas,
    hiddenimports=hidden,
    hookspath=[],
    runtime_hooks=[],
    # 크로미움/불필요 대형 패키지 제외(용량↓). matplotlib 등 안 씀.
    excludes=['tkinter', 'matplotlib', 'numpy.tests', 'pytest'],
    noarchive=False,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='DDMKT-Agent',
    console=True,          # 발행 로그를 콘솔에 출력(고객 지원 시 확인)
    disable_windowed_traceback=False,
    upx=False,             # UPX 압축 금지 — 백신 오탐 유발
    # icon='agent.ico',    # (선택) 아이콘 준비되면 지정
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    name='DDMKT-Agent',    # dist/DDMKT-Agent/ 폴더로 산출
)
