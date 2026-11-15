param(
    [string]$SourceImage = (Join-Path $PSScriptRoot 'smspva-icon.png')
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$icoPath = Join-Path $PSScriptRoot 'smspva.ico'
$csPath = Join-Path $PSScriptRoot 'launcher.cs'
$outExe = Join-Path $root 'SMSPVA.exe'
$faviconPath = Join-Path $root 'ui\public\favicon.png'

Add-Type -AssemblyName System.Drawing

function New-RoundedSquareBitmap {
    param([System.Drawing.Image]$Img, [int]$Size)
    $bmp = New-Object System.Drawing.Bitmap $Size, $Size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.Clear([System.Drawing.Color]::Transparent)

    $radius = [Math]::Max(4, [int]($Size * 0.18))
    $gp = New-Object System.Drawing.Drawing2D.GraphicsPath
    $gp.AddArc(0, 0, $radius * 2, $radius * 2, 180, 90)
    $gp.AddArc($Size - $radius * 2, 0, $radius * 2, $radius * 2, 270, 90)
    $gp.AddArc($Size - $radius * 2, $Size - $radius * 2, $radius * 2, $radius * 2, 0, 90)
    $gp.AddArc(0, $Size - $radius * 2, $radius * 2, $radius * 2, 90, 90)
    $gp.CloseFigure()
    $g.SetClip($gp)
    $g.DrawImage($Img, 0, 0, $Size, $Size)
    $gp.Dispose()
    $g.Dispose()
    return $bmp
}

if (-not (Test-Path -LiteralPath $SourceImage)) {
    throw "No se encontró la imagen fuente: $SourceImage"
}

$srcImg = [System.Drawing.Image]::FromFile($SourceImage)
try {
    $favDir = Split-Path -Parent $faviconPath
    if (-not (Test-Path -LiteralPath $favDir)) { New-Item -ItemType Directory -Path $favDir -Force | Out-Null }
    $favBmp = New-RoundedSquareBitmap -Img $srcImg -Size 256
    $favBmp.Save($faviconPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $favBmp.Dispose()

    $sizes = @(256, 64, 48, 32, 16)
    $entries = @()
    foreach ($s in $sizes) {
        $b = New-RoundedSquareBitmap -Img $srcImg -Size $s
        $ps = New-Object System.IO.MemoryStream
        $b.Save($ps, [System.Drawing.Imaging.ImageFormat]::Png)
        $entries += ,@{ Size = $s; Bytes = $ps.ToArray() }
        $ps.Dispose()
        $b.Dispose()
    }
} finally {
    $srcImg.Dispose()
}

$ms = New-Object System.IO.MemoryStream
$bw = New-Object System.IO.BinaryWriter($ms)
$bw.Write([uint16]0)
$bw.Write([uint16]1)
$bw.Write([uint16]$entries.Count)
$offset = 6 + (16 * $entries.Count)
foreach ($e in $entries) {
    $dim = if ($e.Size -ge 256) { [byte]0 } else { [byte]$e.Size }
    $bw.Write($dim)
    $bw.Write($dim)
    $bw.Write([byte]0)
    $bw.Write([byte]0)
    $bw.Write([uint16]1)
    $bw.Write([uint16]32)
    $bw.Write([uint32]$e.Bytes.Length)
    $bw.Write([uint32]$offset)
    $offset += $e.Bytes.Length
}
foreach ($e in $entries) {
    $bw.Write($e.Bytes)
}
[System.IO.File]::WriteAllBytes($icoPath, $ms.ToArray())
$bw.Dispose(); $ms.Dispose()

$csc = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
& $csc /nologo /target:winexe /optimize+ /win32icon:"$icoPath" /reference:System.Windows.Forms.dll /out:"$outExe" "$csPath"
if ($LASTEXITCODE -ne 0) { throw "csc.exe falló ($LASTEXITCODE)." }
Write-Host "Generado: $outExe con icono $icoPath"
