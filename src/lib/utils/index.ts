import { getInitialAppLanguage, useAppPreferencesStore } from "@/features/preferences/store";

/** Format a timestamp to relative time string */
export function formatRelativeTime(timestamp: number): string {
  const locale = useAppPreferencesStore.getState().language || getInitialAppLanguage();
  const now = Date.now();
  const diff = now - timestamp;
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });

  if (diff < 60_000) return rtf.format(-Math.floor(diff / 1_000), "second");
  if (diff < 3_600_000) return rtf.format(-Math.floor(diff / 60_000), "minute");
  if (diff < 86_400_000) return rtf.format(-Math.floor(diff / 3_600_000), "hour");
  return new Date(timestamp).toLocaleDateString(locale);
}

/** Truncate string with ellipsis */
export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 1) + "…";
}

/** Generate a unique ID */
export function uid(): string {
  return crypto.randomUUID();
}

/** Debounce a function */
export function debounce<T extends (...args: unknown[]) => unknown>(
  fn: T,
  delay: number,
): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

/** Class name utility (minimal clsx) */
export function cn(...classes: (string | boolean | undefined | null)[]): string {
  return classes.filter(Boolean).join(" ");
}
