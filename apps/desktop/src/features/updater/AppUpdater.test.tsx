import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppUpdater, CHECK_UPDATE_EVENT } from "./AppUpdater";
import type { PendingUpdate } from "../../infrastructure/updater";

const updater = vi.hoisted(() => ({ checkForUpdate: vi.fn() }));
vi.mock("../../infrastructure/updater", () => updater);

afterEach(() => {
  vi.clearAllMocks();
});

function pendingUpdate(overrides: Partial<PendingUpdate> = {}): PendingUpdate {
  return {
    version: "0.1.5",
    currentVersion: "0.1.4",
    notes: "자동 업데이트 추가",
    downloadAndInstall: vi.fn().mockResolvedValue(undefined),
    relaunch: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("AppUpdater", () => {
  it("renders nothing on startup when there is no update", async () => {
    updater.checkForUpdate.mockResolvedValue(null);
    render(<AppUpdater />);
    await waitFor(() => expect(updater.checkForUpdate).toHaveBeenCalled());
    expect(screen.queryByRole("dialog", { name: "업데이트" })).not.toBeInTheDocument();
  });

  it("shows a modal on startup when an update is available, and installs then restarts when \"Update now\" is clicked", async () => {
    const update = pendingUpdate();
    updater.checkForUpdate.mockResolvedValue(update);
    render(<AppUpdater />);

    const dialog = await screen.findByRole("dialog", { name: "업데이트" });
    expect(dialog).toHaveTextContent("새 버전 0.1.5");
    expect(dialog).toHaveTextContent("자동 업데이트 추가");

    fireEvent.click(screen.getByRole("button", { name: "지금 업데이트" }));

    await waitFor(() => expect(update.downloadAndInstall).toHaveBeenCalled());
    await waitFor(() => expect(update.relaunch).toHaveBeenCalled());
  });

  it("opens the result modal for a manual check even when already on the latest version", async () => {
    updater.checkForUpdate.mockResolvedValue(null);
    render(<AppUpdater />);
    await waitFor(() => expect(updater.checkForUpdate).toHaveBeenCalledTimes(1));

    fireEvent(window, new Event(CHECK_UPDATE_EVENT));

    expect(await screen.findByText("최신 버전입니다.")).toBeInTheDocument();
  });

  it("notifies an error when installation fails", async () => {
    const update = pendingUpdate({
      downloadAndInstall: vi.fn().mockRejectedValue(new Error("네트워크 오류")),
    });
    updater.checkForUpdate.mockResolvedValue(update);
    render(<AppUpdater />);

    fireEvent.click(await screen.findByRole("button", { name: "지금 업데이트" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("네트워크 오류");
    expect(update.relaunch).not.toHaveBeenCalled();
  });
});
