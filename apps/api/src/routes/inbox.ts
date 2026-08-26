import type { FastifyInstance } from "fastify";
import type { SqliteInboxRepository } from "../repositories/inbox-repository.ts";

export function registerInboxRoutes(app: FastifyInstance, repo: SqliteInboxRepository) {
  app.get("/inbox/snapshot", async () => repo.getSnapshot());

  app.post<{ Params: { id: string } }>("/inbox/items/:id/approve", async (request) => {
    await repo.approve(request.params.id);
    return { ok: true };
  });

  app.post<{ Body: { minimum: number } }>("/inbox/approve-high-confidence", async (request) => {
    await repo.approveHighConfidence(request.body.minimum);
    return { ok: true };
  });

  app.put<{ Params: { id: string } }>("/inbox/items/:id", async (request) => {
    await repo.update(request.params.id, request.body as never);
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>("/inbox/items/:id", async (request) => {
    await repo.discard(request.params.id);
    return { ok: true };
  });
}
