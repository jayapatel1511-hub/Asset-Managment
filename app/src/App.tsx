import { BrowserRouter, Route, Routes } from "react-router-dom";
import { FluentProvider, Title3, tokens } from "@fluentui/react-components";
import { useSystemTheme } from "./useSystemTheme";
import { useCurrentUser } from "./hooks/useCurrentUser";
import { BottomNav } from "./components/BottomNav";
import { RoleSwitcher } from "./components/RoleSwitcher";
import { t } from "./i18n";
import { SearchPage } from "./features/search/SearchPage";
import { AssetDetailPage } from "./features/asset/AssetDetailPage";
import { CheckoutPage } from "./features/checkout/CheckoutPage";
import { ReturnPage } from "./features/return/ReturnPage";
import { TransferPage } from "./features/transfer/TransferPage";
import { CalibrationDuePage } from "./features/calibration/CalibrationDuePage";
import { AdminHomePage } from "./features/admin/AdminHomePage";
import { NewAssetPage } from "./features/admin/NewAssetPage";

export default function App() {
  const theme = useSystemTheme();
  const { admin, reload } = useCurrentUser();

  return (
    <FluentProvider theme={theme} style={{ height: "100%" }}>
      <BrowserRouter>
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
            <RoleSwitcher onChange={reload} />
          </header>

          <main style={{ flex: 1, overflowY: "auto" }}>
            <Routes>
              <Route path="/" element={<SearchPage />} />
              <Route path="/asset/:assetId" element={<AssetDetailPage />} />
              <Route path="/checkout" element={<CheckoutPage />} />
              <Route path="/return" element={<ReturnPage />} />
              <Route path="/transfer" element={<TransferPage />} />
              <Route path="/calibration" element={<CalibrationDuePage />} />
              <Route path="/admin" element={<AdminHomePage />} />
              <Route path="/admin/new-asset" element={<NewAssetPage />} />
            </Routes>
          </main>

          <BottomNav isAdmin={admin} />
        </div>
      </BrowserRouter>
    </FluentProvider>
  );
}
