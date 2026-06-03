import { useEffect, useState } from "react";
import {
  initTheme,
  listenThemeChanges,
  resolveTheme,
  type ResolvedTheme,
  type ThemePreference,
} from "../utils/theme";

function readCurrentResolved(): ResolvedTheme {
  const pref = document.documentElement.dataset.themePreference as
    | ThemePreference
    | undefined;
  if (pref) return resolveTheme(pref);
  return resolveTheme("system");
}

/** 初始化并订阅全局主题变化 */
export function useTheme(): ResolvedTheme {
  const [resolved, setResolved] = useState<ResolvedTheme>(readCurrentResolved);

  useEffect(() => {
    let cancelled = false;

    void initTheme().then((theme) => {
      if (!cancelled) setResolved(theme);
    });

    let unlisten: (() => void) | undefined;
    void listenThemeChanges((_pref, next) => {
      if (!cancelled) setResolved(next);
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  return resolved;
}
