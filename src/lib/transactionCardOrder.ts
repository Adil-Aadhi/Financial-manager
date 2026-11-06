/**
 * Custom transaction card ordering helpers and localStorage persistence.
 *
 * Isolated purely to client-side UI preference storage.
 * Does not mutate database records, Supabase, Dexie, or sync state.
 */

export const TRANSACTION_CARD_ORDER_STORAGE_KEY_V1 =
  "ft_transactions_card_order_v1";

const listeners = new Set<() => void>();

export function notifyCardOrderChange() {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // Ignore listener errors
    }
  }
}

export function subscribeToCardOrder(callback: () => void) {
  listeners.add(callback);
  const handleStorage = (event: StorageEvent) => {
    if (event.key?.startsWith(TRANSACTION_CARD_ORDER_STORAGE_KEY_V1)) {
      callback();
    }
  };
  if (typeof window !== "undefined") {
    window.addEventListener("storage", handleStorage);
  }
  return () => {
    listeners.delete(callback);
    if (typeof window !== "undefined") {
      window.removeEventListener("storage", handleStorage);
    }
  };
}

/**
 * Returns a versioned, user-scoped storage key to prevent collision
 * across multiple user profiles on the same device.
 */
export function getCardOrderStorageKey(ownerId?: string | null): string {
  if (ownerId && typeof ownerId === "string" && ownerId.trim().length > 0) {
    return `${TRANSACTION_CARD_ORDER_STORAGE_KEY_V1}:${ownerId.trim()}`;
  }
  return TRANSACTION_CARD_ORDER_STORAGE_KEY_V1;
}

/**
 * Safely loads the saved card order from localStorage.
 * Returns an empty array if unavailable, empty, or corrupted.
 */
export function loadCardOrder(ownerId?: string | null): string[] {
  try {
    if (typeof window === "undefined" || !window.localStorage) {
      return [];
    }
    const key = getCardOrderStorageKey(ownerId);
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    const seen = new Set<string>();
    const sanitized: string[] = [];
    for (const item of parsed) {
      if (typeof item === "string") {
        const trimmed = item.trim();
        if (trimmed.length > 0 && !seen.has(trimmed)) {
          seen.add(trimmed);
          sanitized.push(trimmed);
        }
      }
    }
    return sanitized;
  } catch (error) {
    console.warn("Unable to load transaction card order from localStorage:", error);
    return [];
  }
}

/**
 * Safely saves the custom card order array to localStorage.
 * Returns true on success or false if localStorage throws an error.
 */
export function saveCardOrder(
  ownerId: string | null | undefined,
  order: string[]
): boolean {
  try {
    if (typeof window === "undefined" || !window.localStorage) {
      return false;
    }
    const seen = new Set<string>();
    const sanitized: string[] = [];
    for (const item of order) {
      if (typeof item === "string") {
        const trimmed = item.trim();
        if (trimmed.length > 0 && !seen.has(trimmed)) {
          seen.add(trimmed);
          sanitized.push(trimmed);
        }
      }
    }

    const key = getCardOrderStorageKey(ownerId);
    window.localStorage.setItem(key, JSON.stringify(sanitized));
    notifyCardOrderChange();
    return true;
  } catch (error) {
    console.warn("Unable to save transaction card order to localStorage:", error);
    return false;
  }
}

/**
 * Clears the saved custom card order from localStorage.
 */
export function clearCardOrder(ownerId?: string | null): boolean {
  try {
    if (typeof window === "undefined" || !window.localStorage) {
      return false;
    }
    const key = getCardOrderStorageKey(ownerId);
    window.localStorage.removeItem(key);
    notifyCardOrderChange();
    return true;
  } catch (error) {
    console.warn("Unable to clear transaction card order from localStorage:", error);
    return false;
  }
}

/**
 * Applies a custom ordering to a list of items having an `id` field.
 *
 * Rules:
 * 1. If savedOrder is empty, returns items in their default arrangement.
 * 2. Items found in savedOrder are sorted according to their position in savedOrder.
 * 3. Newly introduced items (not present in savedOrder) are appended at the end
 *    preserving their original relative order.
 * 4. Obsolete IDs in savedOrder (not in items) are safely ignored.
 */
export function applyCardOrder<T extends { id: string }>(
  items: T[],
  savedOrder: string[] | null | undefined
): T[] {
  if (!savedOrder || savedOrder.length === 0 || items.length <= 1) {
    return [...items];
  }

  const orderMap = new Map<string, number>();
  let rank = 0;
  for (const id of savedOrder) {
    if (typeof id === "string" && id.trim().length > 0 && !orderMap.has(id)) {
      orderMap.set(id, rank++);
    }
  }

  const knownItems: T[] = [];
  const newItems: T[] = [];

  for (const item of items) {
    if (orderMap.has(item.id)) {
      knownItems.push(item);
    } else {
      newItems.push(item);
    }
  }

  knownItems.sort((a, b) => (orderMap.get(a.id) ?? 0) - (orderMap.get(b.id) ?? 0));

  return [...knownItems, ...newItems];
}

/**
 * Merges a newly reordered subset of visible IDs with any other previously
 * saved card IDs (e.g. from other tabs/groups).
 */
export function mergeCardOrder(
  currentSavedOrder: string[],
  reorderedVisibleIds: string[]
): string[] {
  const visibleSet = new Set(reorderedVisibleIds);
  const remaining = currentSavedOrder.filter((id) => !visibleSet.has(id));
  return [...reorderedVisibleIds, ...remaining];
}

/**
 * Checks whether the current arrangement differs from the default arrangement.
 */
export function hasCustomCardOrder<T extends { id: string }>(
  defaultItems: T[],
  currentItems: T[]
): boolean {
  if (defaultItems.length !== currentItems.length) return false;
  for (let i = 0; i < defaultItems.length; i++) {
    if (defaultItems[i].id !== currentItems[i].id) {
      return true;
    }
  }
  return false;
}
