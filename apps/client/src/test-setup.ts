import "@testing-library/jest-dom/vitest";
import { beforeEach } from "vitest";
// Initialize i18next once for the test environment so components that call
// `useTranslation(...)` receive real translations. Tests that prefer to
// bypass translation can still `vi.mock("react-i18next", ...)` locally;
// that mock continues to take precedence over the real module.
import "@/i18n";

function createMemoryStorage(): Storage {
  const store = new Map<string, string>();

  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
  };
}

function ensureStorage(name: "localStorage" | "sessionStorage") {
  const existing = globalThis[name];
  if (existing && typeof existing.getItem === "function") {
    return existing;
  }

  const storage = createMemoryStorage();

  Object.defineProperty(globalThis, name, {
    value: storage,
    configurable: true,
  });

  if (typeof window !== "undefined") {
    Object.defineProperty(window, name, {
      value: storage,
      configurable: true,
    });
  }

  return storage;
}

const localStorageRef = ensureStorage("localStorage");
const sessionStorageRef = ensureStorage("sessionStorage");

beforeEach(() => {
  localStorageRef.clear();
  sessionStorageRef.clear();
});
