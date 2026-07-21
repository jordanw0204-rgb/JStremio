param(
    [int]$Port = 9222
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$debugExe = Join-Path $repoRoot "target\x86_64-pc-windows-msvc\debug\JStremio.exe"
$extensions = Join-Path $repoRoot "resources\extensions"

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
        node scripts/quick-seek-live-smoke.mjs
        if ($LASTEXITCODE -ne 0) {
            throw "Quick Seek live smoke test failed with exit code $LASTEXITCODE"
        }
    } finally {
        Pop-Location
    }
} finally {
    Get-Process -Id $process.Id -ErrorAction SilentlyContinue |
        ForEach-Object { [void]$_.CloseMainWindow() }
    Start-Sleep -Seconds 1
}
