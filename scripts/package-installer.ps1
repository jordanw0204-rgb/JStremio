[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
& (Join-Path $PSScriptRoot 'build-web.ps1')
Push-Location $Root
try {
    cargo build --locked --release --target x86_64-pc-windows-msvc
    if ($LASTEXITCODE -ne 0) { throw 'Release build failed' }
    $Compiler = 'C:\Program Files (x86)\Inno Setup 6\ISCC.exe'
    if (-not (Test-Path -LiteralPath $Compiler)) {
        throw 'Inno Setup 6 is not installed. The portable package does not require it.'
    }
    & $Compiler (Join-Path $Root 'setup\JStremio.iss')
    if ($LASTEXITCODE -ne 0) { throw 'Installer build failed' }
}
finally {
    Pop-Location
}
