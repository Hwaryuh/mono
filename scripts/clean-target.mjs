// Rust는 target/ 을 스스로 정리하지 않는다. cargo build/check/test 가 입력이 바뀔 때마다
// 해시가 붙은 새 아티팩트를 만들고 옛것은 영원히 남긴다. mono-api / mono-desktop 은
// [workspace.package].version 이 CARGO_PKG_VERSION 으로 박혀서, 릴리즈 bump 하나에
// 100MB대 libmono_*-<hash>.rlib 이 매번 새로 쌓인다.
//
// 이 스크립트는 워크스페이스 크레이트(mono_api / mono_desktop_lib)의 오래된 해시 변종만
// 지운다. 최신 것 하나씩은 남기므로 다음 빌드가 이걸 처음부터 다시 만들지 않는다.
// 의존성 캐시(target 대부분)는 건드리지 않는다 — 그건 `cargo clean` 이 담당한다.

import { execFileSync } from "node:child_process";
import { readdirSync, statSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const CRATES = ["mono_api", "mono_desktop_lib"];
const KEEP_PER_CRATE = 1;

function humanBytes(n) {
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i += 1; }
  return `${n.toFixed(1)}${units[i]}`;
}

function sweepProfile(profile) {
  const depsDir = join(repoRoot, "target", profile, "deps");
  let entries;
  try {
    entries = readdirSync(depsDir);
  } catch {
    return { removed: 0, bytes: 0 };
  }

  let removed = 0;
  let bytes = 0;
  for (const crate of CRATES) {
    // lib<crate>-<hash>.rlib / <crate>-<hash>.rmeta / <crate>-<hash>.d / <crate>-<hash> (bin)
    const pattern = new RegExp(`^(lib)?${crate}-[0-9a-f]{8,}(\\.(rlib|rmeta|d))?$`);
    const matches = entries
      .filter((name) => pattern.test(name))
      .map((name) => {
        const path = join(depsDir, name);
        const stat = statSync(path);
        return { name, path, mtime: stat.mtimeMs, size: stat.size };
      })
      .sort((a, b) => b.mtime - a.mtime);

    // 최신 KEEP_PER_CRATE 개의 "빌드 단위"(해시)만 남긴다.
    const keepHashes = new Set(
      matches
        .map((m) => m.name.match(/-([0-9a-f]{8,})/)?.[1])
        .filter(Boolean)
        .slice(0, KEEP_PER_CRATE * 4), // rlib/rmeta/d/bin ~ 4 files per hash
    );
    const seenHashes = new Set();
    for (const m of matches) {
      const hash = m.name.match(/-([0-9a-f]{8,})/)?.[1];
      if (seenHashes.size < KEEP_PER_CRATE) seenHashes.add(hash);
      if (seenHashes.has(hash)) continue;
      rmSync(m.path, { force: true });
      removed += 1;
      bytes += m.size;
    }
    void keepHashes;
  }
  return { removed, bytes };
}

if (process.argv.includes("--full")) {
  console.log("cargo clean (전체 target/ 삭제, 다음 빌드는 처음부터)...");
  execFileSync("cargo", ["clean"], { cwd: repoRoot, stdio: "inherit" });
  process.exit(0);
}

const quiet = process.argv.includes("--quiet");
let totalRemoved = 0;
let totalBytes = 0;
for (const profile of ["debug", "release"]) {
  const { removed, bytes } = sweepProfile(profile);
  totalRemoved += removed;
  totalBytes += bytes;
  if (removed > 0 && !quiet) console.log(`${profile}: 오래된 워크스페이스 아티팩트 ${removed}개 삭제 (${humanBytes(bytes)})`);
}
if (quiet) {
  if (totalRemoved > 0) console.log(`clean-target: ${humanBytes(totalBytes)} 회수 (${totalRemoved}개)`);
} else if (totalRemoved === 0) {
  console.log("정리할 오래된 워크스페이스 아티팩트가 없습니다.");
} else {
  console.log(`총 ${humanBytes(totalBytes)} 회수. 의존성 캐시까지 비우려면 npm run clean -- --full`);
}
