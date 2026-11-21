import { StrictMode, Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import App from "./ui/App";
import "./ui/styles.css";

// ?fixture=timeline shows the track view on a song built by hand, in place of the app (it is loaded only then)
const fixture = new URLSearchParams(window.location.search).get("fixture") === "timeline";
const FixturePage = lazy(() => import("./ui/timeline/FixturePage"));

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {fixture ? <Suspense fallback={null}><FixturePage /></Suspense> : <App />}
  </StrictMode>,
);

// Offline support: cache the app after the first visit (production builds only).
// (Not in the desktop app: it has its own files and its own updates.)
if ("serviceWorker" in navigator && import.meta.env.PROD && window.self === window.top && !("__TAURI_INTERNALS__" in window)) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {
      /* offline mode unavailable; app still works online */
    });
  });
}
