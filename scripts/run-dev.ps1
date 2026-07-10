[CmdletBinding()]
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$JStremioArgs
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
& (Join-Path $PSScriptRoot 'build-web.ps1')

Push-Location $Root
try {
    $ExtensionDirectory = Join-Path $Root 'resources\extensions'
    $DebugDirectory = Join-Path $Root 'target\x86_64-pc-windows-msvc\debug'
    cargo build --locked --target x86_64-pc-windows-msvc
    if ($LASTEXITCODE -ne 0) {
        throw "Debug build failed with exit code $LASTEXITCODE"
    }

    Copy-Item -Force -LiteralPath (Join-Path $Root 'server.js'), (Join-Path $Root 'libmpv-2.dll') -Destination $DebugDirectory
    Get-ChildItem -File -LiteralPath (Join-Path $Root 'bin') | Copy-Item -Force -Destination $DebugDirectory

    & (Join-Path $DebugDirectory 'JStremio.exe') --extensions-dir $ExtensionDirectory --dev-tools @JStremioArgs
    if ($LASTEXITCODE -ne 0) {
        throw "JStremio exited with code $LASTEXITCODE"
    }
}
finally {
    Pop-Location
}
