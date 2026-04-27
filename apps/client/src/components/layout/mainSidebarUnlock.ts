import type { SidebarSection } from "@/stores";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export const HIDDEN_NAV_UNLOCK_STORAGE_KEY =
  "team9.main-sidebar.hidden-nav.unlocked";
export const HIDDEN_NAV_TAP_COUNT_STORAGE_KEY =
  "team9.main-sidebar.hidden-nav.more-tap-count";
export const MORE_TAP_UNLOCK_THRESHOLD = 5;

export const HIDDEN_NAV_SECTION_IDS = [
  "skills",
  "resources",
  "wiki",
] as const satisfies readonly SidebarSection[];

const HIDDEN_NAV_SECTION_SET = new Set<string>(HIDDEN_NAV_SECTION_IDS);

function getStorage(storage?: StorageLike): StorageLike | null {
  if (storage) return storage;

  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

function getTapCount(storage?: StorageLike): number {
  const storageRef = getStorage(storage);
  if (!storageRef) return 0;

  const rawValue = storageRef.getItem(HIDDEN_NAV_TAP_COUNT_STORAGE_KEY);
  const count = Number.parseInt(rawValue ?? "0", 10);
  return Number.isFinite(count) && count > 0 ? count : 0;
}

export function isHiddenNavUnlocked(storage?: StorageLike): boolean {
  const storageRef = getStorage(storage);
  if (!storageRef) return false;

  return storageRef.getItem(HIDDEN_NAV_UNLOCK_STORAGE_KEY) === "true";
}

export function registerMoreTapUnlock(storage?: StorageLike): boolean {
  const storageRef = getStorage(storage);
  if (!storageRef) return false;

  if (isHiddenNavUnlocked(storageRef)) {
    return true;
  }

  const nextTapCount = getTapCount(storageRef) + 1;

  if (nextTapCount >= MORE_TAP_UNLOCK_THRESHOLD) {
    storageRef.setItem(HIDDEN_NAV_UNLOCK_STORAGE_KEY, "true");
    storageRef.removeItem(HIDDEN_NAV_TAP_COUNT_STORAGE_KEY);
    return true;
  }

  storageRef.setItem(HIDDEN_NAV_TAP_COUNT_STORAGE_KEY, String(nextTapCount));
  return false;
}

export function getVisibleNavigationItems<T extends { id: string }>(
  items: readonly T[],
  hiddenNavUnlocked: boolean,
): T[] {
  if (hiddenNavUnlocked) {
    return [...items];
  }

  return items.filter((item) => !HIDDEN_NAV_SECTION_SET.has(item.id));
}
