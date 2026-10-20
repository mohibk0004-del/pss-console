$ErrorActionPreference = 'Stop'
$sourceRoot = Split-Path -Parent $PSScriptRoot
$outputRoot = Split-Path -Parent $sourceRoot
$archivePath = Join-Path $outputRoot 'PSS-Source-1.1.1.zip'
tar.exe -a -c -f $archivePath --exclude 'PSS-Source/.git' --exclude 'PSS-Source/installer/generated' --exclude 'PSS-Source/installer/bin' --exclude 'PSS-Source/installer/obj' --exclude 'PSS-Source/installer/publish' --exclude 'PSS-Source/installer/publish-uninstaller' --exclude 'PSS-Source/node_modules' --exclude 'PSS-Source/dist' --exclude 'PSS-Source/native/bin' --exclude 'PSS-Source/native/obj' --exclude 'PSS-Source/native/publish' --exclude 'PSS-Source/native/download' --exclude 'PSS-Source/tests/fixtures/bin' --exclude 'PSS-Source/tests/fixtures/obj' -C $outputRoot 'PSS-Source'
if ($LASTEXITCODE -ne 0) { throw 'Source archive creation failed.' }
Get-Item -LiteralPath $archivePath | Select-Object Name,Length
