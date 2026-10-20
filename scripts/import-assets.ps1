param(
    [string]$SoundDirectory = (Join-Path $env:USERPROFILE 'Downloads\PS5 Sounds By Dan Patrick\PS5 V2'),
    [string]$FontDirectory = (Join-Path $env:LOCALAPPDATA 'Microsoft\Windows\Fonts')
)
$ErrorActionPreference = 'Stop'
$sourceRoot = Split-Path -Parent $PSScriptRoot
$soundTarget = Join-Path $sourceRoot 'public\sounds'
$fontTarget = Join-Path $sourceRoot 'public\fonts'
New-Item -ItemType Directory -Force -Path $soundTarget,$fontTarget | Out-Null
foreach ($name in @('Move.wav','Select.wav','Back.wav','Startup.wav')) {
    $source = Join-Path $SoundDirectory $name
    if (-not (Test-Path -LiteralPath $source)) { throw "Sound file missing: $source" }
    Copy-Item -LiteralPath $source -Destination (Join-Path $soundTarget $name) -Force
}
foreach ($name in @('SSTRg.TTF','SSTLight.TTF','SSTMedium.TTF','SSTBold.TTF')) {
    $source = Join-Path $FontDirectory $name
    if (-not (Test-Path -LiteralPath $source)) { $source = Join-Path (Join-Path $env:WINDIR 'Fonts') $name }
    if (-not (Test-Path -LiteralPath $source)) { throw "SST font missing: $name. Pass -FontDirectory containing your font files." }
    Copy-Item -LiteralPath $source -Destination (Join-Path $fontTarget $name) -Force
}
Write-Output 'Local SST fonts and supplied PS5 V2 sounds imported.'
