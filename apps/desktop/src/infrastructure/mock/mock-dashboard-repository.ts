import { captureInputSchema, dashboardSnapshotSchema, type CaptureInput } from "@mono/contracts";
import type { DashboardRepository } from "../../features/dashboard/dashboard-repository";
import type { CaptureAnalysisProvider } from "../../features/dashboard/capture-analysis-provider";
import { summarizeLedgerMonth } from "../../features/ledger/ledger-summary";
import { createMockPlatformState, type MockPlatformState } from "./mock-platform-state";
import { routineTodoItems, toggleRoutineOccurrence } from "./mock-routine-occurrences";

function datesEndingAt(date: string, count: number) {
  const end = Date.parse(`${date}T00:00:00Z`);
  return Array.from({ length: count }, (_, index) => new Date(end - (count - index - 1) * 86_400_000).toISOString().slice(0, 10));
}

function formatPeriod(endDate: string | null) {
  if (!endDate) return "∞";
  const [, month, day] = endDate.split("-");
  return `~${Number(month)}/${Number(day)}`;
}

const scrapKindLabel = {
  image: "사진",
  url: "링크",
  text: "메모",
  video: "동영상",
} as const;

export const mockCaptureAnalysisProvider: CaptureAnalysisProvider = {
  async analyze({ raw }) {
    return {
      target: "todo",
      confidence: 0.74,
      fields: [
        { label: "제목", value: raw, confidence: 0.74 },
        { label: "라벨", value: "미지정", confidence: 0.45 },
        { label: "마감", value: "기한 없음", confidence: 0.4 },
      ],
    };
  },
};

class MockDashboardRepository implements DashboardRepository {
  constructor(
    private readonly state: MockPlatformState,
    private readonly analysisProvider: CaptureAnalysisProvider,
  ) {}

  async getSnapshot() {
    const pendingCaptureCount = this.state.inbox.items.filter(
      (item) => item.status === "pending" || item.status === "processing",
    ).length;
    const todoTasks = this.state.todo.items.slice(0, 2).map((item) => {
      const label = this.state.todo.labels.find((candidate) => candidate.id === item.labelId);
      return {
        id: item.id,
        title: item.title,
        label: label?.name ?? "미지정",
        labelColor: label?.color ?? "oklch(0.645 0.009 106.643)",
        done: item.done,
        isRoutine: false,
      };
    });
    const routineTasks = routineTodoItems(this.state).map((item) => {
      const label = this.state.todo.labels.find((candidate) => candidate.id === item.labelId);
      return {
        id: item.id,
        title: item.title,
        label: label?.name ?? "미지정",
        labelColor: label?.color ?? "oklch(0.645 0.009 106.643)",
        done: item.done,
        isRoutine: true,
      };
    });
    const recentWeek = datesEndingAt(this.state.todo.today, 7);
    const events = this.state.calendar.events
      .filter((event) => event.startDate === this.state.calendar.today)
      .sort((left, right) => (left.startTime ?? "").localeCompare(right.startTime ?? ""))
      .map((event) => ({
        id: event.id,
        title: event.title,
        time: event.startTime ?? "종일",
        color: this.state.calendar.categories.find((category) => category.id === event.categoryId)?.color ?? "oklch(0.645 0.009 106.643)",
      }));
    const routines = this.state.routine.items.slice(0, 3).map((routine) => ({
      id: routine.id,
      title: routine.title,
      period: formatPeriod(routine.endDate),
      week: recentWeek.map((date) => this.state.routine.occurrences.some(
        (occurrence) => occurrence.routineId === routine.id && occurrence.occurrenceDate === date && occurrence.done,
      )),
    }));
    const scraps = this.state.scrap.items.slice(0, 3).map((scrap) => ({
      id: scrap.id,
      title: scrap.title,
      kind: scrapKindLabel[scrap.kind],
      commentCount: scrap.comments.length,
    }));
    const ledger = summarizeLedgerMonth(this.state.ledger);
    return dashboardSnapshotSchema.parse(structuredClone({
      ...this.state.dashboard,
      pendingCaptureCount,
      tasks: [...routineTasks, ...todoTasks],
      routines,
      events,
      scraps,
      monthlyExpense: {
        total: ledger.totalWon,
        categories: ledger.categories.map((category) => ({
          name: category.name,
          amount: category.amountWon,
          color: category.color,
        })),
      },
    }));
  }

  async capture(input: CaptureInput) {
    const parsed = captureInputSchema.parse(input);
    const sequence = this.state.nextCaptureId++;
    const images = parsed.images ?? [];
    const videos = parsed.videos ?? [];
    const hasVideo = videos.length > 0;
    const raw = parsed.raw || (hasVideo ? videos[0].name : `사진 ${images.length}장`);
    let analysis: Awaited<ReturnType<CaptureAnalysisProvider["analyze"]>> | null;
    try {
      analysis = hasVideo ? {
          target: "scrap" as const,
          confidence: 1,
          fields: [
            { label: "제목", value: raw },
            { label: "메모", value: parsed.raw },
            { label: "라벨", value: "수집" },
          ],
        } : await this.analysisProvider.analyze({ raw, images });
    } catch {
      analysis = null;
    }

    if (analysis) {
      this.state.dashboard.recentCaptures = [
        { id: `capture-${sequence}`, raw, module: analysis.target, confidence: analysis.confidence },
        ...this.state.dashboard.recentCaptures,
      ].slice(0, 3);
    }
    this.state.inbox.items = [
      {
        id: `inbox-${sequence}`,
        source: hasVideo ? "video" : images.length > 0 ? "image" : /^https?:\/\//.test(raw) ? "url" : "text",
        raw,
        target: analysis?.target ?? null,
        confidence: analysis?.confidence ?? 0,
        status: analysis ? "pending" : "failed",
        pinned: hasVideo,
        receivedAt: "방금",
        fields: analysis?.fields ?? [{ label: "분석", value: "Gemini 분석에 실패했습니다. AI 설정과 네트워크를 확인하세요." }],
        images: images.length > 0 ? images : undefined,
        videos: hasVideo ? videos : undefined,
      },
      ...this.state.inbox.items,
    ];
  }

  async toggleTask(taskId: string) {
    if (toggleRoutineOccurrence(this.state, taskId)) return;
    if (this.state.todo.items.some((item) => item.id === taskId)) {
      this.state.todo.items = this.state.todo.items.map((item) => item.id === taskId
        ? { ...item, done: !item.done, completedAt: item.done ? null : "방금" }
        : item);
      return;
    }
    throw new Error(`할 일을 찾을 수 없습니다: ${taskId}`);
  }
}

export function createMockDashboardRepository(
  state = createMockPlatformState(),
  analysisProvider: CaptureAnalysisProvider = mockCaptureAnalysisProvider,
): DashboardRepository {
  return new MockDashboardRepository(state, analysisProvider);
}
