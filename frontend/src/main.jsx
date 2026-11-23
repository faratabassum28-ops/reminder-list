import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";
import { ToastProvider } from "./components/Toast.jsx";
import { AuthProvider } from "./context/AuthContext.jsx";
import { ThemeProvider } from "./context/ThemeContext.jsx";
import { NetworkProvider } from "./context/NetworkContext.jsx";
import NetworkBanner from "./components/NetworkBanner.jsx";
import ThemeSync from "./components/ThemeSync.jsx";
import RouteBoundary from "./components/RouteBoundary.jsx";
import "./index.css";
import "./loaders.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <NetworkProvider>
          <ToastProvider>
            <AuthProvider>
              <RouteBoundary fullscreen>
                <App />
              </RouteBoundary>
              <ThemeSync />
            </AuthProvider>
          </ToastProvider>
          <NetworkBanner />
        </NetworkProvider>
      </ThemeProvider>
    </BrowserRouter>
  </React.StrictMode>
);

// The offline service worker is switched off (it was causing failed page loads).
// Remove any copy still installed in a browser, and clear its caches.
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister())).catch(() => {});
  if (window.caches) caches.keys().then((ks) => ks.forEach((k) => caches.delete(k))).catch(() => {});
}
