import { invoke, isTauri } from "@tauri-apps/api/core";

// Blob을 저장한다. 데스크톱에서는 네이티브 "다른 이름으로 저장" 대화상자(경로 선택),
// 브라우저 프리뷰에서는 <a download> 폴백. 웹뷰의 <a download>는 macOS에서 경로 선택 없이
// 다운로드 폴더로만 떨어지므로 Tauri에서는 커스텀 커맨드로 처리한다.
export async function saveBlobToDisk(blob: Blob, name: string): Promise<void> {
  if (isTauri()) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    await invoke("save_media_file", { name, bytes });
    return;
  }
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.rel = "noreferrer";
    document.body.append(link);
    link.click();
    link.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

// blob:/asset: object URL에서 원본 Blob을 되찾아 저장한다.
export async function saveObjectUrlToDisk(src: string, name: string): Promise<void> {
  const blob = await fetch(src).then((response) => response.blob());
  await saveBlobToDisk(blob, name);
}
