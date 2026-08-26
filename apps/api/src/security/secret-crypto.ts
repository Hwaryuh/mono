import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const ALGO = "aes-256-gcm";

function loadOrCreateMasterKey(path: string): Buffer {
  if (existsSync(path)) return Buffer.from(readFileSync(path, "utf8"), "hex");
  const key = randomBytes(32);
  writeFileSync(path, key.toString("hex"), { mode: 0o600 });
  return key;
}

// 비밀 정보를 DB엔 암호문만, 복호화 키는 별도 파일로 분리해 보관한다(architecture-decisions.md §5).
export class SecretCrypto {
  private readonly key: Buffer;

  constructor(keyPath = process.env.MONO_SECRET_KEY_PATH ?? "mono.secret.key") {
    this.key = loadOrCreateMasterKey(keyPath);
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv(ALGO, this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString("hex")}:${tag.toString("hex")}:${ciphertext.toString("hex")}`;
  }

  decrypt(payload: string): string {
    const [ivHex, tagHex, dataHex] = payload.split(":");
    const decipher = createDecipheriv(ALGO, this.key, Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    return Buffer.concat([decipher.update(Buffer.from(dataHex, "hex")), decipher.final()]).toString("utf8");
  }
}
