import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createMockCalendarRepository } from "../../infrastructure/mock/mock-calendar-repository";
import { createMockInboxRepository } from "../../infrastructure/mock/mock-inbox-repository";
import { createMockLedgerRepository } from "../../infrastructure/mock/mock-ledger-repository";
import { createMockScrapRepository } from "../../infrastructure/mock/mock-scrap-repository";
import { createMockTodoRepository } from "../../infrastructure/mock/mock-todo-repository";
import type { CalendarRepository } from "../calendar/calendar-repository";
import type { LedgerRepository } from "../ledger/ledger-repository";
import type { ScrapRepository } from "../scrap/scrap-repository";
import type { TodoRepository } from "../todo/todo-repository";
import type { InboxRepository } from "./inbox-repository";
import { InboxPage } from "./InboxPage";
import { inboxViewStateStoreOf, type InboxViewStateStore } from "./inbox-view-state-store";

function renderInbox(
  repository: InboxRepository = createMockInboxRepository(),
  calendarRepository: CalendarRepository = createMockCalendarRepository(),
  todoRepository: TodoRepository = createMockTodoRepository(),
  scrapRepository: ScrapRepository = createMockScrapRepository(),
  ledgerRepository: LedgerRepository = createMockLedgerRepository(),
  viewStateStore?: InboxViewStateStore,
) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const result = render(
    <QueryClientProvider client={queryClient}>
      <InboxPage calendarRepository={calendarRepository} ledgerRepository={ledgerRepository} repository={repository} scrapRepository={scrapRepository} todoRepository={todoRepository} viewStateStore={viewStateStore} />
    </QueryClientProvider>,
  );
  return { ...result, repository };
}

async function rowFor(text: string) {
  const matches = await screen.findAllByText(text);
  const raw = matches.find((match) => match.matches(".inbox-item__source p"));
  const row = raw?.closest(".inbox-item");
  if (!row) throw new Error(`행을 찾을 수 없습니다: ${text}`);
  return row as HTMLElement;
}

function moveDatePickerTo(dialog: HTMLElement, targetMonth: string) {
  const label = within(dialog).getByRole("group").getAttribute("aria-label") ?? "";
  const match = /^(\d{4})년 (\d{1,2})월$/.exec(label);
  if (!match) throw new Error(`날짜 선택기 월을 읽을 수 없습니다: ${label}`);
  const [targetYear, target] = targetMonth.split("-").map(Number);
  const offset = (targetYear - Number(match[1])) * 12 + target - Number(match[2]);
  const button = within(dialog).getByRole("button", { name: offset < 0 ? "이전 달" : "다음 달" });
  for (let index = 0; index < Math.abs(offset); index += 1) fireEvent.click(button);
}

describe("InboxPage", () => {
  it("keeps the last status tab after reopening", async () => {
    const repository = createMockInboxRepository();
    const calendarRepository = createMockCalendarRepository();
    const todoRepository = createMockTodoRepository();
    const scrapRepository = createMockScrapRepository();
    const ledgerRepository = createMockLedgerRepository();
    const viewStateStore = inboxViewStateStoreOf();
    const first = renderInbox(repository, calendarRepository, todoRepository, scrapRepository, ledgerRepository, viewStateStore);
    fireEvent.click(await screen.findByRole("tab", { name: /분류 실패/ }));
    first.unmount();

    renderInbox(repository, calendarRepository, todoRepository, scrapRepository, ledgerRepository, viewStateStore);

    expect(await screen.findByRole("tab", { name: /분류 실패/ })).toHaveAttribute("aria-selected", "true");
  });

  it("switches tab filters using keyboard and pointer", async () => {
    renderInbox();
    const pendingTab = await screen.findByRole("tab", { name: /대기/ });

    fireEvent.keyDown(pendingTab, { key: "End" });

    expect(await screen.findByText("스크린샷 · 흐릿한 손글씨 메모")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /분류 실패/ })).toHaveAttribute("aria-selected", "true");
  });

  it("approves a single item and high-confidence items", async () => {
    renderInbox();
    const firstRow = await rowFor("담주 일요일 홍대에서 합주함");

    fireEvent.click(within(firstRow).getByRole("button", { name: "승인하고 저장" }));
    await waitFor(() => expect(screen.queryByText("담주 일요일 홍대에서 합주함")).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /확신도 90% 이상 1건 일괄 승인/ }));
    await waitFor(() => expect(screen.queryByText("@할일 홍길동이 보내준 기획안 검토하기")).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole("tab", { name: /승인됨/ }));
    expect(await screen.findByText("담주 일요일 홍대에서 합주함")).toBeInTheDocument();
    expect(screen.getByText("@할일 홍길동이 보내준 기획안 검토하기")).toBeInTheDocument();
  });

  it("edits fields in the Modal", async () => {
    const calendarRepository = createMockCalendarRepository();
    await calendarRepository.createCategory({ name: "운동", color: "#2f7a61" });
    renderInbox(createMockInboxRepository(), calendarRepository);
    const row = await rowFor("담주 일요일 홍대에서 합주함");

    fireEvent.click(within(row).getByRole("button", { name: "필드 수정" }));
    const modal = screen.getByRole("dialog", { name: "필드 수정" });
    expect(modal.querySelector(".ui-modal.inbox-editor")).toBeInTheDocument();
    expect(modal.querySelector(".ui-drawer")).not.toBeInTheDocument();
    expect(within(modal).getByRole("button", { name: "시작 날짜" })).toHaveTextContent("2026-08-09");
    expect(within(modal).getByRole("button", { name: "종료 날짜" })).toHaveTextContent("2026-08-09");

    fireEvent.click(within(modal).getByRole("button", { name: "시작 날짜" }));
    fireEvent.click(within(modal).getByRole("button", { name: /^2026년 8월 10일/ }));

    const categorySelect = within(modal).getByRole("combobox", { name: "일정 라벨" });
    expect(categorySelect).toHaveTextContent("취미");
    fireEvent.click(categorySelect);
    expect(screen.getByRole("option", { name: "운동" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: "약속" }));

    const titleInput = within(modal).getByDisplayValue("홍대 합주");
    fireEvent.change(titleInput, { target: { value: "홍대 주말 합주" } });
    fireEvent.click(within(modal).getByRole("button", { name: "저장" }));

    expect(await screen.findByText("홍대 주말 합주")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "필드 수정" })).not.toBeInTheDocument());
    expect(screen.getByText("2026-08-10 12:00–14:00")).toBeInTheDocument();
    expect(screen.getByText("약속")).toBeInTheDocument();
  });

  it("picks a label from the actual todo label list in the todo-target Modal", async () => {
    renderInbox();
    const row = await rowFor("@할일 홍길동이 보내준 기획안 검토하기");

    fireEvent.click(within(row).getByRole("button", { name: "라벨 필드 수정" }));
    const modal = screen.getByRole("dialog", { name: "필드 수정" });
    const labelSelect = within(modal).getByRole("combobox", { name: "할 일 라벨" });
    const dueDatePicker = within(modal).getByRole("button", { name: "마감일" });
    expect(labelSelect).toHaveTextContent("업무");
    expect(dueDatePicker).toHaveTextContent("날짜 선택");

    fireEvent.click(dueDatePicker);
    const dueDateDialog = screen.getByRole("dialog", { name: "마감일 선택" });
    moveDatePickerTo(dueDateDialog, "2026-08");
    fireEvent.click(within(dueDateDialog).getByRole("button", { name: /^2026년 8월 12일/ }));
    expect(dueDatePicker).toHaveTextContent("2026-08-12");

    fireEvent.click(labelSelect);
    expect(screen.getByRole("option", { name: "집안일" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "건강" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: "건강" }));
    expect(labelSelect).toHaveTextContent("건강");

    fireEvent.click(within(modal).getByRole("button", { name: "저장" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "필드 수정" })).not.toBeInTheDocument());
    expect(within(await rowFor("@할일 홍길동이 보내준 기획안 검토하기")).getByText("건강")).toBeInTheDocument();
    expect(within(await rowFor("@할일 홍길동이 보내준 기획안 검토하기")).getByText("2026-08-12")).toBeInTheDocument();
  });

  it("picks a label from each module's list in the scrap/ledger-target Modal", async () => {
    renderInbox();

    const scrapRow = await rowFor("https://youtube.com/watch?v=ref-camera-move");
    fireEvent.click(within(scrapRow).getByRole("button", { name: "라벨 필드 수정" }));
    let modal = screen.getByRole("dialog", { name: "필드 수정" });
    const scrapLabelSelect = within(modal).getByRole("combobox", { name: "스크랩 라벨" });
    fireEvent.click(scrapLabelSelect);
    expect(screen.getByRole("option", { name: "음악" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: "음악" }));
    fireEvent.click(within(modal).getByRole("button", { name: "저장" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "필드 수정" })).not.toBeInTheDocument());
    expect(within(await rowFor("https://youtube.com/watch?v=ref-camera-move")).getByText("음악")).toBeInTheDocument();

    const ledgerRow = await rowFor("오늘 점심값 만육천원");
    fireEvent.click(within(ledgerRow).getByRole("button", { name: "라벨 필드 수정" }));
    modal = screen.getByRole("dialog", { name: "필드 수정" });
    const amountInput = within(modal).getByRole("textbox", { name: "금액" });
    expect(amountInput).toHaveValue("16,000");
    fireEvent.change(amountInput, { target: { value: "1234567" } });
    expect(amountInput).toHaveValue("1,234,567");
    const datePicker = within(modal).getByRole("button", { name: "날짜" });
    expect(amountInput.closest(".ledger-expense-form__pair")).toContainElement(datePicker);
    expect(datePicker).toHaveTextContent("2026-08-05");
    fireEvent.click(datePicker);
    fireEvent.click(screen.getByRole("button", { name: /^2026년 8월 6일/ }));
    expect(datePicker).toHaveTextContent("2026-08-06");
    const ledgerLabelSelect = within(modal).getByRole("combobox", { name: "가계부 라벨" });
    fireEvent.click(ledgerLabelSelect);
    expect(screen.getByRole("option", { name: "생활" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: "생활" }));
    fireEvent.click(within(modal).getByRole("button", { name: "저장" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "필드 수정" })).not.toBeInTheDocument());
    expect(within(await rowFor("오늘 점심값 만육천원")).getByText("생활")).toBeInTheDocument();
    expect(within(await rowFor("오늘 점심값 만육천원")).getByText("₩ 1,234,567")).toBeInTheDocument();
    expect(within(await rowFor("오늘 점심값 만육천원")).getByText("2026-08-06")).toBeInTheDocument();
  });

  it("manually classifies a classification-failed item in the Modal", async () => {
    renderInbox();
    fireEvent.click(await screen.findByRole("tab", { name: /분류 실패/ }));
    const row = await rowFor("스크린샷 · 흐릿한 손글씨 메모");

    fireEvent.click(within(row).getByRole("button", { name: "직접 분류" }));
    const modal = screen.getByRole("dialog", { name: "직접 분류" });
    expect(modal.querySelector(".ui-modal.inbox-editor")).toBeInTheDocument();
    expect(within(modal).queryByRole("radiogroup", { name: "저장할 모듈 목록" })).not.toBeInTheDocument();
    fireEvent.click(within(modal).getByRole("button", { name: "저장할 모듈: 할 일" }));
    expect(within(modal).getByRole("radiogroup", { name: "저장할 모듈 목록" })).toHaveClass("inbox-editor__target-list");
    expect(within(modal).queryByRole("radio", { name: "루틴" })).not.toBeInTheDocument();
    fireEvent.click(within(modal).getByRole("radio", { name: "스크랩" }));
    expect(within(modal).getByRole("button", { name: "저장할 모듈: 스크랩" })).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(within(modal).getByRole("button", { name: "저장" }));

    await waitFor(() => expect(screen.queryByText("스크린샷 · 흐릿한 손글씨 메모")).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("tab", { name: /대기/ }));
    const pendingRow = await rowFor("스크린샷 · 흐릿한 손글씨 메모");
    expect(within(pendingRow).getByRole("button", { name: "분류 대상 변경: 스크랩" })).toBeInTheDocument();
  });

  it("returns focus when discard is canceled and removes the item when confirmed", async () => {
    renderInbox();
    const row = await rowFor("https://youtube.com/watch?v=ref-camera-move");
    const discardButton = within(row).getByRole("button", { name: "버리기" });

    discardButton.focus();
    fireEvent.click(discardButton);
    let modal = screen.getByRole("dialog", { name: "이 항목을 버릴까요?" });
    const confirmButton = within(modal).getByRole("button", { name: "버리기" });
    confirmButton.focus();
    fireEvent.keyDown(window, { key: "Tab" });
    expect(within(modal).getByRole("button", { name: "닫기" })).toHaveFocus();
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(discardButton).toHaveFocus());

    fireEvent.click(discardButton);
    modal = screen.getByRole("dialog", { name: "이 항목을 버릴까요?" });
    fireEvent.click(within(modal).getByRole("button", { name: "취소" }));
    await waitFor(() => expect(discardButton).toHaveFocus());

    fireEvent.click(discardButton);
    fireEvent.click(within(screen.getByRole("dialog", { name: "이 항목을 버릴까요?" })).getByRole("button", { name: "버리기" }));
    await waitFor(() => expect(screen.queryByText("https://youtube.com/watch?v=ref-camera-move")).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole("tab", { name: /대기/ })).toHaveFocus());
  });

  it("shows mutation pending and error states only on the affected item", async () => {
    const base = createMockInboxRepository();
    let rejectApproval: ((reason?: unknown) => void) | undefined;
    const repository: InboxRepository = {
      ...base,
      getSnapshot: () => base.getSnapshot(),
      approve: vi.fn(() => new Promise<void>((_, reject) => { rejectApproval = reject; })),
      approveHighConfidence: (minimum) => base.approveHighConfidence(minimum),
      update: (itemId, input) => base.update(itemId, input),
      discard: (itemId) => base.discard(itemId),
    };
    renderInbox(repository);
    const firstRow = await rowFor("담주 일요일 홍대에서 합주함");
    const secondRow = await rowFor("@할일 홍길동이 보내준 기획안 검토하기");

    fireEvent.click(within(firstRow).getByRole("button", { name: "승인하고 저장" }));

    await waitFor(() => expect(within(firstRow).getByRole("button", { name: "승인하고 저장" })).toBeDisabled());
    expect(within(secondRow).getByRole("button", { name: "승인하고 저장" })).toBeEnabled();

    rejectApproval?.(new Error("승인 저장 실패"));
    expect(await within(firstRow).findByRole("alert")).toHaveTextContent("승인 저장 실패");
    expect(within(secondRow).queryByRole("alert")).not.toBeInTheDocument();
  });
});
