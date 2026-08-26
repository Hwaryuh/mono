import { S3Client } from "@aws-sdk/client-s3";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDb, type Db } from "../db/client.ts";
import { inboxItems, scrapItems } from "../db/schema.ts";
import { buildServer } from "../server.ts";

function freshDb(): Db {
  return createDb(":memory:");
}

async function encodeMultipart(fields: Record<string, string>, file: { field: string; filename: string; mimetype: string; data: Buffer }) {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) formData.append(key, value);
  formData.append(file.field, new Blob([file.data], { type: file.mimetype }), file.filename);
  const request = new Request("http://localhost", { method: "POST", body: formData });
  return { body: Buffer.from(await request.arrayBuffer()), contentType: request.headers.get("content-type")! };
}

async function withR2Credentials(app: Awaited<ReturnType<typeof buildServer>>) {
  await app.inject({
    method: "POST",
    url: "/media/credentials",
    payload: { accountId: "acc-1", accessKeyId: "key-1", secretAccessKey: "secret-1", bucket: "bucket-1" },
  });
}

const MEDIA_ID = "11111111-1111-4111-8111-111111111111";

describe("media routes", () => {
  let sendMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sendMock = vi.fn();
    vi.spyOn(S3Client.prototype, "send").mockImplementation(sendMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("HTTP로 업로드·다운로드·삭제가 이어진다", async () => {
    const app = buildServer(freshDb());
    await app.ready();
    await withR2Credentials(app);
    sendMock.mockImplementation((command) => {
      if (command.constructor.name === "PutObjectCommand") return Promise.resolve({});
      if (command.constructor.name === "GetObjectCommand") return Promise.resolve({ Body: Readable.from([Buffer.from("hello")]), ContentType: "image/png" });
      if (command.constructor.name === "DeleteObjectCommand") return Promise.resolve({});
      return Promise.reject(new Error(`unexpected command: ${command.constructor.name}`));
    });

    const { body, contentType } = await encodeMultipart({ id: MEDIA_ID }, { field: "file", filename: "a.png", mimetype: "image/png", data: Buffer.from("bytes") });
    const uploaded = await app.inject({ method: "POST", url: "/media", headers: { "content-type": contentType }, payload: body });
    expect(uploaded.statusCode).toBe(201);

    const downloaded = await app.inject({ method: "GET", url: `/media/${MEDIA_ID}` });
    expect(downloaded.statusCode).toBe(200);
    expect(downloaded.headers["content-type"]).toBe("image/png");
    expect(downloaded.body).toBe("hello");

    const deleted = await app.inject({ method: "DELETE", url: `/media/${MEDIA_ID}` });
    expect(deleted.statusCode).toBe(200);

    await app.close();
  });

  it("uuid 형식이 아닌 id는 400으로 거부한다", async () => {
    const app = buildServer(freshDb());
    await app.ready();
    const response = await app.inject({ method: "GET", url: "/media/not-a-uuid" });
    expect(response.statusCode).toBe(400);
    expect(sendMock).not.toHaveBeenCalled();
    await app.close();
  });

  it("존재하지 않는 미디어는 404를 준다", async () => {
    const app = buildServer(freshDb());
    await app.ready();
    await withR2Credentials(app);
    sendMock.mockRejectedValue(Object.assign(new Error("no such key"), { name: "NoSuchKey" }));

    const response = await app.inject({ method: "GET", url: `/media/${MEDIA_ID}` });
    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it("orphan-stats·gc는 참조되지 않은 객체만 대상으로 삼는다", async () => {
    const db = freshDb();
    db.insert(scrapItems).values({ id: "s1", seq: 1, kind: "image", title: "t", memo: "", tag: "요리", savedAt: "now", url: null, mediaId: MEDIA_ID }).run();
    db.insert(inboxItems).values({
      id: "i1", seq: 1, source: "text", raw: "r", target: "todo", confidence: 0.5, status: "pending", pinned: false, receivedAt: "now",
      fieldsJson: "[]", imagesJson: null, videosJson: null,
    }).run();
    const app = buildServer(db);
    await app.ready();
    await withR2Credentials(app);
    sendMock.mockImplementation((command) => {
      if (command.constructor.name === "ListObjectsV2Command") {
        return Promise.resolve({ Contents: [{ Key: MEDIA_ID, Size: 10 }, { Key: "orphan-media-id", Size: 20 }], IsTruncated: false });
      }
      if (command.constructor.name === "DeleteObjectsCommand") return Promise.resolve({});
      return Promise.reject(new Error(`unexpected command: ${command.constructor.name}`));
    });

    const stats = JSON.parse((await app.inject({ method: "GET", url: "/media/orphan-stats" })).body);
    expect(stats).toEqual({ count: 1, bytes: 20 });

    const gc = JSON.parse((await app.inject({ method: "POST", url: "/media/gc" })).body);
    expect(gc).toEqual({ deleted: 1 });
    const deleteCall = sendMock.mock.calls.find(([command]) => command.constructor.name === "DeleteObjectsCommand");
    expect(deleteCall![0].input.Delete.Objects).toEqual([{ Key: "orphan-media-id" }]);

    await app.close();
  });
});

describe("media credential routes", () => {
  it("자격증명을 설정·조회·삭제하고, 저장 후엔 연결 테스트가 실제로 호출된다", async () => {
    const sendMock = vi.fn().mockResolvedValue({});
    vi.spyOn(S3Client.prototype, "send").mockImplementation(sendMock);
    const app = buildServer(freshDb());
    await app.ready();

    expect(JSON.parse((await app.inject({ method: "GET", url: "/media/credentials" })).body)).toEqual({ hasCredentials: false });

    const set = await app.inject({
      method: "POST",
      url: "/media/credentials",
      payload: { accountId: "acc-1", accessKeyId: "key-1", secretAccessKey: "secret-1", bucket: "bucket-1" },
    });
    expect(set.statusCode).toBe(201);
    expect(JSON.parse((await app.inject({ method: "GET", url: "/media/credentials" })).body)).toEqual({ hasCredentials: true });

    const tested = await app.inject({ method: "POST", url: "/media/credentials/test" });
    expect(tested.statusCode).toBe(200);
    expect(sendMock).toHaveBeenCalled();

    const deleted = await app.inject({ method: "DELETE", url: "/media/credentials" });
    expect(deleted.statusCode).toBe(200);
    expect(JSON.parse((await app.inject({ method: "GET", url: "/media/credentials" })).body)).toEqual({ hasCredentials: false });

    vi.restoreAllMocks();
    await app.close();
  });

  it("필드가 비어 있으면 400으로 거부한다", async () => {
    const app = buildServer(freshDb());
    await app.ready();
    const response = await app.inject({
      method: "POST",
      url: "/media/credentials",
      payload: { accountId: "acc-1", accessKeyId: "key-1", secretAccessKey: "  ", bucket: "bucket-1" },
    });
    expect(response.statusCode).toBe(400);
    await app.close();
  });
});
