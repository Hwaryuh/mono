import type { FastifyInstance } from "fastify";
import type { GeminiCaptureAnalysisProvider } from "../repositories/gemini-capture-analysis-provider.ts";
import type { OpenAiCaptureAnalysisProvider } from "../repositories/openai-capture-analysis-provider.ts";
import type { AiProviderId, SqliteSecretStore } from "../repositories/secret-store.ts";

export function registerAiRoutes(
  app: FastifyInstance,
  secretStore: SqliteSecretStore,
  geminiProvider: GeminiCaptureAnalysisProvider,
  openaiProvider: OpenAiCaptureAnalysisProvider,
) {
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
    await geminiProvider.testConnection();
    return { ok: true };
  });

  app.get("/ai/openai-key", async () => ({ hasKey: secretStore.hasOpenaiApiKey() }));

  app.post("/ai/openai-key", async (request, reply) => {
    const { apiKey } = request.body as { apiKey: string };
    secretStore.setOpenaiApiKey(apiKey);
    return reply.code(201).send({ ok: true });
  });

  app.delete("/ai/openai-key", async () => {
    secretStore.deleteOpenaiApiKey();
    return { ok: true };
  });

  app.post("/ai/openai-key/test", async () => {
    await openaiProvider.testConnection();
    return { ok: true };
  });

  app.get("/ai/provider", async () => ({ provider: secretStore.getActiveProvider() }));

  app.post("/ai/provider", async (request) => {
    const { provider } = request.body as { provider: AiProviderId };
    if (provider !== "gemini" && provider !== "openai") throw new Error("알 수 없는 AI provider입니다.");
    secretStore.setActiveProvider(provider);
    return { ok: true };
  });
}
