[CmdletBinding()]
param(
    [switch]$SkipBrowser
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$Web = Join-Path $Root 'web'
$Target = 'x86_64-pc-windows-msvc'

function Invoke-Native([scriptblock]$Command) {
    & $Command
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed with exit code $LASTEXITCODE"
    }
}

Push-Location $Root
try {
    Invoke-Native { cargo fmt --all -- --check }
    Invoke-Native { cargo clippy --locked --all-targets --target $Target -- -D warnings }
    Invoke-Native { cargo test --locked --target $Target }
    Push-Location $Web
    try {
        Invoke-Native { corepack pnpm@11.0.0 install --frozen-lockfile }
        Invoke-Native { corepack pnpm@11.0.0 typecheck }
        Invoke-Native { corepack pnpm@11.0.0 test }
        Invoke-Native { corepack pnpm@11.0.0 build }
        if (-not $SkipBrowser) {
            Invoke-Native { corepack pnpm@11.0.0 exec playwright test }
        }
    }
    finally {
        Pop-Location
    }
    Invoke-Native { cargo build --locked --release --target $Target }
}
finally {
    Pop-Location
}
