[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$Web = Join-Path $Root 'web'

Push-Location $Web
try {
    corepack pnpm@11.0.0 install --frozen-lockfile
    if ($LASTEXITCODE -ne 0) { throw 'pnpm install failed' }
    corepack pnpm@11.0.0 test:e2e
    if ($LASTEXITCODE -ne 0) { throw 'Playwright tests failed' }
}
finally {
    Pop-Location
}
