import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

import { LandingPage } from "@/pages/LandingPage";
import { ErrorDirectoryPage } from "@/pages/ErrorDirectoryPage";
import { DashboardPage } from "@/pages/DashboardPage";
import { AnalysisPage } from "@/pages/AnalysisPage";

/**
 * Every route is public: there is no sign-in, no account and no server behind
 * this app. Reports live in the browser that produced them.
 */
export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/errors" element={<ErrorDirectoryPage />} />
        <Route path="/app" element={<DashboardPage />} />
        <Route path="/app/analysis/:id" element={<AnalysisPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
