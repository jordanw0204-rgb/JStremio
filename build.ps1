[CmdletBinding()]
param(
    [switch]$Installer,
    [switch]$Zip
)

$ErrorActionPreference = 'Stop'
if ($Installer) {
    & (Join-Path $PSScriptRoot 'scripts\package-installer.ps1')
}
else {
    & (Join-Path $PSScriptRoot 'scripts\package-portable.ps1') -Zip:$Zip
}
