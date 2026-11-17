import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./ui/App";
import "./ui/styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
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
