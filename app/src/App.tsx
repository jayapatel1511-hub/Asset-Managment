import { BrowserRouter, Route, Routes } from "react-router-dom";
import { FluentProvider, Title3, tokens } from "@fluentui/react-components";
import { useSystemTheme } from "./useSystemTheme";
import { useCurrentUser } from "./hooks/useCurrentUser";
import { BottomNav } from "./components/BottomNav";
import { DatasetBanner } from "./components/DatasetBanner";
// Feature 008 T012: the two `// MOCK-ONLY` stand-ins are reached only through this module, whose
// build-time gate keeps them out of a release bundle entirely. See src/devStandins.tsx.
import { DevRoleSwitcher } from "./devStandins";
import { t } from "./i18n";
import { FieldHomePage } from "./features/home/FieldHomePage";
import { SearchPage } from "./features/search/SearchPage";
import { AssetDetailPage } from "./features/asset/AssetDetailPage";
import { CheckoutPage } from "./features/checkout/CheckoutPage";
import { ReturnPage } from "./features/return/ReturnPage";
import { TransferPage } from "./features/transfer/TransferPage";
import { CalibrationDuePage } from "./features/calibration/CalibrationDuePage";
import { AdminHomePage } from "./features/admin/AdminHomePage";
import { NewAssetPage } from "./features/admin/NewAssetPage";
// Feature 005 (WS-A)
import { DeployPage } from "./features/deploy/DeployPage";
import { RecoverPage } from "./features/recover/RecoverPage";
import { SiteListPage } from "./features/site/SiteListPage";
import { SiteDetailPage } from "./features/site/SiteDetailPage";
// Feature 006 (WS-B)
import { ReportsHomePage } from "./features/reports/ReportsHomePage";
import { CompliancePage } from "./features/reports/CompliancePage";
import { TimelinePage } from "./features/reports/TimelinePage";
import { UtilisationPage } from "./features/reports/UtilisationPage";
// Feature 003 US5 (WS-C)
import { NeedsAttentionPage } from "./features/offline/NeedsAttentionPage";
// Feature 004 US4 (WS-D)
import { OfficeAdminsPage } from "./features/admin/OfficeAdminsPage";

export default function App() {
  const theme = useSystemTheme();
  const { admin, reload } = useCurrentUser();

  return (
    <FluentProvider theme={theme} style={{ height: "100%" }}>
      {/* Feature 008 T016: Power Apps serves a Code App from /play/e/{env}/a/{app}, not from the
          origin root, so the router's basename must not be hard-coded to "/". It now follows
          Vite's own `base` (import.meta.env.BASE_URL, "/" everywhere today), which makes hosting
          under a path a one-line config change in vite.config.ts rather than a code change.
          PREPARED, NOT RESOLVED: confirming the real prefix needs `pa app run` against a tenant. */}
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            height: "100dvh",
            maxWidth: 480,
            margin: "0 auto",
            background: tokens.colorNeutralBackground2,
          }}
        >
          <header
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "10px 12px",
              borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
              background: tokens.colorNeutralBackground1,
            }}
          >
            <Title3>{t("app.title")}</Title3>
            <DevRoleSwitcher onChange={reload} />
          </header>

          <DatasetBanner />

          <main style={{ flex: 1, overflowY: "auto" }}>
            <Routes>
              {/* D2 (2026-09-03): the Field home is no longer search. Search keeps its own route
                  — it is still the fastest path when a technician knows the tag — but it is now
                  one action reachable from the home rather than the thing the app opens on. */}
              <Route path="/" element={<FieldHomePage />} />
              <Route path="/search" element={<SearchPage />} />
              <Route path="/asset/:assetId" element={<AssetDetailPage />} />
              <Route path="/checkout" element={<CheckoutPage />} />
              <Route path="/return" element={<ReturnPage />} />
              <Route path="/transfer" element={<TransferPage />} />
              <Route path="/calibration" element={<CalibrationDuePage />} />
              <Route path="/admin" element={<AdminHomePage />} />
              <Route path="/admin/new-asset" element={<NewAssetPage />} />

              {/* Feature 005 (WS-A) */}
              <Route path="/deploy" element={<DeployPage />} />
              <Route path="/recover/:installationId" element={<RecoverPage />} />
              <Route path="/sites" element={<SiteListPage />} />
              <Route path="/site/:site" element={<SiteDetailPage />} />

              {/* Feature 006 (WS-B) */}
              <Route path="/reports" element={<ReportsHomePage />} />
              <Route path="/reports/compliance" element={<CompliancePage />} />
              <Route path="/reports/timeline/:assetId" element={<TimelinePage />} />
              <Route path="/reports/utilisation" element={<UtilisationPage />} />

              {/* Feature 003 US5 (WS-C) */}
              <Route path="/needs-attention" element={<NeedsAttentionPage />} />

              {/* Feature 004 US4 (WS-D) */}
              <Route path="/admin/office-admins" element={<OfficeAdminsPage />} />
            </Routes>
          </main>

          <BottomNav isAdmin={admin} />
        </div>
      </BrowserRouter>
    </FluentProvider>
  );
}
