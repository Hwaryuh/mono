import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMockInboxRepository } from "../infrastructure/mock/mock-inbox-repository";
import type { InboxRepository } from "../features/inbox/inbox-repository";
import { InMemoryMediaStore, type MediaStore } from "../infrastructure/media/media-store";
import { InMemoryMediaMaintenance, type MediaMaintenance } from "../infrastructure/media/media-maintenance";
import { MediaStoreProvider } from "../infrastructure/media/media-store-context";
import { createMockTodoRepository } from "../infrastructure/mock/mock-todo-repository";
import { createMockRoutineRepository } from "../infrastructure/mock/mock-routine-repository";
import { createMockCalendarRepository } from "../infrastructure/mock/mock-calendar-repository";
import { createMockScrapRepository } from "../infrastructure/mock/mock-scrap-repository";
import { TodoPage } from "../features/todo/TodoPage";
import { AppShell } from "./AppShell";
import type { RoutineRepository } from "../features/routine/routine-repository";
import type { CalendarRepository } from "../features/calendar/calendar-repository";
import { CalendarPage } from "../features/calendar/CalendarPage";
import { ScrapPage } from "../features/scrap/ScrapPage";
import type { ScrapRepository } from "../features/scrap/scrap-repository";
import { LedgerPage } from "../features/ledger/LedgerPage";
import { createMockLedgerRepository } from "../infrastructure/mock/mock-ledger-repository";
import type { LedgerRepository } from "../features/ledger/ledger-repository";
import { createMockDashboardRepository } from "../infrastructure/mock/mock-dashboard-repository";
import type { DashboardRepository } from "../features/dashboard/dashboard-repository";
import { ACCENT_COLOR_STORAGE_KEY } from "./accent-color-preference";
import { InMemoryAiSettingsStore, type AiSettingsStore } from "../infrastructure/ai/ai-settings-store";
import { InMemoryServerSettingsStore, type ServerSettingsStore } from "../infrastructure/server/server-settings-store";

function renderShell(routineRepository: RoutineRepository = createMockRoutineRepository(), calendarRepository: CalendarRepository = createMockCalendarRepository(), scrapRepository: ScrapRepository = createMockScrapRepository(), ledgerRepository: LedgerRepository = createMockLedgerRepository(), dashboardRepository: DashboardRepository = createMockDashboardRepository(), aiSettingsStore?: AiSettingsStore, mediaStore: MediaStore = new InMemoryMediaStore(), inboxRepository: InboxRepository = createMockInboxRepository(), mediaMaintenance: MediaMaintenance = new InMemoryMediaMaintenance(), serverSettingsStore: ServerSettingsStore = new InMemoryServerSettingsStore()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const todoRepository = createMockTodoRepository();
  return render(
    <QueryClientProvider client={queryClient}>
      <MediaStoreProvider value={mediaStore}>
        <MemoryRouter initialEntries={["/dashboard"]}>
          <Routes>
            <Route path="/" element={<AppShell aiSettingsStore={aiSettingsStore} calendarRepository={calendarRepository} dashboardRepository={dashboardRepository} inboxRepository={inboxRepository} mediaMaintenance={mediaMaintenance} routineRepository={routineRepository} serverSettingsStore={serverSettingsStore} todoRepository={todoRepository} />}>
              <Route path="dashboard" element={<div>대시보드 경로</div>} />
              <Route path="inbox" element={<div>수집함 경로</div>} />
              <Route path="todo" element={<TodoPage repository={todoRepository} />} />
              <Route path="calendar" element={<CalendarPage repository={calendarRepository} />} />
              <Route path="scrap" element={<ScrapPage repository={scrapRepository} />} />
              <Route path="ledger" element={<LedgerPage repository={ledgerRepository} />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </MediaStoreProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AppShell", () => {
  it("사이드바 검색을 제거하고 Ctrl+K로 빠른 캡처를 연다", async () => {
    const { container } = renderShell();
    expect(container.querySelector(".sidebar__search")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "설정 열기" })).toHaveAttribute("title", "설정 (Ctrl+,)");
    const collapseButton = screen.getByRole("button", { name: "사이드바 축소" });
    collapseButton.focus();

    fireEvent.keyDown(window, { ctrlKey: true, key: "k" });

    const modal = await screen.findByRole("dialog", { name: "빠른 캡처" });
    expect(modal.querySelector("kbd")).toHaveTextContent("Ctrl+K");
    const input = within(modal).getByRole("textbox", { name: "빠른 캡처" });
    await waitFor(() => expect(input).toHaveFocus());
    fireEvent.change(input, { target: { value: "어디서든 기록하기" } });
    fireEvent.submit(input.closest("form")!);
    await waitFor(() => expect(within(modal).getByText("어디서든 기록하기")).toBeInTheDocument());

    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "빠른 캡처" })).not.toBeInTheDocument());
    expect(collapseButton).toHaveFocus();
  });

  it("Ctrl+K 빠른 캡처에서 사진과 텍스트를 구성한 뒤 화살표로 제출한다", async () => {
    renderShell();
    fireEvent.keyDown(window, { ctrlKey: true, key: "k" });
    const modal = await screen.findByRole("dialog", { name: "빠른 캡처" });
    const dropZone = within(modal).getByRole("region", { name: "빠른 캡처 드롭 영역" });
    const linkDataTransfer = {
      dropEffect: "none",
      files: [],
      getData: (type: string) => type === "text/uri-list" ? "https://example.com/reference" : "Reference",
      types: ["text/uri-list", "text/plain"],
    };

    fireEvent.drop(dropZone, {
      dataTransfer: {
        dropEffect: "none",
        files: [new File(["image"], "reference.png", { type: "image/png" })],
        getData: () => "",
        types: ["Files"],
      },
    });
    expect(await within(modal).findByRole("img", { name: "reference.png" })).toBeInTheDocument();

    fireEvent.drop(dropZone, { dataTransfer: linkDataTransfer });
    const input = within(modal).getByRole("textbox", { name: "빠른 캡처" });
    expect(input).toHaveValue("https://example.com/reference");
    expect(within(modal).queryByText("https://example.com/reference")).not.toBeInTheDocument();

    fireEvent.click(within(modal).getByRole("button", { name: "분류 요청" }));
    await waitFor(() => expect(within(modal).getByText("https://example.com/reference")).toBeInTheDocument());
  });

  it("macOS에서는 Cmd 조합만 처리하고 플랫폼별 단축키 힌트를 표시한다", async () => {
    vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)");
    renderShell();
    const settingsButton = screen.getByRole("button", { name: "설정 열기" });
    expect(settingsButton).toHaveAttribute("title", "설정 (⌘,)");

    fireEvent.keyDown(window, { ctrlKey: true, key: "k" });
    expect(screen.queryByRole("dialog", { name: "빠른 캡처" })).not.toBeInTheDocument();
    fireEvent.keyDown(window, { metaKey: true, key: "k" });
    const captureModal = await screen.findByRole("dialog", { name: "빠른 캡처" });
    expect(captureModal.querySelector("kbd")).toHaveTextContent("⌘K");
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(captureModal).not.toBeInTheDocument());

    fireEvent.keyDown(window, { ctrlKey: true, key: "," });
    expect(screen.queryByRole("dialog", { name: "설정" })).not.toBeInTheDocument();
    fireEvent.keyDown(window, { metaKey: true, key: "," });
    expect(await screen.findByRole("dialog", { name: "설정" })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "설정" })).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole("link", { name: /할 일/ }));
    const createButton = await screen.findByRole("button", { name: "새 할 일" });
    expect(createButton).toHaveAttribute("title", "새 할 일 (⌘N)");
    fireEvent.keyDown(window, { ctrlKey: true, key: "n" });
    expect(screen.queryByRole("dialog", { name: "새 할 일" })).not.toBeInTheDocument();
    fireEvent.keyDown(window, { metaKey: true, key: "n" });
    expect(await screen.findByRole("dialog", { name: "새 할 일" })).toBeInTheDocument();
  });

  it("상단바에 별도 테마 전환 버튼을 표시하지 않는다", () => {
    renderShell();

    expect(screen.queryByRole("button", { name: "다크 테마" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "라이트 테마" })).not.toBeInTheDocument();
  });

  it("사이드바를 56px 축소 상태로 전환한다", () => {
    const { container } = renderShell();

    const collapseButton = screen.getByRole("button", { name: "사이드바 축소" });
    expect(within(collapseButton).queryByText("사이드바 축소")).not.toBeInTheDocument();
    fireEvent.click(collapseButton);

    expect(container.querySelector(".app-shell")).toHaveClass("app-shell--collapsed");
    expect(screen.getByRole("button", { name: "사이드바 확장" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("button", { name: "설정 열기" })).not.toBeInTheDocument();
  });

  it("사이드바 폭을 키보드로 줄이고 최대값을 넘지 못한다", async () => {
    localStorage.clear();
    const { container } = renderShell();
    const shell = container.querySelector<HTMLElement>(".app-shell")!;
    const handle = screen.getByRole("separator", { name: "사이드바 폭 조절" });

    expect(shell.style.getPropertyValue("--sidebar-width")).toBe("224px");

    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(shell.style.getPropertyValue("--sidebar-width")).toBe("216px");

    fireEvent.keyDown(handle, { key: "ArrowRight" });
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(shell.style.getPropertyValue("--sidebar-width")).toBe("224px");

    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    await waitFor(() => expect(localStorage.getItem("mono:sidebar-width")).toBe("216"));
  });

  it("최소 폭에서 더 줄이면 사이드바가 접힌다", () => {
    localStorage.clear();
    const { container } = renderShell();
    const shell = container.querySelector(".app-shell")!;
    const handle = screen.getByRole("separator", { name: "사이드바 폭 조절" });

    for (let step = 0; step < 7; step += 1) fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(shell).not.toHaveClass("app-shell--collapsed");

    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(shell).toHaveClass("app-shell--collapsed");
    expect(screen.getByRole("button", { name: "사이드바 확장" })).toHaveAttribute("aria-pressed", "true");
  });

  it("좌측 설정 아이콘을 닫기 아이콘으로 morph하고 설정 패널을 제어한다", async () => {
    const { container } = renderShell();
    const settingsButton = screen.getByRole("button", { name: "설정 열기" });
    const collapseButton = screen.getByRole("button", { name: "사이드바 축소" });
    const footer = container.querySelector(".sidebar__footer")!;
    expect(footer.firstElementChild).toBe(settingsButton);
    expect(footer.lastElementChild).toBe(collapseButton);
    const settingsLines = Array.from(settingsButton.querySelectorAll<SVGLineElement>("svg line"));
    const settingsTransforms = settingsLines.map((line) => line.style.transform);
    expect(settingsLines).toHaveLength(3);

    settingsButton.focus();
    fireEvent.click(settingsButton);
    const settingsModal = screen.getByRole("dialog", { name: "설정" });
    expect(settingsModal.querySelector(".settings-modal")).toBeInTheDocument();
    const closeLines = Array.from(screen.getByRole("button", { name: "설정 닫기" }).querySelectorAll<SVGLineElement>("svg line"));
    expect(closeLines).toHaveLength(3);
    expect(closeLines[0]).toBe(settingsLines[0]);
    expect(closeLines.map((line) => line.style.transform)).not.toEqual(settingsTransforms);
    expect(closeLines[2]).toHaveAttribute("opacity", "0");
    fireEvent.click(screen.getByRole("radio", { name: "다크" }));
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("dark"));

    fireEvent.keyDown(window, { key: "Escape" });
    const reopenedButton = await screen.findByRole("button", { name: "설정 열기" });
    await waitFor(() => expect(reopenedButton).toHaveFocus());
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "설정" })).not.toBeInTheDocument());
  });

  it("설정에서 강조색을 바꾸고 다음 실행에 복원한다", async () => {
    const firstRender = renderShell();
    fireEvent.click(screen.getByRole("button", { name: "설정 열기" }));
    const settingsModal = screen.getByRole("dialog", { name: "설정" });
    fireEvent.click(within(settingsModal).getByRole("button", { name: "강조색" }));
    const colorPicker = within(settingsModal).getByRole("dialog", { name: "강조색 선택" });

    fireEvent.change(within(colorPicker).getByRole("textbox", { name: "HEX 색상" }), {
      target: { value: "#F4D35E" },
    });

    await waitFor(() => expect(document.documentElement).toHaveStyle({
      "--color-accent": "oklch(0.873 0.14 93.538)",
      "--color-accent-foreground": "oklch(0.222 0.002 106.554)",
    }));
    expect(localStorage.getItem(ACCENT_COLOR_STORAGE_KEY)).toBe("oklch(0.873 0.14 93.538)");

    firstRender.unmount();
    document.documentElement.style.removeProperty("--color-accent");
    renderShell();

    await waitFor(() => expect(document.documentElement).toHaveStyle({ "--color-accent": "oklch(0.873 0.14 93.538)" }));
  });

  it("설정에서 지원 언어를 한국어 한 항목으로 제공한다", async () => {
    renderShell();
    fireEvent.click(screen.getByRole("button", { name: "설정 열기" }));
    const settingsModal = screen.getByRole("dialog", { name: "설정" });
    const languageSelect = within(settingsModal).getByRole("combobox", { name: "표시 언어" });

    expect(languageSelect).toHaveTextContent("한국어");
    fireEvent.click(languageSelect);
    const listbox = screen.getByRole("listbox", { name: "표시 언어 옵션" });
    expect(within(listbox).getAllByRole("option")).toHaveLength(1);
    expect(within(listbox).getByRole("option", { name: "한국어" })).toHaveAttribute("aria-selected", "true");
  });

  it("설정에서 Gemini API 키를 저장하고 연결 확인 후 삭제한다", async () => {
    const store = new InMemoryAiSettingsStore();
    renderShell(undefined, undefined, undefined, undefined, undefined, store);
    fireEvent.click(screen.getByRole("button", { name: "설정 열기" }));
    const settingsModal = screen.getByRole("dialog", { name: "설정" });
    fireEvent.click(within(settingsModal).getByRole("button", { name: "AI" }));
    const geminiSection = within(settingsModal).getByRole("region", { name: "Gemini API 키 설정" });
    await waitFor(() => expect(within(geminiSection).getByText("키 없음")).toBeInTheDocument());

    fireEvent.change(within(geminiSection).getByLabelText("Gemini API 키"), { target: { value: "test-key" } });
    fireEvent.click(within(geminiSection).getByRole("button", { name: "저장" }));
    await waitFor(() => expect(within(geminiSection).getByText("키 저장됨")).toBeInTheDocument());

    fireEvent.click(within(geminiSection).getByRole("button", { name: "연결 테스트" }));
    expect(await within(geminiSection).findByText("Gemini 연결에 성공했습니다.")).toBeInTheDocument();
    fireEvent.click(within(geminiSection).getByRole("button", { name: "삭제" }));
    await waitFor(() => expect(within(geminiSection).getByText("키 없음")).toBeInTheDocument());
  });

  it("각 API 키 카드에서 사용할 AI 모델을 선택한다", async () => {
    const store = new InMemoryAiSettingsStore();
    renderShell(undefined, undefined, undefined, undefined, undefined, store);
    fireEvent.click(screen.getByRole("button", { name: "설정 열기" }));
    const settingsModal = screen.getByRole("dialog", { name: "설정" });
    fireEvent.click(within(settingsModal).getByRole("button", { name: "AI" }));
    const providerGroup = within(settingsModal).getByRole("radiogroup", { name: "사용할 AI 모델" });
    const geminiRadio = within(providerGroup).getByRole("radio", { name: /Gemini API 키/ });
    const openaiRadio = within(providerGroup).getByRole("radio", { name: /OpenAI API 키/ });
    const geminiSection = within(settingsModal).getByRole("region", { name: "Gemini API 키 설정" });
    const openaiSection = within(settingsModal).getByRole("region", { name: "OpenAI API 키 설정" });

    expect(within(settingsModal).queryByText("사용할 모델")).not.toBeInTheDocument();
    await waitFor(() => expect(geminiRadio).toBeChecked());
    expect(openaiRadio).not.toBeChecked();
    expect(geminiSection).toHaveClass("settings-ai--active");
    expect(openaiSection).toHaveClass("settings-ai--inactive");
    expect(within(openaiSection).getByLabelText("OpenAI API 키")).toBeEnabled();

    fireEvent.click(openaiRadio);

    await waitFor(() => expect(openaiRadio).toBeChecked());
    expect(geminiRadio).not.toBeChecked();
    expect(geminiSection).toHaveClass("settings-ai--inactive");
    expect(openaiSection).toHaveClass("settings-ai--active");
    await expect(store.getActiveProvider()).resolves.toBe("openai");
  });

  it("서버 설정에서 원격 모드로 전환하고 저장하면 재시작 안내가 뜬다", async () => {
    const store = new InMemoryServerSettingsStore({ reachable: ["http://100.80.12.34:4174"] });
    renderShell(undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, store);
    fireEvent.click(screen.getByRole("button", { name: "설정 열기" }));
    const settingsModal = screen.getByRole("dialog", { name: "설정" });
    fireEvent.click(within(settingsModal).getByRole("button", { name: "서버" }));

    expect(await within(settingsModal).findByText("연결됨")).toBeInTheDocument();
    expect(within(settingsModal).queryByRole("textbox", { name: "원격 서버 주소" })).not.toBeInTheDocument();

    const modeGroup = within(settingsModal).getByRole("radiogroup", { name: "서버 연결 모드" });
    fireEvent.click(within(modeGroup).getByRole("radio", { name: /원격 서버/ }));

    const urlInput = within(settingsModal).getByRole("textbox", { name: "원격 서버 주소" });
    const saveButton = within(settingsModal).getByRole("button", { name: "저장" });
    expect(saveButton).toBeDisabled();

    fireEvent.change(urlInput, { target: { value: "http://100.80.12.34:4174" } });
    fireEvent.click(within(settingsModal).getByRole("button", { name: "연결 테스트" }));
    expect(await within(settingsModal).findByText(/mono 서버가 응답합니다/)).toBeInTheDocument();

    expect(saveButton).toBeEnabled();
    fireEvent.click(saveButton);

    expect(await within(settingsModal).findByText("다시 시작하면 적용됩니다")).toBeInTheDocument();
    const applied = await store.read();
    expect(applied).toMatchObject({ mode: "remote", remoteUrl: "http://100.80.12.34:4174", restartRequired: true });

    fireEvent.click(within(settingsModal).getByRole("button", { name: "지금 다시 시작" }));
    await waitFor(async () => expect((await store.read()).runningEmbedded).toBe(false));
  });

  it("토큰이 걸린 원격 서버를 현재 연결로 정상 표시한다", async () => {
    const store = new InMemoryServerSettingsStore({ reachable: ["https://mono.example.ts.net"], requiredToken: "sekret" });
    await store.save({ mode: "remote", remoteUrl: "https://mono.example.ts.net", token: "sekret" });
    await store.restart();
    const probe = vi.spyOn(store, "probe");
    renderShell(undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, store);
    fireEvent.click(screen.getByRole("button", { name: "설정 열기" }));
    const settingsModal = screen.getByRole("dialog", { name: "설정" });
    fireEvent.click(within(settingsModal).getByRole("button", { name: "서버" }));

    // 현재 연결 프로브가 저장된 토큰을 실어 보내므로 401이 아니라 "연결됨"이다.
    expect(await within(settingsModal).findByText("연결됨")).toBeInTheDocument();
    expect(within(settingsModal).queryByText("응답 없음")).not.toBeInTheDocument();
    expect(probe).toHaveBeenCalledWith("https://mono.example.ts.net", "sekret");
  });

  it("잘못된 원격 주소는 저장을 막고 오류를 알린다", async () => {
    const store = new InMemoryServerSettingsStore();
    renderShell(undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, store);
    fireEvent.click(screen.getByRole("button", { name: "설정 열기" }));
    const settingsModal = screen.getByRole("dialog", { name: "설정" });
    fireEvent.click(within(settingsModal).getByRole("button", { name: "서버" }));
    await within(settingsModal).findByText("연결됨");

    const modeGroup = within(settingsModal).getByRole("radiogroup", { name: "서버 연결 모드" });
    fireEvent.click(within(modeGroup).getByRole("radio", { name: /원격 서버/ }));
    fireEvent.change(within(settingsModal).getByRole("textbox", { name: "원격 서버 주소" }), { target: { value: "http://host:8080" } });

    expect(within(settingsModal).getByRole("button", { name: "저장" })).toBeDisabled();
    expect(within(settingsModal).getByRole("button", { name: "연결 테스트" })).toBeDisabled();
    expect(within(settingsModal).getByRole("textbox", { name: "원격 서버 주소" })).toHaveAttribute("aria-invalid", "true");
  });

  async function openStoragePanel(mediaMaintenance: MediaMaintenance) {
    renderShell(undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, mediaMaintenance);
    fireEvent.click(screen.getByRole("button", { name: "설정 열기" }));
    const settingsModal = screen.getByRole("dialog", { name: "설정" });
    fireEvent.click(within(settingsModal).getByRole("button", { name: "저장공간" }));
    return within(settingsModal).getByRole("region", { name: "미사용 미디어 정리" });
  }

  it("저장공간 설정에서 미사용 미디어를 확인한 뒤 정리한다", async () => {
    const mediaMaintenance = new InMemoryMediaMaintenance({ count: 2, bytes: 1024 });
    const section = await openStoragePanel(mediaMaintenance);
    expect(within(section).getByText("확인 필요")).toBeInTheDocument();

    fireEvent.click(within(section).getByRole("button", { name: "확인" }));
    expect(await within(section).findByText("2개 · 1KB")).toBeInTheDocument();
    // 확인 단계는 아무것도 지우지 않는다.
    expect(await mediaMaintenance.orphanUsage()).toEqual({ count: 2, bytes: 1024 });

    fireEvent.click(within(section).getByRole("button", { name: "정리" }));
    expect(await within(section).findByText("미디어 2개를 삭제했습니다.")).toBeInTheDocument();
    expect(await mediaMaintenance.orphanUsage()).toEqual({ count: 0, bytes: 0 });
  });

  it("확인이 실패하면 오류만 알리고 정리 버튼을 비활성 상태로 둔다", async () => {
    const brokenMaintenance: MediaMaintenance = {
      orphanUsage: () => Promise.reject(new Error("API 서버에 연결할 수 없습니다.")),
      gc: () => Promise.reject(new Error("사용되지 않음")),
    };
    const section = await openStoragePanel(brokenMaintenance);

    fireEvent.click(within(section).getByRole("button", { name: "확인" }));

    expect(await within(section).findByRole("alert")).toHaveTextContent("API 서버에 연결할 수 없습니다.");
    expect(within(section).getByText("확인 필요")).toBeInTheDocument();
    expect(within(section).getByRole("button", { name: "정리" })).toBeDisabled();
  });

  it("사이드바 링크로 수집함 경로를 연다", async () => {
    renderShell();

    fireEvent.click(screen.getByRole("link", { name: /수집함/ }));

    expect(await screen.findByText("수집함 경로")).toBeInTheDocument();
    expect(screen.queryByText("AI 분류 결과를 확인하고 승인합니다")).not.toBeInTheDocument();
  });

  it("할 일 상단 액션으로 새 할 일 Modal을 연다", async () => {
    renderShell();
    fireEvent.click(screen.getByRole("link", { name: /할 일/ }));
    const createButton = await screen.findByRole("button", { name: "새 할 일" });
    expect(createButton).toHaveAttribute("title", "새 할 일 (Ctrl+N)");
    createButton.focus();
    fireEvent.click(createButton);

    const modal = await screen.findByRole("dialog", { name: "새 할 일" });
    expect(within(modal).getByRole("textbox", { name: /제목/ })).toHaveFocus();
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(createButton).toHaveFocus());
  });

  it("사이드바 루틴 배지를 공유 상태에서 파생한다", async () => {
    const routineRepository = createMockRoutineRepository();
    await routineRepository.create({ title: "추가 루틴", labelId: "health", days: [3], endDate: null });
    renderShell(routineRepository);

    expect(await screen.findByRole("link", { name: /루틴 4/ })).toBeInTheDocument();
  });

  it("사이드바 일정 배지와 상단 액션을 일정 원본에서 연결한다", async () => {
    const calendarRepository = createMockCalendarRepository();
    await calendarRepository.create({ title: "오늘 추가 일정", startDate: "2026-08-05", startTime: "23:00", endDate: "2026-08-05", endTime: "23:30", location: "", categoryId: "work", note: "" });
    renderShell(createMockRoutineRepository(), calendarRepository);

    const calendarLink = await screen.findByRole("link", { name: /일정 4/ });
    fireEvent.click(calendarLink);
    const createButton = await screen.findByRole("button", { name: "새 일정" });
    createButton.focus();
    fireEvent.click(createButton);
    expect(await screen.findByRole("dialog", { name: "새 일정" })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(createButton).toHaveFocus());
  });

  it("사이드바 스크랩 링크에서 상단 스크랩 추가 액션을 연결한다", async () => {
    renderShell();

    const scrapLink = await screen.findByRole("link", { name: "스크랩" });
    fireEvent.click(scrapLink);
    const createButton = await screen.findByRole("button", { name: "스크랩 추가" });
    createButton.focus();
    fireEvent.click(createButton);
    expect(await screen.findByRole("dialog", { name: "스크랩 추가" })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(createButton).toHaveFocus());
  });

  it("가계부 상단 액션에서 Escape·취소·생성 후 focus를 복귀한다", async () => {
    renderShell();
    fireEvent.click(screen.getByRole("link", { name: "가계부" }));
    const createButton = await screen.findByRole("button", { name: "지출 추가" });
    expect(screen.queryByText("2026년 8월")).not.toBeInTheDocument();
    createButton.focus();
    fireEvent.click(createButton);

    expect(await screen.findByRole("dialog", { name: "지출 추가" })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(createButton).toHaveFocus());

    fireEvent.click(createButton);
    let modal = await screen.findByRole("dialog", { name: "지출 추가" });
    fireEvent.click(within(modal).getByRole("button", { name: "취소" }));
    await waitFor(() => expect(createButton).toHaveFocus());

    fireEvent.click(createButton);
    modal = await screen.findByRole("dialog", { name: "지출 추가" });
    fireEvent.change(within(modal).getByRole("textbox", { name: "항목" }), { target: { value: "교통비" } });
    fireEvent.change(within(modal).getByRole("textbox", { name: "금액" }), { target: { value: "1,500" } });
    fireEvent.click(within(modal).getByRole("button", { name: "저장" }));
    await waitFor(() => expect(createButton).toHaveFocus());
  });
});
