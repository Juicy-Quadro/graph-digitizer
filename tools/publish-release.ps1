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

### What is new in 1.2.0

This is a defect fix release. An independent audit of the whole code base
found **36 defects**; every one of them is fixed here.

**The numbers were the worst**

- **The calibration used two incompatible geometries at once.** `toLogical`
  projected the point perpendicular onto the axis while the constant-X and
  constant-Y lines were built as affine iso-lines. The two only agree on
  perpendicular axes, so on a tilted figure the logical X of a curve was not
  monotonic and the order of the data was wrong. The model is now a single
  affine basis decomposition. On the tilted reference figure the truth values
  are monotonic again (108 of 108 points, was 77 of 108) and the curvature of
  the mapped curve drops by a factor of 58.
- **Changing the calibration did not update a single digitised point.** The
  table and all eight exports kept the old numbers while the interface showed
  the new calibration. Every point is now recomputed from its pixel position.
- **Opening a second figure kept the calibration and the points of the first
  one**, so the export of file B contained the data of file A.
- The combined mask mode counted the black axes, the grid and the labels as
  curve; the tracer happily followed them (839 px became 155 px).
- The tracer jumped onto an unrelated parallel structure and kept tracing it;
  the tolerance is now measured against the walking point and the heading is
  updated after a bridge (108 points became 49, and a 6 px gap is still
  bridged).
- A run that hit the point limit was silently cut short. The limit is now
  reported and shown in the status bar.
- Area sampling missed intersections at a coarse step, anchored the grid on
  the left edge and returned the intersections of a vertical sampling line in
  no particular order.

**The interface did what it was told**

- A click was measured in **image** pixels, so the same gesture behaved
  differently at every zoom level: at 40x a 40 pixel drag counted as a click,
  at 0.5x a two pixel jitter threw the click away. The threshold is now in
  screen pixels.
- The canvas and the data table kept their own selection. Deleting a point
  made the canvas paint the "selected" colour onto the neighbouring point
  while the table showed an empty selection. The table owns the selection
  now, the canvas mirrors it per series and clamps it to the current point
  count.
- A cancelled pointer (the system took the gesture over) created a data point
  out of thin air.
- The click that ended a cell edit never reached its row.
- The *Show detection mask* switch and the opacity slider did nothing.
- Clicking a series tab did not repaint the canvas.
- Renaming a series could never succeed: Electron has no `window.prompt`.
- The native `Delete` accelerator swallowed the key inside a text field, so
  deleting a character deleted a data point.

**The application was too trusting**

- The renderer was served from `file://`, where `script-src 'self'` matches
  every local file. It now runs on a custom `app://` scheme, so the policy
  really keeps the renderer inside the application. A `file://` script is
  blocked, and it is checked in the test suite.
- The renderer could read **any** file the main process could read through a
  channel that had no caller at all. That channel is gone, and the remaining
  one is limited to the folders the user opened through a native dialog.
- The test hook that the automation uses is behind two switches and does not
  ship in the release.

**The exports told lies**

- A missing measurement was formatted as a real `0`, and the SVG, DXF and EPS
  writers emitted literal `NaN` coordinates, which makes the whole file
  unreadable. Every format now either leaves the cell empty or drops the
  point it cannot represent.
- The header of a multi series CSV, text or spreadsheet file did not line up
  with the data columns.

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
points within 2 px, 0.80 px mean deviation**. The calibration pipeline is
validated on three real workspaces as well: the calibration is valid, every
reference point maps to a finite logical value and the pixel round trip is
below 1e-13 px.

### Regression suites

Five executable suites, 103 assertions in total:

    node tools/run-tests.js

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
    npm test           # run every regression suite
'@

$notes = $notes.Replace('__VERSION__', $Tag.TrimStart('v'))
$notes = $notes.Replace('__INSTALLER_NAME__', (Split-Path $installer -Leaf))
$notes = $notes.Replace('__PORTABLE_NAME__', (Split-Path $portable -Leaf))
$notes = $notes.Replace('__SHA_INSTALLER__', (Get-Sha256 $installer))
$notes = $notes.Replace('__SHA_PORTABLE__', (Get-Sha256 $portable))

# ---------------------------------------------------------------- release
$version = $Tag.TrimStart('v')
$releaseName = 'Graph Digitizer ' + $version
$existing = @(Invoke-RestMethod -Uri "$api/releases" -Headers $headers -Method Get -TimeoutSec 60 |
    Where-Object { $_.tag_name -eq $Tag })
if ($existing.Count -eq 0) {
    Write-Host '--- creating the release ---'
    $payload = @{ tag_name = $Tag; name = $releaseName; body = $notes; draft = $false; prerelease = $false } | ConvertTo-Json
    $release = Invoke-RestMethod -Uri "$api/releases" -Headers $headers -Method Post -Body $payload -ContentType 'application/json' -TimeoutSec 60
} else {
    Write-Host '--- updating the release notes ---'
    $payload = @{ tag_name = $Tag; name = $releaseName; body = $notes; draft = $false; prerelease = $false } | ConvertTo-Json
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
