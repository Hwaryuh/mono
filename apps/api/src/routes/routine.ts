import type { FastifyInstance } from "fastify";
import type { SqliteRoutineRepository } from "../repositories/routine-repository.ts";

export function registerRoutineRoutes(app: FastifyInstance, repo: SqliteRoutineRepository) {
  app.get("/routine/snapshot", async () => repo.getSnapshot());

  app.post("/routine/items", async (request, reply) => {
    await repo.create(request.body as never);
    return reply.code(201).send({ ok: true });
  });

  app.put<{ Params: { id: string } }>("/routine/items/:id", async (request) => {
    await repo.update(request.params.id, request.body as never);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>("/routine/items/:id/toggle-today", async (request) => {
    await repo.toggleToday(request.params.id);
    return { ok: true };
  });
}
