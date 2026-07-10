[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$Web = Join-Path $Root 'web'

function Invoke-Native([scriptblock]$Command) {
    & $Command
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed with exit code $LASTEXITCODE"
    }
}

Push-Location $Web
try {
    Invoke-Native { corepack pnpm@11.0.0 install --frozen-lockfile }
    Invoke-Native { corepack pnpm@11.0.0 build }
}
finally {
    Pop-Location
}
