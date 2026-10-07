# Captures of the installer and uninstaller pages (CI, Windows runner) for the
# record in docs/captures: the real NSIS windows, driven with Enter, each page
# saved as PNG. Not a test (installer-test.ps1 is): a failure here only loses pictures.
param(
  [Parameter(Mandatory)] [string] $Setup,
  [Parameter(Mandatory)] [string] $Out
)
$ErrorActionPreference = "Stop"
if ($env:CI -ne "true") { throw "CI only: installs and uninstalls the app." }
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class Win {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
}
"@
[void] [Win]::SetProcessDPIAware()
New-Item -ItemType Directory -Force $Out | Out-Null

# First process whose name matches `$pattern` (regex) with a visible window.
function Window([string] $pattern, [int] $seconds = 60) {
  $deadline = (Get-Date).AddSeconds($seconds)
  while ((Get-Date) -lt $deadline) {
    $p = Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -match $pattern -and $_.MainWindowHandle -ne 0 } | Select-Object -First 1
    if ($p) { return $p }
    Start-Sleep -Milliseconds 500
  }
  throw "no window for $pattern"
}

function Shot($process, [string] $file) {
  Start-Sleep -Milliseconds 1200
  $h = $process.MainWindowHandle
  [void] [Win]::SetForegroundWindow($h)
  Start-Sleep -Milliseconds 300
  $r = New-Object Win+RECT
  [void] [Win]::GetWindowRect($h, [ref] $r)
  $w = $r.Right - $r.Left; $hgt = $r.Bottom - $r.Top
  $bmp = New-Object System.Drawing.Bitmap $w, $hgt
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($r.Left, $r.Top, 0, 0, $bmp.Size)
  $bmp.Save((Join-Path $Out $file), [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
  Write-Host "  $file ($w × $hgt)"
}

function Enter($process) {
  [void] [Win]::SetForegroundWindow($process.MainWindowHandle)
  Start-Sleep -Milliseconds 200
  [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
}

# Installer: every page up to the end, then the app it starts.
$setupName = [IO.Path]::GetFileNameWithoutExtension($Setup)
Start-Process $Setup | Out-Null
$i = 1
$p = Window ("^" + [regex]::Escape($setupName) + "$")
for ($page = 0; $page -lt 8; $page++) {
  Shot $p ("installeur-{0:00}.png" -f $i); $i++
  Enter $p
  Start-Sleep -Seconds 2
  $p.Refresh()
  if ($p.HasExited) { break }
  # The installing page goes by on its own: wait for the last page.
  $deadline = (Get-Date).AddSeconds(60)
  while (-not $p.HasExited -and $p.MainWindowHandle -eq 0 -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 500; $p.Refresh() }
  if ($p.HasExited) { break }
}

# The finish page starts the app (checked by default).
try {
  $app = Window "^bullshit$" 60
  Start-Sleep -Seconds 3
  Shot $app "app-premier-lancement.png"
} catch { Write-Host "  app window not found: $_" }
Get-Process bullshit -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 2

# Uninstaller: the confirmation page with « delete settings » unchecked.
Start-Process (Join-Path $env:LOCALAPPDATA "Bullshit\uninstall.exe") | Out-Null
# NSIS copies the uninstaller to %TEMP% (Un_A.exe, Au_.exe…) and runs that copy.
$uninstaller = "^(Un_?[A-Z]?|Au_)$"
$u = Window $uninstaller 60
Shot $u "desinstalleur-01.png"
for ($page = 2; $page -le 4; $page++) {
  Enter $u
  Start-Sleep -Seconds 3
  $u.Refresh()
  if ($u.HasExited) { break }
  Shot $u ("desinstalleur-{0:00}.png" -f $page)
}
Get-Process | Where-Object { $_.ProcessName -match $uninstaller } | Stop-Process -Force -ErrorAction SilentlyContinue
