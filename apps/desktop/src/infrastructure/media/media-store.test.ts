import { afterEach, describe, expect, it, vi } from "vitest";
import { newMediaId } from "./media-store";

const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

afterEach(() => vi.unstubAllGlobals());

describe("newMediaId", () => {
  it("crypto.randomUUID가 있으면 그걸 쓴다", () => {
    expect(newMediaId()).toMatch(uuidV4);
  });

  it("crypto.randomUUID가 없어도 getRandomValues로 v4 UUID를 만든다", () => {
    vi.stubGlobal("crypto", {
      getRandomValues: (array: Uint8Array) => {
        for (let index = 0; index < array.length; index += 1) array[index] = index;
        return array;
      },
    });
    const id = newMediaId();
    expect(id).toMatch(uuidV4);
    // version nibble = 4, variant nibble ∈ {8,9,a,b}
    expect(id[14]).toBe("4");
    expect("89ab").toContain(id[19]);
  });
});
