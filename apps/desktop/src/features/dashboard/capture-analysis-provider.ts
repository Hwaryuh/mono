import type { CaptureAnalysisContext, CaptureAnalysisResult, CaptureImage } from "@mono/contracts";

export interface CaptureAnalysisRequest {
  raw: string;
  images: CaptureImage[];
  context?: CaptureAnalysisContext;
}

/** The AI analysis boundary. A video cannot be included in this request type. */
export interface CaptureAnalysisProvider {
  analyze(request: CaptureAnalysisRequest): Promise<CaptureAnalysisResult>;
}
