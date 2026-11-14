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

/** The system share sheet (iOS "Save to Files"), when the browser can share this file. */
export function canShareFile(blob: Blob, filename: string) {
  if (typeof navigator === "undefined" || typeof navigator.canShare !== "function") return false;
  try {
    return navigator.canShare({ files: [new File([blob], filename, { type: blob.type })] });
  } catch {
    return false;
  }
}

export async function shareBlob(blob: Blob, filename: string) {
  const file = new File([blob], filename, { type: blob.type });
  await navigator.share({ files: [file], title: filename });
}
