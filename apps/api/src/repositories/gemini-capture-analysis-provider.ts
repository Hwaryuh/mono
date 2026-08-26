import { captureAnalysisResultSchema, type CaptureAnalysisContext, type CaptureAnalysisResult, type CaptureImage } from "@mono/contracts";
import { buildAnalysisInstruction } from "./capture-analysis-prompt.ts";
import type { CaptureAnalysisProvider } from "./capture-analysis-provider.ts";
import { validateCaptureAnalysisResult } from "./capture-analysis-validation.ts";

const MODEL = "gemini-2.5-flash-lite";
const API_ROOT = "https://generativelanguage.googleapis.com/v1beta";
const MAX_INLINE_BASE64_BYTES = 18 * 1024 * 1024;
const CONNECT_TIMEOUT_MS = 10_000;
const REQUEST_TIMEOUT_MS = 45_000;

const RESULT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["target", "confidence", "fields"],
  properties: {
    target: { type: "string", enum: ["todo", "calendar", "scrap", "ledger"] },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    fields: {
      type: "array",
      maxItems: 12,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "value"],
        properties: {
          label: { type: "string" },
          value: { type: "string" },
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
      },
    },
  },
};

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Gemini API에 연결하지 못했습니다: 요청 시간이 초과되었습니다.");
    }
    throw new Error(`Gemini API에 연결하지 못했습니다: ${error instanceof Error ? error.message : String(error)}`);
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
  return `Gemini API 요청 실패(${status}): ${message.slice(0, 300)}`;
}

function parseResponse(body: string): CaptureAnalysisResult {
  let envelope: unknown;
  try {
    envelope = JSON.parse(body);
  } catch (error) {
    throw new Error(`Gemini 응답 JSON이 올바르지 않습니다: ${error instanceof Error ? error.message : String(error)}`);
  }
  const parts = (envelope as { candidates?: Array<{ content?: { parts?: Array<{ text?: unknown }> } }> })
    .candidates?.[0]?.content?.parts;
  const text = parts?.find((part) => typeof part.text === "string")?.text as string | undefined;
  if (typeof text !== "string") throw new Error("Gemini가 분석 결과를 반환하지 않았습니다.");

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(text);
  } catch (error) {
    throw new Error(`Gemini 분석 결과 형식이 올바르지 않습니다: ${error instanceof Error ? error.message : String(error)}`);
  }
  const result = captureAnalysisResultSchema.parse(parsedJson);
  validateCaptureAnalysisResult(result, "Gemini");
  return result;
}

// Rust GeminiProvider(gemini.rs) 포팅. 모델·엔드포인트·프롬프트·스키마·검증 규칙을 그대로 유지한다.
export class GeminiCaptureAnalysisProvider implements CaptureAnalysisProvider {
  private readonly getApiKey: () => string | null;

  constructor(getApiKey: () => string | null) {
    this.getApiKey = getApiKey;
  }

  async analyze(input: { raw: string; images: CaptureImage[]; context?: CaptureAnalysisContext }): Promise<CaptureAnalysisResult> {
    const apiKey = this.requireApiKey();
    const images = input.images.filter((image) => typeof image.dataUrl === "string");

    const inlineSize = images.reduce((sum, image) => sum + (image.dataUrl?.length ?? 0), 0);
    if (inlineSize > MAX_INLINE_BASE64_BYTES) {
      throw new Error("Gemini에 보낼 사진 전체 용량이 너무 큽니다. 13MB 이하로 줄여 주세요.");
    }

    const parts: unknown[] = [
      { text: input.raw.trim().length === 0 ? "첨부 이미지를 분류해 줘." : input.raw },
      ...images.map((image) => {
        const data = image.dataUrl!.split(",", 2)[1] ?? "";
        return { inlineData: { mimeType: image.mimeType, data } };
      }),
    ];

    const payload = {
      systemInstruction: { parts: [{ text: buildAnalysisInstruction(input.context) }] },
      contents: [{ role: "user", parts }],
      generationConfig: {
        responseMimeType: "application/json",
        responseJsonSchema: RESULT_SCHEMA,
        maxOutputTokens: 1024,
        thinkingConfig: { thinkingBudget: 0 },
      },
    };

    const response = await fetchWithTimeout(
      `${API_ROOT}/models/${MODEL}:generateContent`,
      { method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": apiKey }, body: JSON.stringify(payload) },
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
      { method: "GET", headers: { "x-goog-api-key": apiKey } },
      CONNECT_TIMEOUT_MS,
    );
    if (response.ok) return;
    const body = await response.text().catch(() => "");
    throw new Error(await apiErrorMessage(response.status, body));
  }

  private requireApiKey(): string {
    const apiKey = this.getApiKey();
    if (!apiKey) throw new Error("Gemini API 키가 설정되지 않았습니다.");
    return apiKey;
  }
}
