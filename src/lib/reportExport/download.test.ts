import { afterEach, describe, expect, it, vi } from "vitest";
import { isAppleMobile, shareBlob, shouldUseShareSheet } from "@/lib/reportExport/download";

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";
const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36";

function stubNavigator(values: Partial<Navigator>) {
  vi.stubGlobal("navigator", { userAgent: "", platform: "", maxTouchPoints: 0, ...values });
}

afterEach(() => vi.unstubAllGlobals());

describe("iOS file saving", () => {
  const blob = new Blob(["a,b"], { type: "text/csv;charset=utf-8" });

  it("detects iPhone and iPadOS (which reports itself as a Mac with touch)", () => {
    stubNavigator({ userAgent: IPHONE });
    expect(isAppleMobile()).toBe(true);
    stubNavigator({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", platform: "MacIntel", maxTouchPoints: 5 });
    expect(isAppleMobile()).toBe(true);
    stubNavigator({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", platform: "MacIntel", maxTouchPoints: 0 });
    expect(isAppleMobile()).toBe(false);
    stubNavigator({ userAgent: ANDROID });
    expect(isAppleMobile()).toBe(false);
  });

  it("uses the share sheet only on iOS when the file can be shared, without MIME parameters", () => {
    const canShare = vi.fn(() => true);
    stubNavigator({ userAgent: IPHONE, canShare });
    expect(shouldUseShareSheet(blob, "Finance_Report_2026-11.csv")).toBe(true);
    const file = (canShare.mock.calls[0] as unknown as [{ files: File[] }])[0].files[0];
    expect(file.type).toBe("text/csv");
    expect(file.name).toBe("Finance_Report_2026-11.csv");

    stubNavigator({ userAgent: IPHONE, canShare: () => false });
    expect(shouldUseShareSheet(blob, "x.csv")).toBe(false); // falls back to a download
    stubNavigator({ userAgent: ANDROID, canShare: () => true });
    expect(shouldUseShareSheet(blob, "x.csv")).toBe(false); // Android downloads normally
  });

  it("treats a cancelled share sheet as no-op and rethrows real failures", async () => {
    stubNavigator({ userAgent: IPHONE, share: () => Promise.reject(new DOMException("cancel", "AbortError")) });
    await expect(shareBlob(blob, "x.csv")).resolves.toBe(false);
    stubNavigator({ userAgent: IPHONE, share: () => Promise.reject(new DOMException("no gesture", "NotAllowedError")) });
    await expect(shareBlob(blob, "x.csv")).rejects.toThrow("no gesture");
    stubNavigator({ userAgent: IPHONE, share: () => Promise.resolve() });
    await expect(shareBlob(blob, "x.csv")).resolves.toBe(true);
  });
});
