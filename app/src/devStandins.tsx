/**
 * Feature 008 T012 / FR-010a — the build-time gate that keeps the two `// MOCK-ONLY` stand-ins
 * OUT of a release bundle rather than merely hidden inside one.
 *
 * `RoleSwitcher` lets anyone pick their own role, and `ScanDialog` accepts a typed code in place
 * of the Power Apps SDK's camera. Both exist only because this build has no tenant. Hiding them
 * behind a runtime flag would not be enough: the code would still ship, `scan-bundle.mjs` would
 * still find a role picker in dist/, and anyone reading the bundle could re-enable it.
 *
 * How the exclusion works: Vite replaces `import.meta.env.MODE` with a string literal at build
 * time, so under `vite build --mode release` the constant below is `"release" !== "release"` —
 * provably false. Each ternary then has a statically-dead arm, and Rollup drops that arm together
 * with the `import()` inside it, so neither component (nor anything they alone pull in) reaches
 * the bundle. In every other mode they load as their own chunk on first render.
 *
 * Verify, don't assume — `npm run build:release` followed by a grep of dist/ for "RoleSwitcher"
 * and "Scan a tag" is the check, and it is recorded in docs/09-build-report.md.
 *
 * Deleted, along with both components, the day api/dataverse/ goes live.
 */
import { lazy, Suspense, type ComponentType } from "react";

/** True in dev, test and the ordinary `vite build`; false only in `--mode release`. */
export const MOCK_STANDINS_INCLUDED = import.meta.env.MODE !== "release";

function withSuspense<P extends object>(Lazy: ComponentType<P>): ComponentType<P> {
  // fallback={null}: both stand-ins are chrome, and a spinner where a dropdown will appear a
  // frame later is worse than nothing.
  return function Gated(props: P) {
    return (
      <Suspense fallback={null}>
        <Lazy {...props} />
      </Suspense>
    );
  };
}

const Nothing = () => null;

export const DevRoleSwitcher: ComponentType<{ onChange: () => void }> = MOCK_STANDINS_INCLUDED
  ? withSuspense(lazy(() => import("./components/RoleSwitcher").then((m) => ({ default: m.RoleSwitcher }))))
  : Nothing;

export const DevScanDialog: ComponentType<{ open: boolean; onClose: () => void; onSubmit: (code: string) => void }> =
  MOCK_STANDINS_INCLUDED
    ? withSuspense(lazy(() => import("./features/search/ScanDialog").then((m) => ({ default: m.ScanDialog }))))
    : Nothing;
