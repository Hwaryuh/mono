import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OpenAiCaptureAnalysisProvider } from "./openai-capture-analysis-provider.ts";

function chatCompletionBody(payload: unknown) {
  return JSON.stringify({ choices: [{ message: { content: JSON.stringify(payload) } }] });
}

function jsonResponse(status: number, body: string) {
  return new Response(body, { status });
}

describe("OpenAiCaptureAnalysisProvider", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("API 키가 없으면 분석 없이 명확한 에러를 던진다", async () => {
    const provider = new OpenAiCaptureAnalysisProvider(() => null);
    await expect(provider.analyze({ raw: "테스트", images: [] })).rejects.toThrow("OpenAI API 키가 설정되지 않았습니다.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("정상 응답을 파싱해 계약을 만족하는 결과를 돌려준다", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, chatCompletionBody({
      target: "todo",
      confidence: 0.9,
      fields: [{ label: "제목", value: "기획안 검토" }],
    })));
    const provider = new OpenAiCaptureAnalysisProvider(() => "sk-test");

    const result = await provider.analyze({ raw: "기획안 검토하기", images: [] });

    expect(result).toEqual({ target: "todo", confidence: 0.9, fields: [{ label: "제목", value: "기획안 검토" }] });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/chat/completions");
    const payload = JSON.parse(init.body as string);
    expect(payload.model).toBe("gpt-5-nano");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer sk-test");
  });

  it("이미지는 dataUrl 그대로 image_url 파트로 보낸다", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, chatCompletionBody({ target: "scrap", confidence: 0.5, fields: [] })));
    const provider = new OpenAiCaptureAnalysisProvider(() => "sk-test");

    await provider.analyze({
      raw: "",
      images: [{ name: "a.png", mimeType: "image/png", size: 4, mediaId: "m1", dataUrl: "data:image/png;base64,AAAA" }],
    });

    const [, init] = fetchMock.mock.calls[0];
    const payload = JSON.parse(init.body as string);
    const userMessage = payload.messages[1];
    expect(userMessage.content[0]).toEqual({ type: "text", text: "첨부 이미지를 분류해 줘." });
    expect(userMessage.content[1]).toEqual({ type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } });
  });

  it("사진 총 용량이 18MB를 넘으면 요청 전에 거부한다", async () => {
    const provider = new OpenAiCaptureAnalysisProvider(() => "sk-test");
    const huge = "A".repeat(19 * 1024 * 1024);
    await expect(provider.analyze({
      raw: "",
      images: [{ name: "big.png", mimeType: "image/png", size: 1, mediaId: "m1", dataUrl: `data:image/png;base64,${huge}` }],
    })).rejects.toThrow("13MB 이하로 줄여 주세요");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("API 응답이 실패면 상태코드와 메시지를 담아 던진다", async () => {
    fetchMock.mockResolvedValue(jsonResponse(429, JSON.stringify({ error: { message: "rate limited" } })));
    const provider = new OpenAiCaptureAnalysisProvider(() => "sk-test");
    await expect(provider.analyze({ raw: "x", images: [] })).rejects.toThrow("OpenAI API 요청 실패(429): rate limited");
  });

  it("응답 field label이 비어 있으면 거부한다", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, chatCompletionBody({
      target: "todo",
      confidence: 0.5,
      fields: [{ label: "  ", value: "값" }],
    })));
    const provider = new OpenAiCaptureAnalysisProvider(() => "sk-test");
    await expect(provider.analyze({ raw: "x", images: [] })).rejects.toThrow("OpenAI 분석 필드가 계약을 위반했습니다.");
  });

  it("testConnection은 GET 성공이면 통과한다", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, "{}"));
    const provider = new OpenAiCaptureAnalysisProvider(() => "sk-test");
    await expect(provider.testConnection()).resolves.toBeUndefined();
    expect(String(fetchMock.mock.calls[0][0])).toContain("/models/gpt-5-nano");
  });

  it("testConnection은 실패 응답이면 에러를 던진다", async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, JSON.stringify({ error: { message: "invalid key" } })));
    const provider = new OpenAiCaptureAnalysisProvider(() => "sk-bad");
    await expect(provider.testConnection()).rejects.toThrow("OpenAI API 요청 실패(401): invalid key");
  });
});
