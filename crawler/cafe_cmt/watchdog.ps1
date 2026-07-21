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

# --- 2. one Chrome per account ----------------------------------------------
# Port comes from accounts.txt so bat/python/watchdog all share one registry.
$acctFile = Join-Path $HERE 'accounts.txt'
if (Test-Path $acctFile) {
    foreach ($line in (Get-Content $acctFile)) {
        $t = $line.Trim()
        if ($t -eq '' -or $t.StartsWith('#')) { continue }
        $parts = $t -split '\s*,\s*'
        if ($parts.Count -lt 2) { continue }
        $name = $parts[0].Trim()
        $port = 0
        if (-not [int]::TryParse($parts[1].Trim(), [ref]$port)) { continue }
        if ($port -eq 9222 -or $port -eq 9223) { continue }   # reserved: kakao / publish

        $listening = Test-NetConnection -ComputerName '127.0.0.1' -Port $port -InformationLevel Quiet -WarningAction SilentlyContinue
        if (-not $listening) {
            Write-Log "DEAD: chrome $name (port $port) - restarting"
            # clear a stale profile lock left by an unclean shutdown
            if ($parts.Count -ge 3) {
                $lock = Join-Path $HERE (Join-Path $parts[2].Trim() 'SingletonLock')
                if (Test-Path $lock) { Remove-Item $lock -Force }
            }
            Start-Process -FilePath (Join-Path $HERE 'run_chrome.bat') -ArgumentList $name -WorkingDirectory $HERE -WindowStyle Hidden
            Start-Sleep -Seconds 6
        }
    }
}

# --- 3. keep the log from growing forever ------------------------------------
if ((Test-Path $LOG) -and ((Get-Item $LOG).Length -gt 1MB)) {
    $tail = Get-Content $LOG -Tail 500
    Set-Content -Path $LOG -Value $tail -Encoding UTF8
}
