import "@testing-library/jest-dom/vitest";

function createMemoryStorage(): Storage {
  const store = new Map<string, string>();

  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key) {
      return store.get(key) ?? null;
    },
    key(index) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key) {
      store.delete(key);
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
  };
}

function ensureStorage(name: "localStorage" | "sessionStorage"): void {
  const existing = globalThis[name];
  if (existing && typeof existing.getItem === "function") {
    return;
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
}

ensureStorage("localStorage");
ensureStorage("sessionStorage");
