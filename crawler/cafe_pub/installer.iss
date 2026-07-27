; DDMKT 카페 발행 에이전트 설치 마법사 (Inno Setup)
;   컴파일: "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" installer.iss
;   전제: build_agent.ps1 로 dist\DDMKT-Agent\ 산출 완료.
;   설치 위치: %LOCALAPPDATA%\DDMKT-Agent  (관리자 권한 불필요)

#define AppName "DDMKT 카페 에이전트"
#define AppVer  "1.0.0"
#define AppExe  "DDMKT-Agent.exe"

[Setup]
AppName={#AppName}
AppVersion={#AppVer}
AppPublisher=DDMKT
DefaultDirName={localappdata}\DDMKT-Agent
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
; ⚠️ 코드서명: SignTool 준비되면 아래 주석 해제(SmartScreen 경고 완화).
; SignTool=signtool sign /fd sha256 /tr http://timestamp.digicert.com /td sha256 $f
OutputBaseFilename=DDMKT-Agent-Setup-{#AppVer}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
ArchitecturesInstallIn64BitMode=x64compatible

[Languages]
Name: "korean"; MessagesFile: "compiler:Languages\Korean.isl"

[Tasks]
Name: "desktopicon"; Description: "바탕화면에 바로가기 만들기"; GroupDescription: "추가 아이콘:"

[Files]
; onedir 산출물 전체(exe + _internal). 재설치 시 코드만 교체.
Source: "dist\DDMKT-Agent\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion
; 설정 견본 — 항상 최신 견본 배치.
Source: "agent.env.example"; DestDir: "{app}"; Flags: ignoreversion
; 실제 설정 — 없을 때만 견본으로 생성(업그레이드 시 고객 값 보존).
Source: "agent.env.example"; DestDir: "{app}"; DestName: "agent.env"; Flags: onlyifdoesntexist
; 설치 안내 문서(선택).
Source: "..\..\docs\고객에이전트-설치.md"; DestDir: "{app}"; DestName: "설치안내.md"; Flags: ignoreversion skipifsourcedoesntexist

[Dirs]
; 런타임 데이터 폴더(로그인 세션·자산·로그). exe 옆에 두어 CAFE_DATA_DIR 이 잡는다.
Name: "{app}\chrome_profile"
Name: "{app}\assets"
Name: "{app}\logs"

[Icons]
Name: "{autoprograms}\{#AppName}"; Filename: "{app}\{#AppExe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExe}"; Tasks: desktopicon

[Run]
; 설치 후 설정 파일 열기(고객이 값 채우게).
Filename: "notepad.exe"; Parameters: """{app}\agent.env"""; Description: "설정(agent.env) 열기"; Flags: postinstall shellexec skipifsilent

[UninstallDelete]
; chrome_profile/logs 는 남길지 지울지 정책에 따라. 기본은 로그만 정리.
Type: filesandordirs; Name: "{app}\logs"
