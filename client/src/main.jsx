import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";

if (import.meta.env.DEV) document.title = "[DEV] Ramblemaxxer";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>
);
