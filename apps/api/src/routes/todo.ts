import type { FastifyInstance } from "fastify";
import type { SqliteTodoRepository } from "../repositories/todo-repository.ts";

// TodoRepository 인터페이스를 HTTP로 노출한다. 검증은 저장소가 contracts 스키마로 수행한다.
export function registerTodoRoutes(app: FastifyInstance, repo: SqliteTodoRepository) {
  app.get("/todo/snapshot", async () => repo.getSnapshot());

  app.post("/todo/items", async (request, reply) => {
    await repo.create(request.body as never);
    return reply.code(201).send({ ok: true });
  });

  app.put<{ Params: { id: string } }>("/todo/items/:id", async (request) => {
    await repo.update(request.params.id, request.body as never);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>("/todo/items/:id/toggle", async (request) => {
    await repo.toggleComplete(request.params.id);
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>("/todo/items/:id", async (request) => {
    await repo.delete(request.params.id);
    return { ok: true };
  });

  app.post("/todo/labels", async (request, reply) => {
    await repo.createLabel(request.body as never);
    return reply.code(201).send({ ok: true });
  });

  app.put<{ Params: { id: string } }>("/todo/labels/:id", async (request) => {
    await repo.updateLabel(request.params.id, request.body as never);
    return { ok: true };
  });

  app.put<{ Body: { labelIds: string[] } }>("/todo/labels/order", async (request) => {
    await repo.reorderLabels(request.body.labelIds);
    return { ok: true };
  });

  app.delete<{ Params: { id: string }; Body: { replacementLabelId: string } }>("/todo/labels/:id", async (request) => {
    await repo.deleteLabel(request.params.id, request.body.replacementLabelId);
    return { ok: true };
  });
}
