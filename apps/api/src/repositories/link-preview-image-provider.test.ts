import { describe, expect, it, vi } from "vitest";
import { HttpLinkPreviewImageProvider } from "./link-preview-image-provider.ts";

const publicAddresses = async () => ["93.184.216.34"];

describe("HttpLinkPreviewImageProvider", () => {
  it("Open Graph 상대 이미지 URL을 해석하고 이미지를 가져온다", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('<meta content="/cover.jpg?x=1&amp;y=2" property="og:image">', { headers: { "content-type": "text/html; charset=utf-8" } }))
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/jpeg" } }));
    const provider = HttpLinkPreviewImageProvider.of({ fetch: fetcher, resolveAddresses: publicAddresses });

    await expect(provider.get("https://example.com/article")).resolves.toEqual({ body: new Uint8Array([1, 2, 3]), contentType: "image/jpeg" });
    expect(fetcher.mock.calls[1][0].toString()).toBe("https://example.com/cover.jpg?x=1&y=2");
  });

  it("og:image가 없으면 twitter:image를 사용한다", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("<meta name='twitter:image' content='https://cdn.example.com/card.webp'>", { headers: { "content-type": "text/html" } }))
      .mockResolvedValueOnce(new Response(new Uint8Array([4]), { headers: { "content-type": "image/webp" } }));
    const provider = HttpLinkPreviewImageProvider.of({ fetch: fetcher, resolveAddresses: publicAddresses });

    expect((await provider.get("https://example.com"))?.contentType).toBe("image/webp");
  });

  it("사설 주소와 HTTP 외 프로토콜은 요청하지 않는다", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const provider = HttpLinkPreviewImageProvider.of({ fetch: fetcher, resolveAddresses: async () => ["127.0.0.1"] });

    await expect(provider.get("http://internal.example.test")).resolves.toBeNull();
    await expect(provider.get("file:///etc/passwd")).resolves.toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
