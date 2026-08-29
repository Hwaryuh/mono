import { httpGet } from "../http/http-client";

type Triple = [number, number, number];

function parseVersion(value: string): Triple | null {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(value.trim());
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

function isBehind(server: Triple, app: Triple): boolean {
  for (let index = 0; index < 3; index += 1) {
    if (server[index] !== app[index]) return server[index] < app[index];
  }
  return false;
}

export type ServerBehind = { kind: "server-behind"; serverVersion: string; appVersion: string };
export type ServerCompatibility = { kind: "ok" } | { kind: "unknown" } | ServerBehind;

export function serverBehindOf(compatibility: ServerCompatibility | undefined): ServerBehind | null {
  return compatibility?.kind === "server-behind" ? compatibility : null;
}

/**
 * 앱(빌드 시 주입된 버전)과 서버(`/version`)의 버전을 비교한다. 원격 모드에서 서버만
 * 재배포를 놓치면 앱이 보내는 새 필드를 서버가 조용히 무시해 기능이 말없이 깨진다.
 * 임베드 모드는 서버가 앱에 동봉돼 항상 같은 버전이라 경고가 뜨지 않는다.
 */
export async function checkServerCompatibility(): Promise<ServerCompatibility> {
  const appVersion = __APP_VERSION__;
  const app = parseVersion(appVersion);
  if (!app) return { kind: "unknown" };

  let serverVersion = "";
  try {
    serverVersion = String((await httpGet<{ version?: string }>("/version"))?.version ?? "");
  } catch {
    return { kind: "unknown" };
  }
  const server = parseVersion(serverVersion);
  if (!server) return { kind: "unknown" };

  return isBehind(server, app) ? { kind: "server-behind", serverVersion, appVersion } : { kind: "ok" };
}
