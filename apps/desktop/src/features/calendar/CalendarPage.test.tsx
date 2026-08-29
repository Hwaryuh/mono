import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { createMockCalendarRepository } from "../../infrastructure/mock/mock-calendar-repository";
import type { CalendarRepository } from "./calendar-repository";
import { CalendarPage } from "./CalendarPage";

function renderCalendar(repository: CalendarRepository = createMockCalendarRepository(), initialEntry = "/calendar") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const result = render(<QueryClientProvider client={queryClient}><MemoryRouter initialEntries={[initialEntry]}><CalendarPage repository={repository} /></MemoryRouter></QueryClientProvider>);
  return { ...result, repository };
}

describe("CalendarPage", () => {
  it("42칸 월 경계, 오늘, 긴 제목과 일정표 키보드 전환을 표시한다", async () => {
    const { container } = renderCalendar();
    expect(await screen.findByText("2026년 8월")).toBeInTheDocument();
    expect(container.querySelectorAll(".calendar-cell")).toHaveLength(42);
    expect(container.querySelectorAll(".calendar-cell--outside")).toHaveLength(11);
    expect(container.querySelector(".calendar-cell__day--today")).toHaveTextContent("5");

    const monthTab = screen.getByRole("tab", { name: "월" });
    monthTab.focus();
    fireEvent.keyDown(monthTab, { key: "ArrowRight" });
    const agendaTab = screen.getByRole("tab", { name: "일정표" });
    expect(agendaTab).toHaveFocus();
    expect(agendaTab).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("8월 22일")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /부산 여행/ })).toBeInTheDocument();
  });

  it("하루 일정을 월간 셀에 최대 3개까지 표시한다", async () => {
    const { container } = renderCalendar();
    await screen.findByText("2026년 8월");

    const todayCell = container.querySelector(".calendar-cell__day--today")?.parentElement;
    expect(todayCell?.querySelectorAll(".calendar-event")).toHaveLength(3);
    expect(todayCell?.querySelector(".calendar-cell__more")).not.toBeInTheDocument();
  });

  it("일정이 있는 날짜 숫자로 해당 날짜의 전체 일정 창을 연다", async () => {
    renderCalendar();
    fireEvent.click(await screen.findByRole("button", { name: "8월 5일 일정 3개 보기" }));

    const dayDialog = screen.getByRole("dialog", { name: /8월 5일/ });
    expect(within(dayDialog).getByRole("button", { name: /팀 회의/ })).toBeInTheDocument();
    expect(within(dayDialog).getByRole("button", { name: /저녁 약속/ })).toBeInTheDocument();
    expect(within(dayDialog).getByRole("button", { name: /가계부 정리/ })).toBeInTheDocument();
  });

  it("여러 날 일정을 이어지는 막대로 그리고, 끼인 날에서도 일정 창에 넣는다", async () => {
    const { container } = renderCalendar();
    await screen.findByText("2026년 8월");

    // 제주 워크샵 8/12–8/14 는 한 주 안이라 세그먼트 1개, 8/12에서 8/14까지 columns를 잇는다.
    const workshop = [...container.querySelectorAll<HTMLElement>(".calendar-span")]
      .find((bar) => bar.textContent?.includes("제주 워크샵"));
    expect(workshop).toBeDefined();
    // 8/12(수)–8/14(금) → 3번째~5번째 열, grid-column 4 / 7
    expect(workshop?.style.gridColumn.replace(/\s+/g, " ").trim()).toBe("4 / 7");
    expect(workshop?.style.gridRow).toBe("3");

    // 부산 여행 8/22–8/24 는 토→월이라 주 경계에서 두 세그먼트로 쪼개진다.
    const busan = container.querySelectorAll(".calendar-span");
    expect([...busan].filter((bar) => bar.textContent?.includes("부산 여행"))).toHaveLength(2);

    // 막대를 누르면 수정 모달이 열린다.
    fireEvent.click(workshop!);
    expect(await screen.findByRole("dialog", { name: "일정 수정" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "취소" }));

    // 끼인 날(8/13)의 날짜 숫자로도 그 일정이 든 창이 열린다.
    fireEvent.click(await screen.findByRole("button", { name: "8월 13일 일정 1개 보기" }));
    const dialog = screen.getByRole("dialog", { name: /8월 13일/ });
    expect(within(dialog).getByRole("button", { name: /제주 워크샵/ })).toBeInTheDocument();
  });

  it("앱 스타일 날짜 선택기에서 날짜를 변경하고 입력 버튼으로 focus를 복귀한다", async () => {
    renderCalendar(createMockCalendarRepository(), "/calendar?modal=new");
    const modal = await screen.findByRole("dialog", { name: "새 일정" });
    const trigger = within(modal).getByRole("button", { name: "시작 날짜" });

    fireEvent.click(trigger);
    const picker = screen.getByRole("dialog", { name: "시작 날짜 선택" });
    expect(within(picker).getByText("2026년 8월")).toBeInTheDocument();
    fireEvent.click(within(picker).getByRole("button", { name: "2026년 8월 6일" }));

    expect(trigger).toHaveTextContent("2026-08-06");
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(screen.queryByRole("dialog", { name: "시작 날짜 선택" })).not.toBeInTheDocument();
  });

  it("앱 스타일 라벨 목록을 키보드로 선택한다", async () => {
    renderCalendar(createMockCalendarRepository(), "/calendar?modal=new");
    const modal = await screen.findByRole("dialog", { name: "새 일정" });
    const trigger = within(modal).getByRole("combobox", { name: "라벨" });

    fireEvent.click(trigger);
    const listbox = screen.getByRole("listbox", { name: "라벨 옵션" });
    expect(listbox).toBeInTheDocument();
    expect(modal).not.toContainElement(listbox);
    expect(listbox.parentElement).toBe(document.body);
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    fireEvent.keyDown(trigger, { key: "Enter" });

    expect(trigger).toHaveTextContent("약속");
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(screen.queryByRole("listbox", { name: "라벨 옵션" })).not.toBeInTheDocument();
  });

  it("일정 라벨을 추가하고 이름과 색상을 커스텀한다", async () => {
    const repository = createMockCalendarRepository();
    renderCalendar(repository, "/calendar?modal=new");
    const eventModal = await screen.findByRole("dialog", { name: "새 일정" });
    const labelGroup = within(eventModal).getByRole("group", { name: "라벨" });
    const manageButton = within(labelGroup).getByRole("button", { name: "관리" });
    expect(manageButton.closest("legend")).toBeNull();
    fireEvent.click(manageButton);
    const manager = screen.getByRole("dialog", { name: "라벨 관리" });
    const nameInput = within(manager).getByRole("textbox", { name: "라벨 이름" });

    fireEvent.change(nameInput, { target: { value: "프로젝트" } });
    fireEvent.click(within(manager).getByRole("button", { name: "추가" }));
    expect(await within(manager).findByText("프로젝트")).toBeInTheDocument();

    fireEvent.click(within(manager).getByRole("button", { name: "프로젝트 편집" }));
    expect(nameInput).toHaveValue("프로젝트");
    fireEvent.change(nameInput, { target: { value: "개인 프로젝트" } });
    fireEvent.click(within(manager).getByRole("button", { name: "저장" }));
    expect(await within(manager).findByText("개인 프로젝트")).toBeInTheDocument();

    const category = (await repository.getSnapshot()).categories.find((candidate) => candidate.name === "개인 프로젝트");
    expect(category).toMatchObject({ color: "oklch(0.604 0.149 260.322)" });
  });

  it("사용 중인 라벨 삭제 시 열린 일정과 기존 일정을 대체 라벨로 이동한다", async () => {
    const repository = createMockCalendarRepository();
    renderCalendar(repository);
    fireEvent.click(await screen.findByRole("button", { name: /미용실 방문/ }));
    const eventModal = screen.getByRole("dialog", { name: "일정 수정" });
    fireEvent.click(within(eventModal).getByRole("button", { name: "관리" }));
    const manager = screen.getByRole("dialog", { name: "라벨 관리" });

    fireEvent.click(within(manager).getByRole("button", { name: "약속 삭제" }));
    const confirmation = screen.getByRole("dialog", { name: "라벨 삭제" });
    expect(within(confirmation).getByRole("combobox", { name: "이동할 라벨" })).toHaveTextContent("업무");
    fireEvent.click(within(confirmation).getByRole("button", { name: "삭제" }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "라벨 삭제" })).not.toBeInTheDocument());
    expect(within(manager).queryByText("약속")).not.toBeInTheDocument();
    expect((await repository.getSnapshot()).events.find((event) => event.id === "event-2")?.categoryId).toBe("work");
    fireEvent.click(within(manager).getByRole("button", { name: "닫기" }));
    expect(within(eventModal).getByRole("combobox", { name: "라벨" })).toHaveTextContent("업무");
  });

  it("공통 Modal에서 생성·수정하고 수정 진입점으로 focus를 복귀한다", async () => {
    renderCalendar(createMockCalendarRepository(), "/calendar?modal=new");
    let modal = await screen.findByRole("dialog", { name: "새 일정" });
    fireEvent.change(within(modal).getByRole("textbox", { name: "제목" }), { target: { value: "치과 검진" } });
    fireEvent.click(within(modal).getByRole("button", { name: "생성" }));

    fireEvent.click(await screen.findByRole("tab", { name: "일정표" }));
    const createdButton = await screen.findByRole("button", { name: /치과 검진/ });
    createdButton.focus();
    fireEvent.click(createdButton);
    modal = screen.getByRole("dialog", { name: "일정 수정" });
    fireEvent.change(within(modal).getByRole("textbox", { name: "제목" }), { target: { value: "정기 치과 검진" } });
    fireEvent.click(within(modal).getByRole("button", { name: "저장" }));
    expect(await screen.findByRole("button", { name: /정기 치과 검진/ })).toHaveFocus();
  });

  it("반복 프리셋으로 일정을 만들면 월간 보기에 회차로 펼쳐진다", async () => {
    const repository = createMockCalendarRepository();
    renderCalendar(repository, "/calendar?modal=new");
    const modal = await screen.findByRole("dialog", { name: "새 일정" });

    // 기본 시작일 = mock today 2026-08-05(화). "매주" → 매주 수요일.
    fireEvent.change(within(modal).getByRole("textbox", { name: "제목" }), { target: { value: "요가" } });
    fireEvent.click(within(modal).getByRole("combobox", { name: "반복" }));
    fireEvent.click(await screen.findByRole("option", { name: "매주" }));
    expect(within(modal).getByText(/매주 수/)).toBeInTheDocument();
    fireEvent.click(within(modal).getByRole("button", { name: "생성" }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "새 일정" })).not.toBeInTheDocument());
    const chips = await screen.findAllByRole("button", { name: /요가/ });
    expect(chips.length).toBeGreaterThanOrEqual(4);

    const snapshot = await repository.getSnapshot({ from: "2026-08-01", to: "2026-08-31" });
    expect(snapshot.events.filter((event) => event.title === "요가").map((event) => event.startDate))
      .toEqual(["2026-08-05", "2026-08-12", "2026-08-19", "2026-08-26"]);
  });

  it("반복 회차를 수정하면 범위를 묻고 이 일정만 반영한다", async () => {
    const repository = createMockCalendarRepository();
    await repository.create({
      title: "루틴 미팅", startDate: "2026-08-03", startTime: "09:00", endDate: "2026-08-03", endTime: "09:30",
      location: "", categoryId: "work", note: "", recurrence: { freq: "weekly", interval: 1, weekdays: [1], until: null, count: null },
    });
    renderCalendar(repository);

    fireEvent.click((await screen.findAllByRole("button", { name: /루틴 미팅/ }))[1]);
    const modal = await screen.findByRole("dialog", { name: "일정 수정" });
    fireEvent.change(within(modal).getByRole("textbox", { name: "제목" }), { target: { value: "루틴 미팅(변경)" } });
    fireEvent.click(within(modal).getByRole("button", { name: "저장" }));

    const scope = await screen.findByRole("dialog", { name: "반복 일정 수정" });
    fireEvent.click(within(scope).getByRole("button", { name: /이 일정만/ }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "반복 일정 수정" })).not.toBeInTheDocument());
    const snapshot = await repository.getSnapshot({ from: "2026-08-01", to: "2026-08-31" });
    const changed = snapshot.events.filter((event) => event.title.startsWith("루틴 미팅"));
    expect(changed.filter((event) => event.title === "루틴 미팅(변경)")).toHaveLength(1);
    expect(changed.filter((event) => event.title === "루틴 미팅").length).toBeGreaterThanOrEqual(3);
  });

  it("빈 상태에서 생성 진입을 제공한다", async () => {
    const base = createMockCalendarRepository();
    const repository: CalendarRepository = {
      ...base,
      getSnapshot: async () => ({ today: "2026-08-05", categories: [{ id: "work", name: "업무", color: "#4a7fd9" }], events: [] }),
      create: (input) => base.create(input),
      update: (id, input) => base.update(id, input),
    };
    renderCalendar(repository);
    expect(await screen.findByText("이 달에는 일정이 없습니다")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "새 일정" }));
    expect(await screen.findByRole("dialog", { name: "새 일정" })).toBeInTheDocument();
  });

  it("수정 mutation pending·실패를 열린 일정에만 표시한다", async () => {
    const base = createMockCalendarRepository();
    let rejectUpdate: ((reason?: unknown) => void) | undefined;
    const repository: CalendarRepository = {
      ...base,
      getSnapshot: () => base.getSnapshot(),
      create: (input) => base.create(input),
      update: vi.fn((id, input) => id === "event-1" ? new Promise<void>((_, reject) => { rejectUpdate = reject; }) : base.update(id, input)),
    };
    renderCalendar(repository);
    const eventButton = await screen.findByRole("button", { name: /팀 회의/ });
    fireEvent.click(eventButton);
    const modal = screen.getByRole("dialog", { name: "일정 수정" });
    fireEvent.click(within(modal).getByRole("button", { name: "저장" }));
    await waitFor(() => expect(within(modal).getByRole("button", { name: "저장" })).toBeDisabled());
    rejectUpdate?.(new Error("일정 저장 실패"));
    expect(await within(modal).findByRole("alert")).toHaveTextContent("일정 저장 실패");
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });

  it("종료가 시작보다 빠른 경계 조건을 저장하지 않는다", async () => {
    const repository = createMockCalendarRepository();
    const update = vi.spyOn(repository, "update");
    renderCalendar(repository);
    fireEvent.click(await screen.findByRole("button", { name: /팀 회의/ }));
    const modal = screen.getByRole("dialog", { name: "일정 수정" });
    fireEvent.click(within(modal).getByRole("button", { name: "종료 시간 다이얼 열기" }));
    const timePicker = within(modal).getByRole("dialog", { name: "종료 시간 선택" });
    fireEvent.click(within(timePicker).getByRole("button", { name: "9시" }));
    fireEvent.click(within(timePicker).getByRole("button", { name: "0분" }));
    fireEvent.click(within(timePicker).getByRole("button", { name: "완료" }));
    fireEvent.click(within(modal).getByRole("button", { name: "저장" }));
    expect(await within(modal).findByRole("alert")).toHaveTextContent("종료 일시는 시작 일시보다 빠를 수 없습니다");
    expect(update).not.toHaveBeenCalled();
  });

  it("시간은 직접 입력하고 아이콘으로만 다이얼을 연다", async () => {
    const repository = createMockCalendarRepository();
    renderCalendar(repository);
    fireEvent.click(await screen.findByRole("button", { name: /팀 회의/ }));
    const modal = screen.getByRole("dialog", { name: "일정 수정" });
    const input = within(modal).getByLabelText("종료 시간");

    fireEvent.click(input);
    expect(within(modal).queryByRole("dialog", { name: "종료 시간 선택" })).not.toBeInTheDocument();
    fireEvent.change(input, { target: { value: "930" } });
    fireEvent.blur(input);
    expect(input).toHaveValue("09:30");

    fireEvent.click(within(modal).getByRole("button", { name: "종료 시간 다이얼 열기" }));
    expect(within(modal).getByRole("dialog", { name: "종료 시간 선택" })).toBeInTheDocument();
  });
});
