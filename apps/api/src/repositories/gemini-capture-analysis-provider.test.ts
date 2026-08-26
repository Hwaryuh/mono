import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GeminiCaptureAnalysisProvider } from "./gemini-capture-analysis-provider.ts";

function geminiBody(payload: unknown) {
  return JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }] });
}

function jsonResponse(status: number, body: string) {
  return new Response(body, { status });
}

describe("GeminiCaptureAnalysisProvider", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("API 키가 없으면 분석 없이 명확한 에러를 던진다", async () => {
    const provider = new GeminiCaptureAnalysisProvider(() => null);
    await expect(provider.analyze({ raw: "테스트", images: [] })).rejects.toThrow("Gemini API 키가 설정되지 않았습니다.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("정상 응답을 파싱해 계약을 만족하는 결과를 돌려준다", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, geminiBody({
      target: "todo",
      confidence: 0.9,
      fields: [{ label: "제목", value: "기획안 검토" }],
    })));
    const provider = new GeminiCaptureAnalysisProvider(() => "gk-test");

    const result = await provider.analyze({ raw: "기획안 검토하기", images: [] });

    expect(result).toEqual({ target: "todo", confidence: 0.9, fields: [{ label: "제목", value: "기획안 검토" }] });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("gemini-2.5-flash-lite:generateContent");
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("gk-test");
  });

  it("이미지 dataUrl을 base64만 잘라 inlineData로 보낸다", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, geminiBody({ target: "scrap", confidence: 0.5, fields: [] })));
    const provider = new GeminiCaptureAnalysisProvider(() => "gk-test");

    await provider.analyze({
      raw: "",
      images: [{ name: "a.png", mimeType: "image/png", size: 4, mediaId: "m1", dataUrl: "data:image/png;base64,AAAA" }],
    });

    const [, init] = fetchMock.mock.calls[0];
    const payload = JSON.parse(init.body as string);
    expect(payload.contents[0].parts[0].text).toBe("첨부 이미지를 분류해 줘.");
    expect(payload.contents[0].parts[1].inlineData).toEqual({ mimeType: "image/png", data: "AAAA" });
  });

  it("context를 주면 유저 라벨 목록과 today를 systemInstruction에 주입한다", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, geminiBody({ target: "todo", confidence: 0.9, fields: [{ label: "제목", value: "x" }] })));
    const provider = new GeminiCaptureAnalysisProvider(() => "gk-test");

    await provider.analyze({
      raw: "장보기",
      images: [],
      context: { today: "2026-08-27", todoLabels: ["집안일", "업무"], calendarCategories: ["약속"], ledgerCategories: ["식비"], scrapTags: ["요리"] },
    });

    const [, init] = fetchMock.mock.calls[0];
    const systemPrompt = JSON.parse(init.body as string).systemInstruction.parts[0].text as string;
    expect(systemPrompt).toContain("2026-08-27");
    expect(systemPrompt).toContain("집안일, 업무");
    expect(systemPrompt).toContain("식비");
  });

  it("사진 총 용량이 18MB를 넘으면 요청 전에 거부한다", async () => {
    const provider = new GeminiCaptureAnalysisProvider(() => "gk-test");
    const huge = "A".repeat(19 * 1024 * 1024);
    await expect(provider.analyze({
      raw: "",
      images: [{ name: "big.png", mimeType: "image/png", size: 1, mediaId: "m1", dataUrl: `data:image/png;base64,${huge}` }],
    })).rejects.toThrow("13MB 이하로 줄여 주세요");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("API 응답이 실패면 상태코드와 메시지를 담아 던진다", async () => {
    fetchMock.mockResolvedValue(jsonResponse(429, JSON.stringify({ error: { message: "rate limited" } })));
    const provider = new GeminiCaptureAnalysisProvider(() => "gk-test");
    await expect(provider.analyze({ raw: "x", images: [] })).rejects.toThrow("Gemini API 요청 실패(429): rate limited");
  });

  it("응답 confidence가 범위를 벗어나면 거부한다", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, geminiBody({ target: "todo", confidence: 1.5, fields: [] })));
    const provider = new GeminiCaptureAnalysisProvider(() => "gk-test");
    await expect(provider.analyze({ raw: "x", images: [] })).rejects.toThrow();
  });

  it("응답 field label이 비어 있으면 거부한다", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, geminiBody({
      target: "todo",
      confidence: 0.5,
      fields: [{ label: "  ", value: "값" }],
    })));
    const provider = new GeminiCaptureAnalysisProvider(() => "gk-test");
    await expect(provider.analyze({ raw: "x", images: [] })).rejects.toThrow("Gemini 분석 필드가 계약을 위반했습니다.");
  });

  it("testConnection은 GET 성공이면 통과한다", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, "{}"));
    const provider = new GeminiCaptureAnalysisProvider(() => "gk-test");
    await expect(provider.testConnection()).resolves.toBeUndefined();
    expect(String(fetchMock.mock.calls[0][0])).toContain("/models/gemini-2.5-flash-lite");
  });

  it("testConnection은 실패 응답이면 에러를 던진다", async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, JSON.stringify({ error: { message: "invalid key" } })));
    const provider = new GeminiCaptureAnalysisProvider(() => "gk-bad");
    await expect(provider.testConnection()).rejects.toThrow("Gemini API 요청 실패(401): invalid key");
  });
});
