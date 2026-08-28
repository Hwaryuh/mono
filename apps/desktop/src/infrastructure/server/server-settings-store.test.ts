import { describe, expect, it } from "vitest";
import {
  InMemoryServerSettingsStore,
  looksLikeRemoteApiUrl,
  trimBaseUrl,
} from "./server-settings-store";

describe("looksLikeRemoteApiUrl", () => {
  it("accepts http on 4174 and https on 443 or 4174", () => {
    expect(looksLikeRemoteApiUrl("http://100.80.12.34:4174")).toBe(true);
    expect(looksLikeRemoteApiUrl("https://mono.example.com")).toBe(true);
    expect(looksLikeRemoteApiUrl("https://mono.example.com:4174")).toBe(true);
    expect(looksLikeRemoteApiUrl("  http://mono-server:4174/  ")).toBe(true);
  });

  it("rejects other ports, schemes, paths, and credentials", () => {
    expect(looksLikeRemoteApiUrl("http://host:8080")).toBe(false);
    expect(looksLikeRemoteApiUrl("http://host")).toBe(false);
    expect(looksLikeRemoteApiUrl("ftp://host:4174")).toBe(false);
    expect(looksLikeRemoteApiUrl("https://host/api")).toBe(false);
    expect(looksLikeRemoteApiUrl("https://user:pw@host:4174")).toBe(false);
    expect(looksLikeRemoteApiUrl("not a url")).toBe(false);
    expect(looksLikeRemoteApiUrl("")).toBe(false);
  });
});

describe("InMemoryServerSettingsStore", () => {
  it("starts embedded and already applied", async () => {
    const store = new InMemoryServerSettingsStore();
    const state = await store.read();
    expect(state).toMatchObject({ mode: "embedded", runningEmbedded: true, restartRequired: false, manageable: true });
  });

  it("switching to remote needs a valid url and then a restart to apply", async () => {
    const store = new InMemoryServerSettingsStore();

    await expect(store.save({ mode: "remote", remoteUrl: "" })).rejects.toThrow(/주소를 입력/);
    await expect(store.save({ mode: "remote", remoteUrl: "http://host:9999" })).rejects.toThrow(/포트/);

    const saved = await store.save({ mode: "remote", remoteUrl: "  http://100.80.12.34:4174/ " });
    expect(saved.mode).toBe("remote");
    expect(saved.remoteUrl).toBe("http://100.80.12.34:4174");
    expect(saved.restartRequired).toBe(true);
    expect(saved.runningEmbedded).toBe(true);

    await store.restart();
    const applied = await store.read();
    expect(applied).toMatchObject({
      mode: "remote",
      runningEmbedded: false,
      effectiveApiBaseUrl: "http://100.80.12.34:4174",
      restartRequired: false,
    });
  });

  it("probe resolves only for reachable base urls", async () => {
    const store = new InMemoryServerSettingsStore({ reachable: ["http://100.80.12.34:4174"] });
    await expect(store.probe("http://100.80.12.34:4174/")).resolves.toBeUndefined();
    await expect(store.probe("http://127.0.0.1:4174")).resolves.toBeUndefined();
    await expect(store.probe("http://10.0.0.9:4174")).rejects.toThrow(/연결할 수 없습니다/);
  });

  it("probe rejects a missing or wrong token when the server requires one", async () => {
    const store = new InMemoryServerSettingsStore({
      reachable: ["https://mono.example.com"],
      requiredToken: "right",
    });
    await expect(store.probe("https://mono.example.com")).rejects.toThrow(/토큰이 필요/);
    await expect(store.probe("https://mono.example.com", "wrong")).rejects.toThrow(/올바르지 않/);
    await expect(store.probe("https://mono.example.com", "right")).resolves.toBeUndefined();
  });

  it("persists a remote token and drops it when returning to embedded", async () => {
    const store = new InMemoryServerSettingsStore();
    const saved = await store.save({ mode: "remote", remoteUrl: "https://mono.example.com", token: "  s3cr3t  " });
    expect(saved.remoteToken).toBe("s3cr3t");
    const back = await store.save({ mode: "embedded" });
    expect(back.remoteUrl).toBe("");
    expect(back.remoteToken).toBe("");
  });
});

describe("trimBaseUrl", () => {
  it("drops surrounding space and trailing slashes", () => {
    expect(trimBaseUrl("  http://host:4174/// ")).toBe("http://host:4174");
  });
});
