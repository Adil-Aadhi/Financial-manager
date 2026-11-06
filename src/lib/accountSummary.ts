/** Old database rows and IndexedDB records predate this flag and remain included. */
export function normalizeIncludeInSummary(value: unknown) {
  return value !== false;
}

/** Return a field value only when the form made an effective inclusion change. */
export function changedIncludeInSummary(
  initialValue: unknown,
  currentValue: boolean
): boolean | undefined {
  return normalizeIncludeInSummary(initialValue) === currentValue
    ? undefined
    : currentValue;
}
