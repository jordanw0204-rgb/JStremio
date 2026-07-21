param(
    [int]$Port = 9222,
    [string]$NodeScript = "scripts/quick-seek-live-smoke.mjs",
    [string]$MediaFile = "",
    [int]$MediaPort = 8765
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$debugExe = Join-Path $repoRoot "target\x86_64-pc-windows-msvc\debug\JStremio.exe"
$extensions = Join-Path $repoRoot "resources\extensions"
$mediaProcess = $null
$mediaLog = $null
$mediaUrl = $null

if ($MediaFile) {
    $resolvedMedia = (Resolve-Path -LiteralPath $MediaFile).Path
    $mediaLog = [System.IO.Path]::GetTempFileName()
    $node = (Get-Command node -ErrorAction Stop).Source
    $mediaProcess = Start-Process -FilePath $node -ArgumentList @(
        (Join-Path $repoRoot "web\scripts\range-media-server.mjs"),
        $resolvedMedia,
        "$MediaPort"
    ) -RedirectStandardOutput $mediaLog -WindowStyle Hidden -PassThru
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        $mediaUrl = Get-Content -LiteralPath $mediaLog -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($mediaUrl) { break }
        Start-Sleep -Milliseconds 100
    }
    if (-not $mediaUrl) { throw "Local range media server did not become ready" }
}

Get-Process -Name "JStremio" -ErrorAction SilentlyContinue |
    ForEach-Object { [void]$_.CloseMainWindow() }
Start-Sleep -Seconds 2

$process = Start-Process -FilePath $debugExe -ArgumentList @(
    "--extensions-dir", $extensions,
    "--remote-debugging-port", "$Port",
    "--dev-tools",
    "--no-splash",
    "--disable-update-check"
) -PassThru

try {
    $endpoint = "http://127.0.0.1:$Port"
    $ready = $false
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        try {
            Invoke-RestMethod -Uri "$endpoint/json/version" -TimeoutSec 1 | Out-Null
            $ready = $true
            break
        } catch {
            Start-Sleep -Milliseconds 250
        }
    }

    if (-not $ready) {
        throw "JStremio CDP endpoint did not become ready at $endpoint"
    }

    $env:JSTREMIO_CDP_ENDPOINT = $endpoint
    Push-Location (Join-Path $repoRoot "web")
    try {
        $nodeArguments = @($NodeScript)
        if ($mediaUrl) { $nodeArguments += $mediaUrl }
        node @nodeArguments
        if ($LASTEXITCODE -ne 0) {
            throw "Quick Seek live smoke test failed with exit code $LASTEXITCODE"
        }
    } finally {
        Pop-Location
    }
} finally {
    Get-Process -Id $process.Id -ErrorAction SilentlyContinue |
        ForEach-Object { [void]$_.CloseMainWindow() }
    if ($mediaProcess) {
        Stop-Process -Id $mediaProcess.Id -ErrorAction SilentlyContinue
        Wait-Process -Id $mediaProcess.Id -Timeout 3 -ErrorAction SilentlyContinue
    }
    if ($mediaLog -and (Test-Path -LiteralPath $mediaLog)) {
        for ($attempt = 0; $attempt -lt 10; $attempt++) {
            try {
                Remove-Item -LiteralPath $mediaLog -Force
                break
            } catch {
                Start-Sleep -Milliseconds 100
            }
        }
    }
    Start-Sleep -Seconds 1
}
