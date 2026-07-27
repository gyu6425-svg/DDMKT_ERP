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
if (-not (Test-Path $exe)) { throw "산출 exe 없음: $exe" }

Write-Host '[+] 고객용 파일 동봉 + zip 패키징...' -ForegroundColor Cyan
# 더블클릭 도우미 + 사용법 + 설정 견본을 산출 폴더에 넣는다(고객은 편집·명령어 불필요).
$dst = Join-Path $PSScriptRoot 'dist\DDMKT-Agent'
Copy-Item (Join-Path $PSScriptRoot '1-로그인.bat')      $dst -Force
Copy-Item (Join-Path $PSScriptRoot '2-시작.bat')        $dst -Force
Copy-Item (Join-Path $PSScriptRoot '사용법.txt')         $dst -Force
Copy-Item (Join-Path $PSScriptRoot 'agent.env.example') $dst -Force
# 배포 zip. ⚠️ agent.env(실비번)는 넣지 않는다 — 담당자가 고객별로 채워 전달.
$zip = Join-Path $PSScriptRoot 'DDMKT-Agent.zip'
if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path (Join-Path $dst '*') -DestinationPath $zip -CompressionLevel Optimal

Write-Host "완료: $exe" -ForegroundColor Green
Write-Host "배포 zip: $zip" -ForegroundColor Green
Write-Host '고객 흐름: 압축풀기 → agent.env(담당자 기입) → 1-로그인.bat → 2-시작.bat' -ForegroundColor Yellow
Write-Host '(선택) signtool 서명 · Inno Setup(installer.iss) 설치본.' -ForegroundColor Yellow
