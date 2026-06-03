import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

declare global {
  interface Window {
    __PINCOPY_THEME_PREFERENCE__?: ThemePreference;
  }
}

const STORAGE_KEY = "pincopy-theme-preference";

function isThemePreference(value: string): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}

/** 解析为实际使用的浅色/深色 */
export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference === "light") return "light";
  if (preference === "dark") return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

/** 将偏好与解析结果写入 document，供 CSS 与组件使用 */
export function applyTheme(preference: ThemePreference): ResolvedTheme {
  const resolved = resolveTheme(preference);
  const root = document.documentElement;
  root.dataset.themePreference = preference;
  root.dataset.theme = resolved;
  try {
    localStorage.setItem(STORAGE_KEY, preference);
  } catch {
    /* 忽略隐私模式等写入失败 */
  }
  return resolved;
}

async function readPreferenceFromBackend(): Promise<ThemePreference | null> {
  try {
    const value = await invoke<string>("get_theme_preference");
    return isThemePreference(value) ? value : null;
  } catch {
    return null;
  }
}

function readInjectedPreference(): ThemePreference | null {
  const injected = window.__PINCOPY_THEME_PREFERENCE__;
  return injected && isThemePreference(injected) ? injected : null;
}

function readStoredPreference(): ThemePreference | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored && isThemePreference(stored) ? stored : null;
  } catch {
    return null;
  }
}

/** 启动时加载主题：注入值 > 后端设置 > localStorage > 跟随系统 */
export async function initTheme(): Promise<ResolvedTheme> {
  const preference =
    readInjectedPreference() ??
    (await readPreferenceFromBackend()) ??
    readStoredPreference() ??
    "system";

  const resolved = applyTheme(preference);

  window
    .matchMedia("(prefers-color-scheme: dark)")
    .addEventListener("change", () => {
      if (document.documentElement.dataset.themePreference === "system") {
        applyTheme("system");
      }
    });

  return resolved;
}

/** 监听托盘菜单切换主题 */
export function listenThemeChanges(
  onChange: (preference: ThemePreference, resolved: ResolvedTheme) => void,
): Promise<() => void> {
  return listen<{ preference: string }>("theme-changed", (event) => {
    const raw = event.payload.preference;
    if (!isThemePreference(raw)) return;
    const resolved = applyTheme(raw);
    onChange(raw, resolved);
  }).then((unlisten) => unlisten);
}
