import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  TRANSACTION_CARD_ORDER_STORAGE_KEY_V1,
  getCardOrderStorageKey,
  loadCardOrder,
  saveCardOrder,
  clearCardOrder,
  applyCardOrder,
  mergeCardOrder,
  hasCustomCardOrder,
} from "./transactionCardOrder";

class MockStorage {
  store = new Map<string, string>();
  getItem(key: string) {
    return this.store.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.store.set(key, String(value));
  }
  removeItem(key: string) {
    this.store.delete(key);
  }
  clear() {
    this.store.clear();
  }
}

describe("transactionCardOrder", () => {
  const ownerId = "user-123";
  let mockStorage: MockStorage;

  beforeEach(() => {
    mockStorage = new MockStorage();
    (globalThis as unknown as { window?: { localStorage?: MockStorage } }).window = {
      localStorage: mockStorage,
    };
    vi.restoreAllMocks();
  });

  afterEach(() => {
    delete (globalThis as unknown as { window?: unknown }).window;
  });

  describe("getCardOrderStorageKey", () => {
    it("returns versioned key with ownerId when provided", () => {
      expect(getCardOrderStorageKey(ownerId)).toBe(
        `${TRANSACTION_CARD_ORDER_STORAGE_KEY_V1}:user-123`
      );
    });

    it("returns default versioned key when ownerId is missing or empty", () => {
      expect(getCardOrderStorageKey()).toBe(
        TRANSACTION_CARD_ORDER_STORAGE_KEY_V1
      );
      expect(getCardOrderStorageKey("")).toBe(
        TRANSACTION_CARD_ORDER_STORAGE_KEY_V1
      );
      expect(getCardOrderStorageKey(null)).toBe(
        TRANSACTION_CARD_ORDER_STORAGE_KEY_V1
      );
    });
  });

  describe("applyCardOrder", () => {
    const items = [
      { id: "acc-1", name: "Savings" },
      { id: "acc-2", name: "Checking" },
      { id: "acc-3", name: "Credit Card" },
    ];

    it("preserves default arrangement when no saved order exists", () => {
      expect(applyCardOrder(items, null)).toEqual(items);
      expect(applyCardOrder(items, [])).toEqual(items);
      expect(applyCardOrder(items, undefined)).toEqual(items);
    });

    it("orders cards according to saved order", () => {
      const savedOrder = ["acc-3", "acc-1", "acc-2"];
      const reordered = applyCardOrder(items, savedOrder);
      expect(reordered.map((i) => i.id)).toEqual(["acc-3", "acc-1", "acc-2"]);
    });

    it("appends newly introduced cards at the end in their default relative order", () => {
      // acc-4 and acc-5 are new
      const allItems = [
        ...items,
        { id: "acc-4", name: "Investment" },
        { id: "acc-5", name: "Cash" },
      ];
      const savedOrder = ["acc-2", "acc-1", "acc-3"];
      const reordered = applyCardOrder(allItems, savedOrder);

      expect(reordered.map((i) => i.id)).toEqual([
        "acc-2",
        "acc-1",
        "acc-3",
        "acc-4",
        "acc-5",
      ]);
    });

    it("ignores obsolete or deleted card IDs from saved order", () => {
      const savedOrder = ["acc-obsolete-1", "acc-2", "acc-obsolete-2", "acc-1"];
      const reordered = applyCardOrder(items, savedOrder);

      // acc-3 was not in savedOrder, so it is appended after acc-2 and acc-1
      expect(reordered.map((i) => i.id)).toEqual(["acc-2", "acc-1", "acc-3"]);
    });

    it("deduplicates IDs in saved order gracefully", () => {
      const savedOrder = ["acc-2", "acc-2", "acc-1"];
      const reordered = applyCardOrder(items, savedOrder);
      expect(reordered.map((i) => i.id)).toEqual(["acc-2", "acc-1", "acc-3"]);
    });
  });

  describe("mergeCardOrder", () => {
    it("preserves IDs from other tabs while applying new visible order", () => {
      const currentSaved = ["general-1", "primary-1", "general-2", "primary-2"];
      const newPrimaryOrder = ["primary-2", "primary-1"];

      const merged = mergeCardOrder(currentSaved, newPrimaryOrder);
      expect(merged).toEqual([
        "primary-2",
        "primary-1",
        "general-1",
        "general-2",
      ]);
    });
  });

  describe("hasCustomCardOrder", () => {
    const defaultItems = [{ id: "1" }, { id: "2" }, { id: "3" }];

    it("returns false when arrangement matches default", () => {
      expect(hasCustomCardOrder(defaultItems, [{ id: "1" }, { id: "2" }, { id: "3" }])).toBe(
        false
      );
    });

    it("returns true when arrangement differs from default", () => {
      expect(hasCustomCardOrder(defaultItems, [{ id: "2" }, { id: "1" }, { id: "3" }])).toBe(
        true
      );
    });
  });

  describe("localStorage persistence", () => {
    it("saves, loads, and clears card order accurately", () => {
      const order = ["acc-a", "acc-b", "acc-c"];
      expect(saveCardOrder(ownerId, order)).toBe(true);

      const loaded = loadCardOrder(ownerId);
      expect(loaded).toEqual(["acc-a", "acc-b", "acc-c"]);

      expect(clearCardOrder(ownerId)).toBe(true);
      expect(loadCardOrder(ownerId)).toEqual([]);
    });

    it("handles corrupted or invalid JSON in localStorage gracefully without throwing", () => {
      const key = getCardOrderStorageKey(ownerId);

      // Corrupted syntax
      mockStorage.setItem(key, "invalid-json{");
      expect(loadCardOrder(ownerId)).toEqual([]);

      // Non-array JSON
      mockStorage.setItem(key, JSON.stringify({ not: "an array" }));
      expect(loadCardOrder(ownerId)).toEqual([]);

      // Array with non-strings
      mockStorage.setItem(key, JSON.stringify([123, null, "", "valid-id"]));
      expect(loadCardOrder(ownerId)).toEqual(["valid-id"]);
    });

    it("gracefully catches exceptions if localStorage throws (e.g. quota exceeded)", () => {
      vi.spyOn(mockStorage, "setItem").mockImplementation(() => {
        throw new Error("QuotaExceededError");
      });

      const success = saveCardOrder(ownerId, ["acc-1"]);
      expect(success).toBe(false);
    });
  });
});
