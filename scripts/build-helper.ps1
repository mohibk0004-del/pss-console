$ErrorActionPreference = 'Stop'
$sourceRoot = Split-Path -Parent $PSScriptRoot
$nativeRoot = Join-Path $sourceRoot 'native'
if (-not (Test-Path -LiteralPath (Join-Path $nativeRoot 'SDL3.dll'))) {
    $release = Invoke-RestMethod -Uri 'https://api.github.com/repos/libsdl-org/SDL/releases/latest' -Headers @{ 'User-Agent' = 'PSS-Console-Build' }
    $asset = $release.assets | Where-Object { $_.name -match '^SDL3-[\d.]+-win32-x64.zip$' } | Select-Object -First 1
    if (-not $asset) { throw 'Official SDL3 Windows x64 release not found.' }
    $downloadRoot = Join-Path $nativeRoot 'download'
    New-Item -ItemType Directory -Force -Path $downloadRoot | Out-Null
    $zipPath = Join-Path $downloadRoot $asset.name
    Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $zipPath
    if ($asset.digest -like 'sha256:*') {
        $actual = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($actual -ne $asset.digest.Substring(7)) { throw 'SDL3 download checksum mismatch.' }
    }
    Expand-Archive -LiteralPath $zipPath -DestinationPath $downloadRoot -Force
    $dll = Get-ChildItem -LiteralPath $downloadRoot -Recurse -Filter SDL3.dll | Select-Object -First 1
    Copy-Item -LiteralPath $dll.FullName -Destination (Join-Path $nativeRoot 'SDL3.dll')
    $license = Get-ChildItem -LiteralPath $downloadRoot -Recurse -File | Where-Object { $_.Name -match 'LICENSE' } | Select-Object -First 1
    if ($license) { Copy-Item -LiteralPath $license.FullName -Destination (Join-Path $nativeRoot 'SDL-LICENSE.txt') }
    else { Invoke-WebRequest -Uri ('https://raw.githubusercontent.com/libsdl-org/SDL/' + $release.tag_name + '/LICENSE.txt') -OutFile (Join-Path $nativeRoot 'SDL-LICENSE.txt') }
    @{ version = $release.tag_name; url = $asset.browser_download_url; sha256 = (Get-FileHash -LiteralPath $zipPath).Hash } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $nativeRoot 'sdl-version.json')
}
dotnet publish (Join-Path $nativeRoot 'PssHelper.csproj') -c Release -r win-x64 --self-contained true -o (Join-Path $nativeRoot 'publish')
if ($LASTEXITCODE -ne 0) { throw 'Native helper build failed.' }
