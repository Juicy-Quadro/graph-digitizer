#!/usr/bin/env pwsh
# Create the GitHub repository using the token that Git Credential Manager
# stored during the push, then push the branch.

param(
    [string]$Repo = 'E:\projects\graph-digitizer',
    [string]$Name = 'graph-digitizer',
    [string]$Description = 'Digitize data points from graphs and plots in images. Electron desktop app: four point calibration, automatic line tracing and area sampling, export to CSV/Excel/XML/JSON/SVG/DXF/EPS.',
    [switch]$Private
)

$ErrorActionPreference = 'Stop'

# Pull the stored credential out of Git Credential Manager.
$input = "protocol=https`nhost=github.com`n`n"
$filled = $input | git credential fill 2>$null
if (-not $filled) {
    throw 'No GitHub credential found. Run a git push first to trigger the browser authorisation.'
}
$token = $null
$user = $null
foreach ($line in $filled) {
    if ($line -like 'password=*') { $token = $line.Substring(9) }
    if ($line -like 'username=*') { $user = $line.Substring(9) }
}
if (-not $token) { throw 'Git Credential Manager did not return a token.' }
Write-Host "credential found for user '$user'"

$headers = @{
    'Authorization'  = "Bearer $token"
    'Accept'         = 'application/vnd.github+json'
    'X-GitHub-Api-Version' = '2022-11-28'
    'User-Agent'     = 'graph-digitizer-setup'
}

# Does the repository already exist?
$existing = Invoke-RestMethod -Uri "https://api.github.com/repos/$user/$Name" -Headers $headers -Method Get -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "repository $user/$Name already exists (visibility: $($existing.visibility))"
} else {
    $body = @{
        name        = $Name
        description = $Description
        private    = [bool]$Private
        auto_init  = $false
    } | ConvertTo-Json
    $created = Invoke-RestMethod -Uri 'https://api.github.com/user/repos' -Headers $headers -Method Post -Body $body -ContentType 'application/json'
    Write-Host "created $($created.full_name)  private=$($created.private)  url=$($created.html_url)"
}
