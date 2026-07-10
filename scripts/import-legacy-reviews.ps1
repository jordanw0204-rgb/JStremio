[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$Source,
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
$SourcePath = [IO.Path]::GetFullPath($Source)
if (-not (Test-Path -LiteralPath $SourcePath -PathType Leaf)) {
    throw 'The legacy reviews file does not exist.'
}
$Document = Get-Content -Raw -LiteralPath $SourcePath | ConvertFrom-Json
if ($Document.schemaVersion -ne 1 -or $null -eq $Document.reviews) {
    throw 'The legacy file is not a schema-v1 reviews document.'
}
foreach ($Review in $Document.reviews) {
    if ([string]::IsNullOrWhiteSpace($Review.id) -or $Review.rating -lt 1 -or $Review.rating -gt 5) {
        throw 'The legacy reviews document contains an invalid review.'
    }
    if ($null -ne $Review.text -and $Review.text.ToString().Length -gt 5000) {
        throw 'The legacy reviews document contains text longer than 5,000 characters.'
    }
}

$DataDirectory = Join-Path $env:LOCALAPPDATA 'JStremio\data'
$Destination = Join-Path $DataDirectory 'reviews.json'
if ((Test-Path -LiteralPath $Destination) -and -not $Force) {
    throw 'A JStremio reviews file already exists. Back it up, then rerun with -Force to replace it explicitly.'
}
New-Item -ItemType Directory -Force -Path $DataDirectory | Out-Null
$Temporary = Join-Path $DataDirectory ("reviews.json.import-{0}.tmp" -f [guid]::NewGuid())
Copy-Item -LiteralPath $SourcePath -Destination $Temporary
if (Test-Path -LiteralPath $Destination) {
    Copy-Item -LiteralPath $Destination -Destination "$Destination.pre-import.bak" -Force
    Remove-Item -LiteralPath $Destination -Force
}
Move-Item -LiteralPath $Temporary -Destination $Destination
Write-Output $Destination
