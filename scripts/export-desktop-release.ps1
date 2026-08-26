$ErrorActionPreference = "Stop"

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$source = Join-Path $repositoryRoot "apps/desktop/src-tauri/target/release/mono-desktop.exe"
$releaseDirectory = Join-Path $repositoryRoot "release"
$destination = Join-Path $releaseDirectory "mono-desktop.exe"

if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
  throw "Desktop release executable not found: $source"
}

New-Item -ItemType Directory -Force -Path $releaseDirectory | Out-Null
Copy-Item -LiteralPath $source -Destination $destination -Force

Write-Output "Desktop executable exported to $destination"
