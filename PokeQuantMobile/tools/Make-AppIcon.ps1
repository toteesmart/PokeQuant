# Generates 1024x1024 opaque App Store icons from logo.png.
# The source has an opaque white background — flood-fill near-white pixels
# connected to the border so interior texture is preserved.
param(
    [string]$Src = "C:\Users\Drawi\Documents\PokeQuant\PokeQuantMobile\logo.png",
    [string]$OutDir = "C:\Users\Drawi\Documents\PokeQuant\screenshots"
)

Add-Type -AssemblyName System.Drawing

function Remove-WhiteBackground {
    param([System.Drawing.Bitmap]$Bmp, [byte]$Threshold = 250)
    $w = $Bmp.Width; $h = $Bmp.Height
    $rect = New-Object System.Drawing.Rectangle(0, 0, $w, $h)
    $data = $Bmp.LockBits($rect, 'ReadWrite', 'Format32bppArgb')
    try {
        $bytes = New-Object byte[] ($data.Stride * $h)
        [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $bytes, 0, $bytes.Length)
        $visited = New-Object bool[] ($w * $h)
        $queue = New-Object System.Collections.Generic.Queue[int]
        for ($x = 0; $x -lt $w; $x++) { $queue.Enqueue($x); $queue.Enqueue(($h - 1) * $w + $x) }
        for ($y = 0; $y -lt $h; $y++) { $queue.Enqueue($y * $w); $queue.Enqueue($y * $w + $w - 1) }
        while ($queue.Count -gt 0) {
            $i = $queue.Dequeue()
            if ($visited[$i]) { continue }
            $visited[$i] = $true
            $o = ($i / $w -as [int]) * $data.Stride + ($i % $w) * 4
            $b = $bytes[$o]; $g = $bytes[$o + 1]; $r = $bytes[$o + 2]
            if ($r -lt $Threshold -or $g -lt $Threshold -or $b -lt $Threshold) { continue }
            $bytes[$o + 3] = 0
            $x = $i % $w; $y = [int]($i / $w)
            if ($x -gt 0) { $queue.Enqueue($i - 1) }
            if ($x -lt $w - 1) { $queue.Enqueue($i + 1) }
            if ($y -gt 0) { $queue.Enqueue($i - $w) }
            if ($y -lt $h - 1) { $queue.Enqueue($i + $w) }
        }
        [System.Runtime.InteropServices.Marshal]::Copy($bytes, 0, $data.Scan0, $bytes.Length)
    } finally { $Bmp.UnlockBits($data) }
}

function New-Icon {
    param([string]$BgHex, [string]$Dest, [double]$Scale = 0.85)
    $src = [System.Drawing.Bitmap]::FromFile($Src)
    try {
        # logo.png is Format24bppRgb — copy into a 32bppArgb bitmap so the
        # flood-fill can actually write alpha.
        $src32 = New-Object System.Drawing.Bitmap($src.Width, $src.Height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
        $gTmp = [System.Drawing.Graphics]::FromImage($src32)
        try { $gTmp.DrawImage($src, 0, 0) } finally { $gTmp.Dispose() }
        Remove-WhiteBackground -Bmp $src32
        $src = $src32
        $dst = New-Object System.Drawing.Bitmap(1024, 1024)
        $g = [System.Drawing.Graphics]::FromImage($dst)
        try {
            $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
            $g.Clear([System.Drawing.ColorTranslator]::FromHtml($BgHex))
            $fit = [Math]::Min(1024 / $src.Width, 1024 / $src.Height) * $Scale
            $w = [int][Math]::Round($src.Width * $fit)
            $h = [int][Math]::Round($src.Height * $fit)
            $x = [int][Math]::Round((1024 - $w) / 2)
            $y = [int][Math]::Round((1024 - $h) / 2)
            $g.DrawImage($src, $x, $y, $w, $h)
            $dst.Save($Dest, [System.Drawing.Imaging.ImageFormat]::Png)
            Write-Output "OK $Dest"
        } finally { $g.Dispose(); $dst.Dispose() }
    } finally { $src.Dispose() }
}

New-Icon -BgHex "#0e1117" -Dest (Join-Path $OutDir "icon-dark.png")
New-Icon -BgHex "#ffffff" -Dest (Join-Path $OutDir "icon-light.png")
