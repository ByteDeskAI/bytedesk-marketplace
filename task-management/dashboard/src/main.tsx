import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { setGlobalTheme } from "@atlaskit/tokens";
import { App } from "./App";

// 'auto' follows the OS light/dark preference — the board is theme-aware for free.
void setGlobalTheme({ colorMode: "auto", light: "light", dark: "dark" });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
