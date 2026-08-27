import { describe, expect, it } from "vitest";
import { createDb, type Db } from "./db/client.ts";
import { buildServer } from "./server.ts";

function freshDb(): Db {
  return createDb(":memory:");
}

// @fastify/cors 기본 methods는 GET,HEAD,POST뿐이라 PUT/DELETE 라우트(라벨 수정·삭제 등)가
// 실제 브라우저 preflight에서 전부 막혔었다(app.inject는 CORS를 안 타서 기존 테스트가 못 잡았다).
describe("CORS", () => {
  it("허용된 오리진에서 PUT·DELETE preflight를 통과시킨다", async () => {
    const app = buildServer(freshDb());
    await app.ready();

    for (const method of ["PUT", "DELETE"]) {
      const response = await app.inject({
        method: "OPTIONS",
        url: "/scrap/tags/x",
        headers: { origin: "http://localhost:4173", "access-control-request-method": method },
      });
      expect(response.headers["access-control-allow-methods"]).toContain(method);
    }

    await app.close();
  });
});
