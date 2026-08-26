import type { MediaMaintenance, OrphanMediaUsage } from "../media/media-maintenance";
import { httpGet, httpPost } from "./http-client";

export class HttpMediaMaintenance implements MediaMaintenance {
  async orphanUsage(): Promise<OrphanMediaUsage> {
    return httpGet<OrphanMediaUsage>("/media/orphan-stats");
  }

  async gc(): Promise<number> {
    const { deleted } = await httpPost<{ deleted: number }>("/media/gc");
    return deleted;
  }
}
