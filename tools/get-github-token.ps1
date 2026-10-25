#!/usr/bin/env pwsh
# Read the GitHub token that Git Credential Manager holds for github.com.
#
#   powershell -NoProfile -File tools\get-github-token.ps1
#
# PowerShell 5.1 cannot pipe a plain string into a native command, so the
# credential request is fed through a temporary file instead.
$ErrorActionPreference = 'Stop'

$request = Join-Path $env:TEMP 'gd-credential-request.txt'
$output = Join-Path $env:TEMP 'gd-credential-output.txt'
try {
    [System.IO.File]::WriteAllText($request, "protocol=https`r`nhost=github.com`r`n`r`n")
    Start-Process -FilePath 'git' -ArgumentList 'credential', 'fill' `
        -RedirectStandardInput $request -RedirectStandardOutput $output `
        -NoNewWindow -Wait
    foreach ($line in [System.IO.File]::ReadAllLines($output)) {
        if ($line -like 'password=*') { Write-Output $line.Substring(9) }
    }
} finally {
    foreach ($f in @($request, $output)) {
        if (Test-Path $f) { Remove-Item -LiteralPath $f -Force }
    }
}
