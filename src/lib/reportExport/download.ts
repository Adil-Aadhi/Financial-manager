/** Save a generated file. The object URL lives only until the browser has started the download. */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.rel = "noopener";
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    // Revoking synchronously can cancel the download in Safari; a short delay is enough.
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }
}

/**
 * iPhone / iPad (including iPadOS, which reports itself as a Mac). On iOS, `<a download>` with
 * a blob opens the file as a full-screen page instead of saving it, and in an installed PWA
 * there is no back button to leave it. The share sheet ("Save to Files") is the reliable path.
 */
export function isAppleMobile() {
  if (typeof navigator === "undefined") return false;
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

/** The File handed to the share sheet; the MIME type must not carry parameters (";charset=…"). */
function toFile(blob: Blob, filename: string) {
  return new File([blob], filename, { type: blob.type.split(";")[0] || "application/octet-stream" });
}

/** The system share sheet (iOS "Save to Files"), when the browser can share this file. */
export function canShareFile(blob: Blob, filename: string) {
  if (typeof navigator === "undefined" || typeof navigator.canShare !== "function") return false;
  try {
    return navigator.canShare({ files: [toFile(blob, filename)] });
  } catch {
    return false;
  }
}

/** Use the share sheet instead of a download (iOS, when file sharing is available). */
export function shouldUseShareSheet(blob: Blob, filename: string) {
  return isAppleMobile() && canShareFile(blob, filename);
}

/**
 * Must be called from a tap: iOS only opens the share sheet with fresh user activation.
 * Resolves false when the user cancelled; rethrows real failures.
 */
export async function shareBlob(blob: Blob, filename: string) {
  try {
    await navigator.share({ files: [toFile(blob, filename)], title: filename });
    return true;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return false;
    throw error;
  }
}
