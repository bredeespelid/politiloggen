import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
// Leaflets grunnstiler først, så våre overstyringer i styles.css vinner.
import "leaflet/dist/leaflet.css";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
