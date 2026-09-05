import { invoke, isTauri } from "@tauri-apps/api/core";

// Saves a Blob. On desktop, a native "Save As" dialog (path picker);
// in the browser preview, an <a download> fallback. Since the webview's <a download> on macOS lands
// in the Downloads folder without a path picker, Tauri handles it with a custom command instead.
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

// Recovers the original Blob from a blob:/asset: object URL and saves it.
export async function saveObjectUrlToDisk(src: string, name: string): Promise<void> {
  const blob = await fetch(src).then((response) => response.blob());
  await saveBlobToDisk(blob, name);
}
