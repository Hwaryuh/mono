import type { FastifyInstance } from "fastify";
import { AI_PROVIDER_IDS, type AiProviderId, type SqliteSecretStore } from "../repositories/secret-store.ts";

interface TestableCaptureAnalysisProvider {
  testConnection(): Promise<void>;
}

function requireProviderId(value: unknown): AiProviderId {
  if (typeof value === "string" && (AI_PROVIDER_IDS as readonly string[]).includes(value)) return value as AiProviderId;
  throw new Error("알 수 없는 AI provider입니다.");
}

export function registerAiRoutes(
  app: FastifyInstance,
  secretStore: SqliteSecretStore,
  providers: Record<AiProviderId, TestableCaptureAnalysisProvider>,
) {
  app.get<{ Params: { provider: string } }>("/ai/keys/:provider", async (request) => {
    return { hasKey: secretStore.hasApiKey(requireProviderId(request.params.provider)) };
  });

  app.post<{ Params: { provider: string }; Body: { apiKey: string } }>("/ai/keys/:provider", async (request, reply) => {
    secretStore.setApiKey(requireProviderId(request.params.provider), request.body.apiKey);
    return reply.code(201).send({ ok: true });
  });

  app.delete<{ Params: { provider: string } }>("/ai/keys/:provider", async (request) => {
    secretStore.deleteApiKey(requireProviderId(request.params.provider));
    return { ok: true };
  });

  app.post<{ Params: { provider: string } }>("/ai/keys/:provider/test", async (request) => {
    const provider = requireProviderId(request.params.provider);
    await providers[provider].testConnection();
    return { ok: true };
  });

  app.get("/ai/provider", async () => ({ provider: secretStore.getActiveProvider() }));

  app.post<{ Body: { provider: string } }>("/ai/provider", async (request) => {
    secretStore.setActiveProvider(requireProviderId(request.body.provider));
    return { ok: true };
  });
}
