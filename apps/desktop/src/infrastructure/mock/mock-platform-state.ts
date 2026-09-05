import {
  dashboardSnapshotSchema,
  inboxSnapshotSchema,
  ledgerSnapshotSchema,
  routineSnapshotSchema,
  scrapSnapshotSchema,
  todoSnapshotSchema,
  calendarSnapshotSchema,
  type CalendarSnapshot,
  type DashboardSnapshot,
  type InboxSnapshot,
  type LedgerSnapshot,
  type RoutineDefinition,
  type RoutineOccurrence,
  type ScrapSnapshot,
  type TodoSnapshot,
} from "@mono/contracts";
import type { CalendarException } from "../../features/calendar/recurrence";

/** The normalized version of the stored state. Bump this when schema defaults or color-normalization rules change. */
export const STATE_VERSION = 1;

export type MockPlatformState = {
  stateVersion: number;
  dashboard: Omit<DashboardSnapshot, "tasks" | "routines" | "events" | "scraps" | "monthlyExpense">;
  inbox: InboxSnapshot;
  ledger: LedgerSnapshot;
  todo: TodoSnapshot;
  calendar: CalendarSnapshot & { exceptions: CalendarException[] };
  scrap: ScrapSnapshot;
  routine: {
    items: RoutineDefinition[];
    occurrences: RoutineOccurrence[];
  };
  nextCaptureId: number;
  nextTodoId: number;
  nextTodoLabelId: number;
  nextRoutineId: number;
  nextCalendarId: number;
  nextCalendarCategoryId: number;
  nextScrapId: number;
  nextScrapCommentId: number;
  nextLedgerId: number;
  nextLedgerCategoryId: number;
};

function occurrence(routineId: string, occurrenceDate: string, done = true): RoutineOccurrence {
  return {
    id: `routine-occurrence:${routineId}:${occurrenceDate}`,
    routineId,
    occurrenceDate,
    done,
    completedAt: done ? "완료" : null,
  };
}

const dashboardStateSchema = dashboardSnapshotSchema.omit({
  tasks: true,
  routines: true,
  events: true,
  scraps: true,
  monthlyExpense: true,
});

function createDashboardState(): MockPlatformState["dashboard"] {
  return dashboardStateSchema.parse({
    dateLabel: "2026년 8월 5일 수요일",
    pendingCaptureCount: 4,
    recentCaptures: [
      { id: "capture-1", raw: "담주 일요일 홍대에서 합주함", module: "calendar", confidence: 0.92 },
      { id: "capture-2", raw: "오늘 점심값 만육천원", module: "ledger", confidence: 0.89 },
    ],
  });
}

export function createMockPlatformState(): MockPlatformState {
  return {
    stateVersion: STATE_VERSION,
    dashboard: createDashboardState(),
    inbox: inboxSnapshotSchema.parse({
      items: [
        {
          id: "inbox-1", source: "text", raw: "담주 일요일 홍대에서 합주함", target: "calendar", confidence: 0.92,
          status: "pending", receivedAt: "2분 전",
          fields: [
            { label: "제목", value: "홍대 합주", confidence: 0.94 },
            { label: "일시", value: "2026-08-09 12:00–14:00", confidence: 0.71 },
            { label: "장소", value: "홍대", confidence: 0.88 },
            { label: "라벨", value: "취미", confidence: 0.62 },
          ],
        },
        {
          id: "inbox-2", source: "text", raw: "@할일 홍길동이 보내준 기획안 검토하기", target: "todo", confidence: 1,
          status: "pending", pinned: true, receivedAt: "6분 전",
          fields: [
            { label: "제목", value: "기획안 검토하기", confidence: 0.96 },
            { label: "라벨", value: "업무", confidence: 0.84 },
            { label: "마감", value: "기한 없음", confidence: 0.4 },
          ],
        },
        {
          id: "inbox-3", source: "text", raw: "오늘 점심값 만육천원", target: "ledger", confidence: 0.89,
          status: "pending", receivedAt: "20분 전",
          fields: [
            { label: "항목", value: "점심", confidence: 0.9 },
            { label: "금액", value: "₩ 16,000", confidence: 0.95 },
            { label: "날짜", value: "2026-08-05", confidence: 0.93 },
            { label: "라벨", value: "식비", confidence: 0.81 },
          ],
        },
        {
          id: "inbox-4", source: "url", raw: "https://youtube.com/watch?v=ref-camera-move", target: "scrap", confidence: 0.64,
          status: "pending", receivedAt: "3시간 전",
          fields: [
            { label: "제목", value: "카메라 무빙 레퍼런스", confidence: 0.66 },
            { label: "메모", value: "원문 링크 보관", confidence: 0.6 },
            { label: "라벨", value: "레퍼런스", confidence: 0.52 },
          ],
        },
        {
          id: "inbox-5", source: "image", raw: "스크린샷 · 흐릿한 손글씨 메모", target: null, confidence: 0,
          status: "failed", receivedAt: "어제",
          fields: [{ label: "원인", value: "읽을 수 있는 텍스트를 찾지 못했습니다" }],
        },
      ],
    }),
    ledger: ledgerSnapshotSchema.parse({
      today: "2026-08-05",
      categories: [
        { id: "food", name: "식비", color: "oklch(0.603 0.109 75.876)" },
        { id: "living", name: "생활", color: "oklch(0.539 0.082 160.129)" },
        { id: "housing", name: "주거", color: "oklch(0.604 0.149 260.322)" },
        { id: "utilities", name: "공과금", color: "oklch(0.502 0.132 309.199)" },
        { id: "hobby", name: "취미", color: "oklch(0.564 0.129 37.329)" },
        { id: "other", name: "기타", color: "oklch(0.645 0.009 106.643)" },
      ],
      expenses: [
        { id: "expense-1", title: "점심값", amountWon: 16_000, date: "2026-08-05", categoryId: "food", note: "" },
        { id: "expense-2", title: "장보기", amountWon: 43_200, date: "2026-08-03", categoryId: "living", note: "" },
        { id: "expense-3", title: "월세", amountWon: 550_000, date: "2026-08-01", categoryId: "housing", note: "" },
        { id: "expense-4", title: "전기세", amountWon: 23_000, date: "2026-07-06", categoryId: "utilities", note: "" },
        { id: "expense-5", title: "합주실 대여", amountWon: 24_000, date: "2026-07-28", categoryId: "hobby", note: "" },
      ],
      comparison: { direction: "less", percentage: 8 },
    }),
    todo: todoSnapshotSchema.parse({
      today: "2026-08-05",
      labels: [
        { id: "home", name: "집안일", color: "oklch(0.539 0.082 160.129)" },
        { id: "work", name: "업무", color: "oklch(0.604 0.149 260.322)" },
        { id: "health", name: "건강", color: "oklch(0.564 0.129 37.329)" },
        { id: "money", name: "재무", color: "oklch(0.502 0.132 309.199)" },
        { id: "other", name: "기타", color: "oklch(0.645 0.009 106.643)" },
      ],
      items: [
        { id: "task-1", title: "설거지 하기", labelId: "home", dueDate: "2026-08-05", dueTime: null, note: "", done: false, completedAt: null },
        { id: "task-2", title: "빨래 정리하기", labelId: "home", dueDate: "2026-08-05", dueTime: null, note: "", done: true, completedAt: "3시간 전" },
        { id: "task-3", title: "홍길동이 보내준 기획안 검토하기", labelId: "work", dueDate: "2026-08-07", dueTime: "18:00", note: "3장 예산표 숫자 다시 확인하기", done: false, completedAt: null },
        { id: "task-4", title: "전기세 이체 확인", labelId: "money", dueDate: "2026-08-03", dueTime: null, note: "", done: false, completedAt: null },
        { id: "task-5", title: "렌즈 주문", labelId: "home", dueDate: "2026-08-11", dueTime: null, note: "", done: false, completedAt: null },
      ],
    }),
    calendar: { ...calendarSnapshotSchema.parse({
      today: "2026-08-05",
      categories: [
        { id: "work", name: "업무", color: "oklch(0.604 0.149 260.322)" },
        { id: "appointment", name: "약속", color: "oklch(0.759 0.145 80.298)" },
        { id: "hobby", name: "취미", color: "oklch(0.502 0.132 309.199)" },
        { id: "personal", name: "개인", color: "oklch(0.539 0.082 160.129)" },
        { id: "finance", name: "재무", color: "oklch(0.603 0.109 75.876)" },
        { id: "other", name: "기타", color: "oklch(0.645 0.009 106.643)" },
      ],
      events: [
        { id: "event-1", title: "팀 회의", startDate: "2026-08-05", startTime: "10:00", endDate: "2026-08-05", endTime: "11:00", location: "회의실 B", categoryId: "work", note: "" },
        { id: "event-2", title: "미용실 방문", startDate: "2026-08-07", startTime: "17:00", endDate: "2026-08-07", endTime: "18:00", location: "연남", categoryId: "appointment", note: "" },
        { id: "event-3", title: "홍대 합주", startDate: "2026-08-09", startTime: "12:00", endDate: "2026-08-09", endTime: "14:00", location: "홍대 합주실", categoryId: "hobby", note: "합주 전 셋리스트 공유하기" },
        { id: "event-4", title: "스터디", startDate: "2026-08-12", startTime: "20:00", endDate: "2026-08-12", endTime: "22:00", location: "온라인", categoryId: "personal", note: "" },
        { id: "event-5", title: "저녁 약속", startDate: "2026-08-05", startTime: "19:30", endDate: "2026-08-05", endTime: "21:00", location: "을지로", categoryId: "appointment", note: "" },
        { id: "event-6", title: "가계부 정리", startDate: "2026-08-05", startTime: "22:00", endDate: "2026-08-05", endTime: "22:30", location: "", categoryId: "finance", note: "" },
        { id: "event-7", title: "부산 여행", startDate: "2026-08-22", startTime: null, endDate: "2026-08-24", endTime: null, location: "부산", categoryId: "work", note: "" },
        { id: "event-8", title: "제주 워크샵", startDate: "2026-08-12", startTime: "09:00", endDate: "2026-08-14", endTime: "18:00", location: "제주", categoryId: "personal", note: "" },
        { id: "event-9", title: "가족 여행", startDate: "2026-08-28", startTime: null, endDate: "2026-09-01", endTime: null, location: "", categoryId: "appointment", note: "" },
      ],
    }), exceptions: [] },
    scrap: scrapSnapshotSchema.parse({
      tags: ["요리", "레퍼런스", "음악", "전시", "수집", "기타"],
      items: [
        {
          id: "scrap-1", kind: "image", title: "들기름 파스타 레시피", memo: "트위터에서 본 캡처. 마늘 6쪽, 국간장 반 스푼.", tag: "요리", savedAt: "7월 6일", url: null,
          comments: [
            { id: "comment-1", createdAt: "7월 12일", text: "만들어봄. 마늘은 반으로 줄이는 게 낫다." },
            { id: "comment-2", createdAt: "7월 28일", text: "면은 1분 덜 삶기. 들기름은 불 끄고 넣을 것." },
          ],
        },
        {
          id: "scrap-2", kind: "url", title: "카메라 무빙 레퍼런스", memo: "2분 14초부터 나오는 트래킹 샷이 정확히 원하던 느낌.", tag: "레퍼런스", savedAt: "7월 21일", url: "youtube.com/watch?v=…",
          comments: [{ id: "comment-3", createdAt: "7월 30일", text: "비슷한 각도로 찍으려면 광각이 필요할 듯." }],
        },
        { id: "scrap-3", kind: "text", title: "합주실 후보 정리", memo: "홍대 3곳 · 시간당 가격과 드럼 상태 메모.", tag: "음악", savedAt: "7월 28일", url: null, comments: [] },
        {
          id: "scrap-4", kind: "image", title: "전시 포스터", memo: "8월 말까지. 주말에 다녀오기.", tag: "전시", savedAt: "8월 1일", url: null,
          comments: [{ id: "comment-4", createdAt: "8월 1일", text: "금요일 저녁이 한산하다고 함." }],
        },
        { id: "scrap-5", kind: "url", title: "좋아하는 밴드 인터뷰", memo: "작업 방식에 대한 이야기. 나중에 다시 읽기.", tag: "레퍼런스", savedAt: "8월 2일", url: "blog.example.com/…", comments: [] },
        {
          id: "scrap-6", kind: "video", title: "합주 녹화본 0801", memo: "3번 곡 후반부 템포가 밀림.", tag: "음악", savedAt: "8월 1일", url: null,
          comments: [{ id: "comment-5", createdAt: "8월 2일", text: "드럼과 베이스만 다시 맞춰보기로." }],
        },
      ],
    }),
    routine: {
      items: [
        { id: "routine-1", title: "비타민 먹기", labelId: "health", days: [1, 3, 5], startDate: "2026-07-06", endDate: "2026-08-19" },
        { id: "routine-2", title: "운동 30분 하기", labelId: "health", days: [0, 1, 2, 3, 4, 5, 6], startDate: "2026-07-06", endDate: null },
        { id: "routine-3", title: "주간 회고 쓰기", labelId: "work", days: [0], startDate: "2026-07-06", endDate: "2026-08-03" },
      ],
      occurrences: [
        ...["2026-07-23", "2026-07-24", "2026-07-27", "2026-07-29", "2026-07-31", "2026-08-03"].map((date) => occurrence("routine-1", date)),
        ...["2026-07-23", "2026-07-24", "2026-07-25", "2026-07-27", "2026-07-28", "2026-07-29", "2026-07-30", "2026-08-01", "2026-08-02", "2026-08-03", "2026-08-04"].map((date) => occurrence("routine-2", date)),
        occurrence("routine-3", "2026-07-26"),
        occurrence("routine-3", "2026-08-02"),
      ],
    },
    nextCaptureId: 6,
    nextTodoId: 6,
    nextTodoLabelId: 1,
    nextRoutineId: 4,
    nextCalendarId: 10,
    nextCalendarCategoryId: 1,
    nextScrapId: 7,
    nextScrapCommentId: 6,
    nextLedgerId: 6,
    nextLedgerCategoryId: 1,
  };
}
