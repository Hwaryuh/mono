import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { createMockTodoRepository } from "../../infrastructure/mock/mock-todo-repository";
import type { TodoRepository } from "./todo-repository";
import { TodoPage } from "./TodoPage";

function renderTodo(repository: TodoRepository = createMockTodoRepository(), initialEntry = "/todo") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}><TodoPage repository={repository} /></MemoryRouter>
    </QueryClientProvider>,
  );
  return { repository };
}

function repositoryOf(base: TodoRepository, overrides: Partial<TodoRepository> = {}): TodoRepository {
  return {
    getSnapshot: overrides.getSnapshot ?? (() => base.getSnapshot()),
    createLabel: overrides.createLabel ?? ((input) => base.createLabel(input)),
    updateLabel: overrides.updateLabel ?? ((labelId, input) => base.updateLabel(labelId, input)),
    reorderLabels: overrides.reorderLabels ?? ((labelIds) => base.reorderLabels(labelIds)),
    deleteLabel: overrides.deleteLabel ?? ((labelId, replacementLabelId) => base.deleteLabel(labelId, replacementLabelId)),
    create: overrides.create ?? ((input) => base.create(input)),
    update: overrides.update ?? ((itemId, input) => base.update(itemId, input)),
    delete: overrides.delete ?? ((itemId) => base.delete(itemId)),
    toggleComplete: overrides.toggleComplete ?? ((itemId) => base.toggleComplete(itemId)),
  };
}

describe("TodoPage", () => {
  it("상태 필터를 키보드로 전환하고 라벨 필터를 겹친다", async () => {
    renderTodo();
    const all = await screen.findByRole("radio", { name: /전체 7/ });
    fireEvent.keyDown(all, { key: "End" });

    expect(screen.getByRole("radio", { name: /완료 1/ })).toHaveFocus();
    expect(screen.getByText("빨래 정리하기")).toBeInTheDocument();
    expect(screen.queryByText("설거지 하기")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /업무 1/ }));
    expect(screen.getByText("조건에 맞는 할 일이 없습니다")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "업무 필터 해제" })).toBeInTheDocument();
  });

  it("공통 Modal에서 새 할 일을 생성하고 기존 할 일을 수정한다", async () => {
    renderTodo(createMockTodoRepository(), "/todo?modal=new");
    let modal = await screen.findByRole("dialog", { name: "새 할 일" });
    fireEvent.change(within(modal).getByRole("textbox", { name: /제목/ }), { target: { value: "분기 보고서 제출" } });
    fireEvent.click(within(modal).getByRole("combobox", { name: "라벨" }));
    fireEvent.click(screen.getByRole("option", { name: "업무" }));
    fireEvent.click(within(modal).getByRole("button", { name: "생성" }));

    const editButton = await screen.findByRole("button", { name: "분기 보고서 제출 수정" });
    fireEvent.click(editButton);
    modal = screen.getByRole("dialog", { name: "할 일 수정" });
    fireEvent.change(within(modal).getByRole("textbox", { name: /제목/ }), { target: { value: "분기 보고서 최종 제출" } });
    fireEvent.click(within(modal).getByRole("button", { name: "저장" }));

    expect(await screen.findByText("분기 보고서 최종 제출")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "할 일 수정" })).not.toBeInTheDocument());
  });

  it("일정과 같은 날짜 선택기로 마감일을 수정한다", async () => {
    const repository = createMockTodoRepository();
    const update = vi.spyOn(repository, "update");
    renderTodo(repository);
    fireEvent.click(await screen.findByRole("button", { name: "렌즈 주문 수정" }));
    const modal = screen.getByRole("dialog", { name: "할 일 수정" });
    const trigger = within(modal).getByRole("button", { name: "마감일" });

    expect(trigger).toHaveTextContent("2026-08-11");
    fireEvent.click(trigger);
    const picker = screen.getByRole("dialog", { name: "마감일 선택" });
    fireEvent.click(within(picker).getByRole("button", { name: "2026년 8월 12일" }));
    fireEvent.click(within(modal).getByRole("button", { name: "저장" }));

    await waitFor(() => expect(update).toHaveBeenCalledWith("task-5", expect.objectContaining({ dueDate: "2026-08-12" })));
  });

  it("라벨을 추가하고 Modal을 닫으면 focus를 복귀한다", async () => {
    renderTodo();
    const trigger = await screen.findByRole("button", { name: "라벨 관리" });
    expect(trigger).toHaveTextContent("관리");
    trigger.focus();
    fireEvent.click(trigger);

    const modal = screen.getByRole("dialog", { name: "라벨 관리" });
    fireEvent.change(within(modal).getByRole("textbox", { name: "라벨 이름" }), { target: { value: "개인 프로젝트" } });
    fireEvent.click(within(modal).getByRole("button", { name: "추가" }));
    expect(await within(modal).findByText("개인 프로젝트")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /개인 프로젝트 0/ })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("자유 HEX 색상으로 라벨을 추가한다", async () => {
    const repository = createMockTodoRepository();
    const createLabel = vi.spyOn(repository, "createLabel");
    renderTodo(repository);
    fireEvent.click(await screen.findByRole("button", { name: "라벨 관리" }));
    const modal = screen.getByRole("dialog", { name: "라벨 관리" });

    fireEvent.click(within(modal).getByRole("button", { name: "라벨 색상" }));
    const colorPicker = screen.getByRole("dialog", { name: "라벨 색상 선택" });
    fireEvent.change(within(colorPicker).getByRole("textbox", { name: "HEX 색상" }), { target: { value: "#123456" } });
    fireEvent.click(within(colorPicker).getByRole("button", { name: "색 선택 닫기" }));
    fireEvent.change(within(modal).getByRole("textbox", { name: "라벨 이름" }), { target: { value: "자유색" } });
    fireEvent.click(within(modal).getByRole("button", { name: "추가" }));

    await waitFor(() => expect(createLabel).toHaveBeenCalledWith({ name: "자유색", color: "oklch(0.319 0.072 251.168)" }));
  });

  it("라벨 생성 pending을 잠그고 실패 시 입력값을 보존한다", async () => {
    const base = createMockTodoRepository();
    let rejectCreateLabel: ((reason?: unknown) => void) | undefined;
    const repository = repositoryOf(base, {
      createLabel: vi.fn(() => new Promise<void>((_, reject) => { rejectCreateLabel = reject; })),
    });
    renderTodo(repository);
    fireEvent.click(await screen.findByRole("button", { name: "라벨 관리" }));
    const modal = screen.getByRole("dialog", { name: "라벨 관리" });
    const name = within(modal).getByRole("textbox", { name: "라벨 이름" });
    fireEvent.change(name, { target: { value: "보존할 라벨" } });
    fireEvent.click(within(modal).getByRole("button", { name: "추가" }));

    await waitFor(() => expect(name).toBeDisabled());
    expect(within(modal).getByRole("button", { name: "라벨 색상" })).toBeDisabled();
    rejectCreateLabel?.(new Error("라벨 저장 실패"));
    expect(await within(modal).findByRole("alert")).toHaveTextContent("라벨 저장 실패");
    expect(name).toHaveValue("보존할 라벨");
    await waitFor(() => expect(name).toHaveFocus());
  });

  it("완료 토글을 항목별로 반영한다", async () => {
    renderTodo();
    const checkbox = await screen.findByRole("checkbox", { name: "설거지 하기 완료 처리" });
    fireEvent.click(checkbox);
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "설거지 하기 미완료 처리" })).toBeChecked());
  });

  it("라벨을 수정·정렬하고 삭제 시 기존 할 일을 선택한 라벨로 이동한다", async () => {
    const repository = createMockTodoRepository();
    renderTodo(repository);
    fireEvent.click(await screen.findByRole("button", { name: "라벨 관리" }));
    const manager = screen.getByRole("dialog", { name: "라벨 관리" });

    fireEvent.click(within(manager).getByRole("button", { name: "집안일 편집" }));
    const name = within(manager).getByRole("textbox", { name: "라벨 이름" });
    expect(name).toHaveValue("집안일");
    fireEvent.change(name, { target: { value: "집" } });
    fireEvent.click(within(manager).getByRole("button", { name: "저장" }));
    expect(await within(manager).findByText("집")).toBeInTheDocument();

    fireEvent.click(within(manager).getByRole("button", { name: "집 아래로 이동" }));
    await waitFor(async () => expect((await repository.getSnapshot()).labels.slice(0, 2).map((label) => label.id)).toEqual(["work", "home"]));

    fireEvent.click(within(manager).getByRole("button", { name: "집 삭제" }));
    const confirmation = screen.getByRole("dialog", { name: "라벨 삭제" });
    expect(within(confirmation).getByRole("combobox", { name: "이동할 라벨" })).toHaveTextContent("업무");
    fireEvent.click(within(confirmation).getByRole("button", { name: "삭제" }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "라벨 삭제" })).not.toBeInTheDocument());
    const snapshot = await repository.getSnapshot();
    expect(snapshot.labels.some((label) => label.id === "home")).toBe(false);
    expect(snapshot.items.filter((item) => item.routineId === null && ["설거지 하기", "빨래 정리하기", "렌즈 주문"].includes(item.title)).every((item) => item.labelId === "work")).toBe(true);
  });

  it("삭제 확인 Modal 취소 시 focus를 복귀하고 확인 시 항목을 지운다", async () => {
    renderTodo();
    const editButton = await screen.findByRole("button", { name: "렌즈 주문 수정" });
    editButton.focus();
    fireEvent.click(editButton);
    const editor = screen.getByRole("dialog", { name: "할 일 수정" });
    const deleteButton = within(editor).getByRole("button", { name: "삭제" });
    fireEvent.click(deleteButton);
    let confirm = screen.getByRole("dialog", { name: "이 할 일을 삭제할까요?" });
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(deleteButton).toHaveFocus());
    expect(screen.getByRole("dialog", { name: "할 일 수정" })).toBeInTheDocument();

    fireEvent.click(deleteButton);
    confirm = screen.getByRole("dialog", { name: "이 할 일을 삭제할까요?" });
    fireEvent.click(within(confirm).getByRole("button", { name: "삭제" }));
    await waitFor(() => expect(screen.queryByText("렌즈 주문")).not.toBeInTheDocument());
    expect(screen.getByRole("radio", { name: /전체 6/ })).toHaveFocus();
  });

  it("필터 결과 없음과 전체 빈 상태를 구분한다", async () => {
    const { repository } = renderTodo();
    await screen.findByText("설거지 하기");
    fireEvent.click(screen.getByRole("radio", { name: /완료 1/ }));
    fireEvent.click(screen.getByRole("button", { name: /건강 2/ }));
    expect(screen.getByText("조건에 맞는 할 일이 없습니다")).toBeInTheDocument();

    const emptyRepository = repositoryOf(repository, { getSnapshot: async () => ({ today: "2026-08-05", labels: [], items: [] }) });
    renderTodo(emptyRepository);
    expect(await screen.findByText("아직 할 일이 없습니다")).toBeInTheDocument();
  });

  it("mutation pending과 오류를 해당 항목에만 표시한다", async () => {
    const base = createMockTodoRepository();
    let rejectToggle: ((reason?: unknown) => void) | undefined;
    const repository = repositoryOf(base, {
      toggleComplete: vi.fn((itemId) => itemId === "task-1"
        ? new Promise<void>((_, reject) => { rejectToggle = reject; })
        : base.toggleComplete(itemId)),
    });
    renderTodo(repository);
    const first = await screen.findByRole("checkbox", { name: "설거지 하기 완료 처리" });
    const second = screen.getByRole("checkbox", { name: "빨래 정리하기 미완료 처리" });
    fireEvent.click(first);

    await waitFor(() => expect(first).toBeDisabled());
    expect(second).toBeEnabled();
    rejectToggle?.(new Error("완료 저장 실패"));
    expect(await screen.findByRole("alert")).toHaveTextContent("완료 저장 실패");
    expect(second.closest(".todo-item")?.querySelector('[role="alert"]')).toBeNull();
  });
});
