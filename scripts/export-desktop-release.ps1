$ErrorActionPreference = "Stop"

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$releaseTargetDirectory = Join-Path $repositoryRoot "apps/desktop/src-tauri/target/release"
$source = Join-Path $releaseTargetDirectory "mono-desktop.exe"
$releaseDirectory = Join-Path $repositoryRoot "release"
$destination = Join-Path $releaseDirectory "mono-desktop.exe"

if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
  throw "Desktop release executable not found: $source"
}

# exe는 API sidecar(node.exe + 번들된 API)를 통째로 임베드하고 첫 실행 때 앱 데이터 폴더로
# 푼다(apps/desktop/src-tauri/src/api_sidecar.rs). 배포물은 이 exe 파일 하나면 된다.
# sidecar.zip이 최신인지 확신하려면 이 스크립트 전에 scripts/build-api-sidecar.ps1을 돌려야 한다.
New-Item -ItemType Directory -Force -Path $releaseDirectory | Out-Null
Copy-Item -LiteralPath $source -Destination $destination -Force

Write-Output "Desktop executable exported to $destination"
