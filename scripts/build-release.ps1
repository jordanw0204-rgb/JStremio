[CmdletBinding()]
param(
    [switch]$SkipChecks
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$Version = (Get-Content -Raw -LiteralPath (Join-Path $Root 'Cargo.toml') | Select-String -Pattern '(?m)^version\s*=\s*"([^"]+)"').Matches[0].Groups[1].Value
$UpdaterVersion = (Get-Content -Raw -LiteralPath (Join-Path $Root 'updater\Cargo.toml') | Select-String -Pattern '(?m)^version\s*=\s*"([^"]+)"').Matches[0].Groups[1].Value
if ($Version -ne $UpdaterVersion) { throw 'JStremio and updater package versions do not match.' }
if ($env:GITHUB_REF_TYPE -eq 'tag' -and $env:GITHUB_REF_NAME -ne "v$Version") {
    throw "Tag $env:GITHUB_REF_NAME does not match Cargo version v$Version."
}

if (-not $SkipChecks) {
    & (Join-Path $PSScriptRoot 'check.ps1')
    if ($LASTEXITCODE -ne 0) { throw 'Release checks failed' }
}

$Portable = & (Join-Path $PSScriptRoot 'package-portable.ps1') -Zip | Select-Object -Last 1
if ($LASTEXITCODE -ne 0) { throw 'Portable release packaging failed' }
$InstallerResult = & (Join-Path $PSScriptRoot 'package-installer.ps1') | Select-Object -Last 1 | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw 'Installer release packaging failed' }
$PortableArchive = "$Portable.zip"
if (-not (Test-Path -LiteralPath $PortableArchive)) { throw "Portable archive is missing: $PortableArchive" }

$Checksums = @(
    (Get-FileHash -Algorithm SHA256 -LiteralPath $InstallerResult.Path),
    (Get-FileHash -Algorithm SHA256 -LiteralPath $PortableArchive)
) | ForEach-Object { "{0}  {1}" -f $_.Hash.ToLowerInvariant(), (Split-Path -Leaf $_.Path) }
$ChecksumPath = Join-Path $Root 'installer\SHA256SUMS.txt'
$Checksums | Set-Content -Encoding ascii -LiteralPath $ChecksumPath

Write-Output ([ordered]@{
    Version = $Version
    Installer = $InstallerResult.Path
    Portable = $PortableArchive
    Checksums = $ChecksumPath
} | ConvertTo-Json -Compress)
