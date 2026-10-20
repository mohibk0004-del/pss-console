$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$assetRoot = Join-Path (Split-Path -Parent $PSScriptRoot) 'assets'
New-Item -ItemType Directory -Path $assetRoot -Force | Out-Null
function Make-Mark([int]$size, [bool]$transparent) {
    $image = [System.Drawing.Bitmap]::new($size, $size)
    $g = [System.Drawing.Graphics]::FromImage($image)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    if ($transparent) { $g.Clear([System.Drawing.Color]::Transparent) }
    else {
        $g.Clear([System.Drawing.Color]::FromArgb(16, 28, 45))
        $pen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(86, 119, 158), [single]($size * .018))
        $g.DrawEllipse($pen, [single]($size * .13), [single]($size * .13), [single]($size * .74), [single]($size * .74))
        $pen.Dispose()
    }
    $font = [System.Drawing.Font]::new('Segoe UI', [single]($size * .36), [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $brush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(235, 243, 254))
    $format = [System.Drawing.StringFormat]::new()
    $format.Alignment = [System.Drawing.StringAlignment]::Center
    $format.LineAlignment = [System.Drawing.StringAlignment]::Center
    $g.DrawString('P', $font, $brush, [System.Drawing.RectangleF]::new(0, -2, $size, $size), $format)
    $font.Dispose(); $brush.Dispose(); $format.Dispose(); $g.Dispose()
    return $image
}
$trayImage = Make-Mark 32 $true
$trayImage.Save((Join-Path $assetRoot 'tray.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$trayImage.Dispose()
$iconImage = Make-Mark 256 $false
$png = [System.IO.MemoryStream]::new()
$iconImage.Save($png, [System.Drawing.Imaging.ImageFormat]::Png)
$iconImage.Dispose()
$bytes = $png.ToArray()
$icoStream = [System.IO.File]::Create((Join-Path $assetRoot 'icon.ico'))
$writer = [System.IO.BinaryWriter]::new($icoStream)
$writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]1)
$writer.Write([byte]0); $writer.Write([byte]0); $writer.Write([byte]0); $writer.Write([byte]0)
$writer.Write([uint16]1); $writer.Write([uint16]32); $writer.Write([uint32]$bytes.Length); $writer.Write([uint32]22)
$writer.Write($bytes); $writer.Dispose(); $png.Dispose()
