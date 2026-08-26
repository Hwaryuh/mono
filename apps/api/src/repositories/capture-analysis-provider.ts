import type { CaptureAnalysisContext, CaptureAnalysisResult, CaptureImage } from "@mono/contracts";

// 아키텍처 결정 §7 2단계: 실제 AI 캡처 분류는 아직 구현하지 않는다. 이 포트가 교체 경계다.
// context는 유저 taxonomy·today grounding(선택). 미주입 시 provider는 grounding 없이 분석한다.
export interface CaptureAnalysisProvider {
  analyze(input: { raw: string; images: CaptureImage[]; context?: CaptureAnalysisContext }): Promise<CaptureAnalysisResult>;
}

// 항상 실패해 데스크톱 mock의 분석 실패 경로(status: "failed")와 같은 결과를 낸다.
export const nullCaptureAnalysisProvider: CaptureAnalysisProvider = {
  async analyze() {
    throw new Error("AI 캡처 분류가 아직 구현되지 않았습니다.");
  },
};
