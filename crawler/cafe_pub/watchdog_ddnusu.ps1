# DDNusu watchdog — relaunch supervisor if listener_ddnusu process is dead.
# Scheduled every ~20min. Self-heals even if the supervisor .bat itself died (weekend failure mode).
$ErrorActionPreference = 'SilentlyContinue'
$log = 'C:\Users\rlawh\sub2\crawler\cafe_pub\cafe_ddnusu.log'
$vbs = 'C:\Users\rlawh\sub2\crawler\cafe_pub\run_ddnusu_hidden.vbs'
$alive = Get-CimInstance Win32_Process -Filter "Name='python.exe'" | Where-Object { $_.CommandLine -like '*listener_ddnusu*' }
if (-not $alive) {
    Start-Process 'wscript.exe' -ArgumentList "`"$vbs`""
    "[WATCHDOG] $(Get-Date -f 'yyyy-MM-dd HH:mm:ss') listener dead -> relaunched supervisor" | Out-File -Append -Encoding utf8 $log
}
