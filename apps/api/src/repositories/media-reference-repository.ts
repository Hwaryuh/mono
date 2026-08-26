import type { Db } from "../db/client.ts";
import { inboxItems, scrapItems } from "../db/schema.ts";

interface MediaRef {
  mediaId?: string | null;
}

// 미디어 GC의 keepIds를 서버가 자체 DB에서 직접 계산한다. 예전에는 데스크톱이 inbox·scrap
// 스냅샷을 HTTP로 각각 받아와 계산했지만(참조: 삭제된 referenced-media-ids.ts), 서버가
// 두 테이블을 이미 갖고 있으므로 왕복이 필요 없다.
export class MediaReferenceRepository {
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  referencedMediaIds(): Set<string> {
    const ids = new Set<string>();

    for (const row of this.db.select({ mediaId: scrapItems.mediaId }).from(scrapItems).all()) {
      if (row.mediaId) ids.add(row.mediaId);
    }

    for (const row of this.db.select({ imagesJson: inboxItems.imagesJson, videosJson: inboxItems.videosJson }).from(inboxItems).all()) {
      for (const media of parseMediaRefs(row.imagesJson)) if (media.mediaId) ids.add(media.mediaId);
      for (const media of parseMediaRefs(row.videosJson)) if (media.mediaId) ids.add(media.mediaId);
    }

    return ids;
  }
}

function parseMediaRefs(json: string | null): MediaRef[] {
  if (!json) return [];
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? (parsed as MediaRef[]) : [];
  } catch {
    return [];
  }
}
