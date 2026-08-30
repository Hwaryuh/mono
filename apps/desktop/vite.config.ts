import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

const workspaceManifest = readFileSync(new URL("../../Cargo.toml", import.meta.url), "utf8");
const workspacePackage = /\[workspace\.package\]([\s\S]*?)(?=\n\[|$)/.exec(workspaceManifest)?.[1];
const appVersion = /^\s*version\s*=\s*"([^"]+)"/m.exec(workspacePackage ?? "")?.[1];
if (!appVersion) throw new Error("Cargo.toml [workspace.package].version을 찾지 못했습니다.");

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  // 앱·서버가 공유하는 Cargo workspace 버전을 주입해 원격 서버 드리프트를 경고한다.
  define: { __APP_VERSION__: JSON.stringify(appVersion) },
  server: {
    port: 4173,
    strictPort: true,
    host: "127.0.0.1",
  },
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  build: {
    target: process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome105" : "safari13",
    minify: process.env.TAURI_ENV_DEBUG ? false : "esbuild",
    sourcemap: Boolean(process.env.TAURI_ENV_DEBUG),
  },
  test: {
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
  },
});
