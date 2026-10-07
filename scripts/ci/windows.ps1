# Top-level windows of a process, by title (dot-sourced by the CI scripts).
# Process.MainWindowHandle is not enough: the single-instance plugin owns a
# window of its own (« com.bullshit.notes-siw ») that .NET may pick instead.
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class TopWindows {
  delegate bool EnumProc(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr p);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
  /// Visible top-level window of process `pid` titled `title` (Zero if none).
  public static IntPtr Find(int pid, string title) {
    IntPtr found = IntPtr.Zero;
    EnumWindows((h, p) => {
      uint id;
      GetWindowThreadProcessId(h, out id);
      if (id != (uint) pid || !IsWindowVisible(h)) return true;
      var text = new StringBuilder(512);
      GetWindowText(h, text, text.Capacity);
      if (text.ToString() != title) return true;
      found = h;
      return false;
    }, IntPtr.Zero);
    return found;
  }
  /// Asks the window to close, as its close button does.
  public static void Close(IntPtr h) { PostMessage(h, 0x0010, IntPtr.Zero, IntPtr.Zero); }
}
"@

# First running process named `$name` with a visible window titled `$title`:
# @{ Process; Handle }, or $null.
function Find-AppWindow([string] $name, [string] $title) {
  foreach ($p in @(Get-Process $name -ErrorAction SilentlyContinue)) {
    $h = [TopWindows]::Find($p.Id, $title)
    if ($h -ne [IntPtr]::Zero) { return @{ Process = $p; Handle = $h } }
  }
  return $null
}
