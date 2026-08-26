import { captureAnalysisResultSchema, type CaptureAnalysisContext, type CaptureAnalysisResult, type CaptureImage } from "@mono/contracts";
import { buildAnalysisInstruction, JSON_SHAPE_INSTRUCTION } from "./capture-analysis-prompt.ts";
import type { CaptureAnalysisProvider } from "./capture-analysis-provider.ts";
import { validateCaptureAnalysisResult } from "./capture-analysis-validation.ts";

// gpt-5-nano: OpenAI 라인업 중 가장 싼 모델(2026-08 기준, $0.05/$0.40 per 1M 토큰).
const MODEL = "gpt-5-nano";
const API_ROOT = "https://api.openai.com/v1";
const MAX_INLINE_BASE64_BYTES = 18 * 1024 * 1024;
const CONNECT_TIMEOUT_MS = 10_000;
const REQUEST_TIMEOUT_MS = 45_000;

function analysisInstruction(context?: CaptureAnalysisContext): string {
  return `${buildAnalysisInstruction(context)}\n${JSON_SHAPE_INSTRUCTION}`;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("OpenAI API에 연결하지 못했습니다: 요청 시간이 초과되었습니다.");
    }
    throw new Error(`OpenAI API에 연결하지 못했습니다: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    clearTimeout(timer);
  }
}

async function apiErrorMessage(status: number, body: string): Promise<string> {
  let message = "응답 본문 없음";
  try {
    const parsed = JSON.parse(body) as { error?: { message?: unknown } };
    if (typeof parsed.error?.message === "string") message = parsed.error.message;
  } catch {
    // 본문이 JSON이 아니면 기본 메시지를 쓴다.
  }
  return `OpenAI API 요청 실패(${status}): ${message.slice(0, 300)}`;
}

function parseResponse(body: string): CaptureAnalysisResult {
  let envelope: unknown;
  try {
    envelope = JSON.parse(body);
  } catch (error) {
    throw new Error(`OpenAI 응답 JSON이 올바르지 않습니다: ${error instanceof Error ? error.message : String(error)}`);
  }
  const content = (envelope as { choices?: Array<{ message?: { content?: unknown } }> }).choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("OpenAI가 분석 결과를 반환하지 않았습니다.");

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(content);
  } catch (error) {
    throw new Error(`OpenAI 분석 결과 형식이 올바르지 않습니다: ${error instanceof Error ? error.message : String(error)}`);
  }
  const result = captureAnalysisResultSchema.parse(parsedJson);
  validateCaptureAnalysisResult(result, "OpenAI");
  return result;
}

// gemini-capture-analysis-provider.ts와 같은 계약(CaptureAnalysisProvider)을 만족하는 두 번째 provider.
export class OpenAiCaptureAnalysisProvider implements CaptureAnalysisProvider {
  private readonly getApiKey: () => string | null;

  constructor(getApiKey: () => string | null) {
    this.getApiKey = getApiKey;
  }

  async analyze(input: { raw: string; images: CaptureImage[]; context?: CaptureAnalysisContext }): Promise<CaptureAnalysisResult> {
    const apiKey = this.requireApiKey();
    const images = input.images.filter((image) => typeof image.dataUrl === "string");

    const inlineSize = images.reduce((sum, image) => sum + (image.dataUrl?.length ?? 0), 0);
    if (inlineSize > MAX_INLINE_BASE64_BYTES) {
      throw new Error("OpenAI에 보낼 사진 전체 용량이 너무 큽니다. 13MB 이하로 줄여 주세요.");
    }

    const userContent = [
      { type: "text", text: input.raw.trim().length === 0 ? "첨부 이미지를 분류해 줘." : input.raw },
      ...images.map((image) => ({ type: "image_url", image_url: { url: image.dataUrl } })),
    ];

    const payload = {
      model: MODEL,
      messages: [
        { role: "system", content: analysisInstruction(input.context) },
        { role: "user", content: userContent },
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: 1024,
    };

    const response = await fetchWithTimeout(
      `${API_ROOT}/chat/completions`,
      { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` }, body: JSON.stringify(payload) },
      REQUEST_TIMEOUT_MS,
    );
    const body = await response.text();
    if (!response.ok) throw new Error(await apiErrorMessage(response.status, body));
    return parseResponse(body);
  }

  async testConnection(): Promise<void> {
    const apiKey = this.requireApiKey();
    const response = await fetchWithTimeout(
      `${API_ROOT}/models/${MODEL}`,
      { method: "GET", headers: { authorization: `Bearer ${apiKey}` } },
      CONNECT_TIMEOUT_MS,
    );
    if (response.ok) return;
    const body = await response.text().catch(() => "");
    throw new Error(await apiErrorMessage(response.status, body));
  }

  private requireApiKey(): string {
    const apiKey = this.getApiKey();
    if (!apiKey) throw new Error("OpenAI API 키가 설정되지 않았습니다.");
    return apiKey;
  }
}
