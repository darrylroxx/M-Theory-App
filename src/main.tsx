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
if ("serviceWorker" in navigator && import.meta.env.PROD && window.self === window.top) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {
      /* offline mode unavailable; app still works online */
    });
  });
}
