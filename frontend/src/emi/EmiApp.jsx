import React, { Suspense, useEffect } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import LoadingScreen from "../components/LoadingScreen.jsx";
import RouteBoundary from "../components/RouteBoundary.jsx";
import { lazyRetry } from "../utils/lazyRetry.js";
import { EmiAuthProvider, useAuth } from "./auth";
import { ToastProvider } from "./ui-context";
import Layout from "./pages/Layout";
import { Loading } from "./components/ui";
import "./emi.css";

const Home = lazyRetry(() => import("./pages/Home"));
const PerformancePage = lazyRetry(() => import("./pages/PerformancePage"));
const BackupPage = lazyRetry(() => import("./pages/BackupPage"));
const ProgramPage = lazyRetry(() => import("./pages/ProgramPage"));
const NewEnrollment = lazyRetry(() => import("./pages/NewEnrollment"));
const EnrollmentProfile = lazyRetry(() => import("./pages/EnrollmentProfile"));
const TrackerPage = lazyRetry(() => import("./pages/TrackerPage"));
const VerifyPage = lazyRetry(() => import("./pages/VerifyPage"));
const Settings = lazyRetry(() => import("./pages/Settings"));
const ImportPage = lazyRetry(() => import("./pages/ImportPage"));
const ActivityPage = lazyRetry(() => import("./pages/ActivityPage"));
const Account = lazyRetry(() => import("../pages/Account.jsx"));

// The EMI Manager app (mounted at /emi/*): fee + EMI tracking for the high-ticket programs, inside the hub.
// Same login as every other app; the server decides what the person may do here (role, "can verify payments", batch access).
function Inner() {
  const { ready, user, error } = useAuth();
  if (!ready) return <LoadingScreen app="emi" message="Opening EMI Manager" />;
  if (!user) return <div className="emi-scope"><div className="page"><div className="alert emi-error">{error || "EMI Manager could not be opened."}</div></div></div>;
  return (
    <div className="emi-scope">
      <RouteBoundary>
        <Suspense fallback={<Loading />}>
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<Home />} />
              <Route path="p/:programId/:batchId/enroll" element={<NewEnrollment />} />
              <Route path="p/:programId/:batchId?/:tab?" element={<ProgramPage />} />
              <Route path="enrollments/:id" element={<EnrollmentProfile />} />
              <Route path="tracker" element={<TrackerPage />} />
              <Route path="verify" element={<VerifyPage />} />
              <Route path="settings" element={<Settings />} />
              <Route path="import" element={<ImportPage />} />
              <Route path="activity" element={<ActivityPage />} />
              <Route path="performance" element={<PerformancePage />} />
              <Route path="backup" element={<BackupPage />} />
              <Route path="account" element={<Account />} />
              <Route path="*" element={<Navigate to="/emi" replace />} />
            </Route>
          </Routes>
        </Suspense>
      </RouteBoundary>
    </div>
  );
}

// EMI Manager is set in Inter; added once, only when this app opens.
function useInterFont() {
  useEffect(() => {
    if (document.getElementById("emi-inter-font")) return;
    const l = document.createElement("link");
    l.id = "emi-inter-font"; l.rel = "stylesheet";
    l.href = "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap";
    document.head.appendChild(l);
  }, []);
}

export default function EmiApp() {
  useInterFont();
  return (
    <ToastProvider>
      <EmiAuthProvider>
        <Inner />
      </EmiAuthProvider>
    </ToastProvider>
  );
}
