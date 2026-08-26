$ErrorActionPreference = "Stop"

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$releaseTargetDirectory = Join-Path $repositoryRoot "apps/desktop/src-tauri/target/release"
$source = Join-Path $releaseTargetDirectory "mono-desktop.exe"
$sidecarSource = Join-Path $releaseTargetDirectory "sidecar"
$releaseDirectory = Join-Path $repositoryRoot "release"
$destination = Join-Path $releaseDirectory "mono-desktop.exe"

if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
  throw "Desktop release executable not found: $source"
}
if (-not (Test-Path -LiteralPath $sidecarSource -PathType Container)) {
  throw "API sidecar not found: $sidecarSource (scripts/build-api-sidecar.ps1을 먼저 실행하세요)"
}

New-Item -ItemType Directory -Force -Path $releaseDirectory | Out-Null
Copy-Item -LiteralPath $source -Destination $destination -Force

# exe는 실행 파일 옆의 sidecar 폴더(node.exe + 번들된 API)를 찾아 자동으로 띄운다
# (apps/desktop/src-tauri/src/api_sidecar.rs) - 이 폴더 없이 exe만 옮기면 API 없이 뜬다.
$sidecarDestination = Join-Path $releaseDirectory "sidecar"
if (Test-Path -LiteralPath $sidecarDestination) {
  Remove-Item -LiteralPath $sidecarDestination -Recurse -Force
}
Copy-Item -LiteralPath $sidecarSource -Destination $sidecarDestination -Recurse -Force

Write-Output "Desktop executable exported to $destination (+ sidecar)"
