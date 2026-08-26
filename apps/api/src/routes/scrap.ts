import type { FastifyInstance } from "fastify";
import type { SqliteScrapRepository } from "../repositories/scrap-repository.ts";

export function registerScrapRoutes(app: FastifyInstance, repo: SqliteScrapRepository) {
  app.get("/scrap/snapshot", async () => repo.getSnapshot());

  app.post("/scrap/items", async (request, reply) => {
    await repo.create(request.body as never);
    return reply.code(201).send({ ok: true });
  });

  app.delete<{ Params: { id: string } }>("/scrap/items/:id", async (request) => {
    await repo.delete(request.params.id);
    return { ok: true };
  });

  app.post<{ Body: { tag: string } }>("/scrap/tags", async (request, reply) => {
    await repo.addTag(request.body.tag);
    return reply.code(201).send({ ok: true });
  });

  app.post<{ Params: { id: string } }>("/scrap/items/:id/comments", async (request, reply) => {
    await repo.addComment(request.params.id, request.body as never);
    return reply.code(201).send({ ok: true });
  });

  app.put<{ Params: { id: string; commentId: string } }>("/scrap/items/:id/comments/:commentId", async (request) => {
    await repo.updateComment(request.params.id, request.params.commentId, request.body as never);
    return { ok: true };
  });

  app.delete<{ Params: { id: string; commentId: string } }>("/scrap/items/:id/comments/:commentId", async (request) => {
    await repo.deleteComment(request.params.id, request.params.commentId);
    return { ok: true };
  });
}
