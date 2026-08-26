import type { FastifyInstance } from "fastify";
import type { MediaObjectSummary, R2MediaStore } from "../repositories/r2-media-store.ts";
import type { MediaReferenceRepository } from "../repositories/media-reference-repository.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// mediaId는 R2 객체 키로 그대로 쓰인다. uuid 형식만 허용해 경로·키 주입을 막는다.
function requireMediaId(value: unknown): string {
  if (typeof value === "string" && UUID_RE.test(value)) return value;
  throw new Error("올바르지 않은 미디어 id입니다.");
}

function orphansOf(objects: MediaObjectSummary[], referenced: Set<string>): MediaObjectSummary[] {
  return objects.filter((object) => !referenced.has(object.key));
}

export function registerMediaRoutes(app: FastifyInstance, mediaStore: R2MediaStore, mediaReferences: MediaReferenceRepository) {
  app.post("/media", { bodyLimit: 105 * 1024 * 1024 }, async (request, reply) => {
    const file = await request.file();
    if (!file) throw new Error("업로드할 파일이 없습니다.");
    const idField = file.fields.id;
    const idValue = idField && !Array.isArray(idField) && idField.type === "field" ? idField.value : undefined;
    const id = requireMediaId(idValue);
    await mediaStore.put(id, await file.toBuffer(), file.mimetype);
    return reply.code(201).send({ ok: true });
  });

  app.get<{ Params: { id: string } }>("/media/:id", async (request, reply) => {
    const id = requireMediaId(request.params.id);
    const object = await mediaStore.get(id);
    if (!object) throw new Error(`미디어를 찾을 수 없습니다: ${id}`);
    reply.header("content-type", object.contentType);
    return reply.send(object.body);
  });

  app.delete<{ Params: { id: string } }>("/media/:id", async (request) => {
    await mediaStore.delete(requireMediaId(request.params.id));
    return { ok: true };
  });

  app.get("/media/orphan-stats", async () => {
    const [objects, referenced] = await Promise.all([mediaStore.listAllKeys(), Promise.resolve(mediaReferences.referencedMediaIds())]);
    const orphans = orphansOf(objects, referenced);
    return { count: orphans.length, bytes: orphans.reduce((sum, object) => sum + object.size, 0) };
  });

  app.post("/media/gc", async () => {
    const objects = await mediaStore.listAllKeys();
    const orphans = orphansOf(objects, mediaReferences.referencedMediaIds());
    await mediaStore.deleteMany(orphans.map((object) => object.key));
    return { deleted: orphans.length };
  });
}
