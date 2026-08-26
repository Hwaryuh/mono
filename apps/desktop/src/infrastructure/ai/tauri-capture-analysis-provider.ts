import { captureAnalysisResultSchema } from "@mono/contracts";
import { invoke } from "@tauri-apps/api/core";
import type {
  CaptureAnalysisProvider,
  CaptureAnalysisRequest,
} from "../../features/dashboard/capture-analysis-provider";

export class TauriCaptureAnalysisProvider implements CaptureAnalysisProvider {
  async analyze(request: CaptureAnalysisRequest) {
    const result = await invoke<unknown>("analyze_capture", { request });
    return captureAnalysisResultSchema.parse(result);
  }
}
