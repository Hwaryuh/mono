import type { FastifyInstance } from "fastify";
import type { SqliteDashboardRepository } from "../repositories/dashboard-repository.ts";

export function registerDashboardRoutes(app: FastifyInstance, repo: SqliteDashboardRepository) {
  app.get("/dashboard/snapshot", async () => repo.getSnapshot());

  app.post("/dashboard/capture", async (request, reply) => {
    await repo.capture(request.body as never);
    return reply.code(201).send({ ok: true });
  });

  app.post<{ Params: { id: string } }>("/dashboard/tasks/:id/toggle", async (request) => {
    await repo.toggleTask(request.params.id);
    return { ok: true };
  });
}
