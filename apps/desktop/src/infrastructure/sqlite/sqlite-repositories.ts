import { currentIsoDate, koreanDateLabel } from "@mono/domain";
import type { CalendarRepository } from "../../features/calendar/calendar-repository";
import type { DashboardRepository } from "../../features/dashboard/dashboard-repository";
import type { CaptureAnalysisProvider } from "../../features/dashboard/capture-analysis-provider";
import type { InboxRepository } from "../../features/inbox/inbox-repository";
import type { LedgerRepository } from "../../features/ledger/ledger-repository";
import type { RoutineRepository } from "../../features/routine/routine-repository";
import type { ScrapRepository } from "../../features/scrap/scrap-repository";
import type { TodoRepository } from "../../features/todo/todo-repository";
import { createMockCalendarRepository } from "../mock/mock-calendar-repository";
import { createMockDashboardRepository, mockCaptureAnalysisProvider } from "../mock/mock-dashboard-repository";
import { createMockInboxRepository } from "../mock/mock-inbox-repository";
import { createMockLedgerRepository } from "../mock/mock-ledger-repository";
import {
  createMockPlatformState,
  parseMockPlatformState,
  referencedMediaIds,
  STATE_VERSION,
  type MockPlatformState,
} from "../mock/mock-platform-state";
import { createMockRoutineRepository } from "../mock/mock-routine-repository";
import { createMockScrapRepository } from "../mock/mock-scrap-repository";
import { createMockTodoRepository } from "../mock/mock-todo-repository";
import type { MediaStore } from "../media/media-store";
import { TauriMediaStore } from "../media/media-store";
import type { PlatformStateStore } from "./platform-state-store";
import { PlatformPersistenceError, TauriSqlitePlatformStateStore } from "./tauri-sqlite-platform-state-store";

export type PlatformRepositories = {
  dashboardRepository: DashboardRepository;
  inboxRepository: InboxRepository;
  todoRepository: TodoRepository;
  routineRepository: RoutineRepository;
  calendarRepository: CalendarRepository;
  scrapRepository: ScrapRepository;
  ledgerRepository: LedgerRepository;
};

type RepositoryFactory<Repository> = (state: MockPlatformState) => Repository;

class SqliteStateCoordinator {
  private queue: Promise<void> = Promise.resolve();

  private constructor(
    private state: MockPlatformState,
    private readonly store: PlatformStateStore,
  ) {}

  /** GC 등 읽기 전용 용도로만 쓴다 — 호출자는 반환값을 변형하면 안 된다. */
  get currentState(): MockPlatformState {
    return this.state;
  }

  static async of(store: PlatformStateStore) {
    const stored = await store.load();
    if (stored === null) {
      const seed = createMockPlatformState();
      await store.save(seed);
      return new SqliteStateCoordinator(seed, store);
    }

    try {
      const normalized = parseMockPlatformState(stored);
      // 정규화는 idempotent하므로, 정상 부팅에선 전체 blob을 다시 직렬화·비교하지 않는다.
      // 저장 버전이 현재와 다를 때(레거시·마이그레이션)만 정규화 결과를 한 번 다시 저장한다.
      const storedVersion = (stored as { stateVersion?: unknown }).stateVersion;
      if (storedVersion !== STATE_VERSION) await store.save(normalized);
      return new SqliteStateCoordinator(normalized, store);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new PlatformPersistenceError(`저장된 데이터 형식이 올바르지 않습니다. ${message}`, { cause: error });
    }
  }

  /** 저장된 값 대신 실제 시계 기준 오늘을 상태에 새겨, "오늘"이 매일 넘어가게 한다. */
  private stampToday(state: MockPlatformState): MockPlatformState {
    const today = currentIsoDate();
    state.todo.today = today;
    state.calendar.today = today;
    state.ledger.today = today;
    state.dashboard.dateLabel = koreanDateLabel(today);
    return state;
  }

  execute<Repository, Result>(
    factory: RepositoryFactory<Repository>,
    operation: (repository: Repository) => Promise<Result>,
    alwaysPersist: boolean,
  ): Promise<Result> {
    return this.enqueue(async () => {
      const draft = this.stampToday(structuredClone(this.state));
      const before = alwaysPersist ? "" : JSON.stringify(draft);
      const result = await operation(factory(draft));
      const changed = alwaysPersist || JSON.stringify(draft) !== before;
      if (changed) {
        await this.store.save(draft);
        this.state = draft;
      }
      return result;
    });
  }

  query<Repository, Result>(
    factory: RepositoryFactory<Repository>,
    operation: (repository: Repository) => Promise<Result>,
  ): Promise<Result> {
    return this.enqueue(() => operation(factory(this.stampToday(this.state))));
  }

  private enqueue<Result>(operation: () => Promise<Result>): Promise<Result> {
    const result = this.queue.then(operation, operation);
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }
}

function dashboardRepositoryOf(
  coordinator: SqliteStateCoordinator,
  analysisProvider: CaptureAnalysisProvider,
): DashboardRepository {
  const factory = (state: MockPlatformState) => createMockDashboardRepository(state, analysisProvider);
  const run = <Result>(operation: (repository: DashboardRepository) => Promise<Result>, persist = true) =>
    coordinator.execute(factory, operation, persist);
  return {
    getSnapshot: () => run((repository) => repository.getSnapshot(), false),
    capture: (input) => run((repository) => repository.capture(input)),
    toggleTask: (taskId) => run((repository) => repository.toggleTask(taskId)),
  };
}

function inboxRepositoryOf(coordinator: SqliteStateCoordinator): InboxRepository {
  const run = <Result>(operation: (repository: InboxRepository) => Promise<Result>, persist = true) =>
    coordinator.execute(createMockInboxRepository, operation, persist);
  return {
    getSnapshot: () => coordinator.query(createMockInboxRepository, (repository) => repository.getSnapshot()),
    approve: (itemId) => run((repository) => repository.approve(itemId)),
    approveHighConfidence: (minimum) => run((repository) => repository.approveHighConfidence(minimum)),
    update: (itemId, input) => run((repository) => repository.update(itemId, input)),
    discard: (itemId) => run((repository) => repository.discard(itemId)),
  };
}

function todoRepositoryOf(coordinator: SqliteStateCoordinator): TodoRepository {
  const run = <Result>(operation: (repository: TodoRepository) => Promise<Result>, persist = true) =>
    coordinator.execute(createMockTodoRepository, operation, persist);
  return {
    getSnapshot: () => run((repository) => repository.getSnapshot(), false),
    create: (input) => run((repository) => repository.create(input)),
    update: (itemId, input) => run((repository) => repository.update(itemId, input)),
    toggleComplete: (itemId) => run((repository) => repository.toggleComplete(itemId)),
    delete: (itemId) => run((repository) => repository.delete(itemId)),
    createLabel: (input) => run((repository) => repository.createLabel(input)),
    updateLabel: (labelId, input) => run((repository) => repository.updateLabel(labelId, input)),
    reorderLabels: (labelIds) => run((repository) => repository.reorderLabels(labelIds)),
    deleteLabel: (labelId, replacementLabelId) => run((repository) => repository.deleteLabel(labelId, replacementLabelId)),
  };
}

function routineRepositoryOf(coordinator: SqliteStateCoordinator): RoutineRepository {
  const run = <Result>(operation: (repository: RoutineRepository) => Promise<Result>, persist = true) =>
    coordinator.execute(createMockRoutineRepository, operation, persist);
  return {
    getSnapshot: () => run((repository) => repository.getSnapshot(), false),
    create: (input) => run((repository) => repository.create(input)),
    update: (routineId, input) => run((repository) => repository.update(routineId, input)),
    toggleToday: (routineId) => run((repository) => repository.toggleToday(routineId)),
  };
}

function calendarRepositoryOf(coordinator: SqliteStateCoordinator): CalendarRepository {
  const run = <Result>(operation: (repository: CalendarRepository) => Promise<Result>, persist = true) =>
    coordinator.execute(createMockCalendarRepository, operation, persist);
  return {
    getSnapshot: () => coordinator.query(createMockCalendarRepository, (repository) => repository.getSnapshot()),
    create: (input) => run((repository) => repository.create(input)),
    update: (eventId, input) => run((repository) => repository.update(eventId, input)),
    createCategory: (input) => run((repository) => repository.createCategory(input)),
    updateCategory: (categoryId, input) => run((repository) => repository.updateCategory(categoryId, input)),
    reorderCategories: (categoryIds) => run((repository) => repository.reorderCategories(categoryIds)),
    deleteCategory: (categoryId, replacementCategoryId) => run((repository) => repository.deleteCategory(categoryId, replacementCategoryId)),
  };
}

function scrapRepositoryOf(coordinator: SqliteStateCoordinator): ScrapRepository {
  const run = <Result>(operation: (repository: ScrapRepository) => Promise<Result>, persist = true) =>
    coordinator.execute(createMockScrapRepository, operation, persist);
  return {
    getSnapshot: () => coordinator.query(createMockScrapRepository, (repository) => repository.getSnapshot()),
    create: (input) => run((repository) => repository.create(input)),
    delete: (scrapId) => run((repository) => repository.delete(scrapId)),
    addTag: (tag) => run((repository) => repository.addTag(tag)),
    addComment: (scrapId, input) => run((repository) => repository.addComment(scrapId, input)),
    updateComment: (scrapId, commentId, input) => run((repository) => repository.updateComment(scrapId, commentId, input)),
    deleteComment: (scrapId, commentId) => run((repository) => repository.deleteComment(scrapId, commentId)),
  };
}

function ledgerRepositoryOf(coordinator: SqliteStateCoordinator): LedgerRepository {
  const run = <Result>(operation: (repository: LedgerRepository) => Promise<Result>, persist = true) =>
    coordinator.execute(createMockLedgerRepository, operation, persist);
  return {
    getSnapshot: () => coordinator.query(createMockLedgerRepository, (repository) => repository.getSnapshot()),
    create: (input) => run((repository) => repository.create(input)),
    createCategory: (input) => run((repository) => repository.createCategory(input)),
    updateCategory: (categoryId, input) => run((repository) => repository.updateCategory(categoryId, input)),
    reorderCategories: (categoryIds) => run((repository) => repository.reorderCategories(categoryIds)),
    deleteCategory: (categoryId) => run((repository) => repository.deleteCategory(categoryId)),
  };
}

export async function createSqliteRepositories(
  store: PlatformStateStore = new TauriSqlitePlatformStateStore(),
  mediaStore: MediaStore = new TauriMediaStore(),
  analysisProvider: CaptureAnalysisProvider = mockCaptureAnalysisProvider,
): Promise<PlatformRepositories> {
  const coordinator = await SqliteStateCoordinator.of(store);
  // 부팅 시 1회, 더 이상 어떤 항목도 참조하지 않는 미디어를 지운다.
  // 실패해도 앱 시작을 막지 않는다 — 다음 부팅에 다시 시도된다.
  void mediaStore.gc(referencedMediaIds(coordinator.currentState)).catch((error) => {
    console.error("미디어 GC 실패:", error);
  });
  return {
    dashboardRepository: dashboardRepositoryOf(coordinator, analysisProvider),
    inboxRepository: inboxRepositoryOf(coordinator),
    todoRepository: todoRepositoryOf(coordinator),
    routineRepository: routineRepositoryOf(coordinator),
    calendarRepository: calendarRepositoryOf(coordinator),
    scrapRepository: scrapRepositoryOf(coordinator),
    ledgerRepository: ledgerRepositoryOf(coordinator),
  };
}
