import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { createMockRoutineRepository } from "../../infrastructure/mock/mock-routine-repository";
import { createMockPlatformState } from "../../infrastructure/mock/mock-platform-state";
import { createMockTodoRepository } from "../../infrastructure/mock/mock-todo-repository";
import type { TodoRepository } from "../todo/todo-repository";
import type { RoutineRepository } from "./routine-repository";
import { RoutinePage } from "./RoutinePage";

function renderRoutine(repository: RoutineRepository = createMockRoutineRepository(), initialEntry = "/routine", todoRepository: TodoRepository = createMockTodoRepository()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={queryClient}><MemoryRouter initialEntries={[initialEntry]}><RoutinePage repository={repository} todoRepository={todoRepository} /></MemoryRouter></QueryClientProvider>);
  return { repository };
}

describe("RoutinePage", () => {
  it("반복 요일, 기간·만료, 진행률, 최근 2주와 비지정 요일을 표시한다", async () => {
    renderRoutine();
    const vitamin = (await screen.findByText("비타민 먹기")).closest<HTMLElement>(".routine-card")!;
    expect(within(vitamin).getByText("14일 남음")).toBeInTheDocument();
    expect(within(vitamin).getAllByLabelText(/2026-/)).toHaveLength(14);
    expect(within(vitamin).getByRole("button", { name: "비타민 먹기 완료 처리" })).toBeEnabled();

    const expired = screen.getByText("주간 회고 쓰기").closest<HTMLElement>(".routine-card")!;
    expect(expired).toHaveClass("routine-card--expired");
    expect(within(expired).getByText("기간 만료", { selector: "small" })).toBeInTheDocument();
    expect(within(expired).getByRole("button", { name: "주간 회고 쓰기 완료 처리" })).toBeDisabled();
  });

  it("공통 Modal에서 만들고 수정하며 focus를 복귀한다", async () => {
    renderRoutine(createMockRoutineRepository(), "/routine?modal=new");
    let modal = await screen.findByRole("dialog", { name: "새 루틴" });
    expect(modal.querySelector(".routine-editor-modal")).toHaveClass("ui-modal");
    expect(modal.querySelector(".routine-editor-modal")).not.toHaveClass("ui-drawer");
    fireEvent.change(within(modal).getByRole("textbox", { name: "제목" }), { target: { value: "아침 스트레칭" } });
    fireEvent.click(within(modal).getByRole("button", { name: "생성" }));
    const createdTitle = await screen.findByText("아침 스트레칭");
    const editButton = within(createdTitle.closest<HTMLElement>(".routine-card")!).getByRole("button", { name: "수정" });
    editButton.focus();
    fireEvent.click(editButton);
    modal = screen.getByRole("dialog", { name: "루틴 수정" });
    fireEvent.change(within(modal).getByRole("textbox", { name: "제목" }), { target: { value: "아침 전신 스트레칭" } });
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(editButton).toHaveFocus());
    expect(screen.getByText("아침 스트레칭")).toBeInTheDocument();
  });

  it("새 루틴 종료일에 공통 날짜 선택기를 사용한다", async () => {
    renderRoutine(createMockRoutineRepository(), "/routine?modal=new");
    const modal = await screen.findByRole("dialog", { name: "새 루틴" });
    fireEvent.click(within(modal).getByRole("radio", { name: "종료일 지정" }));
    const datePicker = within(modal).getByRole("button", { name: "종료일" });
    expect(datePicker).toHaveAttribute("aria-haspopup", "dialog");
    fireEvent.click(datePicker);
    expect(screen.getByRole("dialog", { name: "종료일 선택" })).toHaveClass("ui-date-picker__popup--end");
  });

  it("루틴 Modal에서 공통 라벨 관리자를 연다", async () => {
    const state = createMockPlatformState();
    renderRoutine(createMockRoutineRepository(state), "/routine?modal=new", createMockTodoRepository(state));
    const routineModal = await screen.findByRole("dialog", { name: "새 루틴" });
    const manageButton = within(routineModal).getByRole("button", { name: "관리" });

    fireEvent.click(manageButton);
    const labelModal = screen.getByRole("dialog", { name: "라벨 관리" });
    fireEvent.change(within(labelModal).getByRole("textbox", { name: "라벨 이름" }), { target: { value: "회복" } });
    fireEvent.click(within(labelModal).getByRole("button", { name: "추가" }));

    expect(await within(labelModal).findByText("회복")).toBeInTheDocument();
  });

  it("오늘 완료 mutation pending과 오류를 해당 루틴에만 표시한다", async () => {
    const base = createMockRoutineRepository();
    let rejectToggle: ((reason?: unknown) => void) | undefined;
    const repository: RoutineRepository = {
      getSnapshot: () => base.getSnapshot(),
      create: (input) => base.create(input),
      update: (id, input) => base.update(id, input),
      toggleToday: vi.fn((id) => id === "routine-1" ? new Promise<void>((_, reject) => { rejectToggle = reject; }) : base.toggleToday(id)),
    };
    renderRoutine(repository);
    const first = await screen.findByRole("button", { name: "비타민 먹기 완료 처리" });
    const second = screen.getByRole("button", { name: "운동 30분 하기 완료 처리" });
    fireEvent.click(first);
    await waitFor(() => expect(first).toBeDisabled());
    expect(second).toBeEnabled();
    rejectToggle?.(new Error("완료 저장 실패"));
    const error = await screen.findByRole("alert");
    expect(error).toHaveTextContent("완료 저장 실패");
    expect(second.closest(".routine-card")?.querySelector('[role="alert"]')).toBeNull();
  });

  it("빈 상태에서 새 루틴 진입을 제공한다", async () => {
    const base = createMockRoutineRepository();
    const repository: RoutineRepository = {
      ...base,
      getSnapshot: async () => ({ today: "2026-08-05", labels: [], items: [], occurrences: [] }),
      create: (input) => base.create(input),
      update: (id, input) => base.update(id, input),
      toggleToday: (id) => base.toggleToday(id),
    };
    renderRoutine(repository);
    expect(await screen.findByText("아직 루틴이 없습니다")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "새 루틴" }));
    expect(await screen.findByRole("dialog", { name: "새 루틴" })).toBeInTheDocument();
  });
});
