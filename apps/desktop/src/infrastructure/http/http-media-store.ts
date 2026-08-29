import type { MediaStore } from "../media/media-store";
import { httpDelete, httpGetBlob, httpUpload } from "./http-client";

export class HttpMediaStore implements MediaStore {
  async save(id: string, file: Blob): Promise<void> {
    // macOS WKWebView는 <input type=file>의 File을 FormData로 fetch 전송할 때 본문을 비워
    // 보내는 사례가 있다(미리보기는 되지만 업로드만 0바이트). 바이트를 먼저 arrayBuffer로
    // 실체화해 새 Blob으로 감싸 보내면 이 지연 스트리밍 버그를 피한다.
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
