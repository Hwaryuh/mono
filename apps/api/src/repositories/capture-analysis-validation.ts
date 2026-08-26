import type { CaptureAnalysisResult } from "@mono/contracts";

// Gemini·OpenAI 등 모든 캡처 분류 provider가 공유하는 계약 검증. 모델이 스키마를 어겨도
// 명확한 한국어 에러로 실패하게 한다(캡처는 실패 시 status: "failed"로 처리됨).
export function validateCaptureAnalysisResult(result: CaptureAnalysisResult, providerLabel: string): void {
  if (!Number.isFinite(result.confidence) || result.confidence < 0 || result.confidence > 1) {
    throw new Error(`${providerLabel} 분석 신뢰도가 0~1 범위를 벗어났습니다.`);
  }
  const invalid = result.fields.length > 12 || result.fields.some((field) =>
    field.label.trim().length === 0
    || field.value.trim().length === 0
    || (field.confidence !== undefined && (!Number.isFinite(field.confidence) || field.confidence < 0 || field.confidence > 1)));
  if (invalid) throw new Error(`${providerLabel} 분석 필드가 계약을 위반했습니다.`);
}
