import type { FastifyInstance } from "fastify";
import type { SqliteCalendarRepository } from "../repositories/calendar-repository.ts";

export function registerCalendarRoutes(app: FastifyInstance, repo: SqliteCalendarRepository) {
  app.get("/calendar/snapshot", async () => repo.getSnapshot());

  app.post("/calendar/events", async (request, reply) => {
    await repo.create(request.body as never);
    return reply.code(201).send({ ok: true });
  });

  app.put<{ Params: { id: string } }>("/calendar/events/:id", async (request) => {
    await repo.update(request.params.id, request.body as never);
    return { ok: true };
  });

  app.post("/calendar/categories", async (request, reply) => {
    await repo.createCategory(request.body as never);
    return reply.code(201).send({ ok: true });
  });

  app.put<{ Params: { id: string } }>("/calendar/categories/:id", async (request) => {
    await repo.updateCategory(request.params.id, request.body as never);
    return { ok: true };
  });

  app.put<{ Body: { categoryIds: string[] } }>("/calendar/categories/order", async (request) => {
    await repo.reorderCategories(request.body.categoryIds);
    return { ok: true };
  });

  app.delete<{ Params: { id: string }; Body: { replacementCategoryId: string } }>("/calendar/categories/:id", async (request) => {
    await repo.deleteCategory(request.params.id, request.body.replacementCategoryId);
    return { ok: true };
  });
}
