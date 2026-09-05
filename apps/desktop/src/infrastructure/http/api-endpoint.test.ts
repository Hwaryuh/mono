import { beforeEach, describe, expect, it, vi } from "vitest";

const tauri = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => tauri);

import { PlatformApiEndpointProvider } from "./api-endpoint";

describe("PlatformApiEndpointProvider", () => {
  beforeEach(() => {
    tauri.invoke.mockReset();
    tauri.isTauri.mockReset();
  });

  it("uses the runtime address determined by Rust when running in Tauri", async () => {
    tauri.isTauri.mockReturnValue(true);
    tauri.invoke.mockResolvedValue("http://mono-server:4174");

    await expect(PlatformApiEndpointProvider.of().resolve()).resolves.toBe("http://mono-server:4174");
    expect(tauri.invoke).toHaveBeenCalledWith("server_api_base_url");
  });

  it("uses the default local address in the browser dev environment", async () => {
    tauri.isTauri.mockReturnValue(false);

    await expect(PlatformApiEndpointProvider.of().resolve()).resolves.toBe("http://127.0.0.1:4174");
  });

  it("uses the bearer token provided by Rust in Tauri, and an empty string in the browser", async () => {
    tauri.isTauri.mockReturnValue(true);
    tauri.invoke.mockResolvedValue("s3cr3t");
    await expect(PlatformApiEndpointProvider.of().resolveToken()).resolves.toBe("s3cr3t");
    expect(tauri.invoke).toHaveBeenCalledWith("server_api_token");

    tauri.isTauri.mockReturnValue(false);
    await expect(PlatformApiEndpointProvider.of().resolveToken()).resolves.toBe("");
  });
});
