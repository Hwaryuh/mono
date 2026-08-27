import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const HTML_LIMIT_BYTES = 2 * 1024 * 1024;
const IMAGE_LIMIT_BYTES = 10 * 1024 * 1024;
const REDIRECT_LIMIT = 4;
const REQUEST_TIMEOUT_MS = 7_000;
const CACHE_TTL_MS = 30 * 60 * 1_000;
const CACHE_LIMIT = 32;

export interface LinkPreviewImage {
  body: Uint8Array;
  contentType: string;
}

export interface LinkPreviewImageProvider {
  get(pageUrl: string): Promise<LinkPreviewImage | null>;
}

interface ProviderDependencies {
  fetch: typeof fetch;
  resolveAddresses: (hostname: string) => Promise<string[]>;
}

interface CacheEntry {
  expiresAt: number;
  image: LinkPreviewImage | null;
}

const defaultDependencies: ProviderDependencies = {
  fetch,
  resolveAddresses: async (hostname) => (await lookup(hostname, { all: true, verbatim: true })).map(({ address }) => address),
};

export class HttpLinkPreviewImageProvider implements LinkPreviewImageProvider {
  private readonly cache = new Map<string, CacheEntry>();

  private constructor(private readonly dependencies: ProviderDependencies) {}

  static of(dependencies: Partial<ProviderDependencies> = {}): HttpLinkPreviewImageProvider {
    return new HttpLinkPreviewImageProvider({ ...defaultDependencies, ...dependencies });
  }

  async get(pageUrl: string): Promise<LinkPreviewImage | null> {
    const cached = this.cache.get(pageUrl);
    if (cached && cached.expiresAt > Date.now()) return cached.image;

    const image = await this.fetchImage(pageUrl).catch(() => null);
    if (this.cache.size >= CACHE_LIMIT) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(pageUrl, { expiresAt: Date.now() + CACHE_TTL_MS, image });
    return image;
  }

  private async fetchImage(pageUrl: string): Promise<LinkPreviewImage | null> {
    const page = await this.fetchPublic(pageUrl, "text/html,application/xhtml+xml");
    const pageType = contentTypeOf(page.response);
    if (!pageType.includes("text/html") && !pageType.includes("application/xhtml+xml")) return null;

    const html = new TextDecoder().decode(await readLimited(page.response, HTML_LIMIT_BYTES));
    const imageRef = previewImageRefOf(html);
    if (!imageRef) return null;

    const imageUrl = new URL(imageRef, page.url).toString();
    const image = await this.fetchPublic(imageUrl, "image/avif,image/webp,image/png,image/jpeg,image/gif");
    const imageType = contentTypeOf(image.response);
    if (!isSupportedImageType(imageType)) return null;

    return { body: await readLimited(image.response, IMAGE_LIMIT_BYTES), contentType: imageType };
  }

  private async fetchPublic(rawUrl: string, accept: string): Promise<{ response: Response; url: URL }> {
    let url = requireHttpUrl(rawUrl);

    for (let redirect = 0; redirect <= REDIRECT_LIMIT; redirect += 1) {
      await this.requirePublicHost(url);
      const response = await this.dependencies.fetch(url, {
        headers: { Accept: accept, "User-Agent": "MonoLinkPreview/1.0" },
        redirect: "manual",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location || redirect === REDIRECT_LIMIT) throw new Error("링크 리디렉션이 올바르지 않습니다.");
        url = requireHttpUrl(new URL(location, url).toString());
        continue;
      }
      if (!response.ok) throw new Error(`링크 요청이 실패했습니다. (${response.status})`);
      return { response, url };
    }

    throw new Error("링크 리디렉션이 너무 많습니다.");
  }

  private async requirePublicHost(url: URL): Promise<void> {
    const hostname = url.hostname.toLowerCase();
    if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
      throw new Error("로컬 주소는 미리보기할 수 없습니다.");
    }

    const addresses = isIP(hostname) ? [hostname] : await this.dependencies.resolveAddresses(hostname);
    if (addresses.length === 0 || addresses.some(isPrivateAddress)) {
      throw new Error("사설 네트워크 주소는 미리보기할 수 없습니다.");
    }
  }
}

function requireHttpUrl(rawUrl: string): URL {
  const url = new URL(rawUrl);
  if (!(["http:", "https:"] as string[]).includes(url.protocol) || url.username || url.password) {
    throw new Error("HTTP 또는 HTTPS 링크만 미리보기할 수 있습니다.");
  }
  return url;
}

function contentTypeOf(response: Response): string {
  return response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() ?? "";
}

function isSupportedImageType(contentType: string): boolean {
  return ["image/avif", "image/webp", "image/png", "image/jpeg", "image/gif"].includes(contentType);
}

async function readLimited(response: Response, limit: number): Promise<Uint8Array> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > limit) throw new Error("미리보기 응답이 너무 큽니다.");
  if (!response.body) return new Uint8Array();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new Error("미리보기 응답이 너무 큽니다.");
    }
    chunks.push(value);
  }

  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function previewImageRefOf(html: string): string | null {
  const candidates = new Map<string, string>();
  for (const [tag] of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attributes = attributesOf(tag);
    const key = (attributes.get("property") ?? attributes.get("name") ?? "").toLowerCase();
    const content = attributes.get("content");
    if (key && content) candidates.set(key, decodeHtmlEntities(content));
  }
  return candidates.get("og:image")
    ?? candidates.get("og:image:url")
    ?? candidates.get("twitter:image")
    ?? candidates.get("twitter:image:src")
    ?? null;
}

function attributesOf(tag: string): Map<string, string> {
  const attributes = new Map<string, string>();
  const pattern = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
  for (const match of tag.matchAll(pattern)) {
    attributes.set(match[1].toLowerCase(), match[2] ?? match[3] ?? match[4] ?? "");
  }
  return attributes;
}

function decodeHtmlEntities(value: string): string {
  return value.replace(/&(?:amp|quot|apos|lt|gt|#(\d+)|#x([\da-f]+));/gi, (entity, decimal: string | undefined, hex: string | undefined) => {
    if (decimal) return String.fromCodePoint(Number(decimal));
    if (hex) return String.fromCodePoint(Number.parseInt(hex, 16));
    return ({ "&amp;": "&", "&quot;": "\"", "&apos;": "'", "&lt;": "<", "&gt;": ">" } as Record<string, string>)[entity.toLowerCase()] ?? entity;
  });
}

function isPrivateAddress(address: string): boolean {
  const normalized = address.toLowerCase();
  if (normalized === "::" || normalized === "::1") return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd") || /^fe[89ab]/.test(normalized)) return true;
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (mapped) return isPrivateAddress(mapped);
  if (isIP(normalized) !== 4) return false;

  const [a, b] = normalized.split(".").map(Number);
  return a === 0
    || a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19))
    || a >= 224;
}
