import { beforeEach, describe, expect, it, vi } from "vitest";

const tauri = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => tauri);

import { PlatformApiEndpointProvider } from "./api-endpoint";

describe("PlatformApiEndpointProvider", () => {
  beforeEach(() => {
    tauri.invoke.mockReset();
    tauri.isTauri.mockReset();
  });

  it("Tauri에서는 Rust가 결정한 런타임 주소를 사용한다", async () => {
    tauri.isTauri.mockReturnValue(true);
    tauri.invoke.mockResolvedValue("http://mono-server:4174");

    await expect(PlatformApiEndpointProvider.of().resolve()).resolves.toBe("http://mono-server:4174");
    expect(tauri.invoke).toHaveBeenCalledWith("server_api_base_url");
  });

  it("브라우저 개발 환경에서는 기본 로컬 주소를 사용한다", async () => {
    tauri.isTauri.mockReturnValue(false);

    await expect(PlatformApiEndpointProvider.of().resolve()).resolves.toBe("http://127.0.0.1:4174");
  });

  it("Tauri에서는 Rust가 준 베어러 토큰을 사용하고, 브라우저에서는 빈 문자열이다", async () => {
    tauri.isTauri.mockReturnValue(true);
    tauri.invoke.mockResolvedValue("s3cr3t");
    await expect(PlatformApiEndpointProvider.of().resolveToken()).resolves.toBe("s3cr3t");
    expect(tauri.invoke).toHaveBeenCalledWith("server_api_token");

    tauri.isTauri.mockReturnValue(false);
    await expect(PlatformApiEndpointProvider.of().resolveToken()).resolves.toBe("");
  });
});
