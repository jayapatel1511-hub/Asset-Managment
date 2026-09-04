import type { Theme } from "@fluentui/react-components";
import { englobeLightTheme } from "./theme";

/**
 * The Field mockup (`docs/mockups/ams-ui/`) is light-only. Forcing the product column onto
 * that theme stops Fluent inputs/selects from flipping to OS dark and reading as a different
 * product. `docs/02-app.md` still wants OS-follow dark later — restore `englobeDarkTheme`
 * when a dark mockup exists.
 */
export function useSystemTheme(): Theme {
  return englobeLightTheme;
}
