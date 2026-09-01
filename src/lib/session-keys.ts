import type { ProviderId } from "./taxonomy";
import type { SessionKeys, SessionModels } from "./types";

const STORAGE = "vigil.session-keys";
const MODELS = "vigil.session-models";
const THEME = "vigil.theme";
const EXTRACT = "vigil.extract-pref";

export function readSessionKeys(): SessionKeys {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.sessionStorage.getItem(STORAGE);
    if (!raw) return {};
    return (JSON.parse(raw) as SessionKeys) ?? {};
  } catch {
    return {};
  }
}

export function writeSessionKeys(keys: SessionKeys) {
  if (typeof window === "undefined") return;
  const cleaned: SessionKeys = {};
  (Object.keys(keys) as ProviderId[]).forEach((k) => {
    const v = keys[k]?.trim();
    if (v) cleaned[k] = v;
  });
  window.sessionStorage.setItem(STORAGE, JSON.stringify(cleaned));
}

export function clearSessionKey(provider: ProviderId) {
  const next = readSessionKeys();
  delete next[provider];
  writeSessionKeys(next);
}

export function readSessionModels(): SessionModels {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.sessionStorage.getItem(MODELS);
    if (!raw) return {};
    return (JSON.parse(raw) as SessionModels) ?? {};
  } catch {
    return {};
  }
}

export function writeSessionModels(models: SessionModels) {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(MODELS, JSON.stringify(models));
}

export function readExtractPref(): { provider: ProviderId; model: string } | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(EXTRACT);
    if (!raw) return null;
    return JSON.parse(raw) as { provider: ProviderId; model: string };
  } catch {
    return null;
  }
}

export function writeExtractPref(provider: ProviderId, model: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(EXTRACT, JSON.stringify({ provider, model }));
}

export function readTheme(): "light" | "dark" {
  if (typeof window === "undefined") return "light";
  try {
    const v = window.localStorage.getItem(THEME);
    return v === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

export function writeTheme(theme: "light" | "dark") {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(THEME, theme);
  document.documentElement.classList.toggle("dark", theme === "dark");
}
