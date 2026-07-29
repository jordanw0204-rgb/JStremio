param(
    [Parameter(Mandatory = $true)]
    [string]$Executable,
    [string[]]$AppArguments = @("--no-splash", "--disable-update-check"),
    [int]$WarmupSeconds = 10,
    [int]$Steps = 240,
    [int]$StepDelayMilliseconds = 8,
    [int]$MovePixels = 180
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $Executable -PathType Leaf)) {
    throw "Executable not found: $Executable"
}

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public static class JStremioWindowProfilerNative {
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
        IntPtr hWnd,
        IntPtr hWndInsertAfter,
        int X,
        int Y,
        int cx,
        int cy,
        uint uFlags
    );

    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    public static extern IntPtr SendMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
}
"@

function Get-Percentile {
    param(
        [double[]]$Values,
        [double]$Percentile
    )

    if ($Values.Count -eq 0) { return 0.0 }
    $sorted = $Values | Sort-Object
    $index = [Math]::Ceiling(($Percentile / 100.0) * $sorted.Count) - 1
    $index = [Math]::Max(0, [Math]::Min($sorted.Count - 1, $index))
    return [double]$sorted[$index]
}

$SWP_NOSIZE = 0x0001
$SWP_NOZORDER = 0x0004
$SWP_NOACTIVATE = 0x0010
$WM_ENTERSIZEMOVE = 0x0231
$WM_EXITSIZEMOVE = 0x0232
$flags = $SWP_NOSIZE -bor $SWP_NOZORDER -bor $SWP_NOACTIVATE

$existing = Get-Process -Name "JStremio" -ErrorAction SilentlyContinue
if ($existing) {
    throw "Another JStremio process is running. Close it before profiling."
}

$process = Start-Process -FilePath $Executable -ArgumentList $AppArguments -PassThru
$originalRect = $null
$result = $null

try {
    $deadline = [DateTime]::UtcNow.AddSeconds(30)
    do {
        Start-Sleep -Milliseconds 100
        $process.Refresh()
        if ($process.HasExited) {
            throw "JStremio exited before creating its main window (exit code $($process.ExitCode))."
        }
    } while ($process.MainWindowHandle -eq [IntPtr]::Zero -and [DateTime]::UtcNow -lt $deadline)

    if ($process.MainWindowHandle -eq [IntPtr]::Zero) {
        throw "JStremio did not create a main window within 30 seconds."
    }

    Start-Sleep -Seconds $WarmupSeconds
    $process.Refresh()
    $hwnd = $process.MainWindowHandle
    $rect = New-Object JStremioWindowProfilerNative+RECT
    if (-not [JStremioWindowProfilerNative]::GetWindowRect($hwnd, [ref]$rect)) {
        throw "GetWindowRect failed with Win32 error $([Runtime.InteropServices.Marshal]::GetLastWin32Error())."
    }
    $originalRect = $rect

    # Announce an interactive move/size loop so the app follows the same lifecycle
    # as a real title-bar drag, while keeping the coordinates deterministic.
    [void][JStremioWindowProfilerNative]::SendMessage(
        $hwnd,
        $WM_ENTERSIZEMOVE,
        [IntPtr]::Zero,
        [IntPtr]::Zero
    )

    $durations = [System.Collections.Generic.List[double]]::new()
    $wallClock = [Diagnostics.Stopwatch]::StartNew()
    $cpuBefore = $process.TotalProcessorTime
    $width = $rect.Right - $rect.Left
    $height = $rect.Bottom - $rect.Top

    for ($step = 0; $step -lt $Steps; $step++) {
        $phase = ($step % 120) / 120.0
        $offsetX = [int][Math]::Round([Math]::Sin($phase * 2.0 * [Math]::PI) * $MovePixels)
        $offsetY = [int][Math]::Round([Math]::Cos($phase * 2.0 * [Math]::PI) * ($MovePixels / 2.0))
        $sample = [Diagnostics.Stopwatch]::StartNew()
        $ok = [JStremioWindowProfilerNative]::SetWindowPos(
            $hwnd,
            [IntPtr]::Zero,
            $rect.Left + $offsetX,
            $rect.Top + $offsetY,
            $width,
            $height,
            $flags
        )
        $sample.Stop()
        if (-not $ok) {
            throw "SetWindowPos failed at step $step with Win32 error $([Runtime.InteropServices.Marshal]::GetLastWin32Error())."
        }
        $durations.Add($sample.Elapsed.TotalMilliseconds)
        if ($StepDelayMilliseconds -gt 0) {
            Start-Sleep -Milliseconds $StepDelayMilliseconds
        }
    }

    $wallClock.Stop()
    $process.Refresh()
    $cpuAfter = $process.TotalProcessorTime
    $cpuMilliseconds = ($cpuAfter - $cpuBefore).TotalMilliseconds
    $wallMilliseconds = $wallClock.Elapsed.TotalMilliseconds
    $logicalProcessors = [Environment]::ProcessorCount

    $result = [ordered]@{
        executable = (Resolve-Path -LiteralPath $Executable).Path
        fileVersion = (Get-Item -LiteralPath $Executable).VersionInfo.FileVersion
        arguments = $AppArguments
        processId = $process.Id
        steps = $Steps
        stepDelayMilliseconds = $StepDelayMilliseconds
        wallMilliseconds = [Math]::Round($wallMilliseconds, 3)
        processCpuMilliseconds = [Math]::Round($cpuMilliseconds, 3)
        processCpuPercentOfOneCore = if ($wallMilliseconds -gt 0) {
            [Math]::Round(($cpuMilliseconds / $wallMilliseconds) * 100.0, 2)
        } else { 0.0 }
        processCpuPercentOfMachine = if ($wallMilliseconds -gt 0) {
            [Math]::Round(($cpuMilliseconds / $wallMilliseconds) * 100.0 / $logicalProcessors, 2)
        } else { 0.0 }
        moveCallMilliseconds = [ordered]@{
            average = [Math]::Round(($durations | Measure-Object -Average).Average, 3)
            p50 = [Math]::Round((Get-Percentile $durations.ToArray() 50), 3)
            p95 = [Math]::Round((Get-Percentile $durations.ToArray() 95), 3)
            p99 = [Math]::Round((Get-Percentile $durations.ToArray() 99), 3)
            maximum = [Math]::Round(($durations | Measure-Object -Maximum).Maximum, 3)
            over16ms = @($durations | Where-Object { $_ -gt 16.667 }).Count
            over33ms = @($durations | Where-Object { $_ -gt 33.333 }).Count
        }
        workingSetMegabytes = [Math]::Round($process.WorkingSet64 / 1MB, 2)
        privateMemoryMegabytes = [Math]::Round($process.PrivateMemorySize64 / 1MB, 2)
        respondingAfterRun = $process.Responding
    }
} finally {
    if (-not $process.HasExited) {
        if ($originalRect) {
            $width = $originalRect.Right - $originalRect.Left
            $height = $originalRect.Bottom - $originalRect.Top
            [void][JStremioWindowProfilerNative]::SetWindowPos(
                $process.MainWindowHandle,
                [IntPtr]::Zero,
                $originalRect.Left,
                $originalRect.Top,
                $width,
                $height,
                ($SWP_NOZORDER -bor $SWP_NOACTIVATE)
            )
        }
        [void][JStremioWindowProfilerNative]::SendMessage(
            $process.MainWindowHandle,
            $WM_EXITSIZEMOVE,
            [IntPtr]::Zero,
            [IntPtr]::Zero
        )
        [void]$process.CloseMainWindow()
        if (-not $process.WaitForExit(8000)) {
            Stop-Process -Id $process.Id -Force
            $process.WaitForExit()
        }
    }
}

$result | ConvertTo-Json -Depth 5
