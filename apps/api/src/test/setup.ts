import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll } from "vitest";

// SecretCrypto의 기본 키 경로는 CWD 상대 "mono.secret.key"다. 그대로 두면 buildServer를 쓰는
// 테스트 파일들이 병렬로 같은 파일을 쓰고 지우면서 서로의 복호화를 깨뜨리고, 실행이 중단되면
// 저장소 루트에 마스터 키를 흘린다(.gitignore가 막긴 하지만 애초에 만들 이유가 없다).
// 파일마다 고유 임시 디렉터리를 준다.
const directory = mkdtempSync(join(tmpdir(), "mono-api-test-"));
process.env.MONO_SECRET_KEY_PATH = join(directory, "mono.secret.key");

afterAll(() => {
  rmSync(directory, { recursive: true, force: true });
});
