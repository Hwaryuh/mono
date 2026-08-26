import type { FastifyInstance } from "fastify";
import type { GeminiCaptureAnalysisProvider } from "../repositories/gemini-capture-analysis-provider.ts";
import type { SqliteSecretStore } from "../repositories/secret-store.ts";

export function registerAiRoutes(app: FastifyInstance, secretStore: SqliteSecretStore, provider: GeminiCaptureAnalysisProvider) {
  app.get("/ai/gemini-key", async () => ({ hasKey: secretStore.hasGeminiApiKey() }));

  app.post("/ai/gemini-key", async (request, reply) => {
    const { apiKey } = request.body as { apiKey: string };
    secretStore.setGeminiApiKey(apiKey);
    return reply.code(201).send({ ok: true });
  });

  app.delete("/ai/gemini-key", async () => {
    secretStore.deleteGeminiApiKey();
    return { ok: true };
  });

  app.post("/ai/gemini-key/test", async () => {
    await provider.testConnection();
    return { ok: true };
  });
}
