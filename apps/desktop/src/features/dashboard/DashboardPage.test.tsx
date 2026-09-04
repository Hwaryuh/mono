import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { createMockDashboardRepository } from "../../infrastructure/mock/mock-dashboard-repository";
import { createMockScrapRepository } from "../../infrastructure/mock/mock-scrap-repository";
import type { DashboardRepository } from "./dashboard-repository";
import { DashboardPage } from "./DashboardPage";

function renderDashboard(repository: DashboardRepository = createMockDashboardRepository()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter><DashboardPage repository={repository} scrapRepository={createMockScrapRepository()} /></MemoryRouter>
    </QueryClientProvider>,
  );
  return { repository };
}

const emptyDashboardRepository: DashboardRepository = {
  async getSnapshot() {
    return {
      dateLabel: "2026년 8월 27일 목요일",
      pendingCaptureCount: 0,
      recentCaptures: [],
      tasks: [],
      events: [],
      monthlyExpense: { total: 0, categories: [] },
      routines: [],
      scraps: [],
    };
  },
  async capture() {},
  async toggleTask() {},
};

describe("DashboardPage", () => {
  it("초기 데이터가 없으면 각 위젯에 빈 상태를 표시한다", async () => {
    renderDashboard(emptyDashboardRepository);

    expect(await screen.findByText("아직 분류한 항목이 없습니다")).toBeInTheDocument();
    expect(screen.getByText("오늘 할 일이 없습니다")).toBeInTheDocument();
    expect(screen.getByText("오늘 일정이 없습니다")).toBeInTheDocument();
    expect(screen.getByText("이번 달 지출이 없습니다")).toBeInTheDocument();
    expect(screen.getByText("아직 루틴이 없습니다")).toBeInTheDocument();
    expect(screen.getByText("아직 스크랩이 없습니다")).toBeInTheDocument();
  });

  it("빠른 캡처를 저장소 경계로 제출하고 최근 분류를 갱신한다", async () => {
    renderDashboard();
    const input = await screen.findByRole("textbox", { name: "빠른 캡처" });

    fireEvent.change(input, { target: { value: "기획안 검토하기" } });
    fireEvent.submit(input.closest("form")!);

    await waitFor(() => expect(screen.getByText("기획안 검토하기")).toBeInTheDocument());
    expect(input).toHaveValue("");
  });

  it("대시보드 빠른 캡처에 드롭한 텍스트를 화살표를 누를 때 제출한다", async () => {
    const { repository } = renderDashboard();
    const dropZone = await screen.findByRole("region", { name: "빠른 캡처 드롭 영역" });
    const input = screen.getByRole("textbox", { name: "빠른 캡처" });
    const beforeDrop = await repository.getSnapshot();
    const dataTransfer = {
      dropEffect: "none",
      files: [],
      getData: (type: string) => type === "text/plain" ? "드롭한 회의 메모" : "",
      types: ["text/plain"],
    };

    fireEvent.dragEnter(dropZone, { dataTransfer });
    expect(dropZone).toHaveClass("quick-capture--dragging");
    fireEvent.drop(dropZone, { dataTransfer });

    expect(input).toHaveValue("드롭한 회의 메모");
    expect((await repository.getSnapshot()).recentCaptures).toEqual(beforeDrop.recentCaptures);
    fireEvent.click(screen.getByRole("button", { name: "분류 요청" }));
    await waitFor(() => expect(screen.getByText("드롭한 회의 메모")).toBeInTheDocument());
    expect(dropZone).not.toHaveClass("quick-capture--dragging");
  });

  it("대시보드 빠른 캡처에 영상을 첨부하고 스크랩으로 표시한다", async () => {
    const { repository } = renderDashboard();
    const dropZone = await screen.findByRole("region", { name: "빠른 캡처 드롭 영역" });
    const videoFile = new File(["video"], "rehearsal.mp4", { type: "video/mp4" });

    fireEvent.drop(dropZone, {
      dataTransfer: {
        dropEffect: "none",
        files: [videoFile],
        getData: () => "",
        types: ["Files"],
      },
    });

    expect(await screen.findByRole("img", { name: "rehearsal.mp4 영상" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "분류 요청" }));
    await waitFor(async () => expect((await repository.getSnapshot()).recentCaptures[0]).toMatchObject({
      raw: "rehearsal.mp4",
      module: "scrap",
      confidence: 1,
    }));
    expect(screen.getByText("스크랩")).toBeInTheDocument();
  });

  it("할 일 체크박스로 완료 상태를 바꾼다", async () => {
    renderDashboard();
    const checkbox = await screen.findByRole("checkbox", { name: "설거지 하기 완료 처리" });

    fireEvent.click(checkbox);

    await waitFor(() => expect(screen.getByRole("checkbox", { name: "설거지 하기 미완료 처리" })).toBeChecked());
  });
});
