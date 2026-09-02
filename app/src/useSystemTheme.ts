import { useEffect, useState } from "react";
import { webDarkTheme, webLightTheme, type Theme } from "@fluentui/react-components";

/** docs/02-app.md: "dark mode follows OS." No manual toggle — Phase 1 scope is exactly this. */
export function useSystemTheme(): Theme {
  const query = "(prefers-color-scheme: dark)";
  const [isDark, setIsDark] = useState(() => window.matchMedia(query).matches);

  useEffect(() => {
    const mql = window.matchMedia(query);
    const listener = (e: MediaQueryListEvent) => setIsDark(e.matches);
    mql.addEventListener("change", listener);
    return () => mql.removeEventListener("change", listener);
  }, []);

  return isDark ? webDarkTheme : webLightTheme;
}
