[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^v\d+\.\d+\.\d+$')]
    [string]$Release
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Push-Location $Root
try {
    if (git status --porcelain) {
        throw 'The working tree must be clean before fetching an upstream release.'
    }
    git fetch --no-tags shell-upstream tag $Release
    if ($LASTEXITCODE -ne 0) { throw 'Could not fetch the requested shell release.' }
    $Commit = git rev-parse "refs/tags/$Release^{commit}"
    Write-Output "Fetched $Release at $Commit. Create a dedicated update branch, refresh upstream.lock.json, run the stock baseline, then run scripts/check.ps1 and the manual playback matrix before merging."
}
finally {
    Pop-Location
}
