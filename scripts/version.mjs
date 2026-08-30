import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const cargoManifestPath = join(repositoryRoot, "Cargo.toml");
const tauriConfigPath = join(repositoryRoot, "apps/desktop/src-tauri/tauri.conf.json");
const rootPackagePath = join(repositoryRoot, "package.json");
const desktopPackagePath = join(repositoryRoot, "apps/desktop/package.json");
const semverPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function workspaceVersion(manifest) {
  const table = /\[workspace\.package\]([\s\S]*?)(?=\n\[|$)/.exec(manifest)?.[1];
  const version = /^\s*version\s*=\s*"([^"]+)"/m.exec(table ?? "")?.[1];
  if (!version) throw new Error("Cargo.toml [workspace.package].version을 찾지 못했습니다.");
  return version;
}

function check() {
  const expected = workspaceVersion(readFileSync(cargoManifestPath, "utf8"));
  const metadata = JSON.parse(execFileSync("cargo", ["metadata", "--locked", "--no-deps", "--format-version", "1"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  }));
  const productPackages = metadata.packages.filter(({ name }) => name === "mono-api" || name === "mono-desktop");
  if (productPackages.length !== 2 || productPackages.some(({ version }) => version !== expected)) {
    throw new Error(`Cargo package version 불일치: expected ${expected}, got ${productPackages.map(({ name, version }) => `${name}=${version}`).join(", ")}`);
  }

  const tauriConfig = JSON.parse(readFileSync(tauriConfigPath, "utf8"));
  const rootPackage = JSON.parse(readFileSync(rootPackagePath, "utf8"));
  const desktopPackage = JSON.parse(readFileSync(desktopPackagePath, "utf8"));
  if ("version" in tauriConfig || "version" in rootPackage || "version" in desktopPackage) {
    throw new Error("제품 버전 중복 발견: tauri.conf.json·package.json의 version 필드를 제거해야 합니다.");
  }

  const tag = process.env.GITHUB_REF_TYPE === "tag" ? process.env.GITHUB_REF_NAME : "";
  if (tag && tag !== `v${expected}`) throw new Error(`Git tag ${tag}와 제품 버전 v${expected}가 다릅니다.`);
  console.log(`mono version ${expected}: ok`);
}

function setVersion(nextVersion) {
  if (!nextVersion || !semverPattern.test(nextVersion)) {
    throw new Error("사용법: npm run version:set -- X.Y.Z");
  }
  const manifest = readFileSync(cargoManifestPath, "utf8");
  const currentVersion = workspaceVersion(manifest);
  const tablePattern = /(\[workspace\.package\][\s\S]*?^\s*version\s*=\s*")[^"]+("(?=\s*$))/m;
  const nextManifest = manifest.replace(tablePattern, `$1${nextVersion}$2`);
  if (nextManifest === manifest && currentVersion !== nextVersion) throw new Error("Cargo.toml version 갱신에 실패했습니다.");
  writeFileSync(cargoManifestPath, nextManifest);
  execFileSync("cargo", ["check", "--workspace"], { cwd: repositoryRoot, stdio: "inherit" });
  check();
}

function git(args, inherit = false) {
  return execFileSync("git", args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    stdio: inherit ? "inherit" : "pipe",
  });
}

// 버전 올림 → 커밋 → main 푸시. 태그 생성·번들·서버 배포·릴리즈 공개는 CI가 한다.
// CI는 "chore(release): bump version" 커밋이 main에 오르면 릴리즈 파이프라인을 실행한다.
// 전제: 코드 변경은 이미 커밋됨, 작업 트리 clean, 브랜치 main.
function release(nextVersion) {
  if (!nextVersion || !semverPattern.test(nextVersion)) {
    throw new Error("사용법: npm run release -- X.Y.Z");
  }
  const tag = `v${nextVersion}`;
  if (git(["status", "--porcelain"]).trim()) {
    throw new Error("작업 트리가 dirty합니다 — 코드 변경을 먼저 커밋하세요.");
  }
  if (git(["branch", "--show-current"]).trim() !== "main") {
    throw new Error("main 브랜치가 아닙니다.");
  }
  if (git(["ls-remote", "--tags", "origin", tag]).trim()) {
    throw new Error(`태그 ${tag}가 이미 원격에 있습니다.`);
  }

  setVersion(nextVersion);
  git(["commit", "-am", `chore(release): bump version to ${nextVersion}`], true);
  git(["push", "origin", "main"], true);
  console.log(`main에 ${nextVersion} 푸시 완료. CI가 태그 생성·번들·서버 배포·릴리즈 공개를 진행합니다.`);
}

const command = process.argv[2];
if (command === "check") check();
else if (command === "set") setVersion(process.argv[3]);
else if (command === "release") release(process.argv[3]);
else if (command === "print") process.stdout.write(`${workspaceVersion(readFileSync(cargoManifestPath, "utf8"))}\n`);
else throw new Error("사용법: node scripts/version.mjs <check|set|release|print> [X.Y.Z]");
