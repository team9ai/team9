import "@testing-library/jest-dom/vitest";
import { beforeEach } from "vitest";

function createMemoryStorage(): Storage {
  let store = new Map<string, string>();

  return {
    get length() {
      return store.size;
    },
    clear() {
      store = new Map<string, string>();
    },
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
  };
}

function ensureWebStorage(name: "localStorage" | "sessionStorage") {
  const storage = globalThis[name];
  if (storage && typeof storage.getItem === "function") {
    return storage;
  }

  const fallback = createMemoryStorage();
  Object.defineProperty(globalThis, name, {
    value: fallback,
    configurable: true,
  });
  return fallback;
}

const localStorageRef = ensureWebStorage("localStorage");
const sessionStorageRef = ensureWebStorage("sessionStorage");

beforeEach(() => {
  localStorageRef.clear();
  sessionStorageRef.clear();
});
