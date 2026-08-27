$ErrorActionPreference = "Stop"

# 패키징된 exe는 API 서버 없이는 뜨지 않는다(모든 화면이 HTTP로 데이터를 가져온다).
# Node 런타임 + 번들된 API + better-sqlite3 네이티브 바이너리를 하나의 zip으로 묶어
# src-tauri/sidecar.zip 에 둔다. release exe가 이 zip을 통째로 임베드하고(src/api_sidecar.rs)
# 첫 실행 때 앱 데이터 폴더로 풀기 때문에, 배포물은 exe 파일 하나면 된다.
# 이 스크립트는 cargo/tauri build 전에 실행해야 한다(그래야 최신 zip이 임베드된다).
# 개발 모드(desktop:dev)는 건드리지 않는다 - 그때는 지금처럼 npm run dev --workspace @mono/api를
# 따로 띄운다.

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$apiRoot = Join-Path $repositoryRoot "apps/api"
$sidecarDirectory = Join-Path $repositoryRoot "apps/desktop/src-tauri/target/release/sidecar"
$sidecarZip = Join-Path $repositoryRoot "apps/desktop/src-tauri/sidecar.zip"

Write-Output "API 번들 생성 중..."
npm run build --workspace @mono/api
if ($LASTEXITCODE -ne 0) { throw "API 번들 생성 실패" }

$bundledServer = Join-Path $apiRoot "dist/server.cjs"
if (-not (Test-Path -LiteralPath $bundledServer -PathType Leaf)) {
  throw "번들된 서버를 찾을 수 없습니다: $bundledServer"
}

$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCommand) { throw "이 PC에 node.exe가 없습니다 - 번들할 Node 런타임을 찾지 못했습니다." }

if (Test-Path -LiteralPath $sidecarDirectory) {
  Remove-Item -LiteralPath $sidecarDirectory -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $sidecarDirectory | Out-Null

Copy-Item -LiteralPath $nodeCommand.Source -Destination (Join-Path $sidecarDirectory "node.exe") -Force
Copy-Item -LiteralPath $bundledServer -Destination (Join-Path $sidecarDirectory "server.cjs") -Force

# better-sqlite3는 네이티브 addon이라 번들에 못 들어간다(scripts/build-sidecar.mjs가 external로 뺌).
# node_modules 전체(수십MB, 컴파일 중간산출물 포함)를 복사하는 대신 런타임에 실제로 필요한
# 것만 추린다: package.json + lib(JS 래퍼) + 컴파일된 .node 바이너리 하나, 그리고 그걸 찾는
# bindings 패키지(+ 그 의존성 file-uri-to-path).
$rootNodeModules = Join-Path $repositoryRoot "node_modules"
$sidecarNodeModules = Join-Path $sidecarDirectory "node_modules"

function Copy-PackageFiles($packageName, $relativePaths) {
  $sourceRoot = Join-Path $rootNodeModules $packageName
  if (-not (Test-Path -LiteralPath $sourceRoot)) {
    throw "필요한 패키지가 없습니다: $packageName (npm install을 먼저 실행하세요)"
  }
  foreach ($relativePath in $relativePaths) {
    $source = Join-Path $sourceRoot $relativePath
    $destination = Join-Path (Join-Path $sidecarNodeModules $packageName) $relativePath
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destination) | Out-Null
    if (Test-Path -LiteralPath $source -PathType Container) {
      Copy-Item -LiteralPath $source -Destination $destination -Recurse -Force
    } else {
      Copy-Item -LiteralPath $source -Destination $destination -Force
    }
  }
}

Copy-PackageFiles "better-sqlite3" @("package.json", "lib", "build/Release/better_sqlite3.node")
Copy-PackageFiles "bindings" @("package.json", "bindings.js")
Copy-PackageFiles "file-uri-to-path" @("package.json", "index.js")

# exe에 임베드할 zip으로 압축한다. Compress-Archive는 deflate zip을 만들고, Rust zip 크레이트가
# 그대로 읽는다. staging 폴더는 zip이 유일한 산출물이므로 지운다.
if (Test-Path -LiteralPath $sidecarZip) {
  Remove-Item -LiteralPath $sidecarZip -Force
}
Compress-Archive -Path (Join-Path $sidecarDirectory "*") -DestinationPath $sidecarZip -CompressionLevel Optimal -Force
Remove-Item -LiteralPath $sidecarDirectory -Recurse -Force

$sizeMb = [math]::Round((Get-Item -LiteralPath $sidecarZip).Length / 1MB, 1)
Write-Output "API sidecar zip 준비 완료: $sidecarZip ($sizeMb MB)"
