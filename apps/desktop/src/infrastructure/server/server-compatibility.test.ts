import { beforeEach, describe, expect, it, vi } from "vitest";

const http = vi.hoisted(() => ({ httpGet: vi.fn() }));
vi.mock("../http/http-client", () => ({ httpGet: http.httpGet }));

import { checkServerCompatibility, serverBehindOf } from "./server-compatibility";

beforeEach(() => http.httpGet.mockReset());

describe("checkServerCompatibility", () => {
  it("서버 버전이 앱보다 낮으면 server-behind", async () => {
    http.httpGet.mockResolvedValue({ version: "0.1.9" });
    // __APP_VERSION__ 은 이 저장소 package.json 버전(0.1.x, 항상 0.1.9보다 큼)
    const result = await checkServerCompatibility();
    expect(result.kind).toBe("server-behind");
    expect(serverBehindOf(result)?.serverVersion).toBe("0.1.9");
  });

  it("서버 버전이 앱과 같거나 높으면 ok", async () => {
    http.httpGet.mockResolvedValue({ version: __APP_VERSION__ });
    expect((await checkServerCompatibility()).kind).toBe("ok");

    http.httpGet.mockResolvedValue({ version: "9.9.9" });
    expect((await checkServerCompatibility()).kind).toBe("ok");
  });

  it("서버 응답이 없거나 파싱 불가면 unknown (경고 안 함)", async () => {
    http.httpGet.mockRejectedValue(new Error("연결 불가"));
    expect((await checkServerCompatibility()).kind).toBe("unknown");

    http.httpGet.mockResolvedValue({ version: "dev" });
    expect((await checkServerCompatibility()).kind).toBe("unknown");

    http.httpGet.mockResolvedValue({});
    expect((await checkServerCompatibility()).kind).toBe("unknown");
  });
});
