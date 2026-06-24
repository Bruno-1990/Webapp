import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import AppShell from "./components/AppShell.js";

const ToolsHubPage = lazy(() => import("./pages/ToolsHubPage.js"));
const HomePage = lazy(() => import("./pages/HomePage.js"));
const DownloadPage = lazy(() => import("./pages/DownloadPage.js"));
const SpedHomePage = lazy(() => import("./pages/SpedHomePage.js"));
const SpedMergeHomePage = lazy(() => import("./pages/SpedMergeHomePage.js"));
const SciConsolidadoHomePage = lazy(() => import("./pages/SciConsolidadoHomePage.js"));
const ComparacaoPlanilhasHomePage = lazy(() => import("./pages/ComparacaoPlanilhasHomePage.js"));
const NfseComparadorHomePage = lazy(() => import("./pages/NfseComparadorHomePage.js"));
const GnreHomePage = lazy(() => import("./pages/GnreHomePage.js"));
const ExtratoEditHomePage = lazy(() => import("./pages/ExtratoEditHomePage.js"));
const NfsePdfHomePage = lazy(() => import("./pages/NfsePdfHomePage.js"));
const SciPortalNacionalHomePage = lazy(() => import("./pages/SciPortalNacionalHomePage.js"));
const LegacyDownloadRedirect = lazy(() => import("./pages/LegacyDownloadRedirect.js"));

function LegacyFallback() {
  return null;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/download/:jobId"
          element={
            <Suspense fallback={<LegacyFallback />}>
              <LegacyDownloadRedirect />
            </Suspense>
          }
        />

        <Route element={<AppShell />}>
          <Route path="/" element={<ToolsHubPage />} />
          <Route path="/tools/nfe" element={<HomePage />} />
          <Route path="/tools/nfe/download/:jobId" element={<DownloadPage />} />
          <Route path="/tools/sped" element={<SpedHomePage />} />
          <Route path="/tools/sped/download/:jobId" element={<DownloadPage />} />
          <Route path="/tools/sped-merge" element={<SpedMergeHomePage />} />
          <Route path="/tools/sped-merge/download/:jobId" element={<DownloadPage />} />
          <Route path="/tools/sci-consolidado" element={<SciConsolidadoHomePage />} />
          <Route path="/tools/sci-consolidado/download/:jobId" element={<DownloadPage />} />
          <Route path="/tools/comparacao-planilhas" element={<ComparacaoPlanilhasHomePage />} />
          <Route path="/tools/comparacao-planilhas/download/:jobId" element={<DownloadPage />} />
          <Route path="/tools/comparacao-nfse" element={<NfseComparadorHomePage />} />
          <Route path="/tools/gnre" element={<GnreHomePage />} />
          <Route path="/tools/extrato-edit" element={<ExtratoEditHomePage />} />
          <Route path="/tools/nfse-pdf" element={<NfsePdfHomePage />} />
          <Route path="/tools/sci-portal-nacional" element={<SciPortalNacionalHomePage />} />
          <Route path="/tools/sci-portal-nacional/download/:jobId" element={<DownloadPage />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
