import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { Readable } from "node:stream";
import type { SqliteSecretStore } from "./secret-store.ts";

export interface StoredMediaObject {
  body: Readable;
  contentType: string;
}

export interface MediaObjectSummary {
  key: string;
  size: number;
}

// 배치 삭제(DeleteObjectsCommand)는 요청 하나에 최대 1000개까지만 받는다.
const DELETE_BATCH_SIZE = 1000;

// R2는 S3 호환 API다. 자격증명은 SecretStore에만 있고 저트래픽 로컬 sidecar라 클라이언트를
// 캐싱하지 않는다 — 호출마다 새로 만들어도 측정 가능한 비용이 없다.
export class R2MediaStore {
  private readonly secretStore: SqliteSecretStore;

  constructor(secretStore: SqliteSecretStore) {
    this.secretStore = secretStore;
  }

  async put(id: string, body: Buffer, contentType: string): Promise<void> {
    const client = this.requireClient();
    await client.client.send(new PutObjectCommand({ Bucket: client.bucket, Key: id, Body: body, ContentType: contentType }));
  }

  async get(id: string): Promise<StoredMediaObject | null> {
    const client = this.requireClient();
    try {
      const result = await client.client.send(new GetObjectCommand({ Bucket: client.bucket, Key: id }));
      return { body: result.Body as Readable, contentType: result.ContentType ?? "application/octet-stream" };
    } catch (error) {
      if (isNotFoundError(error)) return null;
      throw error;
    }
  }

  async delete(id: string): Promise<void> {
    const client = this.requireClient();
    await client.client.send(new DeleteObjectCommand({ Bucket: client.bucket, Key: id }));
  }

  async listAllKeys(): Promise<MediaObjectSummary[]> {
    const client = this.requireClient();
    const summaries: MediaObjectSummary[] = [];
    let continuationToken: string | undefined;
    do {
      const page = await client.client.send(new ListObjectsV2Command({
        Bucket: client.bucket,
        ContinuationToken: continuationToken,
      }));
      for (const object of page.Contents ?? []) {
        if (object.Key) summaries.push({ key: object.Key, size: object.Size ?? 0 });
      }
      continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (continuationToken);
    return summaries;
  }

  async deleteMany(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const client = this.requireClient();
    for (let index = 0; index < ids.length; index += DELETE_BATCH_SIZE) {
      const batch = ids.slice(index, index + DELETE_BATCH_SIZE);
      await client.client.send(new DeleteObjectsCommand({
        Bucket: client.bucket,
        Delete: { Objects: batch.map((key) => ({ Key: key })) },
      }));
    }
  }

  async testConnection(): Promise<void> {
    const client = this.requireClient();
    await client.client.send(new HeadBucketCommand({ Bucket: client.bucket }));
  }

  private requireClient(): { client: S3Client; bucket: string } {
    const credentials = this.secretStore.getR2Credentials();
    if (!credentials) throw new Error("R2 자격증명이 설정되지 않았습니다.");
    const client = new S3Client({
      region: "auto",
      endpoint: `https://${credentials.accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: credentials.accessKeyId, secretAccessKey: credentials.secretAccessKey },
    });
    return { client, bucket: credentials.bucket };
  }
}

function isNotFoundError(error: unknown): boolean {
  const name = (error as { name?: string } | null)?.name;
  return name === "NoSuchKey" || name === "NotFound";
}
