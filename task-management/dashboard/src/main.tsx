import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/app.css";
import "./lib/theme"; // sets data-bd-theme before first paint
import { installWriteToken } from "./lib/write-token.mjs";
import { Shell } from "./app/Shell";

installWriteToken(); // TM-468: before anything can write

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Shell />
  </StrictMode>,
);
