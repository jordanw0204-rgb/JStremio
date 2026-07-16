[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$SidebarSource,
    [string]$OutputDirectory = (Join-Path (Split-Path -Parent $PSScriptRoot) 'images')
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

function Save-ResizedBitmap {
    param(
        [Parameter(Mandatory)] [string]$Source,
        [Parameter(Mandatory)] [string]$Destination,
        [Parameter(Mandatory)] [int]$Width,
        [Parameter(Mandatory)] [int]$Height,
        [int]$Margin = 0,
        [System.Drawing.Color]$Background = [System.Drawing.Color]::White
    )

    $Image = [System.Drawing.Image]::FromFile($Source)
    $Bitmap = New-Object System.Drawing.Bitmap($Width, $Height, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
    $Graphics = [System.Drawing.Graphics]::FromImage($Bitmap)
    try {
        $Graphics.Clear($Background)
        $Graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
        $Graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $Graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $Graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
        $Graphics.DrawImage($Image, $Margin, $Margin, $Width - (2 * $Margin), $Height - (2 * $Margin))
        $Bitmap.Save($Destination, [System.Drawing.Imaging.ImageFormat]::Bmp)
    }
    finally {
        $Graphics.Dispose()
        $Bitmap.Dispose()
        $Image.Dispose()
    }
}

New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
$Root = Split-Path -Parent $PSScriptRoot
Save-ResizedBitmap -Source $SidebarSource -Destination (Join-Path $OutputDirectory 'jstremio-installer-sidebar-v2.bmp') -Width 164 -Height 314 -Background ([System.Drawing.Color]::FromArgb(6, 16, 55))
Save-ResizedBitmap -Source (Join-Path $Root 'images\jstremio.png') -Destination (Join-Path $OutputDirectory 'jstremio-installer-header-v2.bmp') -Width 55 -Height 55 -Margin 3
