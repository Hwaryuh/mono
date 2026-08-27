import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import Fastify from "fastify";
import { ZodError } from "zod";
import { createDb, type Db } from "./db/client.ts";
import { SqliteCalendarRepository } from "./repositories/calendar-repository.ts";
import { SqliteDashboardRepository } from "./repositories/dashboard-repository.ts";
import { GeminiCaptureAnalysisProvider } from "./repositories/gemini-capture-analysis-provider.ts";
import { SqliteInboxRepository } from "./repositories/inbox-repository.ts";
import { SqliteLedgerRepository } from "./repositories/ledger-repository.ts";
import { MediaReferenceRepository } from "./repositories/media-reference-repository.ts";
import { OpenAiCaptureAnalysisProvider } from "./repositories/openai-capture-analysis-provider.ts";
import { R2MediaStore } from "./repositories/r2-media-store.ts";
import { SqliteRoutineRepository } from "./repositories/routine-repository.ts";
import { SqliteScrapRepository } from "./repositories/scrap-repository.ts";
import { SqliteSecretStore } from "./repositories/secret-store.ts";
import { SelectableCaptureAnalysisProvider } from "./repositories/selectable-capture-analysis-provider.ts";
import { SqliteTodoRepository } from "./repositories/todo-repository.ts";
import { registerAiRoutes } from "./routes/ai.ts";
import { registerCalendarRoutes } from "./routes/calendar.ts";
import { registerDashboardRoutes } from "./routes/dashboard.ts";
import { registerInboxRoutes } from "./routes/inbox.ts";
import { registerLedgerRoutes } from "./routes/ledger.ts";
import { registerMediaCredentialRoutes } from "./routes/media-credentials.ts";
import { registerMediaRoutes } from "./routes/media.ts";
import { registerRoutineRoutes } from "./routes/routine.ts";
import { registerScrapRoutes } from "./routes/scrap.ts";
import { registerTodoRoutes } from "./routes/todo.ts";

// 영상 100MB 캡처 업로드에 여유를 둔 상한. JSON 라우트의 CAPTURE_BODY_LIMIT_BYTES와 별개로
// /media POST 라우트에만 개별 적용한다(멀티파트 전역 기본값).
const MEDIA_UPLOAD_LIMIT_BYTES = 105 * 1024 * 1024;

// 캡처는 사진 data URL을 본문에 실어 보낸다. 데스크톱 QuickCapture 상한이 원본 13MB이고
// base64가 약 4/3로 팽창하므로 17.4MB + JSON 여유를 잡는다. Fastify 기본 1MB로는 사진 캡처가
// 전부 413으로 떨어진다.
const CAPTURE_BODY_LIMIT_BYTES = 24 * 1024 * 1024;

export function buildServer(db: Db = createDb()) {
  const app = Fastify({ logger: false, bodyLimit: CAPTURE_BODY_LIMIT_BYTES });

  // 단일 사용자 로컬 앱: 인증 대신 오리진만 제한한다(§5, §9). Tauri devUrl(Vite)과 패키징된
  // 웹뷰 오리진만 허용 — Origin 헤더가 없는 요청(Tauri 커스텀 프로토콜 등)은 통과시킨다.
  app.register(cors, {
    origin: [
      "http://127.0.0.1:4173",
      "http://localhost:4173",
      "tauri://localhost",
      "http://tauri.localhost",
    ],
    // @fastify/cors 기본값은 GET,HEAD,POST뿐이다 — PUT/DELETE 라우트(라벨 수정·삭제 등)가
    // 실제 브라우저 preflight에서 전부 막혀 있었다. 쓰는 메서드를 명시한다.
    methods: ["GET", "POST", "PUT", "DELETE"],
  });
  app.register(multipart, { limits: { fileSize: MEDIA_UPLOAD_LIMIT_BYTES, files: 1 } });

  // ponytail: 인증 스텁. localhost 단계는 통과. 인터넷 노출 배포 결정 시 실제 인증으로 교체(§5).
  app.addHook("onRequest", async () => {});

  app.setErrorHandler((error: unknown, _request, reply) => {
    if (error instanceof ZodError) return reply.code(422).send({ error: error.issues });
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("찾을 수 없습니다")) return reply.code(404).send({ error: message });
    return reply.code(400).send({ error: message });
  });

  const secretStore = new SqliteSecretStore(db);
  const geminiProvider = new GeminiCaptureAnalysisProvider(() => secretStore.getApiKey("gemini"));
  const openaiProvider = new OpenAiCaptureAnalysisProvider(() => secretStore.getApiKey("openai"));
  const captureProviders = { gemini: geminiProvider, openai: openaiProvider };
  const analysisProvider = new SelectableCaptureAnalysisProvider(secretStore, captureProviders);
  const mediaStore = new R2MediaStore(secretStore);
  const mediaReferences = new MediaReferenceRepository(db);

  registerTodoRoutes(app, new SqliteTodoRepository(db));
  registerLedgerRoutes(app, new SqliteLedgerRepository(db));
  registerRoutineRoutes(app, new SqliteRoutineRepository(db));
  registerCalendarRoutes(app, new SqliteCalendarRepository(db));
  registerScrapRoutes(app, new SqliteScrapRepository(db));
  registerMediaRoutes(app, mediaStore, mediaReferences);
  registerMediaCredentialRoutes(app, secretStore, mediaStore);
  registerInboxRoutes(app, new SqliteInboxRepository(db));
  registerDashboardRoutes(app, new SqliteDashboardRepository(db, analysisProvider));
  registerAiRoutes(app, secretStore, captureProviders);
  return app;
}
