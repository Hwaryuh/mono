$ErrorActionPreference = "Stop"

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$releaseTargetDirectory = Join-Path $repositoryRoot "target/release"
$source = Join-Path $releaseTargetDirectory "mono-desktop.exe"
$releaseDirectory = Join-Path $repositoryRoot "release"
$destination = Join-Path $releaseDirectory "mono-desktop.exe"

if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
  throw "Desktop release executable not found: $source"
}

# API 서버는 Tauri 바이너리에 임베드된 axum 서버다(crates/mono-api, mono_api::spawn).
# 별도 런타임·sidecar 없이 이 exe 파일 하나가 배포물이다.
New-Item -ItemType Directory -Force -Path $releaseDirectory | Out-Null
Copy-Item -LiteralPath $source -Destination $destination -Force

Write-Output "Desktop executable exported to $destination"
