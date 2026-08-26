import { inboxUpdateInputSchema } from "@mono/contracts";
import { describe, expect, it } from "vitest";
import { createMockInboxRepository } from "./mock-inbox-repository";

describe("MockInboxRepository", () => {
  it("루틴을 수집함 등록 대상으로 허용하지 않는다", () => {
    const result = inboxUpdateInputSchema.safeParse({
      target: "routine",
      fields: [{ label: "제목", value: "저녁 산책" }],
    });

    expect(result.success).toBe(false);
  });

  it("계약을 만족하는 수집함 스냅샷을 반환한다", async () => {
    const repository = createMockInboxRepository();
    const snapshot = await repository.getSnapshot();

    expect(snapshot.items).toHaveLength(5);
    expect(snapshot.items.filter((item) => item.status === "pending")).toHaveLength(4);
  });

  it("단일 항목을 승인한다", async () => {
    const repository = createMockInboxRepository();

    await repository.approve("inbox-1");
    const snapshot = await repository.getSnapshot();

    expect(snapshot.items.find((item) => item.id === "inbox-1")?.status).toBe("approved");
  });

  it("기준 이상 확신도 항목을 일괄 승인한다", async () => {
    const repository = createMockInboxRepository();

    await repository.approveHighConfidence(0.9);
    const snapshot = await repository.getSnapshot();

    expect(snapshot.items.find((item) => item.id === "inbox-1")?.status).toBe("approved");
    expect(snapshot.items.find((item) => item.id === "inbox-2")?.status).toBe("approved");
    expect(snapshot.items.find((item) => item.id === "inbox-3")?.status).toBe("pending");
  });

  it("필드와 대상을 수정해 실패 항목을 대기 상태로 돌린다", async () => {
    const repository = createMockInboxRepository();

    await repository.update("inbox-5", {
      target: "scrap",
      fields: [
        { label: "제목", value: "손글씨 메모" },
        { label: "메모", value: "직접 확인 필요" },
      ],
    });
    const snapshot = await repository.getSnapshot();
    const item = snapshot.items.find((candidate) => candidate.id === "inbox-5");

    expect(item).toMatchObject({ target: "scrap", status: "pending", confidence: 0.9 });
    expect(item?.fields[0].value).toBe("손글씨 메모");
  });

  it("항목을 버린다", async () => {
    const repository = createMockInboxRepository();

    await repository.discard("inbox-4");
    const snapshot = await repository.getSnapshot();

    expect(snapshot.items.some((item) => item.id === "inbox-4")).toBe(false);
  });
});
