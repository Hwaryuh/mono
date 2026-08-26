import { build } from "esbuild";

// 데스크톱 패키징 산출물(Tauri sidecar)용 단일 파일 번들. better-sqlite3는 네이티브 addon(.node)이라
// 번들에 못 넣는다 - external로 빼고, 실행 시 옆의 node_modules/better-sqlite3에서 찾게 한다
// (scripts/build-api-sidecar.ps1이 그 폴더를 함께 복사한다).
await build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  outfile: "dist/server.cjs",
  external: ["better-sqlite3"],
  logLevel: "info",
});
