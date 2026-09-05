import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// jsdom doesn't implement object URLs — used by media and link-preview images.
if (typeof URL.createObjectURL !== "function") {
  URL.createObjectURL = () => "blob:mock";
  URL.revokeObjectURL = () => {};
}

// Some Node runtimes expose a built-in localStorage enabled without a path. If it gets picked up instead of jsdom's,
// it lacks the Storage methods, so it's swapped for a test implementation.
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
