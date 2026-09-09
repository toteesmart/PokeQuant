Add-Type -AssemblyName System.Drawing
$b = [System.Drawing.Bitmap]::FromFile("C:\Users\Drawi\Documents\PokeQuant\PokeQuantMobile\logo.png")
Write-Output ("PixelFormat: " + $b.PixelFormat + "  Size: " + $b.Width + "x" + $b.Height)
$pts = @(0,0), (500,0), (1000,0), (1000,100), (1000,500), (1000,1500), (500,200), (1500,200), (1999,1999)
foreach ($p in $pts) {
    $c = $b.GetPixel($p[0], $p[1])
    Write-Output ("pixel(" + $p[0] + "," + $p[1] + ") = RGB(" + $c.R + "," + $c.G + "," + $c.B + ")")
}
$b.Dispose()
