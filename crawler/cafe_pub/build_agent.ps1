# DDMKT 카페 발행 에이전트 빌드 — PyInstaller onedir.
#   실행: powershell -ExecutionPolicy Bypass -File build_agent.ps1
#   산출: dist\DDMKT-Agent\DDMKT-Agent.exe (+ _internal\)
#   ⚠️ playwright install 하지 않는다(크로미움 attach 방식). onefile 쓰지 않는다.

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

Write-Host '[1/3] 의존성 확인/설치...' -ForegroundColor Cyan
# 런타임 4종 + PyInstaller. (playwright 브라우저는 설치하지 않음)
python -m pip install --quiet --upgrade pip
python -m pip install --quiet pyinstaller playwright requests truststore pillow
if ($LASTEXITCODE -ne 0) { throw 'pip install 실패' }

Write-Host '[2/3] 이전 산출물 정리...' -ForegroundColor Cyan
if (Test-Path build) { Remove-Item build -Recurse -Force }
if (Test-Path dist)  { Remove-Item dist  -Recurse -Force }

Write-Host '[3/3] PyInstaller onedir 빌드...' -ForegroundColor Cyan
python -m PyInstaller agent.spec --noconfirm
if ($LASTEXITCODE -ne 0) { throw 'PyInstaller 빌드 실패' }

$exe = Join-Path $PSScriptRoot 'dist\DDMKT-Agent\DDMKT-Agent.exe'
if (Test-Path $exe) {
    Write-Host "완료: $exe" -ForegroundColor Green
    Write-Host '다음: (선택) signtool 로 코드서명 → Inno Setup(installer.iss) 로 설치본 생성.' -ForegroundColor Yellow
} else {
    throw "산출 exe 없음: $exe"
}
