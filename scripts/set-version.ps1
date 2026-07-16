[CmdletBinding(SupportsShouldProcess)]
param(
    [Parameter(Mandatory)]
    [ValidatePattern('^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$')]
    [string]$Version
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$Files = @(
    (Join-Path $Root 'Cargo.toml'),
    (Join-Path $Root 'updater\Cargo.toml')
)

foreach ($File in $Files) {
    $Content = Get-Content -Raw -LiteralPath $File
    $VersionPattern = [regex]::new('(?m)^(version\s*=\s*)"[^"]+"')
    $Updated = $VersionPattern.Replace($Content, "`$1`"$Version`"", 1)
    if ($Updated -eq $Content) { throw "No package version was found in $File" }
    if ($PSCmdlet.ShouldProcess($File, "Set version to $Version")) {
        [IO.File]::WriteAllText($File, $Updated, [Text.UTF8Encoding]::new($false))
    }
}

if (-not $WhatIfPreference) {
    cargo check --manifest-path (Join-Path $Root 'Cargo.toml') --offline | Out-Host
    if ($LASTEXITCODE -ne 0) { throw 'Could not refresh the JStremio lockfile' }
    cargo check --manifest-path (Join-Path $Root 'updater\Cargo.toml') --offline | Out-Host
    if ($LASTEXITCODE -ne 0) { throw 'Could not refresh the updater lockfile' }
}

if ($WhatIfPreference) {
    Write-Output "JStremio version would be set to $Version"
} else {
    Write-Output "JStremio version is now $Version"
}
