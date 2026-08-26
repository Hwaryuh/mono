import type { InboxRepository } from "../../features/inbox/inbox-repository";
import type { ScrapRepository } from "../../features/scrap/scrap-repository";

/**
 * 서버가 아직 참조 중인 mediaId 전부. 미디어 정리가 지우면 안 되는 목록이다.
 *
 * 미디어 바이트는 이 PC에만 있고 참조는 서버에만 있다. 스냅샷을 하나라도 못 받으면 목록이
 * 불완전해지고, 그 상태로 GC를 돌리면 살아 있는 사진·영상을 복구 불가능하게 지운다.
 * 그래서 Promise.all로 묶어 하나라도 실패하면 던진다 — 호출자는 절대 부분 목록으로 지우면 안 된다.
 */
export async function referencedMediaIds(
  inboxRepository: InboxRepository,
  scrapRepository: ScrapRepository,
): Promise<Set<string>> {
  const [inbox, scrap] = await Promise.all([inboxRepository.getSnapshot(), scrapRepository.getSnapshot()]);
  const ids = new Set<string>();
  for (const item of inbox.items) {
    item.images?.forEach((image) => ids.add(image.mediaId));
    item.videos?.forEach((video) => ids.add(video.mediaId));
  }
  for (const item of scrap.items) {
    if (item.mediaId) ids.add(item.mediaId);
  }
  return ids;
}
