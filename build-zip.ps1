# Chrome Web Store'a yuklenecek ZIP'i olusturur.
# Kullanim: powershell -ExecutionPolicy Bypass -File build-zip.ps1
# Sadece eklentinin calismasi icin gereken dosyalar eklenir.

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

$version = (Get-Content manifest.json -Raw | ConvertFrom-Json).version
New-Item -ItemType Directory -Force dist | Out-Null
$zip = "dist\tote-lookup-assistant-$version.zip"
if (Test-Path $zip) { Remove-Item $zip -Confirm:$false }

$include = @('manifest.json', 'icons', 'background', 'offscreen', 'shared', 'sidepanel')

# Windows'un tar.exe'si ZIP icinde '/' ayiracini kullanir (Compress-Archive '\' kullanir ve magaza bunu reddedebilir).
tar.exe -a -c -f $zip @include
if ($LASTEXITCODE -ne 0) { throw "ZIP olusturulamadi" }

Write-Host "Hazir: $zip"
tar.exe -t -f $zip
