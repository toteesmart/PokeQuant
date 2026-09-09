Add-Type -AssemblyName System.Drawing
Get-ChildItem 'C:\Users\Drawi\Documents\PokeQuant\screenshots\store' -Recurse -Filter *.png | ForEach-Object {
    $b = [System.Drawing.Bitmap]::FromFile($_.FullName)
    Write-Output ($_.Directory.Name + '/' + $_.Name + ' = ' + $b.Width + 'x' + $b.Height)
    $b.Dispose()
}
