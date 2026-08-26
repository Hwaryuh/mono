import type { MediaStore } from "../media/media-store";
import { httpDelete, httpGetBlob, httpUpload } from "./http-client";

export class HttpMediaStore implements MediaStore {
  async save(id: string, file: Blob): Promise<void> {
    const formData = new FormData();
    formData.append("id", id);
    formData.append("file", file);
    await httpUpload("/media", formData);
  }

  async load(id: string): Promise<string | null> {
    const blob = await httpGetBlob(`/media/${id}`);
    return blob ? URL.createObjectURL(blob) : null;
  }

  async delete(id: string): Promise<void> {
    await httpDelete(`/media/${id}`);
  }
}
