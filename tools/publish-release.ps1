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

### What is new in 1.3.2

The readme now shows what the application actually does: the colour map
extraction with its framed bar, its tick values and the field it recovered,
the curves the model read out of a figure, the region sampling and the
settings with the key of the model.

- Six screenshots of the running application, in both themes and both
  languages.
- The colour map panel is shown from the framing of the bar to the exported
  grid, so the whole path is visible in one picture.

The release of 1.3.1 carries the two fixes that the real paper figures
found. They are worth repeating here, because they change the numbers you
get:

- **The colour lookup was too coarse.** It used a fixed 32 x 32 x 32 table of
  colours, and one cell of that table is eight units of colour - more than
  fifty pixels of a colour bar that is eighteen hundred pixels long. The
  colour of a pixel was therefore matched to the wrong band and the number
  came out about two percent off. The lookup now searches for the exact
  nearest band, and the error is below one percent of the value range.
- **The tick labels of a colour bar usually do not reach its ends.** On a
  real figure the labels only cover the middle of the bar, and the values
  outside the known labels were held flat, which reports the same number
  for a whole part of the figure. They are now continued along the line of
  the nearest two labels.

Measured on four panels with a colour bar taken from arXiv 2601.00342,
covering a jet map, a diverging map and labels that stop in the middle of
the bar:

| panel | colour map | tick labels | error |
|---|---|---|---|
| uv_a1 | jet | 5 / 0 / -5 (1e-1) | 0.77 percent of the range |
| uv_a2 | jet | 5 / 0 / -5 (1e-1) | 0.77 percent of the range |
| uv_a3 | diverging | 1 / 0 (1e-6) | 1.72 percent of the range |
| uv_b1 | jet | -6 / -7 (1e-2) | 0.73 percent of the range |

The largest error is at the flat end of a colour map, where the colour
simply does not tell the number.

### What was new in 1.3.1

The colour bar of a contour map is now read more accurately. Two defects
were found by running the extraction on the figures of real papers, and both
are fixed.

- **The colour lookup was too coarse.** It used a fixed 32 x 32 x 32 table of
  colours, and one cell of that table is eight units of colour - more than
  fifty pixels of a colour bar that is eighteen hundred pixels long. The
  colour of a pixel was therefore matched to the wrong band and the number
  came out about two percent off. The lookup now searches for the exact
  nearest band, and the error is below one percent of the value range.
- **The tick labels of a colour bar usually do not reach its ends.** On a
  real figure the labels only cover the middle of the bar, and the values
  outside the known labels were held flat, which reports the same number
  for a whole part of the figure. They are now continued along the line of
  the nearest two labels.

Measured on four panels with a colour bar taken from arXiv 2601.00342,
covering a jet map, a diverging map and labels that stop in the middle of
the bar:

| panel | colour map | tick labels | error |
|---|---|---|---|
| uv_a1 | jet | 5 / 0 / -5 (1e-1) | 0.77 percent of the range |
| uv_a2 | jet | 5 / 0 / -5 (1e-1) | 0.77 percent of the range |
| uv_a3 | diverging | 1 / 0 (1e-6) | 1.72 percent of the range |
| uv_b1 | jet | -6 / -7 (1e-2) | 0.73 percent of the range |

The largest error is at the flat end of a colour map, where the colour
simply does not tell the number.

### What was new in 1.3.0

**Cloud map extraction**

A contour map does not hold a curve, it holds a field of values: the colour
of every pixel *is* the number. That is a different kind of data, so it gets
its own panel and its own export instead of being forced into the point
table of the curves.

- **Frame the colour bar** with a drag, give it its tick values, and the
  whole figure is read back as numbers.
- **The tick values come from two places and both work together.** A vision
  model reads the labels off the bar and the position of each label along it;
  every number is then editable, so a label the model got wrong or could not
  read is simply typed in. Measured on a synthetic bar with the labels
  100 / 75 / 50 / 25 / 0: four of the five were read with the value correct
  and the position within 4 px of a 260 px bar.
- **The API key stays in the main process**, encrypted with `safeStorage`.
  The interface can never read it back, and the application does nothing else
  with the network.
- **Three exports**: a wide grid CSV that Excel and Origin read as a contour
  map, a long CSV with X, Y and the value per cell, and a PNG of the field
  coloured by value.
- **The colour bar calibration and the axis calibration are independent.** The
  grid can be exported in calibrated coordinates; the numbers always come
  from the bar.
- Colours that are not on the bar - axes, labels, the background - are
  recognised as such and left out on their own.
- **The model can read the curves of a figure too.** `Extract curves with AI`
  sits next to `Auto Detect` and adds what the model found as a new series,
  through the same channel and with the same key as the colour bar reader.

**How the numbers are recovered**

The colour bar is scanned row by row and the dominant colour of every row
becomes one band. The tick values give the bands their numbers, and the
nearest band of the figure is found for every colour. On a synthetic
contour map the recovered values deviate by 0.37 on average, with 1.4 at
worst - about two band widths. That is the limit of the method: the wider
the bands, the better.

### The fixes of 1.2.0 are still in

An independent audit of the whole code base found **36 defects**; every one
of them was fixed in 1.2.0 and none of them came back.

- The calibration used two incompatible geometries at once. It is now a
  single affine basis decomposition, so the truth values of a tilted figure
  are monotonic again (108 of 108 points, was 77 of 108).
- Changing the calibration recomputes every digitised point.
- A click is measured in screen pixels, so a gesture behaves the same at
  every zoom level.
- The canvas and the data table share one selection, and deleting a point no
  longer paints the "selected" colour onto its neighbour.
- The renderer runs on a custom `app://` scheme, so the content security
  policy really keeps it inside the application, and the renderer can no
  longer read arbitrary files.
- A missing measurement never turns into a zero or a NaN in any of the eight
  export formats.

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

Eight executable suites, 179 assertions in total:

    node tools/run-tests.js

### Install

- `GraphDigitizer-__VERSION__-x64.exe` - installer, choose the install
  directory, creates a desktop and a Start menu shortcut.
- `GraphDigitizer-__VERSION__-portable.exe` - no installation, double click
  to run.

Both packages are unsigned, so Windows SmartScreen may show a warning on the
first run. The application is a plain local tool: it only talks to the
network when you ask it to read a colour bar with the model.

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
