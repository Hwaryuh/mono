import { beforeEach, describe, expect, it, vi } from "vitest";

const http = vi.hoisted(() => ({ httpGet: vi.fn() }));
vi.mock("../http/http-client", () => ({ httpGet: http.httpGet }));

import { checkServerCompatibility, serverBehindOf } from "./server-compatibility";

beforeEach(() => http.httpGet.mockReset());

describe("checkServerCompatibility", () => {
  it("returns server-behind when the server version is lower than the app's", async () => {
    http.httpGet.mockResolvedValue({ version: "0.1.9" });
    // __APP_VERSION__ 은 이 저장소 package.json 버전(0.1.x, 항상 0.1.9보다 큼)
    const result = await checkServerCompatibility();
    expect(result.kind).toBe("server-behind");
    expect(serverBehindOf(result)?.serverVersion).toBe("0.1.9");
  });

  it("returns ok when the server version is equal to or higher than the app's", async () => {
    http.httpGet.mockResolvedValue({ version: __APP_VERSION__ });
    expect((await checkServerCompatibility()).kind).toBe("ok");

    http.httpGet.mockResolvedValue({ version: "9.9.9" });
    expect((await checkServerCompatibility()).kind).toBe("ok");
  });

  it("returns unknown (without warning) when there is no server response or it can't be parsed", async () => {
    http.httpGet.mockRejectedValue(new Error("연결 불가"));
    expect((await checkServerCompatibility()).kind).toBe("unknown");

    http.httpGet.mockResolvedValue({ version: "dev" });
    expect((await checkServerCompatibility()).kind).toBe("unknown");

    http.httpGet.mockResolvedValue({});
    expect((await checkServerCompatibility()).kind).toBe("unknown");
  });
});
