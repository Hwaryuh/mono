import { randomUUID } from "node:crypto";
import { captureInputSchema, dashboardSnapshotSchema, type CaptureInput, type LedgerCategory, type LedgerExpense, type LedgerSnapshot } from "@mono/contracts";
import { currentIsoDate, koreanDateLabel } from "@mono/domain";
import { desc, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { dashboardCaptures, inboxItems, todoItems } from "../db/schema.ts";
import { nullCaptureAnalysisProvider, type CaptureAnalysisProvider } from "./capture-analysis-provider.ts";
import { SqliteCalendarRepository } from "./calendar-repository.ts";
import { SqliteLedgerRepository } from "./ledger-repository.ts";
import { SqliteRoutineRepository } from "./routine-repository.ts";
import { SqliteScrapRepository } from "./scrap-repository.ts";
import { SqliteTodoRepository } from "./todo-repository.ts";

function datesEndingAt(date: string, count: number) {
  const end = Date.parse(`${date}T00:00:00Z`);
  return Array.from({ length: count }, (_, index) => new Date(end - (count - index - 1) * 86_400_000).toISOString().slice(0, 10));
}

function formatPeriod(endDate: string | null) {
  if (!endDate) return "∞";
  const [, month, day] = endDate.split("-");
  return `~${Number(month)}/${Number(day)}`;
}

const scrapKindLabel = { image: "사진", url: "링크", text: "메모", video: "동영상" } as const;

// ledger-summary.ts(데스크톱 전용 UI 코드)와 같은 계산이다. apps 간 의존을 만들지 않으려고
// 여기서 다시 작성했다. 로직이 바뀌면 양쪽을 함께 고친다.
function summarizeLedgerMonth(snapshot: LedgerSnapshot, month = snapshot.today.slice(0, 7)) {
  const expenses = snapshot.expenses.filter((expense) => expense.date.startsWith(`${month}-`));
  const totalWon = expenses.reduce((sum, expense) => sum + expense.amountWon, 0);
  const categories = snapshot.categories
    .map((category: LedgerCategory) => {
      const amountWon = expenses.filter((expense: LedgerExpense) => expense.categoryId === category.id).reduce((sum, expense) => sum + expense.amountWon, 0);
      return { ...category, amountWon };
    })
    .filter((category) => category.amountWon > 0);
  return { totalWon, categories };
}

// 서버 Dashboard 저장소. 데스크톱 DashboardRepository 인터페이스와 같은 op·에러 시맨틱을 만족한다.
// 다른 5경계 저장소를 조합해 read-model을 파생한다. 별도 dashboard 상태 테이블은 recentCaptures뿐이다.
export class SqliteDashboardRepository {
  private readonly db: Db;
  private readonly todo: SqliteTodoRepository;
  private readonly routine: SqliteRoutineRepository;
  private readonly calendar: SqliteCalendarRepository;
  private readonly scrap: SqliteScrapRepository;
  private readonly ledger: SqliteLedgerRepository;
  private readonly analysisProvider: CaptureAnalysisProvider;

  constructor(db: Db, analysisProvider: CaptureAnalysisProvider = nullCaptureAnalysisProvider) {
    this.db = db;
    this.todo = new SqliteTodoRepository(db);
    this.routine = new SqliteRoutineRepository(db);
    this.calendar = new SqliteCalendarRepository(db);
    this.scrap = new SqliteScrapRepository(db);
    this.ledger = new SqliteLedgerRepository(db);
    this.analysisProvider = analysisProvider;
  }

  async getSnapshot() {
    const today = currentIsoDate();
    const [todoSnapshot, routineSnapshot, calendarSnapshot, scrapSnapshot, ledgerSnapshot] = await Promise.all([
      this.todo.getSnapshot(),
      this.routine.getSnapshot(),
      this.calendar.getSnapshot(),
      this.scrap.getSnapshot(),
      this.ledger.getSnapshot(),
    ]);

    const pendingCaptureCount = this.db.select({ n: sql<number>`COUNT(*)` }).from(inboxItems)
      .where(sql`${inboxItems.status} IN ('pending', 'processing')`).get()?.n ?? 0;

    const todoTasks = todoSnapshot.items.slice(0, 2).map((item) => {
      const label = todoSnapshot.labels.find((candidate) => candidate.id === item.labelId);
      return { id: item.id, title: item.title, label: label?.name ?? "미지정", labelColor: label?.color ?? "oklch(0.645 0.009 106.643)", done: item.done, isRoutine: false };
    });
    const routineTasks = routineSnapshot.items.flatMap((routine) => {
      const occurrence = routineSnapshot.occurrences.find((candidate) => candidate.routineId === routine.id && candidate.occurrenceDate === today);
      if (!occurrence) return [];
      const label = todoSnapshot.labels.find((candidate) => candidate.id === routine.labelId);
      return [{ id: occurrence.id, title: routine.title, label: label?.name ?? "미지정", labelColor: label?.color ?? "oklch(0.645 0.009 106.643)", done: occurrence.done, isRoutine: true }];
    });

    const recentWeek = datesEndingAt(today, 7);
    const events = calendarSnapshot.events
      .filter((event) => event.startDate === today)
      .sort((left, right) => (left.startTime ?? "").localeCompare(right.startTime ?? ""))
      .map((event) => ({
        id: event.id,
        title: event.title,
        time: event.startTime ?? "종일",
        color: calendarSnapshot.categories.find((category) => category.id === event.categoryId)?.color ?? "oklch(0.645 0.009 106.643)",
      }));

    const routines = routineSnapshot.items.slice(0, 3).map((routine) => ({
      id: routine.id,
      title: routine.title,
      period: formatPeriod(routine.endDate),
      week: recentWeek.map((date) => routineSnapshot.occurrences.some((occurrence) => occurrence.routineId === routine.id && occurrence.occurrenceDate === date && occurrence.done)),
    }));

    const scraps = scrapSnapshot.items.slice(0, 3).map((scrap) => ({ id: scrap.id, title: scrap.title, kind: scrapKindLabel[scrap.kind], commentCount: scrap.comments.length }));

    const ledgerSummary = summarizeLedgerMonth(ledgerSnapshot);
    const recentCaptures = this.db.select().from(dashboardCaptures).orderBy(desc(dashboardCaptures.seq)).limit(3).all();

    return dashboardSnapshotSchema.parse({
      dateLabel: koreanDateLabel(today),
      pendingCaptureCount,
      recentCaptures: recentCaptures.map(({ seq: _seq, ...capture }) => capture),
      tasks: [...routineTasks, ...todoTasks],
      events,
      monthlyExpense: { total: ledgerSummary.totalWon, categories: ledgerSummary.categories.map((category) => ({ name: category.name, amount: category.amountWon, color: category.color })) },
      routines,
      scraps,
    });
  }

  async capture(input: CaptureInput): Promise<void> {
    const parsed = captureInputSchema.parse(input);
    const images = parsed.images ?? [];
    const videos = parsed.videos ?? [];
    const hasVideo = videos.length > 0;
    const raw = parsed.raw || (hasVideo ? videos[0].name : `사진 ${images.length}장`);

    let analysis: Awaited<ReturnType<CaptureAnalysisProvider["analyze"]>> | null = null;
    let analysisErrorMessage = "AI 분석에 실패했습니다. AI 설정과 네트워크를 확인하세요.";
    if (hasVideo) {
      analysis = { target: "scrap", confidence: 1, fields: [{ label: "제목", value: raw }, { label: "메모", value: parsed.raw }, { label: "라벨", value: "수집" }] };
    } else {
      try {
        analysis = await this.analysisProvider.analyze({ raw, images });
      } catch (cause) {
        analysisErrorMessage = cause instanceof Error ? cause.message : String(cause);
      }
    }

    if (analysis) {
      const nextSeq = (this.db.select({ max: sql<number>`COALESCE(MAX(${dashboardCaptures.seq}), 0)` }).from(dashboardCaptures).get()?.max ?? 0) + 1;
      this.db.insert(dashboardCaptures).values({ id: randomUUID(), seq: nextSeq, raw, module: analysis.target, confidence: analysis.confidence }).run();
    }

    const nextInboxSeq = (this.db.select({ max: sql<number>`COALESCE(MAX(${inboxItems.seq}), 0)` }).from(inboxItems).get()?.max ?? 0) + 1;
    this.db.insert(inboxItems).values({
      id: randomUUID(),
      seq: nextInboxSeq,
      source: hasVideo ? "video" : images.length > 0 ? "image" : /^https?:\/\//.test(raw) ? "url" : "text",
      raw,
      target: analysis?.target ?? null,
      confidence: analysis?.confidence ?? 0,
      status: analysis ? "pending" : "failed",
      pinned: hasVideo,
      receivedAt: new Date().toISOString(),
      fieldsJson: JSON.stringify(analysis?.fields ?? [{ label: "원인", value: analysisErrorMessage }]),
      imagesJson: images.length > 0 ? JSON.stringify(images.map(({ dataUrl: _dataUrl, ...meta }) => meta)) : null,
      videosJson: hasVideo ? JSON.stringify(videos) : null,
    }).run();
  }

  async toggleTask(taskId: string): Promise<void> {
    if (await this.routine.toggleOccurrenceById(taskId)) return;
    const item = this.db.select().from(todoItems).where(eq(todoItems.id, taskId)).get();
    if (!item) throw new Error(`할 일을 찾을 수 없습니다: ${taskId}`);
    const done = !item.done;
    this.db.update(todoItems).set({ done, completedAt: done ? new Date().toISOString() : null }).where(eq(todoItems.id, taskId)).run();
  }
}
