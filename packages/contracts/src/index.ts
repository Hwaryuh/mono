import { inboxTargetModuleIds, normalizeColorToOklch, platformModuleIds } from "@mono/domain";
import { z } from "zod";

export const realtimeModuleIds = ["dashboard", "inbox", "todo", "routine", "calendar", "scrap", "ledger"] as const;

export const realtimeChangeEventSchema = z.object({
  revision: z.number().int().positive(),
  modules: z.array(z.enum(realtimeModuleIds)).min(1),
});

export type RealtimeModuleId = (typeof realtimeModuleIds)[number];
export type RealtimeChangeEvent = z.infer<typeof realtimeChangeEventSchema>;

// During a server-first rollout window, an older-shaped snapshot is also read. A new server always returns version.
const recordVersionSchema = z.number().int().positive().optional();

export const oklchColorSchema = z.string().transform((value, context) => {
  const normalized = normalizeColorToOklch(value);
  if (normalized) return normalized;
  context.addIssue({
    code: "custom",
    message: "색상은 OKLCH 또는 6자리 HEX 값이어야 합니다.",
  });
  return z.NEVER;
});

const recentCaptureSchema = z.object({
  id: z.string(),
  raw: z.string(),
  module: z.enum(platformModuleIds),
  confidence: z.number().min(0).max(1),
});

const dashboardTaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  label: z.string(),
  labelColor: oklchColorSchema,
  done: z.boolean(),
  isRoutine: z.boolean().default(false),
});

const dashboardEventSchema = z.object({
  id: z.string(),
  title: z.string(),
  time: z.string(),
  color: oklchColorSchema,
});

const expenseCategorySchema = z.object({
  name: z.string(),
  amount: z.number().nonnegative(),
  color: oklchColorSchema,
});

const routineSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  week: z.array(z.boolean()).length(7),
  period: z.string(),
});

const scrapSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  kind: z.enum(["사진", "링크", "메모", "동영상"]),
  commentCount: z.number().int().nonnegative(),
});

export const dashboardSnapshotSchema = z.object({
  dateLabel: z.string(),
  pendingCaptureCount: z.number().int().nonnegative(),
  recentCaptures: z.array(recentCaptureSchema),
  tasks: z.array(dashboardTaskSchema),
  events: z.array(dashboardEventSchema),
  monthlyExpense: z.object({
    total: z.number().nonnegative(),
    categories: z.array(expenseCategorySchema),
  }),
  routines: z.array(routineSummarySchema),
  scraps: z.array(scrapSummarySchema),
});

// The original media isn't part of the state blob — it's stored in a separate media table, with only the reference id + metadata kept here.
export const captureImageSchema = z.object({
  name: z.string().trim().min(1).max(255),
  mimeType: z.string().regex(/^image\//),
  size: z.number().int().nonnegative().max(10 * 1024 * 1024),
  mediaId: z.string().min(1),
  // A transient field (base64 data URL) sent only with the capture-analysis request. The server uses it only for analysis and does not persist it.
  dataUrl: z.string().optional(),
});

export const captureVideoSchema = z.object({
  name: z.string().trim().min(1).max(255),
  mimeType: z.string().regex(/^video\//),
  size: z.number().int().nonnegative().max(100 * 1024 * 1024),
  mediaId: z.string().min(1),
});

export const captureInputSchema = z.object({
  raw: z.string().trim().max(2_000),
  images: z.array(captureImageSchema).max(4).optional(),
  videos: z.array(captureVideoSchema).max(1).optional(),
}).refine((input) => input.raw.length > 0 || (input.images?.length ?? 0) > 0 || (input.videos?.length ?? 0) > 0, {
  message: "텍스트, 사진 또는 영상이 필요합니다.",
});

export type DashboardSnapshot = z.infer<typeof dashboardSnapshotSchema>;
export type CaptureImage = z.infer<typeof captureImageSchema>;
export type CaptureVideo = z.infer<typeof captureVideoSchema>;
export type CaptureInput = z.infer<typeof captureInputSchema>;

export const inboxFieldSchema = z.object({
  label: z.string(),
  value: z.string(),
  confidence: z.number().min(0).max(1).optional(),
});

export const captureAnalysisResultSchema = z.object({
  target: z.enum(inboxTargetModuleIds),
  confidence: z.number().min(0).max(1),
  fields: z.array(inboxFieldSchema).max(12),
});

export type CaptureAnalysisResult = z.infer<typeof captureAnalysisResultSchema>;

// The user-data context injected into the AI analysis. Grounds the model so it picks from the existing list instead of inventing labels,
// and converts relative dates based on today. Only names are included, to save tokens.
export const captureAnalysisContextSchema = z.object({
  today: z.string(),
  todoLabels: z.array(z.string()),
  calendarCategories: z.array(z.string()),
  ledgerCategories: z.array(z.string()),
  scrapTags: z.array(z.string()),
});

export type CaptureAnalysisContext = z.infer<typeof captureAnalysisContextSchema>;

export const inboxItemSchema = z.object({
  id: z.string(),
  version: recordVersionSchema,
  source: z.enum(["text", "url", "image", "video"]),
  raw: z.string(),
  target: z.enum(inboxTargetModuleIds).nullable(),
  confidence: z.number().min(0).max(1),
  status: z.enum(["pending", "approved", "failed", "processing"]),
  pinned: z.boolean().default(false),
  receivedAt: z.string(),
  fields: z.array(inboxFieldSchema),
  images: z.array(captureImageSchema).max(4).optional(),
  videos: z.array(captureVideoSchema).max(1).optional(),
});

export const inboxSnapshotSchema = z.object({
  items: z.array(inboxItemSchema),
});

export const inboxUpdateInputSchema = z.object({
  target: z.enum(inboxTargetModuleIds),
  fields: z.array(inboxFieldSchema).min(1),
});

export type InboxField = z.infer<typeof inboxFieldSchema>;
export type InboxItem = z.infer<typeof inboxItemSchema>;
export type InboxSnapshot = z.infer<typeof inboxSnapshotSchema>;
export type InboxUpdateInput = z.infer<typeof inboxUpdateInputSchema>;

export const todoLabelSchema = z.object({
  id: z.string(),
  version: recordVersionSchema,
  name: z.string(),
  color: oklchColorSchema,
});

export const todoLabelWriteInputSchema = z.object({
  name: z.string().trim().min(1, "라벨 이름을 입력해야 합니다.").max(100),
  color: oklchColorSchema,
});

export const todoLabelOrderSchema = z.array(z.string().min(1)).min(1);

export const todoItemSchema = z.object({
  id: z.string(),
  version: recordVersionSchema,
  title: z.string(),
  labelId: z.string(),
  dueDate: z.string().nullable(),
  dueTime: z.string().nullable(),
  note: z.string(),
  done: z.boolean(),
  completedAt: z.string().nullable(),
  routineId: z.string().nullable().default(null),
  occurrenceDate: z.string().nullable().default(null),
  priority: z.number().int().min(0).max(3).default(0),
});

export const todoSnapshotSchema = z.object({
  today: z.string(),
  labels: z.array(todoLabelSchema),
  items: z.array(todoItemSchema),
});

export const todoWriteInputSchema = z.object({
  title: z.string().trim().min(1).max(500),
  labelId: z.string(),
  dueDate: z.string().nullable(),
  dueTime: z.string().nullable(),
  note: z.string().max(4_000),
});

export type TodoLabel = z.infer<typeof todoLabelSchema>;
export type TodoLabelWriteInput = z.infer<typeof todoLabelWriteInputSchema>;
export type TodoItem = z.infer<typeof todoItemSchema>;
export type TodoSnapshot = z.infer<typeof todoSnapshotSchema>;
export type TodoWriteInput = z.infer<typeof todoWriteInputSchema>;

const routineDaysSchema = z.array(z.number().int().min(0).max(6)).min(1).max(7)
  .refine((days) => new Set(days).size === days.length, "반복 요일은 중복될 수 없습니다.");

export const routineDefinitionSchema = z.object({
  id: z.string(),
  version: recordVersionSchema,
  title: z.string(),
  labelId: z.string(),
  days: routineDaysSchema,
  startDate: z.string(),
  endDate: z.string().nullable(),
});

export const routineOccurrenceSchema = z.object({
  id: z.string(),
  routineId: z.string(),
  occurrenceDate: z.string(),
  done: z.boolean(),
  completedAt: z.string().nullable(),
});

export const routineSnapshotSchema = z.object({
  today: z.string(),
  labels: z.array(todoLabelSchema),
  items: z.array(routineDefinitionSchema),
  occurrences: z.array(routineOccurrenceSchema),
});

export const routineWriteInputSchema = z.object({
  title: z.string().trim().min(1).max(500),
  labelId: z.string(),
  days: routineDaysSchema,
  endDate: z.string().nullable(),
});

export type RoutineDefinition = z.infer<typeof routineDefinitionSchema>;
export type RoutineOccurrence = z.infer<typeof routineOccurrenceSchema>;
export type RoutineSnapshot = z.infer<typeof routineSnapshotSchema>;
export type RoutineWriteInput = z.infer<typeof routineWriteInputSchema>;

export const calendarCategorySchema = z.object({
  id: z.string().min(1),
  version: recordVersionSchema,
  name: z.string().min(1),
  color: oklchColorSchema,
});

export const calendarCategoryWriteInputSchema = z.object({
  name: z.string().trim().min(1, "라벨 이름을 입력해야 합니다.").max(100),
  color: oklchColorSchema,
});

export const calendarCategoryOrderSchema = z.array(z.string().min(1)).min(1);

export const recurrenceFreqSchema = z.enum(["daily", "weekly", "monthly", "yearly"]);

// The recurrence rule. weekdays is meaningful only for weekly, and [] means the start date's weekday is used.
// End condition: either until (inclusive of that date) or count (a number of occurrences); infinite if both are null.
export const calendarRecurrenceSchema = z.object({
  freq: recurrenceFreqSchema,
  interval: z.number().int().min(1).max(999),
  weekdays: z.array(z.number().int().min(0).max(6)).max(7),
  until: z.string().nullable(),
  count: z.number().int().min(1).max(999).nullable(),
});

export const calendarEditScopeSchema = z.enum(["this", "future", "all"]);

export const calendarEventSchema = z.object({
  id: z.string(),
  version: recordVersionSchema,
  title: z.string(),
  startDate: z.string(),
  startTime: z.string().nullable(),
  endDate: z.string(),
  endTime: z.string().nullable(),
  location: z.string(),
  categoryId: z.string(),
  note: z.string(),
  // The recurring series' rule (carried on both the master and expanded occurrences). null for a single event.
  recurrence: calendarRecurrenceSchema.nullable().default(null),
  // For an expanded occurrence, the master event's id and that occurrence's original slot date. null for a single event.
  seriesId: z.string().nullable().default(null),
  occurrenceDate: z.string().nullable().default(null),
});

export const calendarSnapshotSchema = z.object({
  today: z.string(),
  categories: z.array(calendarCategorySchema),
  events: z.array(calendarEventSchema),
});

export const calendarWriteInputSchema = calendarEventSchema
  .omit({ id: true, version: true, seriesId: true, occurrenceDate: true, recurrence: true })
  .extend({
    title: z.string().trim().min(1).max(500),
    location: z.string().max(500),
    note: z.string().max(4_000),
    recurrence: calendarRecurrenceSchema.nullable().optional(),
  });

export type RecurrenceFreq = z.infer<typeof recurrenceFreqSchema>;
export type CalendarRecurrence = z.infer<typeof calendarRecurrenceSchema>;
export type CalendarEditScope = z.infer<typeof calendarEditScopeSchema>;
export type CalendarCategory = z.infer<typeof calendarCategorySchema>;
export type CalendarCategoryWriteInput = z.infer<typeof calendarCategoryWriteInputSchema>;
export type CalendarEvent = z.infer<typeof calendarEventSchema>;
export type CalendarSnapshot = z.infer<typeof calendarSnapshotSchema>;
export type CalendarWriteInput = z.infer<typeof calendarWriteInputSchema>;

export const scrapKindSchema = z.enum(["image", "url", "text", "video", "file"]);
export const scrapFileMaxBytes = 50 * 1024 * 1024;

// A comment's attachment file. The original bytes live in the media table (R2); only the reference id + display metadata are here.
export const scrapCommentFileSchema = z.object({
  mediaId: z.string().min(1),
  name: z.string().trim().min(1).max(255),
  size: z.number().int().nonnegative().max(50 * 1024 * 1024),
});

export const scrapCommentSchema = z.object({
  id: z.string(),
  version: recordVersionSchema,
  createdAt: z.string(),
  text: z.string(),
  file: scrapCommentFileSchema.nullable().default(null),
});

export const scrapItemSchema = z.object({
  id: z.string(),
  kind: scrapKindSchema,
  title: z.string(),
  memo: z.string(),
  tag: z.string(),
  savedAt: z.string(),
  url: z.string().nullable(),
  mediaId: z.string().nullable().default(null),
  // The original name/size of a non-image attachment (kind "file"). Both null if it's an image.
  fileName: z.string().nullable().default(null),
  fileSize: z.number().int().nonnegative().nullable().default(null),
  comments: z.array(scrapCommentSchema),
});

export const scrapSnapshotSchema = z.object({
  tags: z.array(z.string()),
  items: z.array(scrapItemSchema),
});

export const scrapWriteInputSchema = z.object({
  title: z.string().trim().min(1).max(500),
  memo: z.string().max(4_000),
  url: z.string().trim().max(2_000),
  tag: z.string().trim().min(1).max(100),
  mediaId: z.string().min(1).nullable().optional(),
  fileName: z.string().trim().min(1).max(255).nullable().optional(),
  fileSize: z.number().int().nonnegative().max(scrapFileMaxBytes).nullable().optional(),
});

export const scrapCommentInputSchema = z.object({
  text: z.string().trim().max(2_000),
  file: scrapCommentFileSchema.nullable().optional(),
}).refine((input) => input.text.length > 0 || input.file != null, {
  message: "댓글 내용이나 파일이 필요합니다.",
});

export type ScrapKind = z.infer<typeof scrapKindSchema>;
export type ScrapCommentFile = z.infer<typeof scrapCommentFileSchema>;
export type ScrapComment = z.infer<typeof scrapCommentSchema>;
export type ScrapItem = z.infer<typeof scrapItemSchema>;
export type ScrapSnapshot = z.infer<typeof scrapSnapshotSchema>;
export type ScrapWriteInput = z.infer<typeof scrapWriteInputSchema>;
export type ScrapCommentInput = z.infer<typeof scrapCommentInputSchema>;

export const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "날짜는 YYYY-MM-DD 형식이어야 합니다.").refine((value) => {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}, "유효한 날짜를 입력해야 합니다.");

export const wonAmountSchema = z.preprocess((value) => {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return value;
  const normalized = value.trim().replace(/[₩원,\s]/g, "");
  return /^\d+$/.test(normalized) ? Number(normalized) : Number.NaN;
}, z.number({ error: "금액은 숫자로 입력해야 합니다." }).int("금액은 원 단위 정수여야 합니다.").positive("금액은 1원 이상이어야 합니다.").safe("금액이 허용 범위를 벗어났습니다."));

export const ledgerCategorySchema = z.object({
  id: z.string().min(1),
  version: recordVersionSchema,
  name: z.string().min(1),
  color: oklchColorSchema,
});

export const ledgerCategoryWriteInputSchema = z.object({
  name: z.string().trim().min(1, "라벨 이름을 입력해야 합니다.").max(100),
  color: oklchColorSchema,
});

export const ledgerCategoryOrderSchema = z.array(z.string().min(1)).min(1);

export const ledgerExpenseSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(500),
  amountWon: z.number().int().positive().safe(),
  date: isoDateSchema,
  categoryId: z.string().min(1),
  note: z.string().max(4_000),
});

export const ledgerComparisonSchema = z.object({
  direction: z.enum(["less", "more", "same"]),
  percentage: z.number().int().nonnegative().safe(),
});

export const ledgerSnapshotSchema = z.object({
  today: isoDateSchema,
  categories: z.array(ledgerCategorySchema),
  expenses: z.array(ledgerExpenseSchema),
  comparison: ledgerComparisonSchema,
});

export const ledgerWriteInputSchema = z.object({
  title: z.string().trim().min(1, "항목을 입력해야 합니다.").max(500),
  amountWon: wonAmountSchema,
  date: isoDateSchema,
  categoryId: z.string().min(1, "라벨을 선택해야 합니다."),
  note: z.string().max(4_000),
});

export type LedgerCategory = z.infer<typeof ledgerCategorySchema>;
export type LedgerCategoryWriteInput = z.infer<typeof ledgerCategoryWriteInputSchema>;
export type LedgerExpense = z.infer<typeof ledgerExpenseSchema>;
export type LedgerComparison = z.infer<typeof ledgerComparisonSchema>;
export type LedgerSnapshot = z.infer<typeof ledgerSnapshotSchema>;
export type LedgerWriteInput = z.infer<typeof ledgerWriteInputSchema>;
