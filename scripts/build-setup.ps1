param([switch]$SkipAppBuild)
$ErrorActionPreference = 'Stop'
$sourceRoot = Split-Path -Parent $PSScriptRoot
$outputRoot = Join-Path (Split-Path -Parent $sourceRoot) 'PSS-Builds'
$installerRoot = Join-Path $sourceRoot 'installer'
$generated = Join-Path $installerRoot 'generated'
foreach ($asset in @('public\fonts\SSTRg.TTF','public\sounds\Move.wav','native\publish\PssHelper.exe')) {
    if (-not (Test-Path -LiteralPath (Join-Path $sourceRoot $asset))) { throw "Build input missing: $asset. Run assets:local and helper first." }
}
if (-not $SkipAppBuild) {
    Push-Location $sourceRoot
    try { & npx.cmd electron-builder --win dir --x64; if ($LASTEXITCODE -ne 0) { throw 'App packaging failed.' } }
    finally { Pop-Location }
}
New-Item -ItemType Directory -Force -Path $generated | Out-Null
$uninstallerOutput = Join-Path $installerRoot 'publish-uninstaller'
dotnet publish (Join-Path $installerRoot 'PssSetup.csproj') -c Release -r win-x64 --self-contained true '-p:EmbedPayload=false' -o $uninstallerOutput
if ($LASTEXITCODE -ne 0) { throw 'Custom uninstaller build failed.' }
$appRoot = Join-Path $outputRoot 'win-unpacked'
Copy-Item -LiteralPath (Join-Path $uninstallerOutput 'PssSetup.exe') -Destination (Join-Path $appRoot 'Uninstall PSS Console.exe') -Force
$payload = Join-Path $generated 'payload.zip'
if (Test-Path -LiteralPath $payload) { Remove-Item -LiteralPath $payload }
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory($appRoot,$payload,[System.IO.Compression.CompressionLevel]::Optimal,$false)
$appFiles = @(Get-ChildItem -LiteralPath $appRoot -Recurse -File)
$hashAlgorithm = [System.Security.Cryptography.SHA256]::Create()
$hashStream = [System.IO.File]::OpenRead($payload)
try { $payloadHash = [BitConverter]::ToString($hashAlgorithm.ComputeHash($hashStream)).Replace('-','') }
finally { $hashStream.Dispose(); $hashAlgorithm.Dispose() }
$totalBytes = 0L
foreach ($appFile in $appFiles) { $totalBytes += $appFile.Length }
$manifest = @{ Version='1.2.0'; Sha256=$payloadHash; UncompressedBytes=$totalBytes; Files=$appFiles.Count }
$manifest | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $generated 'payload.json') -Encoding utf8
$setupOutput = Join-Path $installerRoot 'publish'
dotnet publish (Join-Path $installerRoot 'PssSetup.csproj') -c Release -r win-x64 --self-contained true '-p:EmbedPayload=true' -o $setupOutput
if ($LASTEXITCODE -ne 0) { throw 'Custom setup build failed.' }
Copy-Item -LiteralPath (Join-Path $setupOutput 'PssSetup.exe') -Destination (Join-Path $outputRoot 'PSS-Console-Setup-1.2.0-x64.exe') -Force
$portable = Join-Path $outputRoot 'PSS-Console-Portable-1.2.0-x64.zip'
Copy-Item -LiteralPath $payload -Destination $portable -Force
Get-Item -LiteralPath (Join-Path $outputRoot 'PSS-Console-Setup-1.2.0-x64.exe'),$portable | Select-Object Name,Length
