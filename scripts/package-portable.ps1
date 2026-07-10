[CmdletBinding()]
param(
    [string]$OutputRoot = 'artifacts',
    [switch]$Zip
)

$ErrorActionPreference = 'Stop'
$Root = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$OutputRootPath = [IO.Path]::GetFullPath((Join-Path $Root $OutputRoot))
$Version = (Get-Content -Raw -LiteralPath (Join-Path $Root 'Cargo.toml') | Select-String -Pattern '(?m)^version\s*=\s*"([^"]+)"').Matches[0].Groups[1].Value
$PackageName = "JStremio-$Version-windows-x64-portable"
$Destination = [IO.Path]::GetFullPath((Join-Path $OutputRootPath $PackageName))

function Test-PathWithin([string]$Child, [string]$Parent) {
    $Separators = [char[]]@([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
    $Boundary = $Parent.TrimEnd($Separators) + [IO.Path]::DirectorySeparatorChar
    return $Child.Equals($Parent, [StringComparison]::OrdinalIgnoreCase) -or
        $Child.StartsWith($Boundary, [StringComparison]::OrdinalIgnoreCase)
}

if (-not (Test-PathWithin $OutputRootPath $Root)) {
    throw 'OutputRoot must resolve inside the repository.'
}
if (-not (Test-PathWithin $Destination $OutputRootPath)) {
    throw 'Portable destination escaped OutputRoot.'
}

& (Join-Path $PSScriptRoot 'build-web.ps1')
Push-Location $Root
try {
    cargo build --locked --release --target x86_64-pc-windows-msvc
    if ($LASTEXITCODE -ne 0) { throw 'Release build failed' }
}
finally {
    Pop-Location
}

if (Test-Path -LiteralPath $Destination) {
    Remove-Item -Recurse -Force -LiteralPath $Destination
}
New-Item -ItemType Directory -Path $Destination | Out-Null

$Release = Join-Path $Root 'target\x86_64-pc-windows-msvc\release'
Copy-Item -LiteralPath (Join-Path $Release 'JStremio.exe') -Destination $Destination
Copy-Item -LiteralPath (Join-Path $Root 'libmpv-2.dll'), (Join-Path $Root 'server.js') -Destination $Destination
Get-ChildItem -File -LiteralPath (Join-Path $Root 'bin') | Copy-Item -Destination $Destination
Copy-Item -Recurse -LiteralPath (Join-Path $Root 'resources') -Destination $Destination
Copy-Item -LiteralPath (Join-Path $Root 'README.md'), (Join-Path $Root 'LICENSE.md'), (Join-Path $Root 'upstream.lock.json') -Destination $Destination

$Files = Get-ChildItem -File -Recurse -LiteralPath $Destination | Sort-Object FullName
$Manifest = [ordered]@{
    schemaVersion = 1
    product = 'JStremio'
    version = $Version
    architecture = 'x86_64-pc-windows-msvc'
    createdAt = (Get-Date).ToUniversalTime().ToString('o')
    files = @($Files | ForEach-Object {
        [ordered]@{
            path = $_.FullName.Substring($Destination.Length).TrimStart('\').Replace('\', '/')
            bytes = $_.Length
            sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash
        }
    })
}
$Manifest | ConvertTo-Json -Depth 5 | Set-Content -Encoding utf8 -LiteralPath (Join-Path $Destination 'build-manifest.json')

if ($Zip) {
    $Archive = "$Destination.zip"
    if (Test-Path -LiteralPath $Archive) { Remove-Item -Force -LiteralPath $Archive }
    Compress-Archive -Path $Destination -DestinationPath $Archive -CompressionLevel Optimal
}

Write-Output $Destination
