/** Dispatched on window whenever a change is added to the outbox on this device. */
export const OUTBOX_CHANGED_EVENT = "account-tracker:outbox-changed";

export function notifyOutboxChanged() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(OUTBOX_CHANGED_EVENT));
}
