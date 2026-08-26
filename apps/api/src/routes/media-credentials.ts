import type { FastifyInstance } from "fastify";
import type { R2MediaStore } from "../repositories/r2-media-store.ts";
import type { R2Credentials, SqliteSecretStore } from "../repositories/secret-store.ts";

export function registerMediaCredentialRoutes(app: FastifyInstance, secretStore: SqliteSecretStore, mediaStore: R2MediaStore) {
  app.get("/media/credentials", async () => ({ hasCredentials: secretStore.hasR2Credentials() }));

  app.post<{ Body: R2Credentials }>("/media/credentials", async (request, reply) => {
    secretStore.setR2Credentials(request.body);
    return reply.code(201).send({ ok: true });
  });

  app.delete("/media/credentials", async () => {
    secretStore.deleteR2Credentials();
    return { ok: true };
  });

  app.post("/media/credentials/test", async () => {
    await mediaStore.testConnection();
    return { ok: true };
  });
}
