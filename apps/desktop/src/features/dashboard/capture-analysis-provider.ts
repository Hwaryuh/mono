import type { CaptureAnalysisResult, CaptureImage } from "@mono/contracts";

export interface CaptureAnalysisRequest {
  raw: string;
  images: CaptureImage[];
}

/** AI 분석 경계. 영상은 이 요청 타입에 포함될 수 없다. */
export interface CaptureAnalysisProvider {
  analyze(request: CaptureAnalysisRequest): Promise<CaptureAnalysisResult>;
}
