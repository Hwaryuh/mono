import type { FastifyInstance } from "fastify";
import type { LinkPreviewImageProvider } from "../repositories/link-preview-image-provider.ts";

export function registerLinkPreviewRoutes(app: FastifyInstance, provider: LinkPreviewImageProvider) {
  app.get<{ Querystring: { url?: string } }>("/link-previews/image", async (request, reply) => {
    if (!request.query.url) throw new Error("미리보기할 링크가 없습니다.");
    const image = await provider.get(request.query.url);
    if (!image) throw new Error("링크 미리보기 이미지를 찾을 수 없습니다.");

    reply.header("cache-control", "private, max-age=1800");
    reply.header("content-type", image.contentType);
    reply.header("x-content-type-options", "nosniff");
    return reply.send(Buffer.from(image.body));
  });
}
