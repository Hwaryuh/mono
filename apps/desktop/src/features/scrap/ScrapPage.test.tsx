import type { ScrapSnapshot } from "@mono/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it, vi } from "vitest";
import type { ExternalUrlOpener } from "../../infrastructure/external-url-opener";
import { createMockScrapRepository } from "../../infrastructure/mock/mock-scrap-repository";
import { ScrapPage } from "./ScrapPage";
import type { ScrapRepository } from "./scrap-repository";

function renderPage(repository: ScrapRepository = createMockScrapRepository(), initialEntry = "/scrap", urlOpener?: ExternalUrlOpener) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}><MemoryRouter initialEntries={[initialEntry]}><Routes><Route path="/scrap" element={<ScrapPage repository={repository} urlOpener={urlOpener} />} /></Routes></MemoryRouter></QueryClientProvider>);
}

function repositoryOf(snapshot: ScrapSnapshot, overrides: Partial<ScrapRepository> = {}): ScrapRepository {
  return {
    getSnapshot: async () => structuredClone(snapshot),
    create: vi.fn(async () => {}),
    delete: vi.fn(async () => {}),
    addTag: vi.fn(async () => {}),
    addComment: vi.fn(async () => {}),
    updateComment: vi.fn(async () => {}),
    deleteComment: vi.fn(async () => {}),
    ...overrides,
  };
}

describe("ScrapPage", () => {
  it("정상 목록과 라벨 필터를 표시하고 키보드로 라벨 사이를 이동한다", async () => {
    renderPage();
    expect(await screen.findByRole("button", { name: /들기름 파스타 레시피/ })).toBeInTheDocument();

    const cooking = screen.getByRole("button", { name: "요리" });
    cooking.focus();
    fireEvent.keyDown(cooking, { key: "ArrowRight" });
    expect(screen.getByRole("button", { name: "레퍼런스" })).toHaveFocus();

    fireEvent.click(screen.getByRole("button", { name: "음악" }));
    expect(screen.getByRole("button", { name: /합주실 후보 정리/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /들기름 파스타 레시피/ })).not.toBeInTheDocument();
  });

  it("전체 빈 상태에서 생성 흐름을 연다", async () => {
    renderPage(repositoryOf({ tags: ["수집"], items: [] }));
    expect(await screen.findByText("아직 스크랩이 없습니다")).toBeInTheDocument();
    const button = screen.getByRole("button", { name: "스크랩 추가" });
    button.focus();
    fireEvent.click(button);
    expect(await screen.findByRole("dialog", { name: "스크랩 추가" })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(button).toHaveFocus());
  });

  it("필터 결과 없음과 필터 해제를 구분한다", async () => {
    renderPage();
    await screen.findByRole("button", { name: "수집" });
    fireEvent.click(screen.getByRole("button", { name: "수집" }));
    expect(screen.getByText("이 라벨의 스크랩이 없습니다")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "필터 해제" }));
    expect(screen.getByRole("button", { name: /들기름 파스타 레시피/ })).toBeInTheDocument();
  });

  it("긴 제목을 카드에서 제한하고 상세에서는 전체 표시한다", async () => {
    const title = "아주 긴 스크랩 제목이 카드의 정해진 높이를 넘어가더라도 레이아웃을 밀어내지 않고 상세에서는 온전히 보여야 하는 자료";
    renderPage(repositoryOf({ tags: ["수집"], items: [{ id: "long", kind: "text", title, memo: "긴 제목 검증", tag: "수집", savedAt: "오늘", url: null, mediaId: null, comments: [] }] }));
    const card = await screen.findByRole("button", { name: new RegExp(title) });
    expect(within(card).getByTitle(title)).toBeInTheDocument();
    fireEvent.click(card);
    expect(within(await screen.findByRole("dialog", { name: /스크랩/ })).getByText(title)).toBeInTheDocument();
  });

  it("상세의 웹 URL을 안전한 외부 링크로 연다", async () => {
    const url = "https://www.youtube.com/watch?v=rop5hVsowDQ&list=WL&index=3";
    const open = vi.fn(async () => {});
    renderPage(
      repositoryOf({ tags: ["수집"], items: [{ id: "link", kind: "url", title: "링크", memo: "", tag: "수집", savedAt: "오늘", url, mediaId: null, comments: [] }] }),
      "/scrap?detail=link",
      { open },
    );

    const drawer = await screen.findByRole("dialog", { name: /스크랩/ });
    const link = within(drawer).getByRole("link", { name: url });
    expect(link).toHaveAttribute("href", url);
    expect(link).toHaveAttribute("target", "_blank");
    fireEvent.click(link);
    expect(open).toHaveBeenCalledWith(url);
  });

  it("웹 URL이 아닌 값은 외부 링크로 만들지 않는다", async () => {
    const unsafeUrl = "javascript:alert('xss')";
    renderPage(repositoryOf({ tags: ["수집"], items: [{ id: "unsafe", kind: "url", title: "안전하지 않은 링크", memo: "", tag: "수집", savedAt: "오늘", url: unsafeUrl, mediaId: null, comments: [] }] }), "/scrap?detail=unsafe");

    const drawer = await screen.findByRole("dialog", { name: /스크랩/ });
    expect(within(drawer).getByText(unsafeUrl)).toBeInTheDocument();
    expect(within(drawer).queryByRole("link", { name: unsafeUrl })).not.toBeInTheDocument();
  });

  it("댓글 mutation 성공 후 원본 댓글을 다시 읽고 상세 진입점으로 focus를 돌린다", async () => {
    renderPage();
    const card = await screen.findByRole("button", { name: /카메라 무빙 레퍼런스/ });
    card.focus();
    fireEvent.click(card);
    const drawer = await screen.findByRole("dialog", { name: /스크랩/ });
    fireEvent.change(within(drawer).getByRole("textbox", { name: "새 댓글" }), { target: { value: "구도를 다시 확인하기" } });
    fireEvent.click(within(drawer).getByRole("button", { name: "댓글" }));
    expect(await within(drawer).findByText("구도를 다시 확인하기")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(card).toHaveFocus());
  });

  it("댓글 mutation 실패를 해당 상세에만 표시한다", async () => {
    const base = await createMockScrapRepository().getSnapshot();
    renderPage(repositoryOf(base, { addComment: vi.fn(async () => { throw new Error("댓글 저장 실패"); }) }));
    fireEvent.click(await screen.findByRole("button", { name: /들기름 파스타 레시피/ }));
    const drawer = await screen.findByRole("dialog", { name: /스크랩/ });
    fireEvent.change(within(drawer).getByRole("textbox", { name: "새 댓글" }), { target: { value: "실패할 댓글" } });
    fireEvent.click(within(drawer).getByRole("button", { name: "댓글" }));
    expect(await within(drawer).findByRole("alert")).toHaveTextContent("댓글 저장 실패");
    expect(within(drawer).getByRole("textbox", { name: "새 댓글" })).toHaveValue("실패할 댓글");
  });

  it("댓글 mutation pending을 선택한 스크랩 입력에만 표시한다", async () => {
    const base = await createMockScrapRepository().getSnapshot();
    let resolveComment!: () => void;
    const pending = new Promise<void>((resolve) => { resolveComment = resolve; });
    renderPage(repositoryOf(base, { addComment: vi.fn(() => pending) }));
    fireEvent.click(await screen.findByRole("button", { name: /카메라 무빙 레퍼런스/ }));
    const drawer = await screen.findByRole("dialog", { name: /스크랩/ });
    const input = within(drawer).getByRole("textbox", { name: "새 댓글" });
    fireEvent.change(input, { target: { value: "저장 중 댓글" } });
    fireEvent.click(within(drawer).getByRole("button", { name: "댓글" }));
    await waitFor(() => expect(input).toBeDisabled());
    expect(within(drawer).getByRole("button", { name: "댓글" })).toBeDisabled();
    resolveComment();
    await waitFor(() => expect(input).not.toBeDisabled());
  });

  it("기존 댓글을 인라인으로 수정하고 저장 후 수정 버튼으로 focus를 복귀한다", async () => {
    const repository = createMockScrapRepository();
    renderPage(repository);
    fireEvent.click(await screen.findByRole("button", { name: /들기름 파스타 레시피/ }));
    const drawer = await screen.findByRole("dialog", { name: /스크랩/ });
    const editButton = within(drawer).getByRole("button", { name: "만들어봄. 마늘은 반으로 줄이는 게 낫다. 댓글 수정" });

    fireEvent.click(editButton);
    const input = within(drawer).getByRole("textbox", { name: "댓글 수정" });
    expect(input).toHaveValue("만들어봄. 마늘은 반으로 줄이는 게 낫다.");
    fireEvent.change(input, { target: { value: "마늘은 그대로 넣는 편이 낫다." } });
    fireEvent.click(within(input.closest("form")!).getByRole("button", { name: "저장" }));

    expect(await within(drawer).findByText("마늘은 그대로 넣는 편이 낫다.")).toBeInTheDocument();
    const updatedEditButton = within(drawer).getByRole("button", { name: "마늘은 그대로 넣는 편이 낫다. 댓글 수정" });
    await waitFor(() => expect(updatedEditButton).toHaveFocus());
    expect((await repository.getSnapshot()).items.find((item) => item.id === "scrap-1")?.comments.find((comment) => comment.id === "comment-1")?.text).toBe("마늘은 그대로 넣는 편이 낫다.");
  });

  it("댓글을 확인 후 삭제하고 목록에서 제거한다", async () => {
    const repository = createMockScrapRepository();
    renderPage(repository);
    fireEvent.click(await screen.findByRole("button", { name: /들기름 파스타 레시피/ }));
    const drawer = await screen.findByRole("dialog", { name: /스크랩/ });
    const commentText = "만들어봄. 마늘은 반으로 줄이는 게 낫다.";
    expect(within(drawer).getByText(commentText)).toBeInTheDocument();

    fireEvent.click(within(drawer).getByRole("button", { name: `${commentText} 댓글 삭제` }));
    fireEvent.click(within(drawer).getByRole("button", { name: "삭제" }));

    await waitFor(() => expect(within(drawer).queryByText(commentText)).not.toBeInTheDocument());
    expect((await repository.getSnapshot()).items.find((item) => item.id === "scrap-1")?.comments.some((comment) => comment.id === "comment-1")).toBe(false);
  });

  it("삭제 확인을 취소하면 댓글이 유지된다", async () => {
    const repository = createMockScrapRepository();
    renderPage(repository);
    fireEvent.click(await screen.findByRole("button", { name: /들기름 파스타 레시피/ }));
    const drawer = await screen.findByRole("dialog", { name: /스크랩/ });
    const commentText = "만들어봄. 마늘은 반으로 줄이는 게 낫다.";

    fireEvent.click(within(drawer).getByRole("button", { name: `${commentText} 댓글 삭제` }));
    fireEvent.click(within(drawer).getByRole("button", { name: "취소" }));

    expect(within(drawer).getByText(commentText)).toBeInTheDocument();
    expect(within(drawer).getByRole("button", { name: `${commentText} 댓글 삭제` })).toBeInTheDocument();
  });

  it("스크랩을 확인 후 삭제하고 목록·상세에서 제거한다", async () => {
    const repository = createMockScrapRepository();
    renderPage(repository);
    fireEvent.click(await screen.findByRole("button", { name: /들기름 파스타 레시피/ }));
    const drawer = await screen.findByRole("dialog", { name: /스크랩/ });

    fireEvent.click(within(drawer).getByRole("button", { name: "스크랩 삭제" }));
    const confirm = await screen.findByRole("dialog", { name: "스크랩 삭제" });
    fireEvent.click(within(confirm).getByRole("button", { name: "삭제" }));

    await waitFor(() => expect(screen.queryByRole("button", { name: /들기름 파스타 레시피/ })).not.toBeInTheDocument());
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /스크랩/ })).not.toBeInTheDocument());
    expect((await repository.getSnapshot()).items.some((item) => item.id === "scrap-1")).toBe(false);
  });

  it("스크랩 삭제 확인을 취소하면 스크랩이 유지된다", async () => {
    const repository = createMockScrapRepository();
    renderPage(repository);
    fireEvent.click(await screen.findByRole("button", { name: /들기름 파스타 레시피/ }));
    const drawer = await screen.findByRole("dialog", { name: /스크랩/ });

    fireEvent.click(within(drawer).getByRole("button", { name: "스크랩 삭제" }));
    const confirm = await screen.findByRole("dialog", { name: "스크랩 삭제" });
    fireEvent.click(within(confirm).getByRole("button", { name: "취소" }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "스크랩 삭제" })).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: /들기름 파스타 레시피/ })).toBeInTheDocument();
    expect((await repository.getSnapshot()).items.some((item) => item.id === "scrap-1")).toBe(true);
  });

  it("댓글 수정 실패 시 입력값을 보존하고 Escape로 취소한다", async () => {
    const base = await createMockScrapRepository().getSnapshot();
    renderPage(repositoryOf(base, { updateComment: vi.fn(async () => { throw new Error("댓글 수정 실패"); }) }));
    fireEvent.click(await screen.findByRole("button", { name: /들기름 파스타 레시피/ }));
    const drawer = await screen.findByRole("dialog", { name: /스크랩/ });
    const editButton = within(drawer).getByRole("button", { name: "만들어봄. 마늘은 반으로 줄이는 게 낫다. 댓글 수정" });
    fireEvent.click(editButton);
    const input = within(drawer).getByRole("textbox", { name: "댓글 수정" });
    fireEvent.change(input, { target: { value: "보존할 수정 내용" } });
    fireEvent.click(within(input.closest("form")!).getByRole("button", { name: "저장" }));

    expect(await within(drawer).findByRole("alert")).toHaveTextContent("댓글 수정 실패");
    expect(input).toHaveValue("보존할 수정 내용");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(within(drawer).getByText("만들어봄. 마늘은 반으로 줄이는 게 낫다.")).toBeInTheDocument();
    await waitFor(() => expect(within(drawer).getByRole("button", { name: "만들어봄. 마늘은 반으로 줄이는 게 낫다. 댓글 수정" })).toHaveFocus());
    expect(screen.getByRole("dialog", { name: /스크랩/ })).toBeInTheDocument();
  });

  it("라벨 관리 Modal을 중첩해 새 라벨을 만들고 생성에 반영한다", async () => {
    renderPage(createMockScrapRepository(), "/scrap?modal=new");
    const modal = await screen.findByRole("dialog", { name: "스크랩 추가" });
    fireEvent.change(within(modal).getByRole("textbox", { name: "제목" }), { target: { value: "새 링크 자료" } });
    fireEvent.change(within(modal).getByRole("textbox", { name: "링크 \(선택\)" }), { target: { value: "https://example.com" } });
    const managerTrigger = within(modal).getByRole("button", { name: "관리" });
    managerTrigger.focus();
    fireEvent.click(managerTrigger);
    const manager = await screen.findByRole("dialog", { name: "라벨 관리" });
    expect(screen.getAllByRole("dialog")).toHaveLength(2);
    fireEvent.change(within(manager).getByRole("textbox", { name: "라벨 이름" }), { target: { value: "연구" } });
    fireEvent.click(within(manager).getByRole("button", { name: "추가" }));
    await waitFor(() => expect(within(modal).getByRole("combobox", { name: "라벨" })).toHaveTextContent("연구"));
    expect(within(manager).getByText("연구")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "라벨 관리" })).not.toBeInTheDocument());
    expect(managerTrigger).toHaveFocus();
    fireEvent.click(within(modal).getByRole("button", { name: "저장" }));
    expect(await screen.findByRole("button", { name: /새 링크 자료/ })).toBeInTheDocument();
  });

  it("생성 mutation 실패 시 Modal과 입력값을 보존한다", async () => {
    const base = await createMockScrapRepository().getSnapshot();
    renderPage(repositoryOf(base, { create: vi.fn(async () => { throw new Error("스크랩 저장 실패"); }) }), "/scrap?modal=new");
    const modal = await screen.findByRole("dialog", { name: "스크랩 추가" });
    fireEvent.change(within(modal).getByRole("textbox", { name: "제목" }), { target: { value: "보존할 제목" } });
    fireEvent.click(within(modal).getByRole("button", { name: "저장" }));
    expect(await within(modal).findByRole("alert")).toHaveTextContent("스크랩 저장 실패");
    expect(within(modal).getByRole("textbox", { name: "제목" })).toHaveValue("보존할 제목");
  });
});
