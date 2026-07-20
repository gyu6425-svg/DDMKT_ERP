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

# --- 1. python daemons -------------------------------------------------------
$SCRIPTS = @('comment_listener.py', 'watch_new_posts.py', 'reply_scheduler.py')
$procs = Get-CimInstance Win32_Process -Filter "Name='python.exe' OR Name='py.exe'"

foreach ($s in $SCRIPTS) {
    $alive = $procs | Where-Object { $_.CommandLine -like "*$s*" }
    if (-not $alive) {
        Write-Log "DEAD: $s - restarting"
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
