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
 * Compares the app's version (injected at build time) against the server's (`/version`). In remote mode, if only the server
 * misses a redeploy, it silently ignores new fields the app sends and features break silently.
 * In embedded mode, the server ships with the app and is always the same version, so no warning appears.
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
