import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
// Polices embarquées dans le bundle : le cockpit reste sur le tailnet, sans appel externe.
import "@fontsource-variable/inter";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "./style.css";

const racine = document.getElementById("racine");
if (!racine) throw new Error("élément #racine absent de index.html");

createRoot(racine).render(
  <StrictMode>
    <App />
  </StrictMode>
);
