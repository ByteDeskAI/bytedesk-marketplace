import { readFileSync } from "node:fs";
import { join } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { paths } from "../lib/paths.mjs";

/**
 * `npm run dev` serves the board with HMR and proxies the API to the running
 * tm-dashboard, whose port that project already recorded in dashboard.port.
 * ponytail: read the port file rather than configure one — the port is assigned
 * per project, so any hardcoded default is wrong for every project but one.
 */
function apiTarget() {
  if (process.env.TM_API) return process.env.TM_API;
  try {
    const port = readFileSync(join(paths().base, "dashboard.port"), "utf8").trim();
    return `http://127.0.0.1:${port}`;
  } catch {
    throw new Error(
      "no running board to proxy to — start one with `bin/tm-dashboard`, or set TM_API=http://127.0.0.1:<port>",
    );
  }
}

// The proxy target is resolved for `dev` only. Evaluated eagerly it takes the
// build down too, and `npm run build` must work with no board running — dist/ is
// committed, so a failed build is a plugin that ships stale.
export default defineConfig(({ command }) => ({
  // @atlaskit/css (cssMap) is Compiled — it needs the build-time transform.
  plugins: [react({ jsxImportSource: "@compiled/react", babel: { plugins: ["@compiled/babel-plugin"] } })],
  base: "/",
  build: {
    outDir: "dist",
    assetsDir: "assets",
    emptyOutDir: true,
    modulePreload: { polyfill: false }, // the polyfill is an inline script; a strict CSP would drop it
  },
  server:
    command === "serve"
      ? {
          proxy: {
            "/api": { target: apiTarget(), changeOrigin: true },
            // SSE needs the stream left alone: no buffering, no timeout.
            "/events": { target: apiTarget(), changeOrigin: true, ws: false, timeout: 0 },
          },
        }
      : undefined,
}));
