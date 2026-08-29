import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// jsdom은 object URL을 구현하지 않는다 — 미디어·링크 미리보기 이미지가 쓴다.
if (typeof URL.createObjectURL !== "function") {
  URL.createObjectURL = () => "blob:mock";
  URL.revokeObjectURL = () => {};
}

// 일부 Node 런타임은 경로 없이 활성화된 내장 localStorage를 노출한다. jsdom 대신 잡히면
// Storage 메서드가 없으므로 테스트용 구현으로 교체한다.
if (typeof localStorage.clear !== "function") {
  const values = new Map<string, string>();
  const testLocalStorage: Storage = {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, String(value)); },
  };
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: testLocalStorage });
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  delete document.documentElement.dataset.theme;
  document.documentElement.style.removeProperty("--color-accent");
  document.documentElement.style.removeProperty("--color-accent-foreground");
});
