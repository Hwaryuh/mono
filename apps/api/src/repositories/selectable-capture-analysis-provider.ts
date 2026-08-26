import type { CaptureAnalysisContext, CaptureAnalysisResult, CaptureImage } from "@mono/contracts";
import type { CaptureAnalysisProvider } from "./capture-analysis-provider.ts";
import type { AiProviderId, SqliteSecretStore } from "./secret-store.ts";

// 실제 캡처 시점에 활성 provider를 다시 읽어 위임한다 — 재시작 없이 Settings에서 전환 가능하게.
export class SelectableCaptureAnalysisProvider implements CaptureAnalysisProvider {
  private readonly secretStore: SqliteSecretStore;
  private readonly providers: Record<AiProviderId, CaptureAnalysisProvider>;

  constructor(secretStore: SqliteSecretStore, providers: Record<AiProviderId, CaptureAnalysisProvider>) {
    this.secretStore = secretStore;
    this.providers = providers;
  }

  analyze(input: { raw: string; images: CaptureImage[]; context?: CaptureAnalysisContext }): Promise<CaptureAnalysisResult> {
    return this.providers[this.secretStore.getActiveProvider()].analyze(input);
  }
}
