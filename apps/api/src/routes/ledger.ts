import type { FastifyInstance } from "fastify";
import type { SqliteLedgerRepository } from "../repositories/ledger-repository.ts";

// LedgerRepository 인터페이스를 HTTP로 노출한다. 검증은 저장소가 contracts 스키마로 수행한다.
export function registerLedgerRoutes(app: FastifyInstance, repo: SqliteLedgerRepository) {
  app.get("/ledger/snapshot", async () => repo.getSnapshot());

  app.post("/ledger/expenses", async (request, reply) => {
    await repo.create(request.body as never);
    return reply.code(201).send({ ok: true });
  });

  app.post("/ledger/categories", async (request, reply) => {
    await repo.createCategory(request.body as never);
    return reply.code(201).send({ ok: true });
  });

  app.put<{ Params: { id: string } }>("/ledger/categories/:id", async (request) => {
    await repo.updateCategory(request.params.id, request.body as never);
    return { ok: true };
  });

  app.put<{ Body: { categoryIds: string[] } }>("/ledger/categories/order", async (request) => {
    await repo.reorderCategories(request.body.categoryIds);
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>("/ledger/categories/:id", async (request) => {
    await repo.deleteCategory(request.params.id);
    return { ok: true };
  });
}
