import { BrowserRouter, Route, Routes } from "react-router-dom";
import { FluentProvider } from "@fluentui/react-components";
import { useSystemTheme } from "./useSystemTheme";
import { PageChromeProvider } from "./chrome/PageChrome";
import { ScanProvider } from "./chrome/ScanContext";
import { AppHeader } from "./components/AppHeader";
import { BottomNav } from "./components/BottomNav";
import { DatasetBanner } from "./components/DatasetBanner";
import { OfflineBar } from "./components/OfflineBar";
import { FieldHomePage } from "./features/home/FieldHomePage";
import { SearchPage } from "./features/search/SearchPage";
import { AssetDetailPage } from "./features/asset/AssetDetailPage";
import { CheckoutPage } from "./features/checkout/CheckoutPage";
import { ReturnPage } from "./features/return/ReturnPage";
import { TransferPage } from "./features/transfer/TransferPage";
import { CalibrationDuePage } from "./features/calibration/CalibrationDuePage";
import { AdminHomePage } from "./features/admin/AdminHomePage";
import { NewAssetPage } from "./features/admin/NewAssetPage";
import { DeployPage } from "./features/deploy/DeployPage";
import { RecoverPage } from "./features/recover/RecoverPage";
import { SiteListPage } from "./features/site/SiteListPage";
import { SiteDetailPage } from "./features/site/SiteDetailPage";
import { ReportsHomePage } from "./features/reports/ReportsHomePage";
import { CompliancePage } from "./features/reports/CompliancePage";
import { TimelinePage } from "./features/reports/TimelinePage";
import { UtilisationPage } from "./features/reports/UtilisationPage";
import { NeedsAttentionPage } from "./features/offline/NeedsAttentionPage";
import { OfficeAdminsPage } from "./features/admin/OfficeAdminsPage";
import { ReferenceDataPage } from "./features/admin/ReferenceDataPage";
import { MorePage } from "./features/more/MorePage";
import { QualityOverviewPage } from "./features/data-management/QualityOverviewPage";
import { QualityIssuesPage } from "./features/data-management/QualityIssuesPage";
import { DictionaryPage } from "./features/data-management/DictionaryPage";

export default function App() {
  const theme = useSystemTheme();

  return (
    <FluentProvider theme={theme} style={{ height: "100%", background: "transparent", colorScheme: "light" }}>
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        <PageChromeProvider>
          <ScanProvider>
            <div className="ams-stage">
              <div className="ams-app">
                <AppHeader />
                <OfflineBar />
                <DatasetBanner />
                <main className="ams-main">
                  <Routes>
                    <Route path="/" element={<FieldHomePage />} />
                    <Route path="/search" element={<SearchPage />} />
                    <Route path="/asset/:assetId" element={<AssetDetailPage />} />
                    <Route path="/checkout" element={<CheckoutPage />} />
                    <Route path="/return" element={<ReturnPage />} />
                    <Route path="/transfer" element={<TransferPage />} />
                    <Route path="/calibration" element={<CalibrationDuePage />} />
                    <Route path="/admin" element={<AdminHomePage />} />
                    <Route path="/admin/new-asset" element={<NewAssetPage />} />
                    <Route path="/deploy" element={<DeployPage />} />
                    <Route path="/recover/:installationId" element={<RecoverPage />} />
                    <Route path="/sites" element={<SiteListPage />} />
                    <Route path="/site/:site" element={<SiteDetailPage />} />
                    <Route path="/reports" element={<ReportsHomePage />} />
                    <Route path="/reports/compliance" element={<CompliancePage />} />
                    <Route path="/reports/timeline/:assetId" element={<TimelinePage />} />
                    <Route path="/reports/utilisation" element={<UtilisationPage />} />
                    <Route path="/needs-attention" element={<NeedsAttentionPage />} />
                    <Route path="/admin/office-admins" element={<OfficeAdminsPage />} />
                    <Route path="/admin/reference" element={<ReferenceDataPage />} />
                    <Route path="/data-management" element={<QualityOverviewPage />} />
                    <Route path="/data-management/quality/issues" element={<QualityIssuesPage />} />
                    <Route path="/data-management/dictionary" element={<DictionaryPage />} />
                    <Route path="/more" element={<MorePage />} />
                  </Routes>
                </main>
                <BottomNav />
              </div>
            </div>
          </ScanProvider>
        </PageChromeProvider>
      </BrowserRouter>
    </FluentProvider>
  );
}
