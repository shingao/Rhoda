# Installer test (CI, Windows runner only) — run by .github/workflows/windows.yml.
# 1. Fresh install: silent install of the new installer (per user, no admin),
#    shortcuts, launch, the window opens, the old Documents\Ursa folder becomes
#    Documents\Bullshit, a second launch keeps a single instance, silent
#    uninstall: the app is gone and the notes are untouched.
# 2. Upgrade: silent install of a 0.9.0 build, launch, settings changed, the
#    new installer over it: settings and notes kept, the new version starts.
# It deletes the app's folders and Documents\Ursa|Bullshit: never run it outside CI.
param(
  [Parameter(Mandatory)] [string] $Version,
  [Parameter(Mandatory)] [string] $Setup,
  [Parameter(Mandatory)] [string] $OldSetup
)
$ErrorActionPreference = "Stop"
if ($env:CI -ne "true") { throw "CI only: this script deletes the app's data and notes folders." }
. (Join-Path $PSScriptRoot "windows.ps1")

$Product = "Bullshit"
$Exe = "bullshit"
$InstallDir = Join-Path $env:LOCALAPPDATA $Product
$ConfigDir = Join-Path $env:APPDATA "com.bullshit.notes"
$OldConfigDir = Join-Path $env:APPDATA "com.ursa.notes"
$Docs = [Environment]::GetFolderPath("MyDocuments")
$Vault = Join-Path $Docs $Product
$OldVault = Join-Path $Docs "Ursa"
$StartMenu = Join-Path ([Environment]::GetFolderPath("Programs")) "$Product.lnk"
$Desktop = Join-Path ([Environment]::GetFolderPath("Desktop")) "$Product.lnk"
$UninstallKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$Product"

function Step($text) { Write-Host "`n== $text" }
function Ok($text) { Write-Host "  ok: $text" }
function Fail($text) { Write-Host "::error::$text"; throw $text }
function Check($condition, $text) { if ($condition) { Ok $text } else { Fail $text } }

function Wait-Until([scriptblock] $test, [int] $seconds, [string] $what) {
  $deadline = (Get-Date).AddSeconds($seconds)
  while ((Get-Date) -lt $deadline) {
    if (& $test) { return }
    Start-Sleep -Milliseconds 500
  }
  Fail "timed out after $seconds s: $what"
}

function Install([string] $installer) {
  $p = Start-Process $installer -ArgumentList "/S" -Wait -PassThru
  Check ($p.ExitCode -eq 0) "silent install of $(Split-Path $installer -Leaf) (exit code $($p.ExitCode))"
}

function Uninstall {
  $p = Start-Process (Join-Path $InstallDir "uninstall.exe") -ArgumentList "/S" -Wait -PassThru
  Check ($p.ExitCode -eq 0) "silent uninstall started (exit code $($p.ExitCode))"
  # The NSIS uninstaller copies itself to %TEMP% and returns at once.
  Wait-Until { -not (Test-Path (Join-Path $InstallDir "$Exe.exe")) } 60 "the app removed"
}

function Installed-Version { (Get-ItemProperty $UninstallKey -ErrorAction SilentlyContinue).DisplayVersion }

# Starts the installed app and waits for its window: hidden at first, it is
# shown by the frontend once themed, so a visible window means the UI booted.
function Launch {
  Start-Process (Join-Path $InstallDir "$Exe.exe") | Out-Null
  $script:window = $null
  Wait-Until {
    $script:window = Find-AppWindow $Exe $Product
    [bool] $script:window
  } 90 "the window « $Product » opens"
  Ok "window « $Product » open"
  return $script:window.Process
}

function Quit {
  foreach ($p in @(Get-Process $Exe -ErrorAction SilentlyContinue)) {
    $h = [TopWindows]::Find($p.Id, $Product)
    if ($h -ne [IntPtr]::Zero) { [TopWindows]::Close($h) }
  }
  $deadline = (Get-Date).AddSeconds(15)
  while ((Get-Process $Exe -ErrorAction SilentlyContinue) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 500 }
  $left = @(Get-Process $Exe -ErrorAction SilentlyContinue)
  if ($left.Count) { Write-Host "  (still running after 15 s: stopped)"; $left | Stop-Process -Force }
  Start-Sleep -Seconds 1
}

# Every file of the notes folder (name → SHA-256), `.ursa` caches excepted.
function Snapshot([string] $folder) {
  $map = @{}
  Get-ChildItem $folder -Recurse -File | Where-Object { $_.FullName -notmatch '[\\/]\.ursa[\\/]' } | ForEach-Object {
    $map[$_.FullName.Substring($folder.Length)] = (Get-FileHash $_.FullName -Algorithm SHA256).Hash
  }
  return $map
}

function Same-Snapshot($before, $after) {
  if ($before.Count -ne $after.Count) { return $false }
  foreach ($k in $before.Keys) { if ($after[$k] -ne $before[$k]) { return $false } }
  return $true
}

# Every file of `$part` is in `$all`, unchanged (the app may add its welcome note).
function Contains-Snapshot($part, $all) {
  foreach ($k in $part.Keys) { if ($all[$k] -ne $part[$k]) { return $false } }
  return $true
}

function Read-Settings { Get-Content (Join-Path $ConfigDir "settings.json") -Raw -Encoding utf8 | ConvertFrom-Json }

# Clean start.
Get-Process $Exe -ErrorAction SilentlyContinue | Stop-Process -Force
foreach ($dir in @($ConfigDir, $OldConfigDir, $Vault, $OldVault, (Join-Path $env:LOCALAPPDATA "com.bullshit.notes"))) {
  if (Test-Path $dir) { Remove-Item $dir -Recurse -Force }
}
Check (-not (Test-Path $InstallDir)) "no previous installation"

# ---------------------------------------------------------------------------
Step "1. Fresh install, notes of the Ursa era"
New-Item -ItemType Directory -Force (Join-Path $OldVault "Voyages") | Out-Null
$witness = "# Témoin`n`nCe texte ne doit jamais changer : installation, migration, désinstallation.`n"
Set-Content (Join-Path $OldVault "Témoin.md") $witness -NoNewline -Encoding utf8NoBOM
Set-Content (Join-Path $OldVault "Voyages\Kyoto.md") "# Kyoto`n`n#voyage`n" -NoNewline -Encoding utf8NoBOM
$notes = Snapshot $OldVault

Install $Setup
Check (Test-Path (Join-Path $InstallDir "$Exe.exe")) "installed per user in $InstallDir"
Check ((Installed-Version) -eq $Version) "version $Version registered (HKCU)"
Check (Test-Path $StartMenu) "Start menu shortcut"
Check (Test-Path $Desktop) "desktop shortcut (silent install)"
Check (-not (Test-Path "HKCU:\Software\Classes\.md\OpenWithProgids\$Product")) "no .md file association"

$first = Launch
Wait-Until { Test-Path (Join-Path $Vault ".ursa\version") } 30 "the notes folder opened"
Check (-not (Test-Path $OldVault)) "Documents\Ursa moved…"
Check (Contains-Snapshot $notes (Snapshot $Vault)) "…to Documents\Bullshit, notes unchanged"

Step "Single instance"
$second = Start-Process (Join-Path $InstallDir "$Exe.exe") -PassThru
Check ($second.WaitForExit(30000)) "the second launch quits"
$running = @(Get-Process $Exe -ErrorAction SilentlyContinue)
Check ($running.Count -eq 1 -and $running[0].Id -eq $first.Id) "one instance, the first one ($($running.Count) running)"

Quit
$notes = Snapshot $Vault
Check ($notes.Count -ge 3) "notes folder: $($notes.Count) files (witness, Kyoto, welcome note)"
Check (Test-Path (Join-Path $ConfigDir "settings.json")) "settings written"

Step "Silent uninstall"
Uninstall
Check (-not (Test-Path $StartMenu)) "Start menu shortcut removed"
Check (-not (Test-Path $Desktop)) "desktop shortcut removed"
Check (-not (Test-Path $UninstallKey)) "uninstall entry removed"
Check (Test-Path $Vault) "notes folder still there"
Check (Same-Snapshot $notes (Snapshot $Vault)) "every note unchanged ($($notes.Count) files)"
Check ((Get-Content (Join-Path $Vault "Témoin.md") -Raw -Encoding utf8) -eq $witness) "witness note byte for byte"
Check (Test-Path (Join-Path $ConfigDir "settings.json")) "settings kept (« delete settings » is unchecked by default)"

# ---------------------------------------------------------------------------
Step "2. Upgrade 0.9.0 → $Version"
Remove-Item $ConfigDir -Recurse -Force
Install $OldSetup
Check ((Installed-Version) -eq "0.9.0") "version 0.9.0 installed"
Launch | Out-Null
Quit
Check (Test-Path (Join-Path $ConfigDir "settings.json")) "0.9.0 wrote its settings"
# The user changes a few settings.
$settings = Read-Settings
$settings | Add-Member -Force -NotePropertyName language -NotePropertyValue "en"
$settings | Add-Member -Force -NotePropertyName sort -NotePropertyValue "title"
$settings | ConvertTo-Json -Depth 32 | Set-Content (Join-Path $ConfigDir "settings.json") -Encoding utf8NoBOM
$notes = Snapshot $Vault

Install $Setup
Check ((Installed-Version) -eq $Version) "$Version installed over 0.9.0"
Check (@(Get-ChildItem "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall" | Where-Object { $_.PSChildName -eq $Product }).Count -eq 1) "a single uninstall entry"
$settings = Read-Settings
Check ($settings.language -eq "en" -and $settings.sort -eq "title") "settings kept by the installer"
Launch | Out-Null
Quit
$settings = Read-Settings
Check ($settings.language -eq "en" -and $settings.sort -eq "title" -and $settings.welcomed -eq $true) "settings kept by $Version (language en, sort by title)"
Check (Same-Snapshot $notes (Snapshot $Vault)) "notes unchanged ($($notes.Count) files)"

Uninstall
Check (Same-Snapshot $notes (Snapshot $Vault)) "notes unchanged after the final uninstall"
Write-Host "`nInstaller test passed."
