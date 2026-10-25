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

$installer = Get-ChildItem -LiteralPath $ReleaseDir -Filter 'GraphDigitizer-*-x64.exe' -File |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
$portable = Get-ChildItem -LiteralPath $ReleaseDir -Filter 'GraphDigitizer-*-portable.exe' -File |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $installer -or -not $portable) {
    throw 'No GraphDigitizer packages found in ' + $ReleaseDir
}
$installer = $installer.FullName
$portable = $portable.FullName

$notes = @'
## Graph Digitizer __VERSION__

Digitise data points out of graphs and plots in images.

### What is new in 1.1.0

**Interface rebuilt**

- A single set of design tokens drives the whole application; the dark and
  light themes were re-tuned together instead of drifting apart.
- The data table was redone: right aligned numbers, tabular figures, zebra
  rows and a compact row height.
- The empty state now carries a three step quick start guide
  (`S` set the scale, `L` pick the curve colour, `T` digitise).
- The theme button shows the icon of the mode that is actually active.

**Experience fixes**

- The *Show detection mask* switch and the opacity slider really work now -
  they were writing to the store while the canvas read a frozen copy.
- The mask overlay stays readable on dark figures (it used a multiply blend
  that turned the curve black).
- Changing the calibration now **recomputes every digitised point** from its
  pixel position, so the table and every export show numbers that match the
  calibration you can see.
- Opening a new figure clears the previous calibration and points instead of
  exporting them under the new file name.
- Renaming a series uses the in-app dialog (Electron has no `window.prompt`).
- TIFF is no longer offered: Chromium cannot decode it, and a file that
  silently fails to open is worse than a format that is honestly missing.

### Highlights

- **Four point calibration** built on a general affine transform, so tilted
  and non-orthogonal axes work; each axis can be linear or logarithmic.
- **Curve identification** by colour, by intensity or combined, with speck
  filtering, thickness compensation and a live mask overlay.
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

- `GraphDigitizer-__VERSION__-x64.exe` - installer, choose the install
  directory, creates a desktop and a Start menu shortcut.
- `GraphDigitizer-__VERSION__-portable.exe` - no installation, double click
  to run.

Both packages are unsigned, so Windows SmartScreen may show a warning on the
first run. The application is a plain local tool: it never touches the
network.

### Requirements

Windows 10 or newer, 64 bit.

### Checksums

    __SHA_INSTALLER__  __INSTALLER_NAME__
    __SHA_PORTABLE__  __PORTABLE_NAME__

### Build from source

    npm install
    npm start          # run it
    npm run dist       # produce the installers in release/
    node tools/algorithm-test.js
'@

$notes = $notes.Replace('__VERSION__', $Tag.TrimStart('v'))
$notes = $notes.Replace('__INSTALLER_NAME__', (Split-Path $installer -Leaf))
$notes = $notes.Replace('__PORTABLE_NAME__', (Split-Path $portable -Leaf))
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
