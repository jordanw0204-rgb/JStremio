param(
    [Parameter(Mandatory = $true)]
    [int]$ProcessId,
    [int]$Steps = 360,
    [int]$StepDelayMilliseconds = 8,
    [int]$MovePixels = 180
)

$ErrorActionPreference = "Stop"

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public static class JStremioExistingWindowMoverNative {
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool SetWindowPos(
        IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags
    );

    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    public static extern IntPtr SendMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
}
"@

$process = Get-Process -Id $ProcessId
$process.Refresh()
$hwnd = $process.MainWindowHandle
if ($hwnd -eq [IntPtr]::Zero) { throw "Process $ProcessId has no main window." }

$rect = New-Object JStremioExistingWindowMoverNative+RECT
if (-not [JStremioExistingWindowMoverNative]::GetWindowRect($hwnd, [ref]$rect)) {
    throw "GetWindowRect failed with Win32 error $([Runtime.InteropServices.Marshal]::GetLastWin32Error())."
}

$SWP_NOSIZE = 0x0001
$SWP_NOZORDER = 0x0004
$SWP_NOACTIVATE = 0x0010
$WM_ENTERSIZEMOVE = 0x0231
$WM_EXITSIZEMOVE = 0x0232
$flags = $SWP_NOSIZE -bor $SWP_NOZORDER -bor $SWP_NOACTIVATE
$width = $rect.Right - $rect.Left
$height = $rect.Bottom - $rect.Top

try {
    [void][JStremioExistingWindowMoverNative]::SendMessage($hwnd, $WM_ENTERSIZEMOVE, [IntPtr]::Zero, [IntPtr]::Zero)
    for ($step = 0; $step -lt $Steps; $step++) {
        $phase = ($step % 120) / 120.0
        $offsetX = [int][Math]::Round([Math]::Sin($phase * 2.0 * [Math]::PI) * $MovePixels)
        $offsetY = [int][Math]::Round([Math]::Cos($phase * 2.0 * [Math]::PI) * ($MovePixels / 2.0))
        $ok = [JStremioExistingWindowMoverNative]::SetWindowPos(
            $hwnd, [IntPtr]::Zero, $rect.Left + $offsetX, $rect.Top + $offsetY,
            $width, $height, $flags
        )
        if (-not $ok) {
            throw "SetWindowPos failed at step $step with Win32 error $([Runtime.InteropServices.Marshal]::GetLastWin32Error())."
        }
        if ($StepDelayMilliseconds -gt 0) { Start-Sleep -Milliseconds $StepDelayMilliseconds }
    }
} finally {
    [void][JStremioExistingWindowMoverNative]::SetWindowPos(
        $hwnd, [IntPtr]::Zero, $rect.Left, $rect.Top, $width, $height,
        ($SWP_NOZORDER -bor $SWP_NOACTIVATE)
    )
    [void][JStremioExistingWindowMoverNative]::SendMessage($hwnd, $WM_EXITSIZEMOVE, [IntPtr]::Zero, [IntPtr]::Zero)
}
