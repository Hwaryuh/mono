import { S3Client } from "@aws-sdk/client-s3";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDb, type Db } from "../db/client.ts";
import { R2MediaStore } from "./r2-media-store.ts";
import { SqliteSecretStore } from "./secret-store.ts";

function storeWithCredentials(): SqliteSecretStore {
  const db: Db = createDb(":memory:");
  const store = new SqliteSecretStore(db);
  store.setR2Credentials({ accountId: "acc-1", accessKeyId: "key-1", secretAccessKey: "secret-1", bucket: "bucket-1" });
  return store;
}

describe("R2MediaStore", () => {
  let sendMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sendMock = vi.fn();
    vi.spyOn(S3Client.prototype, "send").mockImplementation(sendMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("자격증명이 없으면 요청 전에 명확한 에러를 던진다", async () => {
    const store = new R2MediaStore(new SqliteSecretStore(createDb(":memory:")));
    await expect(store.put("id-1", Buffer.from("x"), "image/png")).rejects.toThrow("R2 자격증명이 설정되지 않았습니다.");
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("put은 버킷·키·본문·content-type을 실어 PutObjectCommand를 보낸다", async () => {
    sendMock.mockResolvedValue({});
    const store = new R2MediaStore(storeWithCredentials());

    await store.put("media-1", Buffer.from("bytes"), "image/png");

    const [command] = sendMock.mock.calls[0];
    expect(command.input).toEqual({ Bucket: "bucket-1", Key: "media-1", Body: Buffer.from("bytes"), ContentType: "image/png" });
  });

  it("get은 존재하는 객체의 본문과 content-type을 돌려준다", async () => {
    const body = Readable.from([Buffer.from("data")]);
    sendMock.mockResolvedValue({ Body: body, ContentType: "video/mp4" });
    const store = new R2MediaStore(storeWithCredentials());

    const result = await store.get("media-1");

    expect(result).toEqual({ body, contentType: "video/mp4" });
  });

  it("get은 NoSuchKey면 null을 돌려준다", async () => {
    const notFound = Object.assign(new Error("no such key"), { name: "NoSuchKey" });
    sendMock.mockRejectedValue(notFound);
    const store = new R2MediaStore(storeWithCredentials());

    await expect(store.get("missing")).resolves.toBeNull();
  });

  it("get은 다른 에러는 그대로 던진다", async () => {
    sendMock.mockRejectedValue(new Error("network down"));
    const store = new R2MediaStore(storeWithCredentials());

    await expect(store.get("media-1")).rejects.toThrow("network down");
  });

  it("delete는 DeleteObjectCommand를 보낸다", async () => {
    sendMock.mockResolvedValue({});
    const store = new R2MediaStore(storeWithCredentials());

    await store.delete("media-1");

    const [command] = sendMock.mock.calls[0];
    expect(command.input).toEqual({ Bucket: "bucket-1", Key: "media-1" });
  });

  it("listAllKeys는 ContinuationToken을 따라 여러 페이지를 모은다", async () => {
    sendMock
      .mockResolvedValueOnce({ Contents: [{ Key: "a", Size: 10 }], IsTruncated: true, NextContinuationToken: "tok-2" })
      .mockResolvedValueOnce({ Contents: [{ Key: "b", Size: 20 }], IsTruncated: false });
    const store = new R2MediaStore(storeWithCredentials());

    const keys = await store.listAllKeys();

    expect(keys).toEqual([{ key: "a", size: 10 }, { key: "b", size: 20 }]);
    expect(sendMock).toHaveBeenCalledTimes(2);
  });

  it("deleteMany는 빈 배열이면 요청을 보내지 않는다", async () => {
    const store = new R2MediaStore(storeWithCredentials());
    await store.deleteMany([]);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("deleteMany는 1000개 단위로 배치를 나눠 보낸다", async () => {
    sendMock.mockResolvedValue({});
    const store = new R2MediaStore(storeWithCredentials());
    const ids = Array.from({ length: 1500 }, (_, index) => `id-${index}`);

    await store.deleteMany(ids);

    expect(sendMock).toHaveBeenCalledTimes(2);
    expect(sendMock.mock.calls[0][0].input.Delete.Objects).toHaveLength(1000);
    expect(sendMock.mock.calls[1][0].input.Delete.Objects).toHaveLength(500);
  });

  it("testConnection은 HeadBucketCommand를 보낸다", async () => {
    sendMock.mockResolvedValue({});
    const store = new R2MediaStore(storeWithCredentials());

    await store.testConnection();

    const [command] = sendMock.mock.calls[0];
    expect(command.input).toEqual({ Bucket: "bucket-1" });
  });
});
