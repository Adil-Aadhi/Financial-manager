/** Cookie the root layout writes with the browser's IANA time zone. */
export const TIME_ZONE_COOKIE = "ft-tz";

/** Used before the browser has reported its time zone (first visit). */
export const DEFAULT_TIME_ZONE = "Asia/Kolkata";

/**
 * Runs in <head>: stores the device time zone so server pages can use the
 * user's local calendar month. Tiny and dependency-free.
 */
export const timeZoneCookieScript = `(function(){try{var z=Intl.DateTimeFormat().resolvedOptions().timeZone;if(z&&document.cookie.indexOf("${TIME_ZONE_COOKIE}="+encodeURIComponent(z))<0){document.cookie="${TIME_ZONE_COOKIE}="+encodeURIComponent(z)+";path=/;max-age=31536000;samesite=lax"}}catch(e){}})()`;

export function resolveTimeZone(value?: string | null) {
  if (!value) return DEFAULT_TIME_ZONE;
  try {
    const zone = decodeURIComponent(value);
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return zone;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}

export interface MonthRange {
  /** "YYYY-MM", for matching transaction_date strings. */
  prefix: string;
  /** First day of the month, inclusive ("YYYY-MM-01"). */
  start: string;
  /** First day of the next month, exclusive. */
  end: string;
  /** e.g. "November" */
  label: string;
}

/** The current calendar month in the given time zone. */
export function getMonthRange(timeZone: string, now = new Date()): MonthRange {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    timeZone,
  }).formatToParts(now);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);

  const pad = (value: number) => String(value).padStart(2, "0");
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;

  return {
    prefix: `${year}-${pad(month)}`,
    start: `${year}-${pad(month)}-01`,
    end: `${nextYear}-${pad(nextMonth)}-01`,
    label: new Intl.DateTimeFormat("en-IN", { month: "long", timeZone: "UTC" }).format(
      new Date(Date.UTC(year, month - 1, 1))
    ),
  };
}
