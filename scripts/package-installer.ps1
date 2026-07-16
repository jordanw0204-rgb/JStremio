[CmdletBinding()]
param(
    [string]$OutputDirectory = 'installer'
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$OutputPath = [IO.Path]::GetFullPath((Join-Path $Root $OutputDirectory))
$Version = (Get-Content -Raw -LiteralPath (Join-Path $Root 'Cargo.toml') | Select-String -Pattern '(?m)^version\s*=\s*"([^"]+)"').Matches[0].Groups[1].Value
& (Join-Path $PSScriptRoot 'build-web.ps1')
Push-Location $Root
try {
    cargo build --locked --release --target x86_64-pc-windows-msvc
    if ($LASTEXITCODE -ne 0) { throw 'Release build failed' }
}
finally {
    Pop-Location
}

Push-Location (Join-Path $Root 'updater')
try {
    cargo build --locked --release --target x86_64-pc-windows-msvc
    if ($LASTEXITCODE -ne 0) { throw 'Updater release build failed' }
}
finally {
    Pop-Location
}

$CompilerCandidates = @(
    'C:\Program Files (x86)\Inno Setup 6\ISCC.exe',
    (Join-Path $env:LOCALAPPDATA 'Programs\Inno Setup 6\ISCC.exe')
)
$Compiler = $CompilerCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $Compiler) {
    $Command = Get-Command ISCC.exe -ErrorAction SilentlyContinue
    if ($Command) { $Compiler = $Command.Source }
}
if (-not $Compiler) {
    throw 'Inno Setup 6 is required. Install it with: winget install --id JRSoftware.InnoSetup -e'
}

New-Item -ItemType Directory -Force -Path $OutputPath | Out-Null
& $Compiler "/O$OutputPath" (Join-Path $Root 'setup\JStremio.iss')
if ($LASTEXITCODE -ne 0) { throw 'Installer build failed' }

$Installer = Join-Path $OutputPath "JStremioSetup-v${Version}_x64-unsigned.exe"
if (-not (Test-Path -LiteralPath $Installer)) { throw "Installer was not created at $Installer" }
$Hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $Installer).Hash
Write-Output ([ordered]@{ Path = $Installer; Version = $Version; SHA256 = $Hash } | ConvertTo-Json -Compress)
