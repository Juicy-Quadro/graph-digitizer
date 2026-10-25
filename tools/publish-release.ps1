#!/usr/bin/env pwsh
# Finish the GitHub release: set the notes and upload the Windows packages.

param(
    [Parameter(Mandatory = $true)]
    [string]$Token,
    [string]$Owner = 'Juicy-Quadro',
    [string]$Repo = 'graph-digitizer',
    [string]$ReleaseDir = 'E:\projects\graph-digitizer\release',
    [string]$Tag = 'v1.0.0'
)

$ErrorActionPreference = 'Stop'
$api = "https://api.github.com/repos/$Owner/$Repo"
$headers = @{
    'Authorization' = "Bearer $Token"
    'Accept' = 'application/vnd.github+json'
    'X-GitHub-Api-Version' = '2022-11-28'
    'User-Agent' = 'graph-digitizer-release'
}

function Get-Sha256([string]$path) {
    (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLower()
}

$installer = Join-Path $ReleaseDir 'GraphDigitizer-1.0.0-x64.exe'
$portable = Join-Path $ReleaseDir 'GraphDigitizer-1.0.0-portable.exe'

$notes = @'
## Graph Digitizer 1.0.0

Digitise data points out of graphs and plots in images.

### Highlights

- **Four point calibration** built on a general affine transform - tilted and
  non-orthogonal axes work, and each axis can be linear or logarithmic.
- **Curve identification** by colour, by intensity or combined, with speck
  filtering, thickness compensation and a live mask overlay so you can see
  exactly what the detector picked.
- **Automatic line tracing** that walks along the curve, goes straight through
  crossings, bridges the gaps of dashed curves, then smooths and resamples.
- **Area sampling** on a grid that can be rotated and expressed in pixels or
  in logical coordinates.
- **Manual points**, erasing, multiple series, undo and redo.
- **Export** to CSV, text, Excel (XML), XML, JSON, SVG, DXF and EPS, plus a
  clipboard copy and a JSON workspace format.
- **English / Simplified Chinese** interface, dark and light themes; the theme
  follows the operating system by default.

### Accuracy

The tracer was validated against the reference points that GetData Graph
Digitizer 2.26 produced for the same figures: **100 percent of the reference
points within 2 px, 0.80 px mean deviation**.

### Install

- `GraphDigitizer-1.0.0-x64.exe` - installer, choose the install directory,
  creates a desktop and a Start menu shortcut.
- `GraphDigitizer-1.0.0-portable.exe` - no installation, double click to run.

Both packages are unsigned, so Windows SmartScreen may show a warning on the
first run. The application is a plain local tool: it never touches the
network.

### Requirements

Windows 10 or newer, 64 bit.

### Checksums

    __SHA_INSTALLER__  GraphDigitizer-1.0.0-x64.exe
    __SHA_PORTABLE__  GraphDigitizer-1.0.0-portable.exe

### Build from source

    npm install
    npm start          # run it
    npm run dist       # produce the installers in release/
    node tools/algorithm-test.js
'@

$notes = $notes.Replace('__SHA_INSTALLER__', (Get-Sha256 $installer))
$notes = $notes.Replace('__SHA_PORTABLE__', (Get-Sha256 $portable))

# ---------------------------------------------------------------- release
$existing = @(Invoke-RestMethod -Uri "$api/releases" -Headers $headers -Method Get -TimeoutSec 60 |
    Where-Object { $_.tag_name -eq $Tag })
if ($existing.Count -eq 0) {
    Write-Host '--- creating the release ---'
    $payload = @{ tag_name = $Tag; name = 'Graph Digitizer 1.0.0'; body = $notes; draft = $false; prerelease = $false } | ConvertTo-Json
    $release = Invoke-RestMethod -Uri "$api/releases" -Headers $headers -Method Post -Body $payload -ContentType 'application/json' -TimeoutSec 60
} else {
    Write-Host '--- updating the release notes ---'
    $payload = @{ tag_name = $Tag; name = 'Graph Digitizer 1.0.0'; body = $notes; draft = $false; prerelease = $false } | ConvertTo-Json
    $release = Invoke-RestMethod -Uri "$api/releases/$($existing[0].id)" -Headers $headers -Method Patch -Body $payload -ContentType 'application/json' -TimeoutSec 60
}
Write-Host ("    release id = " + $release.id)

# drop any asset that is already there so a rerun is clean
foreach ($a in @($release.assets)) {
    Write-Host ("    removing stale asset " + $a.name)
    Invoke-RestMethod -Uri "$api/releases/assets/$($a.id)" -Headers $headers -Method Delete -TimeoutSec 60 | Out-Null
}

# ---------------------------------------------------------------- assets
$uploadUrl = "https://uploads.github.com/repos/$Owner/$Repo/releases/$($release.id)/assets"
foreach ($asset in @(
    @{ path = $installer; label = 'Windows installer' },
    @{ path = $portable; label = 'Portable, no installation' }
)) {
    $name = Split-Path $asset.path -Leaf
    $size = [math]::Round((Get-Item $asset.path).Length / 1MB, 1)
    Write-Host ("--- uploading " + $name + " (" + $size + " MB) ---")
    $query = [System.Web.HttpUtility]::UrlEncode($name)
    $uploaded = Invoke-RestMethod -Uri "$uploadUrl`?name=$query" -Headers $headers -Method Post `
        -InFile $asset.path -ContentType 'application/octet-stream' -TimeoutSec 1800
    Write-Host ("    uploaded " + $uploaded.name + "  " + $uploaded.size + " bytes")
    Write-Host ("    " + $uploaded.browser_download_url)
}

# ---------------------------------------------------------------- verify
Write-Host '--- verifying ---'
$final = Invoke-RestMethod -Uri "$api/releases/$($release.id)" -Headers $headers -Method Get -TimeoutSec 60
Write-Host ("    " + $final.name + "  tag=" + $final.tag_name + "  draft=" + $final.draft + "  prerelease=" + $final.prerelease)
Write-Host ("    url: " + $final.html_url)
foreach ($a in $final.assets) {
    Write-Host ("    asset " + $a.name + "  " + [math]::Round($a.size / 1MB, 2) + " MB  downloads=" + $a.download_count)
    Write-Host ("          " + $a.browser_download_url)
}
