# Generates App Store screenshot sizes from raw iPhone screenshots.
# Usage: powershell -File Make-StoreScreenshots.ps1 -SrcDir <dir> -OutDir <dir>
#
# Outputs per source PNG:
#   <OutDir>\iphone65\<name>.png  -> 1284x2778  (6.5" display, cover-fit)
#   <OutDir>\ipad13\<name>.png    -> 2048x2732  (13" iPad, contain-fit on sampled bg)

param(
    [string]$SrcDir = "C:\Users\Drawi\Documents\PokeQuant\screenshots\src",
    [string]$OutDir = "C:\Users\Drawi\Documents\PokeQuant\screenshots\store"
)

Add-Type -AssemblyName System.Drawing

function New-StoreShot {
    param(
        [string]$SrcPath,
        [string]$DestPath,
        [int]$TargetW,
        [int]$TargetH,
        [ValidateSet("cover","contain")][string]$Fit
    )

    $src = [System.Drawing.Bitmap]::FromFile($SrcPath)
    try {
        # Sample the app's background color from the top-left pixel for padding.
        $bg = $src.GetPixel(2, 2)

        $dst = New-Object System.Drawing.Bitmap($TargetW, $TargetH)
        $g = [System.Drawing.Graphics]::FromImage($dst)
        try {
            $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
            $g.Clear($bg)

            if ($Fit -eq "cover") {
                $scale = [Math]::Max($TargetW / $src.Width, $TargetH / $src.Height)
            } else {
                $scale = [Math]::Min($TargetW / $src.Width, $TargetH / $src.Height)
            }
            $w = [int][Math]::Round($src.Width * $scale)
            $h = [int][Math]::Round($src.Height * $scale)
            $x = [int][Math]::Round(($TargetW - $w) / 2)
            $y = [int][Math]::Round(($TargetH - $h) / 2)

            $g.DrawImage($src, $x, $y, $w, $h)
            $dst.Save($DestPath, [System.Drawing.Imaging.ImageFormat]::Png)
            Write-Output "OK  $DestPath  (${w}x${h} @$x,$y)"
        } finally {
            $g.Dispose()
            $dst.Dispose()
        }
    } finally {
        $src.Dispose()
    }
}

$iphoneDir = Join-Path $OutDir "iphone65"
$ipadDir = Join-Path $OutDir "ipad13"
New-Item -ItemType Directory -Force -Path $iphoneDir, $ipadDir | Out-Null

$files = Get-ChildItem -Path $SrcDir -Filter *.png
if ($files.Count -eq 0) { Write-Output "No PNGs found in $SrcDir"; exit 1 }

foreach ($f in $files) {
    New-StoreShot -SrcPath $f.FullName -DestPath (Join-Path $iphoneDir $f.Name) -TargetW 1284 -TargetH 2778 -Fit "cover"
    New-StoreShot -SrcPath $f.FullName -DestPath (Join-Path $ipadDir $f.Name) -TargetW 2048 -TargetH 2732 -Fit "contain"
}
Write-Output "Done. $($files.Count) screenshot(s) -> $OutDir"
