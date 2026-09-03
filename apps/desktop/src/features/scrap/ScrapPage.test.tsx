import type { ScrapSnapshot } from "@mono/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExternalUrlOpener } from "../../infrastructure/external-url-opener";
import type { MediaStore } from "../../infrastructure/media/media-store";
import { MediaStoreProvider } from "../../infrastructure/media/media-store-context";
import { createMockScrapRepository } from "../../infrastructure/mock/mock-scrap-repository";
import { ScrapPage } from "./ScrapPage";
import type { ScrapRepository } from "./scrap-repository";
import { scrapViewStateStoreOf, type ScrapViewStateStore } from "./scrap-view-state-store";

const httpClient = vi.hoisted(() => ({ httpGetBlob: vi.fn() }));
vi.mock("../../infrastructure/http/http-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../infrastructure/http/http-client")>()),
  httpGetBlob: httpClient.httpGetBlob,
}));

beforeEach(() => {
  httpClient.httpGetBlob.mockReset().mockResolvedValue(new Blob(["img"], { type: "image/png" }));
});

function renderPage(repository: ScrapRepository = createMockScrapRepository(), initialEntry = "/scrap", urlOpener?: ExternalUrlOpener, mediaStore?: MediaStore, viewStateStore?: ScrapViewStateStore) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const page = <MemoryRouter initialEntries={[initialEntry]}><Routes><Route path="/scrap" element={<ScrapPage repository={repository} urlOpener={urlOpener} viewStateStore={viewStateStore} />} /></Routes></MemoryRouter>;
  return render(<QueryClientProvider client={queryClient}>{mediaStore ? <MediaStoreProvider value={mediaStore}>{page}</MediaStoreProvider> : page}</QueryClientProvider>);
}

function repositoryOf(snapshot: ScrapSnapshot, overrides: Partial<ScrapRepository> = {}): ScrapRepository {
  return {
    getSnapshot: async () => structuredClone(snapshot),
    create: vi.fn(async () => {}),
    update: vi.fn(async () => {}),
    delete: vi.fn(async () => {}),
    addTag: vi.fn(async () => {}),
    renameTag: vi.fn(async () => {}),
    deleteTag: vi.fn(async () => {}),
    addComment: vi.fn(async () => {}),
    updateComment: vi.fn(async () => {}),
    deleteComment: vi.fn(async () => {}),
    ...overrides,
  };
}

describe("ScrapPage", () => {
  it("다시 열어도 마지막 라벨 필터를 유지한다", async () => {
    const repository = createMockScrapRepository();
    const viewStateStore = scrapViewStateStoreOf();
    const first = renderPage(repository, "/scrap", undefined, undefined, viewStateStore);
    await screen.findByRole("button", { name: /들기름 파스타 레시피/ });
    fireEvent.click(screen.getByRole("button", { name: "음악" }));
    first.unmount();

    renderPage(repository, "/scrap", undefined, undefined, viewStateStore);

    expect(await screen.findByRole("button", { name: "음악" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /합주실 후보 정리/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /들기름 파스타 레시피/ })).not.toBeInTheDocument();
  });

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
    renderPage(repositoryOf({ tags: ["수집"], items: [{ id: "long", kind: "text", title, memo: "긴 제목 검증", tag: "수집", savedAt: "오늘", url: null, mediaId: null, fileName: null, fileSize: null, comments: [] }] }));
    const card = await screen.findByRole("button", { name: new RegExp(title) });
    expect(within(card).getByTitle(title)).toBeInTheDocument();
    fireEvent.click(card);
    expect(within(await screen.findByRole("dialog", { name: /스크랩/ })).getByText(title)).toBeInTheDocument();
  });

  it("상세 헤더에서 ISO 저장 시각을 사람이 읽는 형식으로 표시한다", async () => {
    renderPage(
      repositoryOf({ tags: ["수집"], items: [{ id: "iso", kind: "text", title: "시각 검증", memo: "", tag: "수집", savedAt: "2026-08-27T00:38:50.792Z", url: null, mediaId: null, fileName: null, fileSize: null, comments: [] }] }),
      "/scrap?detail=iso",
    );
    const drawer = await screen.findByRole("dialog", { name: /스크랩/ });
    expect(within(drawer).getByText(/^\d{4}\. \d{2}\. \d{2}\. \d{2}:\d{2}$/)).toBeInTheDocument();
    expect(within(drawer).queryByText(/2026-08-27T/)).not.toBeInTheDocument();
  });

  it("상세의 웹 URL을 안전한 외부 링크로 연다", async () => {
    const url = "https://www.youtube.com/watch?v=rop5hVsowDQ&list=WL&index=3";
    const open = vi.fn(async () => {});
    renderPage(
      repositoryOf({ tags: ["수집"], items: [{ id: "link", kind: "url", title: "링크", memo: "", tag: "수집", savedAt: "오늘", url, mediaId: null, fileName: null, fileSize: null, comments: [] }] }),
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

  it("URL 스크랩 카드와 상세에 서버 링크 미리보기 이미지를 표시한다", async () => {
    const url = "https://example.com/article?id=1&lang=ko";
    renderPage(repositoryOf({ tags: ["수집"], items: [{ id: "link-preview", kind: "url", title: "관련 사진", memo: "", tag: "수집", savedAt: "오늘", url, mediaId: null, fileName: null, fileSize: null, comments: [] }] }));

    const card = await screen.findByRole("button", { name: /관련 사진/ });
    expect(await within(card).findByRole("presentation")).toHaveAttribute("src", "blob:mock");
    // 원격 서버 인증을 위해 <img src>가 아니라 토큰 헤더를 실은 fetch로 가져온다.
    expect(httpClient.httpGetBlob).toHaveBeenCalledWith(`/link-previews/image?url=${encodeURIComponent(url)}`);

    fireEvent.click(card);
    const drawer = await screen.findByRole("dialog", { name: /스크랩/ });
    expect(await within(drawer).findByRole("presentation")).toHaveAttribute("src", "blob:mock");
  });

  it("링크 미리보기 이미지를 못 받으면 플레이스홀더로 남는다", async () => {
    httpClient.httpGetBlob.mockRejectedValue(new Error("401"));
    renderPage(repositoryOf({ tags: ["수집"], items: [{ id: "no-preview", kind: "url", title: "미리보기 없음", memo: "", tag: "수집", savedAt: "오늘", url: "https://example.com/x", mediaId: null, fileName: null, fileSize: null, comments: [] }] }));

    const card = await screen.findByRole("button", { name: /미리보기 없음/ });
    expect(await within(card).findByText("링크 미리보기")).toBeInTheDocument();
    expect(within(card).queryByRole("presentation")).not.toBeInTheDocument();
  });

  it("프로토콜 없는 URL도 HTTPS로 정규화해 미리보기한다", async () => {
    renderPage(repositoryOf({ tags: ["수집"], items: [{ id: "bare-link", kind: "url", title: "프로토콜 없는 링크", memo: "", tag: "수집", savedAt: "오늘", url: "example.com/article", mediaId: null, fileName: null, fileSize: null, comments: [] }] }));

    await within(await screen.findByRole("button", { name: /프로토콜 없는 링크/ })).findByRole("presentation");
    expect(httpClient.httpGetBlob).toHaveBeenCalledWith(expect.stringContaining(encodeURIComponent("https://example.com/article")));
  });

  it("웹 URL이 아닌 값은 외부 링크로 만들지 않는다", async () => {
    const unsafeUrl = "javascript:alert('xss')";
    renderPage(repositoryOf({ tags: ["수집"], items: [{ id: "unsafe", kind: "url", title: "안전하지 않은 링크", memo: "", tag: "수집", savedAt: "오늘", url: unsafeUrl, mediaId: null, fileName: null, fileSize: null, comments: [] }] }), "/scrap?detail=unsafe");

    const drawer = await screen.findByRole("dialog", { name: /스크랩/ });
    expect(within(drawer).getByText(unsafeUrl)).toBeInTheDocument();
    expect(within(drawer).queryByRole("link", { name: unsafeUrl })).not.toBeInTheDocument();
  });

  it("댓글 URL을 외부 링크와 첫 링크의 썸네일 카드로 표시한다", async () => {
    const url = "https://www.youtube.com/watch?v=rop5hVsowDQ";
    const open = vi.fn(async () => {});
    renderPage(
      repositoryOf({
        tags: ["수집"],
        items: [{ id: "comment-link", kind: "text", title: "댓글 링크", memo: "", tag: "수집", savedAt: "오늘", url: null, mediaId: null, fileName: null, fileSize: null, comments: [{ id: "comment-link-1", createdAt: "오늘", text: `첫 줄\n${url}.`, file: null }] }],
      }),
      "/scrap?detail=comment-link",
      { open },
    );

    const drawer = await screen.findByRole("dialog", { name: /스크랩/ });
    const textLink = within(drawer).getByRole("link", { name: url });
    expect(textLink).toHaveAttribute("href", url);
    expect(textLink.closest("p")).toHaveTextContent(`첫 줄 ${url}.`);
    expect(await within(drawer).findByRole("link", { name: "youtube.com 링크 미리보기 열기" })).toBeInTheDocument();
    expect(httpClient.httpGetBlob).toHaveBeenCalledWith(`/link-previews/image?url=${encodeURIComponent(url)}`);

    fireEvent.click(textLink);
    expect(open).toHaveBeenCalledWith(url);
  });

  it("댓글의 ~~취소선~~ 마크다운을 <s>로 렌더한다", async () => {
    renderPage(
      repositoryOf({
        tags: ["수집"],
        items: [{ id: "comment-strike", kind: "text", title: "댓글 취소선", memo: "", tag: "수집", savedAt: "오늘", url: null, mediaId: null, fileName: null, fileSize: null, comments: [{ id: "comment-strike-1", createdAt: "오늘", text: "이건 ~~틀림~~ 맞음", file: null }] }],
      }),
      "/scrap?detail=comment-strike",
    );

    const drawer = await screen.findByRole("dialog", { name: /스크랩/ });
    const struck = within(drawer).getByText("틀림");
    expect(struck.tagName).toBe("S");
    expect(struck.closest("p")).toHaveTextContent("이건 틀림 맞음");
  });

  it("새 댓글은 Shift+Enter로 줄바꿈하고 Enter로 등록한다", async () => {
    const addComment = vi.fn(async () => {});
    renderPage(
      repositoryOf({ tags: ["수집"], items: [{ id: "comment-keyboard", kind: "text", title: "댓글 키보드", memo: "", tag: "수집", savedAt: "오늘", url: null, mediaId: null, fileName: null, fileSize: null, comments: [] }] }, { addComment }),
      "/scrap?detail=comment-keyboard",
    );

    const drawer = await screen.findByRole("dialog", { name: /스크랩/ });
    const textarea = within(drawer).getByRole("textbox", { name: "새 댓글" });
    fireEvent.change(textarea, { target: { value: "첫 줄" } });
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });
    expect(addComment).not.toHaveBeenCalled();

    fireEvent.change(textarea, { target: { value: "첫 줄\n둘째 줄" } });
    fireEvent.keyDown(textarea, { key: "Enter" });
    await waitFor(() => expect(addComment).toHaveBeenCalledWith("comment-keyboard", { text: "첫 줄\n둘째 줄" }));
  });

  it("댓글 수정도 Shift+Enter로 줄바꿈하고 Enter로 저장한다", async () => {
    const updateComment = vi.fn(async () => {});
    const text = "수정 전";
    renderPage(
      repositoryOf({ tags: ["수집"], items: [{ id: "edit-keyboard", kind: "text", title: "댓글 수정 키보드", memo: "", tag: "수집", savedAt: "오늘", url: null, mediaId: null, fileName: null, fileSize: null, comments: [{ id: "edit-keyboard-comment", createdAt: "오늘", text, file: null }] }] }, { updateComment }),
      "/scrap?detail=edit-keyboard",
    );

    const drawer = await screen.findByRole("dialog", { name: /스크랩/ });
    fireEvent.click(within(drawer).getByRole("button", { name: `${text} 댓글 수정` }));
    const textarea = within(drawer).getByRole("textbox", { name: "댓글 수정" });
    fireEvent.change(textarea, { target: { value: "수정 첫 줄" } });
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });
    expect(updateComment).not.toHaveBeenCalled();

    fireEvent.change(textarea, { target: { value: "수정 첫 줄\n수정 둘째 줄" } });
    fireEvent.keyDown(textarea, { key: "Enter" });
    await waitFor(() => expect(updateComment).toHaveBeenCalledWith("edit-keyboard", "edit-keyboard-comment", { text: "수정 첫 줄\n수정 둘째 줄" }, 1));
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
    await waitFor(() => expect(within(drawer).getByRole("textbox", { name: "새 댓글" })).not.toBeDisabled());
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

    await waitFor(async () => expect((await repository.getSnapshot()).items.find((item) => item.id === "scrap-1")?.comments.find((comment) => comment.id === "comment-1")?.text).toBe("마늘은 그대로 넣는 편이 낫다."));
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

  it("스크랩 상세에서 제목과 라벨을 인라인으로 수정한다", async () => {
    const repository = createMockScrapRepository();
    renderPage(repository);
    fireEvent.click(await screen.findByRole("button", { name: /합주실 후보 정리/ }));
    const drawer = await screen.findByRole("dialog", { name: /스크랩/ });

    fireEvent.click(within(drawer).getByRole("button", { name: "스크랩 수정" }));
    const title = within(drawer).getByRole("textbox", { name: "제목" });
    expect(title).toHaveValue("합주실 후보 정리");
    fireEvent.change(title, { target: { value: "합주실 후보 3곳" } });
    fireEvent.click(within(title.closest("form")!).getByRole("button", { name: "저장" }));

    expect(await within(drawer).findByText("합주실 후보 3곳")).toBeInTheDocument();
    expect((await repository.getSnapshot()).items.find((item) => item.id === "scrap-3")?.title).toBe("합주실 후보 3곳");
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
    expect(within(modal).getByRole("combobox", { name: "라벨" }).closest("fieldset")).toBeNull();
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

  it("수동으로 고른 사진을 업로드하고 이미지 스크랩으로 저장한다", async () => {
    const repository = createMockScrapRepository();
    const mediaStore: MediaStore = { save: vi.fn(async () => {}), load: vi.fn(async () => null), delete: vi.fn(async () => {}) };
    const mediaId = "00000000-0000-4000-8000-000000000001";
    vi.spyOn(crypto, "randomUUID").mockReturnValue(mediaId);
    renderPage(repository, "/scrap?modal=new", undefined, mediaStore);

    const modal = await screen.findByRole("dialog", { name: "스크랩 추가" });
    const photo = new File(["photo"], "여름 바다.png", { type: "image/png" });
    fireEvent.change(within(modal).getByLabelText("첨부 파일 선택"), { target: { files: [photo] } });

    expect(within(modal).getByRole("img", { name: "여름 바다.png 미리보기" })).toHaveAttribute("src", "blob:mock");
    expect(within(modal).getByRole("textbox", { name: "제목" })).toHaveValue("여름 바다");
    await waitFor(() => expect(within(modal).getByRole("button", { name: "교체" })).toHaveFocus());
    fireEvent.click(within(modal).getByRole("button", { name: "저장" }));

    await waitFor(() => expect(mediaStore.save).toHaveBeenCalledWith(mediaId, photo));
    expect(await screen.findByRole("button", { name: /여름 바다/ })).toBeInTheDocument();
    expect((await repository.getSnapshot()).items[0]).toMatchObject({ kind: "image", mediaId, title: "여름 바다" });
  });

  it("이미지가 아닌 파일을 업로드하면 file 종류로 저장하고 상세에 다운로드 칩을 띄운다", async () => {
    const repository = createMockScrapRepository();
    const mediaStore: MediaStore = { save: vi.fn(async () => {}), load: vi.fn(async () => "blob:doc"), delete: vi.fn(async () => {}) };
    const mediaId = "00000000-0000-4000-8000-0000000000ab";
    vi.spyOn(crypto, "randomUUID").mockReturnValue(mediaId);
    renderPage(repository, "/scrap?modal=new", undefined, mediaStore);

    const modal = await screen.findByRole("dialog", { name: "스크랩 추가" });
    const doc = new File(["report"], "1분기 보고서.pdf", { type: "application/pdf" });
    fireEvent.change(within(modal).getByLabelText("첨부 파일 선택"), { target: { files: [doc] } });
    expect(within(modal).queryByRole("img")).not.toBeInTheDocument();
    expect(within(modal).getByText("1분기 보고서.pdf")).toBeInTheDocument();
    fireEvent.click(within(modal).getByRole("button", { name: "저장" }));

    await waitFor(() => expect(mediaStore.save).toHaveBeenCalledWith(mediaId, doc));
    expect((await repository.getSnapshot()).items[0]).toMatchObject({ kind: "file", mediaId, fileName: "1분기 보고서.pdf", fileSize: 6 });

    fireEvent.click(await screen.findByRole("button", { name: /1분기 보고서/ }));
    const drawer = await screen.findByRole("dialog", { name: /스크랩/ });
    const chip = within(drawer).getByRole("link", { name: /1분기 보고서\.pdf/ });
    expect(chip).toHaveAttribute("download", "1분기 보고서.pdf");
  });

  it("사진 제거 후 보이는 사진 선택 버튼으로 focus를 복귀한다", async () => {
    renderPage(createMockScrapRepository(), "/scrap?modal=new");
    const modal = await screen.findByRole("dialog", { name: "스크랩 추가" });
    const input = within(modal).getByLabelText("첨부 파일 선택");
    expect(input).toHaveAttribute("tabindex", "-1");
    fireEvent.change(input, { target: { files: [new File(["photo"], "제거.png", { type: "image/png" })] } });

    const removeButton = within(modal).getByRole("button", { name: "제거.png 제거" });
    fireEvent.click(removeButton);

    const picker = within(modal).getByRole("button", { name: /파일 선택/ });
    await waitFor(() => expect(picker).toHaveFocus());
    expect(within(modal).queryByRole("img", { name: "제거.png 미리보기" })).not.toBeInTheDocument();
  });

  it("사진이 연결된 스크랩 저장 실패 시 업로드한 사진을 정리하고 입력을 보존한다", async () => {
    const base = await createMockScrapRepository().getSnapshot();
    const repository = repositoryOf(base, { create: vi.fn(async () => { throw new Error("스크랩 저장 실패"); }) });
    const mediaStore: MediaStore = { save: vi.fn(async () => {}), load: vi.fn(async () => null), delete: vi.fn(async () => {}) };
    const mediaId = "00000000-0000-4000-8000-000000000002";
    vi.spyOn(crypto, "randomUUID").mockReturnValue(mediaId);
    renderPage(repository, "/scrap?modal=new", undefined, mediaStore);

    const modal = await screen.findByRole("dialog", { name: "스크랩 추가" });
    const photo = new File(["photo"], "보존.png", { type: "image/png" });
    fireEvent.change(within(modal).getByLabelText("첨부 파일 선택"), { target: { files: [photo] } });
    fireEvent.click(within(modal).getByRole("button", { name: "저장" }));

    expect(await within(modal).findByRole("alert")).toHaveTextContent("스크랩 저장 실패");
    expect(mediaStore.delete).toHaveBeenCalledWith(mediaId);
    expect(within(modal).getByRole("img", { name: "보존.png 미리보기" })).toBeInTheDocument();
    expect(within(modal).getByRole("textbox", { name: "제목" })).toHaveValue("보존");
  });

  it("스크랩 상세에서 사진을 교체하면 새 미디어를 올리고 저장한다", async () => {
    const snapshot: ScrapSnapshot = {
      tags: ["수집", "기타"],
      items: [{ id: "img", kind: "image", title: "포스터", memo: "", tag: "수집", savedAt: "오늘", url: null, mediaId: "11111111-1111-4111-8111-111111111111", fileName: null, fileSize: null, comments: [] }],
    };
    const repository = repositoryOf(snapshot, {
      update: vi.fn(async (id, input) => {
        const item = snapshot.items.find((candidate) => candidate.id === id)!;
        item.title = input.title;
        item.mediaId = input.mediaId ?? null;
        item.kind = input.mediaId ? "image" : "text";
      }),
    });
    const mediaStore: MediaStore = { save: vi.fn(async () => {}), load: vi.fn(async () => "blob:existing"), delete: vi.fn(async () => {}) };
    vi.spyOn(crypto, "randomUUID").mockReturnValue("22222222-2222-4222-8222-222222222222");
    renderPage(repository, "/scrap?detail=img", undefined, mediaStore);

    const drawer = await screen.findByRole("dialog", { name: /스크랩/ });
    fireEvent.click(within(drawer).getByRole("button", { name: "스크랩 수정" }));
    const photo = new File(["p"], "새포스터.png", { type: "image/png" });
    fireEvent.change(within(drawer).getByLabelText("첨부 파일 선택"), { target: { files: [photo] } });
    fireEvent.click(within(within(drawer).getByRole("textbox", { name: "제목" }).closest("form")!).getByRole("button", { name: "저장" }));

    await waitFor(() => expect(mediaStore.save).toHaveBeenCalledWith("22222222-2222-4222-8222-222222222222", photo));
    expect(repository.update).toHaveBeenCalledWith("img", expect.objectContaining({ mediaId: "22222222-2222-4222-8222-222222222222" }));
  });

  it("스크랩 상세에서 사진을 제거하면 mediaId 없이 저장한다", async () => {
    const snapshot: ScrapSnapshot = {
      tags: ["수집", "기타"],
      items: [{ id: "img", kind: "image", title: "포스터", memo: "", tag: "수집", savedAt: "오늘", url: null, mediaId: "11111111-1111-4111-8111-111111111111", fileName: null, fileSize: null, comments: [] }],
    };
    const repository = repositoryOf(snapshot, { update: vi.fn(async () => {}) });
    const mediaStore: MediaStore = { save: vi.fn(async () => {}), load: vi.fn(async () => "blob:existing"), delete: vi.fn(async () => {}) };
    renderPage(repository, "/scrap?detail=img", undefined, mediaStore);

    const drawer = await screen.findByRole("dialog", { name: /스크랩/ });
    fireEvent.click(within(drawer).getByRole("button", { name: "스크랩 수정" }));
    fireEvent.click(within(drawer).getByRole("button", { name: "첨부 제거" }));
    fireEvent.click(within(within(drawer).getByRole("textbox", { name: "제목" }).closest("form")!).getByRole("button", { name: "저장" }));

    await waitFor(() => expect(repository.update).toHaveBeenCalledWith("img", expect.objectContaining({ mediaId: null })));
    expect(mediaStore.save).not.toHaveBeenCalled();
  });

  it("라벨 관리 Modal에서 기존 라벨 이름을 바꾸면 목록과 필터에 반영된다", async () => {
    const repository = createMockScrapRepository();
    renderPage(repository, "/scrap?modal=new");
    const modal = await screen.findByRole("dialog", { name: "스크랩 추가" });
    fireEvent.click(within(modal).getByRole("button", { name: "관리" }));
    const manager = await screen.findByRole("dialog", { name: "라벨 관리" });

    fireEvent.click(within(manager).getByRole("button", { name: "요리 편집" }));
    expect(within(manager).getByRole("textbox", { name: "라벨 이름" })).toHaveValue("요리");
    expect(within(manager).getByText("라벨 수정")).toBeInTheDocument();

    fireEvent.change(within(manager).getByRole("textbox", { name: "라벨 이름" }), { target: { value: "레시피" } });
    fireEvent.click(within(manager).getByRole("button", { name: "저장" }));

    await waitFor(() => expect(within(manager).queryByText("요리")).not.toBeInTheDocument());
    expect(within(manager).getByText("레시피")).toBeInTheDocument();

    const snapshot = await repository.getSnapshot();
    expect(snapshot.tags).not.toContain("요리");
    expect(snapshot.tags).toContain("레시피");
    expect(snapshot.items.filter((item) => item.tag === "요리")).toHaveLength(0);
  });

  it("라벨 관리 Modal에서 라벨을 삭제하면 참조하던 스크랩이 대체 라벨로 옮겨간다", async () => {
    const repository = createMockScrapRepository();
    renderPage(repository, "/scrap?modal=new");
    const modal = await screen.findByRole("dialog", { name: "스크랩 추가" });
    fireEvent.click(within(modal).getByRole("button", { name: "관리" }));
    const manager = await screen.findByRole("dialog", { name: "라벨 관리" });

    expect(within(manager).getByRole("button", { name: "기타 삭제 불가" })).toBeDisabled();

    fireEvent.click(within(manager).getByRole("button", { name: "요리 삭제" }));
    const confirmation = await screen.findByRole("dialog", { name: "라벨 삭제" });
    expect(within(confirmation).getByRole("combobox", { name: "이동할 라벨" })).toBeInTheDocument();
    fireEvent.click(within(confirmation).getByRole("button", { name: "삭제" }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "라벨 삭제" })).not.toBeInTheDocument());
    const snapshot = await repository.getSnapshot();
    expect(snapshot.tags).not.toContain("요리");
    expect(snapshot.items.filter((item) => item.tag === "요리")).toHaveLength(0);
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

  it("댓글에 파일을 첨부해 업로드하고 mediaId·이름·크기와 함께 등록한다", async () => {
    const addComment = vi.fn(async () => {});
    const mediaStore: MediaStore = { save: vi.fn(async () => {}), load: vi.fn(async () => "blob:file"), delete: vi.fn(async () => {}) };
    const mediaId = "00000000-0000-4000-8000-0000000000fa";
    vi.spyOn(crypto, "randomUUID").mockReturnValue(mediaId);
    renderPage(
      repositoryOf({ tags: ["수집"], items: [{ id: "with-file", kind: "text", title: "파일 댓글", memo: "", tag: "수집", savedAt: "오늘", url: null, mediaId: null, fileName: null, fileSize: null, comments: [] }] }, { addComment }),
      "/scrap?detail=with-file",
      undefined,
      mediaStore,
    );
    const drawer = await screen.findByRole("dialog", { name: /스크랩/ });
    const file = new File(["hello"], "보고서.pdf", { type: "application/pdf" });
    fireEvent.change(within(drawer).getByLabelText("댓글 파일 선택"), { target: { files: [file] } });
    expect(within(drawer).getByText("보고서.pdf")).toBeInTheDocument();

    fireEvent.click(within(drawer).getByRole("button", { name: "댓글" }));

    await waitFor(() => expect(mediaStore.save).toHaveBeenCalledWith(mediaId, file));
    expect(addComment).toHaveBeenCalledWith("with-file", { text: "", file: { mediaId, name: "보고서.pdf", size: 5 } });
  });
});
