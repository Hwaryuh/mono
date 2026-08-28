import { describe, expect, it, vi } from "vitest";
import type { CaptureAnalysisProvider } from "../../features/dashboard/capture-analysis-provider";
import { createMockPlatformState } from "./mock-platform-state";
import { createMockDashboardRepository } from "./mock-dashboard-repository";

describe("MockDashboardRepository", () => {
  it("계약을 만족하는 대시보드 스냅샷을 반환한다", async () => {
    const repository = createMockDashboardRepository();
    const snapshot = await repository.getSnapshot();

    expect(snapshot.pendingCaptureCount).toBe(4);
    expect(snapshot.tasks).toHaveLength(4);
  });

  it("캡처를 저장소 경계 안에서 반영한다", async () => {
    const repository = createMockDashboardRepository();

    await repository.capture({ raw: "기획안 검토하기" });
    const snapshot = await repository.getSnapshot();

    expect(snapshot.pendingCaptureCount).toBe(5);
    expect(snapshot.recentCaptures[0].raw).toBe("기획안 검토하기");
  });

  it("영상은 AI Provider에 전달하지 않고 스크랩으로 확정한다", async () => {
    const state = createMockPlatformState();
    const analyze = vi.fn<CaptureAnalysisProvider["analyze"]>();
    const repository = createMockDashboardRepository(state, { analyze });
    const video = {
      name: "meeting.mp4",
      mimeType: "video/mp4",
      size: 15,
      mediaId: "media-video-1",
    };

    await repository.capture({ raw: "회의 녹화", videos: [video] });

    expect(analyze).not.toHaveBeenCalled();
    expect(state.dashboard.recentCaptures[0]).toMatchObject({ raw: "회의 녹화", module: "scrap", confidence: 1 });
    expect(state.inbox.items[0]).toMatchObject({
      source: "video",
      target: "scrap",
      confidence: 1,
      pinned: true,
      videos: [video],
    });
  });

  it("AI 분석 실패 시 원본을 failed 수집 항목으로 보존한다", async () => {
    const state = createMockPlatformState();
    const analyze = vi.fn<CaptureAnalysisProvider["analyze"]>().mockRejectedValue(new Error("network"));
    const repository = createMockDashboardRepository(state, { analyze });

    await repository.capture({ raw: "분석 중 잃으면 안 되는 메모" });

    expect(state.inbox.items[0]).toMatchObject({
      raw: "분석 중 잃으면 안 되는 메모",
      target: null,
      confidence: 0,
      status: "failed",
    });
    // 회귀: provider가 던진 실제 원인 대신 "Gemini 분석에 실패했습니다"로 항상 고정 표시했었다.
    expect(state.inbox.items[0].fields).toEqual([{ label: "원인", value: "network" }]);
  });

  it("할 일 완료 상태를 바꾼다", async () => {
    const repository = createMockDashboardRepository();

    await repository.toggleTask("task-1");
    const snapshot = await repository.getSnapshot();

    expect(snapshot.tasks.find((task) => task.id === "task-1")?.done).toBe(true);
  });

  it("최근 스크랩을 스크랩 원본 상태에서 파생한다", async () => {
    const repository = createMockDashboardRepository();
    const snapshot = await repository.getSnapshot();

    expect(snapshot.scraps).toEqual([
      { id: "scrap-1", title: "들기름 파스타 레시피", kind: "사진", commentCount: 2 },
      { id: "scrap-2", title: "카메라 무빙 레퍼런스", kind: "링크", commentCount: 1 },
      { id: "scrap-3", title: "합주실 후보 정리", kind: "메모", commentCount: 0 },
    ]);
  });

  it("월 지출을 가계부 원본 상태에서 파생한다", async () => {
    const repository = createMockDashboardRepository();
    const snapshot = await repository.getSnapshot();

    expect(snapshot.monthlyExpense).toEqual({
      total: 609_200,
      categories: [
        { name: "주거", amount: 550_000, color: "oklch(0.604 0.149 260.322)" },
        { name: "생활", amount: 43_200, color: "oklch(0.539 0.082 160.129)" },
        { name: "식비", amount: 16_000, color: "oklch(0.603 0.109 75.876)" },
      ],
    });
  });
});
