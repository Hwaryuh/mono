import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { createMockLedgerRepository } from "../../infrastructure/mock/mock-ledger-repository";
import { createMockPlatformState } from "../../infrastructure/mock/mock-platform-state";
import type { LedgerRepository } from "./ledger-repository";
import { LedgerPage } from "./LedgerPage";

function renderLedger(repository: LedgerRepository = createMockLedgerRepository(), initialEntry = "/ledger") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}><LedgerPage repository={repository} /></MemoryRouter>
    </QueryClientProvider>,
  );
}

function repositoryOf(base: LedgerRepository, overrides: Partial<LedgerRepository> = {}): LedgerRepository {
  return {
    getSnapshot: overrides.getSnapshot ?? (() => base.getSnapshot()),
    create: overrides.create ?? ((input) => base.create(input)),
    update: overrides.update ?? ((expenseId, input) => base.update(expenseId, input)),
    remove: overrides.remove ?? ((expenseId) => base.remove(expenseId)),
    createCategory: overrides.createCategory ?? ((input) => base.createCategory(input)),
    updateCategory: overrides.updateCategory ?? ((categoryId, input) => base.updateCategory(categoryId, input)),
    reorderCategories: overrides.reorderCategories ?? ((categoryIds) => base.reorderCategories(categoryIds)),
    deleteCategory: overrides.deleteCategory ?? ((categoryId) => base.deleteCategory(categoryId)),
  };
}

async function fillRequiredFields() {
  const modal = await screen.findByRole("dialog", { name: "지출 추가" });
  fireEvent.change(within(modal).getByRole("textbox", { name: "항목" }), { target: { value: "저녁 식사" } });
  const amountInput = within(modal).getByRole("textbox", { name: "금액" });
  fireEvent.change(amountInput, { target: { value: "12345" } });
  expect(amountInput).toHaveValue("12,345");
  return modal;
}

describe("LedgerPage", () => {
  it("월 합계, 비교, 라벨별 금액과 현재 월 목록을 표시한다", async () => {
    renderLedger();

    expect(await screen.findByText("₩ 609,200")).toBeInTheDocument();
    expect(screen.getByText("지난달 같은 기간보다 8% 적게 씀")).toBeInTheDocument();
    expect(screen.getAllByText("₩ 550,000").length).toBe(2);
    expect(screen.getByText("점심값")).toBeInTheDocument();
    // 전기세(2026-07)는 지난달 지출이므로 현재 월 목록에는 없다.
    expect(screen.queryByText("전기세")).not.toBeInTheDocument();
  });

  it("이전 월/다음 월로 이동하며 해당 월 목록을 보여준다", async () => {
    renderLedger();
    await screen.findByText("점심값");

    fireEvent.click(screen.getByRole("button", { name: "이전 월" }));
    expect(screen.getByText("2026년 7월 지출")).toBeInTheDocument();
    expect(screen.getByText("전기세")).toBeInTheDocument();
    expect(screen.queryByText("점심값")).not.toBeInTheDocument();
    // 지난달을 볼 때 다음 월은 이번 달이 상한이라 활성화된다.
    expect(screen.getByRole("button", { name: "다음 월" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "이번 달" }));
    expect(screen.getByText("2026년 8월 지출")).toBeInTheDocument();
    expect(screen.getByText("점심값")).toBeInTheDocument();
    // 이번 달에서는 미래로 못 넘어가도록 다음 월이 비활성이다.
    expect(screen.getByRole("button", { name: "다음 월" })).toBeDisabled();
  });

  it("거래가 없는 전체 빈 상태와 0원 합계를 표시한다", async () => {
    const state = createMockPlatformState();
    state.ledger.expenses = [];
    renderLedger(repositoryOf(createMockLedgerRepository(), { getSnapshot: async () => structuredClone(state.ledger), create: async () => undefined }));

    expect(await screen.findByText("₩ 0")).toBeInTheDocument();
    expect(screen.getByText("이번 달 라벨별 지출이 없습니다.")).toBeInTheDocument();
    expect(screen.getByText("이번 달 지출이 없습니다")).toBeInTheDocument();
  });

  it("긴 항목명과 큰 금액을 손실 없이 표시한다", async () => {
    const state = createMockPlatformState();
    const title = "아주 긴 지출 항목 이름 ".repeat(10).trim();
    state.ledger.expenses = [{ id: "expense-large", title, amountWon: 9_000_000_000_000, date: "2026-08-05", categoryId: "other", note: "" }];
    renderLedger(repositoryOf(createMockLedgerRepository(), { getSnapshot: async () => structuredClone(state.ledger), create: async () => undefined }));

    expect(await screen.findByTitle(title)).toHaveTextContent(title);
    expect(screen.getAllByText("₩ 9,000,000,000,000").length).toBeGreaterThan(0);
  });

  it("쉼표 금액으로 지출을 생성하고 Modal을 닫는다", async () => {
    renderLedger(createMockLedgerRepository(), "/ledger?modal=new");
    const modal = await fillRequiredFields();

    fireEvent.click(within(modal).getByRole("button", { name: "저장" }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "지출 추가" })).not.toBeInTheDocument());
    expect(await screen.findByText("저녁 식사")).toBeInTheDocument();
    expect(screen.getAllByText("₩ 12,345").length).toBeGreaterThan(0);
  });

  it("지출 행을 눌러 항목과 금액을 수정한다", async () => {
    renderLedger();
    fireEvent.click(await screen.findByRole("button", { name: "점심값 수정" }));

    const modal = await screen.findByRole("dialog", { name: "지출 수정" });
    const title = within(modal).getByRole("textbox", { name: "항목" });
    expect(title).toHaveValue("점심값");
    fireEvent.change(title, { target: { value: "점심값(정정)" } });
    fireEvent.change(within(modal).getByRole("textbox", { name: "금액" }), { target: { value: "9000" } });
    fireEvent.click(within(modal).getByRole("button", { name: "저장" }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "지출 수정" })).not.toBeInTheDocument());
    expect(await screen.findByText("점심값(정정)")).toBeInTheDocument();
    expect(screen.getAllByText("₩ 9,000").length).toBeGreaterThan(0);
  });

  it("지출을 확인 후 삭제한다", async () => {
    renderLedger();
    fireEvent.click(await screen.findByRole("button", { name: "장보기 수정" }));

    const modal = await screen.findByRole("dialog", { name: "지출 수정" });
    fireEvent.click(within(modal).getByRole("button", { name: "삭제" }));

    const confirm = await screen.findByRole("dialog", { name: "지출 삭제" });
    fireEvent.click(within(confirm).getByRole("button", { name: "삭제" }));

    await waitFor(() => expect(screen.queryByText("장보기")).not.toBeInTheDocument());
  });

  it("생성 pending을 Modal 내부에 표시한다", async () => {
    const base = createMockLedgerRepository();
    const repository = repositoryOf(base, { create: vi.fn(() => new Promise<void>(() => undefined)) });
    renderLedger(repository, "/ledger?modal=new");
    const modal = await fillRequiredFields();

    fireEvent.click(within(modal).getByRole("button", { name: "저장" }));

    expect(await within(modal).findByRole("status")).toHaveTextContent("지출을 저장하고 있습니다.");
    expect(within(modal).getByRole("button", { name: "저장" })).toBeDisabled();
  });

  it("생성 실패 시 입력값을 보존하고 항목 입력으로 focus를 돌린다", async () => {
    const base = createMockLedgerRepository();
    const repository = repositoryOf(base, { create: vi.fn(async () => { throw new Error("저장소 오류"); }) });
    renderLedger(repository, "/ledger?modal=new");
    const modal = await fillRequiredFields();

    fireEvent.click(within(modal).getByRole("button", { name: "저장" }));

    expect(await within(modal).findByRole("alert")).toHaveTextContent("저장소 오류");
    expect(within(modal).getByRole("textbox", { name: "항목" })).toHaveValue("저녁 식사");
    expect(within(modal).getByRole("textbox", { name: "금액" })).toHaveValue("12,345");
    await waitFor(() => expect(within(modal).getByRole("textbox", { name: "항목" })).toHaveFocus());
  });

  it("Modal focus를 가두고 Escape로 닫는다", async () => {
    renderLedger(createMockLedgerRepository(), "/ledger?modal=new");
    const modal = await screen.findByRole("dialog", { name: "지출 추가" });
    const saveButton = within(modal).getByRole("button", { name: "저장" });
    saveButton.focus();

    // waitFor re-fires Tab until the Modal's keydown listener (registered in an
    // effect) is attached — under parallel CI load the effect can lag findByRole.
    await waitFor(() => {
      fireEvent.keyDown(window, { key: "Tab" });
      expect(within(modal).getByRole("button", { name: "닫기" })).toHaveFocus();
    });
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "지출 추가" })).not.toBeInTheDocument());
  });

  it("라벨을 방향키, Home, End, Enter로 선택한다", async () => {
    renderLedger(createMockLedgerRepository(), "/ledger?modal=new");
    const modal = await screen.findByRole("dialog", { name: "지출 추가" });
    const trigger = within(modal).getByRole("combobox", { name: "라벨" });
    trigger.focus();

    fireEvent.click(trigger);
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    fireEvent.keyDown(trigger, { key: "Enter" });
    expect(trigger).toHaveTextContent("생활");
    fireEvent.click(trigger);
    fireEvent.keyDown(trigger, { key: "End" });
    fireEvent.keyDown(trigger, { key: "Enter" });
    expect(trigger).toHaveTextContent("기타");
    fireEvent.click(trigger);
    fireEvent.keyDown(trigger, { key: "Home" });
    fireEvent.keyDown(trigger, { key: "Enter" });
    expect(trigger).toHaveTextContent("식비");
  });

  it("라벨 관리에서 자유 색상의 라벨을 추가하고 지출 라벨에 반영한다", async () => {
    const repository = createMockLedgerRepository();
    renderLedger(repository, "/ledger?modal=new");
    const expenseModal = await screen.findByRole("dialog", { name: "지출 추가" });

    fireEvent.click(within(expenseModal).getByRole("button", { name: "관리" }));
    const manager = await screen.findByRole("dialog", { name: "라벨 관리" });
    fireEvent.click(within(manager).getByRole("button", { name: "라벨 색상" }));
    const colorPicker = screen.getByRole("dialog", { name: "라벨 색상 선택" });
    fireEvent.change(within(colorPicker).getByRole("textbox", { name: "HEX 색상" }), { target: { value: "#123456" } });
    fireEvent.click(within(colorPicker).getByRole("button", { name: "색 선택 닫기" }));
    fireEvent.change(within(manager).getByRole("textbox", { name: "라벨 이름" }), { target: { value: "교통" } });
    fireEvent.click(within(manager).getByRole("button", { name: "추가" }));

    expect(await within(manager).findByText("교통")).toBeInTheDocument();
    expect((await repository.getSnapshot()).categories).toContainEqual(expect.objectContaining({ name: "교통", color: "oklch(0.319 0.072 251.168)" }));
    fireEvent.click(within(manager).getByRole("button", { name: "닫기" }));
    fireEvent.click(within(expenseModal).getByRole("combobox", { name: "라벨" }));
    expect(await screen.findByRole("option", { name: "교통" })).toBeInTheDocument();
  });

  it("사용 중인 라벨을 삭제하면 기존 지출과 선택값을 기타로 이동한다", async () => {
    const repository = createMockLedgerRepository();
    renderLedger(repository, "/ledger?modal=new");
    const expenseModal = await screen.findByRole("dialog", { name: "지출 추가" });
    expect(within(expenseModal).getByRole("combobox", { name: "라벨" })).toHaveTextContent("식비");

    fireEvent.click(within(expenseModal).getByRole("button", { name: "관리" }));
    const manager = await screen.findByRole("dialog", { name: "라벨 관리" });
    fireEvent.click(within(manager).getByRole("button", { name: "식비 삭제" }));
    const confirmation = await screen.findByRole("dialog", { name: "라벨 삭제" });
    expect(within(confirmation).getByText(/기존 지출은 모두/)).toHaveTextContent("기타");
    fireEvent.click(within(confirmation).getByRole("button", { name: "삭제" }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "라벨 삭제" })).not.toBeInTheDocument());
    expect(within(manager).queryByText("식비")).not.toBeInTheDocument();
    expect(within(expenseModal).getByRole("combobox", { name: "라벨" })).toHaveTextContent("기타");
    const snapshot = await repository.getSnapshot();
    expect(snapshot.categories.some((category) => category.id === "food")).toBe(false);
    expect(snapshot.expenses.find((expense) => expense.id === "expense-1")?.categoryId).toBe("other");
  });
});
