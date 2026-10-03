# Starts the tracker at logon through Task Scheduler, with no window, using this repo's .env.
#   powershell -File scripts/autostart.ps1            register (or replace) the entry
#   powershell -File scripts/autostart.ps1 -Stop      stop the tracker it started
#   powershell -File scripts/autostart.ps1 -Remove    stop it and remove the entry
param(
  [switch]$Stop,
  [switch]$Remove,
  [string]$TaskName = "claude-delegate-tracker",
  [int]$Port = 0  # 0: the port from .env or the default; anything else overrides it
)
$ErrorActionPreference = "Stop"

$repo = Split-Path -Parent $PSScriptRoot
# The task runs node on this absolute path, so its command line names this repo; a tracker
# started by hand runs a relative path and is left alone.
$main = Join-Path $repo "src\server\main.ts"

function Stop-Tracker {
  # Ending the task leaves the server running under it, so end the server itself.
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
    Where-Object { $_.CommandLine -like "*$main*" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
}

if ($Stop -or $Remove) {
  Stop-Tracker
  if ($Remove) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Output "Stopped the tracker and removed the '$TaskName' entry."
  } else {
    Write-Output "Stopped the tracker '$TaskName' started."
  }
  return
}

$npm = (Get-Command npm.cmd).Source
$start = "`"$npm`" run build && node `"$main`""
$command = if ($Port -gt 0) { "set TRACKER_PORT=$Port&& $start" } else { $start }
# conhost --headless runs the console programs without opening a window.
$action = New-ScheduledTaskAction -Execute "conhost.exe" -Argument "--headless cmd.exe /c $command" -WorkingDirectory $repo
$trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings `
  -Description "Starts the delegation tracker at logon." -Force | Out-Null
Write-Output "Registered '$TaskName': the tracker starts at your next logon. Start it now with: Start-ScheduledTask -TaskName $TaskName"
