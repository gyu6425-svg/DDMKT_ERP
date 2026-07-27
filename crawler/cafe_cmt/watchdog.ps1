# Cafe comment automation - WATCHDOG
#   Restarts anything that died: the three python daemons and each account's Chrome.
#   Registered as a Scheduled Task that runs every 5 minutes (see docs).
#
#   NOTE: ASCII only. Korean text here can break under the scheduler code page,
#         the same way it does in the .bat files.
#   NOTE: this touches ONLY cafe_cmt. The cafe publishing listener (port 9223) is
#         owned by another process - never restart or kill it from here.

$ErrorActionPreference = 'SilentlyContinue'
$HERE = Split-Path -Parent $MyInvocation.MyCommand.Path
$LOG = Join-Path $HERE 'watchdog.log'

function Write-Log($msg) {
    $line = "{0} {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
    Add-Content -Path $LOG -Value $line -Encoding UTF8
}

# --- 1. python daemons: 죽었거나(dead) 멈췄으면(hang) 되살린다 ----------------
#   hang 감지: 각 데몬이 .hb_<name> 에 heartbeat 를 찍는다. 그 값이 STALE_SEC 보다
#   오래됐으면 = 살아있어도 멈춘 것 → 죽였다가 되살린다. (프로세스 존재만 보면 hang 을 놓친다)
$STALE_SEC = 480   # 8분 — 정상 1주기(크롤 최대 수분)보다 넉넉히 크게(오탐 방지)
$DAEMONS = @(
    @{ script = 'comment_listener.py'; hb = 'listener' },
    @{ script = 'watch_new_posts.py';  hb = 'watch' },
    @{ script = 'reply_scheduler.py';  hb = 'reply' }
)
$procs = Get-CimInstance Win32_Process -Filter "Name='python.exe' OR Name='py.exe'"
$nowEpoch = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()

foreach ($d in $DAEMONS) {
    $s = $d.script
    $alive = $procs | Where-Object { $_.CommandLine -like "*$s*" }
    $reason = $null
    if (-not $alive) {
        $reason = 'DEAD'
    } else {
        $hbFile = Join-Path $HERE (".hb_" + $d.hb)
        if (Test-Path $hbFile) {
            $beat = 0.0
            if ([double]::TryParse((Get-Content $hbFile -Raw).Trim(), [ref]$beat)) {
                $age = $nowEpoch - [long]$beat
                if ($age -gt $STALE_SEC) { $reason = "HUNG(${age}s no heartbeat)" }
            }
        }
        # hb 파일이 아직 없으면(방금 뜬 프로세스) 건드리지 않는다 — 곧 찍힌다.
    }
    if ($reason) {
        Write-Log "$reason : $s - restarting"
        if ($alive) { $alive | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } }
        Start-Sleep -Milliseconds 500
        $env:PYTHONUTF8 = '1'
        Start-Process -FilePath 'py' -ArgumentList $s -WorkingDirectory $HERE -WindowStyle Minimized
    }
}

# --- 2. 계정 크롬: '진짜 CDP 연결'로 좀비 감지 + 중복 제거 ---------------------
#   ⚠️ 포트 열림(Test-NetConnection)만 보면 '좀비 크롬'(포트는 열렸는데 CDP 무응답)을
#      못 잡는다 — 2026-07-22 실제 사고. 그래서 chrome_health.py 로 실제 connect_over_cdp
#      를 8초 타임아웃으로 시도해, 죽었/멈춘 계정만 골라 재기동한다.
#   재기동은 반드시 '그 포트의 크롬을 전부 죽이고 하나만' 띄운다(중복 크롬이 쌓이면 CDP 가
#      먹통이 되는 게 바로 이번 원인이었다).
function Get-AcctPort($name, $acctFile) {
    foreach ($l in (Get-Content $acctFile)) {
        $p = ($l.Trim() -split '\s*,\s*')
        if ($p.Count -ge 2 -and $p[0].Trim() -eq $name) {
            $prof = if ($p.Count -ge 3) { $p[2].Trim() } else { 'chrome_profile' }
            return @{ port = $p[1].Trim(); profile = $prof }
        }
    }
    return $null
}

$acctFile = Join-Path $HERE 'accounts.txt'
if (Test-Path $acctFile) {
    $dead = @()
    try {
        $env:PYTHONUTF8 = '1'
        $dead = @(& py (Join-Path $HERE 'chrome_health.py') 2>$null | Where-Object { $_ -match ',' })
    } catch { $dead = @() }

    foreach ($row in $dead) {
        $name = ($row -split ',')[0].Trim()
        $port = ($row -split ',')[1].Trim()
        if ($port -eq '9222' -or $port -eq '9223') { continue }   # reserved: kakao / publish
        Write-Log "DEAD/HUNG chrome $name (port $port) - killing all on port + relaunching one"
        # 그 포트의 크롬 전부 종료(중복 누적 방지 — 이번 사고의 핵심)
        Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" |
            Where-Object { $_.CommandLine -match "remote-debugging-port=$port(\D|$)" } |
            ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
        Start-Sleep -Seconds 2
        # stale 프로필 락 제거
        $info = Get-AcctPort $name $acctFile
        if ($info) {
            $lock = Join-Path $HERE (Join-Path $info.profile 'SingletonLock')
            if (Test-Path $lock) { Remove-Item $lock -Force -ErrorAction SilentlyContinue }
        }
        Start-Process -FilePath (Join-Path $HERE 'run_chrome.bat') -ArgumentList $name -WorkingDirectory $HERE -WindowStyle Hidden
        Start-Sleep -Seconds 6
    }
}

# --- 3. keep the log from growing forever ------------------------------------
if ((Test-Path $LOG) -and ((Get-Item $LOG).Length -gt 1MB)) {
    $tail = Get-Content $LOG -Tail 500
    Set-Content -Path $LOG -Value $tail -Encoding UTF8
}
