import type { MediaStore } from "../media/media-store";
import { httpDelete, httpGetBlob, httpUpload } from "./http-client";

export class HttpMediaStore implements MediaStore {
  async save(id: string, file: Blob): Promise<void> {
    // macOS WKWebView has been observed sending an empty body when a <input type=file> File is sent via
    // fetch + FormData (the preview works, but only the upload is 0 bytes). Materializing the bytes
    // as an arrayBuffer first and wrapping them in a new Blob before sending avoids this lazy-streaming bug.
    const bytes = await file.arrayBuffer();
    const blob = new Blob([bytes], { type: file.type || "application/octet-stream" });
    const formData = new FormData();
    formData.append("id", id);
    formData.append("file", blob, "upload");
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
