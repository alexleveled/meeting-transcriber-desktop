<#
.SYNOPSIS
  Install / launch / reinstall / uninstall the built installer and assert each step really worked.

.DESCRIPTION
  CI built an installer it never once executed, which is how 0.1.4 shipped an app that could not be
  uninstalled -- through a green build. This runs the installer for real on the runner and checks
  the things a green electron-builder log does not:

    1. a clean install succeeds
    2. the installed app actually boots and serves /api/health
    3. installing OVER an existing install succeeds  <-- the exact failure in 0.1.4
    4. the uninstaller leaves NOTHING behind         <-- the root cause; NSIS cannot delete
                                                        paths over 260 chars and fails silently

  Step 4 is the important one. In 0.1.4 the uninstaller exited 0 while leaving resources/ on disk,
  so every later install died with "Meeting Transcriber cannot be closed. Please close it manually."
  Exit code alone proves nothing here; the directory has to be gone.

  Run from the repo root, after electron-builder. Exits non-zero on the first failed assertion.
#>

$ErrorActionPreference = "Stop"

# Inherited from an Electron-hosted terminal (a VS Code extension host, for one), this makes
# electron.exe run as plain Node, so `require("electron").app` is undefined and the app exits 0 with
# no window and no log. The launch check below would fail with a completely misleading message.
# Absent on CI; cleared here so a local run behaves the same as CI.
Remove-Item Env:\ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue

$InstallDir = Join-Path $env:LOCALAPPDATA "Programs\meeting-transcriber"
$UserData   = Join-Path $env:APPDATA "meeting-transcriber"
$AppExe     = Join-Path $InstallDir "Meeting Transcriber.exe"
$LogFile    = Join-Path $UserData "logs\main.log"

function Fail([string]$Message) {
    Write-Host "`n  FAIL: $Message`n" -ForegroundColor Red
    exit 1
}

function Pass([string]$Message) {
    Write-Host "  ok   $Message" -ForegroundColor Green
}

function Stop-App {
    Get-Process -Name "Meeting Transcriber" -ErrorAction SilentlyContinue |
        Stop-Process -Force -ErrorAction SilentlyContinue
    # whisper-server is spawned by the Next server; if the app ever leaks one it would lock the
    # install dir and make the next step's failure look like something else entirely.
    Get-Process -Name "whisper-server" -ErrorAction SilentlyContinue |
        Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
}

function Invoke-Installer([string]$Path, [string]$Label) {
    $proc = Start-Process -FilePath $Path -ArgumentList "/S" -PassThru -Wait
    if ($proc.ExitCode -ne 0) {
        Fail "$Label exited $($proc.ExitCode). Exit 2 here is the old-uninstaller failure that
       surfaces to users as 'Meeting Transcriber cannot be closed'."
    }
    Pass "$Label exited 0"
    # oneClick installers launch the app when they finish; it must not hold files for the next step.
    Start-Sleep -Seconds 5
    Stop-App
}

# ── Locate the installer ─────────────────────────────────────────────────────
$setup = Get-ChildItem "dist-electron\*Setup*.exe" -ErrorAction SilentlyContinue |
    Sort-Object Length -Descending | Select-Object -First 1
if (-not $setup) { Fail "no installer found in dist-electron/" }
Write-Host "`n  installer: $($setup.Name) ($([math]::Round($setup.Length / 1MB, 1)) MB)`n"

# A leftover install from an earlier run would invalidate the clean-install assertions.
Stop-App
if (Test-Path $InstallDir) {
    Remove-Item $InstallDir -Recurse -Force -ErrorAction SilentlyContinue
    if (Test-Path $InstallDir) { Fail "could not clear a pre-existing install at $InstallDir" }
}

# ── 1. clean install ─────────────────────────────────────────────────────────
Write-Host "`n[1/4] clean install"
Invoke-Installer $setup.FullName "clean install"

if (-not (Test-Path $AppExe)) { Fail "installer exited 0 but $AppExe does not exist" }
Pass "app executable present"

$nested = Join-Path $InstallDir "resources\app-server\dist-electron"
if (Test-Path $nested) { Fail "installed tree contains a nested previous build at $nested" }
Pass "no nested build in the installed tree"

$longest = Get-ChildItem $InstallDir -Recurse -File -ErrorAction SilentlyContinue |
    Sort-Object { $_.FullName.Length } -Descending | Select-Object -First 1
if ($longest.FullName.Length -ge 260) {
    Fail "installed path is $($longest.FullName.Length) chars, past MAX_PATH:`n       $($longest.FullName)"
}
Pass "longest installed path $($longest.FullName.Length) chars (limit 260)"

# ── 2. it actually boots ─────────────────────────────────────────────────────
Write-Host "`n[2/4] launch and health check"
if (Test-Path $LogFile) { Remove-Item $LogFile -Force -ErrorAction SilentlyContinue }
Start-Process $AppExe | Out-Null

$port = $null
for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Seconds 2
    if (Test-Path $LogFile) {
        $m = [regex]::Match((Get-Content $LogFile -Raw -ErrorAction SilentlyContinue), 'port (\d+)')
        if ($m.Success) { $port = $m.Groups[1].Value; break }
    }
}
if (-not $port) {
    $tail = if (Test-Path $LogFile) { Get-Content $LogFile -Tail 20 | Out-String } else { "(no log written)" }
    Fail "app never reported a server port within 120s. main.log:`n$tail"
}

$health = $null
for ($i = 0; $i -lt 15; $i++) {
    try {
        $health = (Invoke-WebRequest "http://127.0.0.1:$port/api/health" -UseBasicParsing -TimeoutSec 5).Content
        break
    } catch { Start-Sleep -Seconds 2 }
}
if (-not $health) { Fail "server on port $port never answered /api/health" }
if ($health -notmatch '"ok"\s*:\s*true') { Fail "health endpoint returned: $health" }
Pass "app booted, health $health"
Stop-App

# ── 3. install over the existing install ─────────────────────────────────────
# This is the step 0.1.4 could not survive: the installer runs the ALREADY-INSTALLED uninstaller
# first, and that is what failed.
Write-Host "`n[3/4] reinstall over the existing install"
Invoke-Installer $setup.FullName "upgrade install"
if (-not (Test-Path $AppExe)) { Fail "upgrade install exited 0 but the app executable is missing" }
Pass "app executable still present after upgrade"

# ── 4. uninstall leaves nothing ──────────────────────────────────────────────
Write-Host "`n[4/4] uninstall"
$entry = Get-ChildItem HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall -ErrorAction SilentlyContinue |
    ForEach-Object { Get-ItemProperty $_.PSPath } |
    Where-Object { $_.DisplayName -match "Meeting Transcriber" } | Select-Object -First 1
if (-not $entry) { Fail "no uninstall entry registered in HKCU" }
Pass "uninstall entry registered: $($entry.DisplayName)"

$uninstaller = Join-Path $InstallDir "Uninstall Meeting Transcriber.exe"
if (-not (Test-Path $uninstaller)) { Fail "uninstaller missing at $uninstaller" }

# No _?= here on purpose: that runs it in place and cannot remove the directory, which is precisely
# the assertion being made. The normal path copies itself to temp and returns immediately, so poll.
Start-Process -FilePath $uninstaller -ArgumentList "/currentuser", "/S" | Out-Null

# What has to be true is that no CONTENT survives. An empty $InstallDir shell is routine on Windows
# (a lingering handle stops the final RMDir) and is harmless -- the next install writes straight into
# it. The 0.1.4 failure was real files surviving: a whisper-server.exe buried past MAX_PATH that NSIS
# could not touch and that then broke every subsequent install.
$left = @()
for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Seconds 2
    if (-not (Test-Path $InstallDir)) { $left = @(); break }
    try {
        $left = @(Get-ChildItem $InstallDir -Recurse -Force -ErrorAction SilentlyContinue)
    } catch {
        # The uninstaller removed $InstallDir between the Test-Path above and this enumeration. The
        # provider raises that as a TERMINATING Win32Exception ("the system cannot find the path
        # specified"), which -ErrorAction SilentlyContinue does not suppress -- v0.5.0 failed here
        # on a build whose install, boot and upgrade had all passed. A vanished directory is the
        # outcome this step wants, so treat it as such and let the next Test-Path confirm it.
        $left = @()
        continue
    }
    if ($left.Count -eq 0) { break }
}

if ($left.Count -gt 0) {
    $names = $left | Select-Object -First 15 -ExpandProperty FullName
    Fail @"
uninstaller left $($left.Count) item(s) behind in $InstallDir

       This is the 0.1.4 bug. NSIS cannot delete paths over 260 chars and does not
       report an error, so every future install fails while running this uninstaller
       and the user is told the app 'cannot be closed'.

$($names -join "`n")
"@
}
Pass "install directory emptied (no files or folders survived)"

# Poll, for the same reason the directory check above polls: the uninstaller is still running. NSIS
# removes files first and deletes its registry key last, so an empty install directory does NOT mean
# the uninstall has finished. Checking the key the instant the last file disappears is a race the
# uninstaller usually wins but sometimes loses -- v0.4.0 failed here 4 ms after the directory went
# empty, on a build whose install, boot, upgrade and file removal had all passed.
$stillRegistered = $null
for ($i = 0; $i -lt 30; $i++) {
    # Same disappearing-target race as the directory scan above: the uninstaller can delete its key
    # while this pipeline is walking the list, and Get-ItemProperty on a key that just vanished
    # throws. That IS the success condition, so swallow it and re-check.
    try {
        $stillRegistered = Get-ChildItem HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall -ErrorAction SilentlyContinue |
            ForEach-Object { Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue } |
            Where-Object { $_.DisplayName -match "Meeting Transcriber" }
    } catch {
        $stillRegistered = $null
    }
    if (-not $stillRegistered) { break }
    Start-Sleep -Seconds 2
}
if ($stillRegistered) { Fail "uninstall entry is still registered in HKCU 60s after uninstalling" }
Pass "uninstall entry removed from HKCU"

Write-Host "`n  smoke test passed: install -> boot -> upgrade -> uninstall, nothing left behind`n" -ForegroundColor Green
exit 0
