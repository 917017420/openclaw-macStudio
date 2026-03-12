import { create } from "zustand";

export const APP_LANGUAGE_STORAGE_KEY = "openclaw.desktop.language";
export const LEGACY_OVERVIEW_LANGUAGE_STORAGE_KEY = "openclaw.desktop.overview.language";

export const LANGUAGE_OPTIONS = [
  { value: "en", label: "English" },
  { value: "zh-CN", label: "简体中文" },
  { value: "zh-TW", label: "繁體中文" },
  { value: "es", label: "Español" },
  { value: "de", label: "Deutsch" },
  { value: "pt-BR", label: "Português (Brasil)" },
] as const;

export function normalizeAppLanguage(value: string | null | undefined): string {
  if (!value) {
    return "en";
  }
  const exact = LANGUAGE_OPTIONS.find((option) => option.value === value);
  if (exact) {
    return exact.value;
  }
  const base = value.split("-")[0]?.toLowerCase() ?? "en";
  return LANGUAGE_OPTIONS.find((option) => option.value.toLowerCase() === base)?.value ?? "en";
}

export function isChineseLanguage(value: string | null | undefined): boolean {
  return normalizeAppLanguage(value).startsWith("zh");
}

function readStoredLanguage(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return (
      window.localStorage.getItem(APP_LANGUAGE_STORAGE_KEY) ??
      window.localStorage.getItem(LEGACY_OVERVIEW_LANGUAGE_STORAGE_KEY)
    );
  } catch {
    return null;
  }
}

function persistLanguage(language: string) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(APP_LANGUAGE_STORAGE_KEY, language);
    window.localStorage.setItem(LEGACY_OVERVIEW_LANGUAGE_STORAGE_KEY, language);
  } catch {
    // Ignore local storage failures.
  }
}

export function getInitialAppLanguage(): string {
  if (typeof window === "undefined") {
    return "en";
  }
  return normalizeAppLanguage(readStoredLanguage() ?? navigator.language);
}

interface AppPreferencesStore {
  language: string;
  setLanguage: (language: string) => void;
}

export const useAppPreferencesStore = create<AppPreferencesStore>((set) => ({
  language: getInitialAppLanguage(),
  setLanguage: (language) => {
    const normalized = normalizeAppLanguage(language);
    persistLanguage(normalized);
    set({ language: normalized });
  },
}));
