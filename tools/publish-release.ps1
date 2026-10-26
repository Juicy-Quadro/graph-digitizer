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

Digitise data points out of graphs and plots in images, and the colours of a
contour map into numbers.

### What is new in 1.5.0

**Fewer steps to the numbers.**

- **The inspector has three pages now** - curves, cloud map and export - and only the
  page in use is shown. The six panels that were stacked on top of each other
  meant that the cloud map and the export were two scrolls away from the
  settings that were of use at the moment.
- **The panel of the tool in the hand is shown with the curve settings**, and it is
  put in front. The tracing and the area sampling have a panel each, and only the
  one that belongs to the tool is shown.
- **The colours of the figure are found when it is opened**, so the two colour
  tools do not have to be used first. The result is drawn over the figure as a
  mask, so a wrong guess is visible at once, and the tools pick the colours
  again when it is wrong.
- **The field of a contour map is taken out as soon as the model has read the
  ticks**, and the data table has an export button of its own, so the export
  settings do not have to be looked up first.

The readme now holds the features and the way to use them. The history of the
versions moved to docs/CHANGELOG.md.

### What is new in 1.4.2

The benchmark was run again on the real figures, and it found four more
problems. All four are fixed.

- **The place of a tick was read in the picture the model saw, not in the
  figure.** The crop is scaled up before it goes to the model, so the model
  reports the place of a tick in the scaled picture while the application
  took it for a place in the original figure. With a crop that was scaled by
  4.7 the error was 4.7 times too big. The scale is taken off again now, and
  the distance between the place the model gave and the place of the printed
  label fell from a median of 84.9 pixels to 1.5 pixels.
- **The labels of the colour bar were looked for in the column of text that
  stood nearest to the bar.** A legend or an axis title that stood nearer
  took the labels with it, and one speck of dust was enough to lose all of
  them. The rows that carry text are counted now, and nothing is left out:
  which of them is a tick label is decided later, by the number that belongs
  to it. The worst label moved from 129 pixels away to 35.
- **A horizontal colour bar was numbered from the wrong end of itself.** The
  part of the bar that is left out to keep the frame out of the way was cut
  off the length of the bar instead of off its thickness, so the bands were
  counted from a quarter of the way along the bar and the numbers did not
  match the values that were typed in. The bar is now numbered along its
  whole length, and the labels of a horizontal bar are found above and below
  it.
- **The benchmark measured the labels of its reference instead of the labels
  of the application.** The window of the reference starts twenty pixels
  behind the bar, so on most figures it never saw the labels of the bar at
  all and measured the numbers of the plot instead. The number it produced -
  28.98 percent - said more about the reference than about the model. The
  benchmark now uses the labels of the application, the same code the answer
  is used with.

The place of a printed label is now only used when it stands very close to
the place the model gave, because the model reads the place of a tick well
and a block of text that is no number can stand next to the bar as well.
On the real figures the numbers on the places of the program sit 0.05
percent off the line, where they were 2.85 percent off it before.

### What was new in 1.4.0

A benchmark of the model on **hundreds of real figures from arXiv papers** went
looking for weak spots, and it found three. All three are fixed.

- **The model could not read the tick labels of a real colour bar.** The
  window that goes to the model cut the numbers in half, and a colour bar is a
  sliver, so the labels were a couple of pixels tall after the picture was
  scaled down. The window now follows the text to its end and the crop is
  scaled up so that the long side reaches 1400 pixels. The bar keeps its
  direction, because the labels are printed the same way as the bar and
  turning the picture would turn the text as well. With that the model read
  the labels of a real bar and worked out the pixel positions itself.
- **The model reads the numbers well but places them badly.** On real colour
  bars the numbers it read were straight to within 0.01 to 0.11 percent of
  the range, while the positions were 24 to 63 pixels off - which is more
  than ten units of value. So the roles are swapped: the program finds the
  printed labels, which it can do exactly, and the model only supplies the
  numbers. The two lists are paired one by one, so a label the program did
  not see does not shift every number after it.
- **The classical tracer is nearly useless on real paper figures.** Out of
  four hundred figures it followed a curve in one: the axes, the grid and the
  text all end up in the mask, and the walk leaves the curve at once. This is
  exactly where the model earns its keep.

The benchmark itself is part of the project. The figures are taken from the
source packages of the papers, so the originals are used and not a rasterised
copy of the page:

    python tools/bench_fetch.py --count 400 --papers 140
    electron tools/bench-reference.js
    electron tools/bench-llm.js --task bar
    node tools/bench-report.js

### What was new in 1.3.2

The readme now shows what the application actually does: the colour map
extraction with its framed bar, its tick values and the field it recovered,
the curves the model read out of a figure, the region sampling and the
settings with the key of the model.

- Six screenshots of the running application, in both themes and both
  languages.
- The colour map panel is shown from the framing of the bar to the exported
  grid, so the whole path is visible in one picture.

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

Eight executable suites, 201 assertions in total:

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
