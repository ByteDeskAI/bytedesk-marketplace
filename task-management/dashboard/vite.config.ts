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
    const base = paths().base;
    const port = readFileSync(join(base, "dashboard.port"), "utf8").trim();
    if (!alive(base)) throw new Error("stale");
    return `http://127.0.0.1:${port}`;
  } catch {
    throw new Error(
      "no running board to proxy to — start one with `bin/tm-dashboard`, or set TM_API=http://127.0.0.1:<port>",
    );
  }
}

/**
 * A port file outlives the board that wrote it. Without this the dev server starts
 * happily against a dead port and every request fails with a proxy error instead of
 * the message above — which sends you looking at the proxy config rather than at the
 * board you forgot to start.
 */
function alive(base: string) {
  try {
    const { pid } = JSON.parse(readFileSync(join(base, "dashboard.pid"), "utf8"));
    if (!pid) return false;
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means the process exists and belongs to someone else — still alive.
    return (err as NodeJS.ErrnoException)?.code === "EPERM";
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
    /**
     * Dependencies in their own chunk, and the size warning turned off deliberately.
     *
     * This bundle is committed, so what matters is not first-paint over a network — it is served
     * from localhost and the service worker precaches every file — but how much of it git has to
     * store again on each release. Unsplit, one character of app code rewrote all 3.3 MB. Split,
     * a typical change rewrites only the app chunk and the dependency chunk is reused.
     *
     * The warning cannot be satisfied honestly: Atlaskit alone is over the 500 kB default, and
     * chopping a design system into arbitrary pieces to quiet a linter would trade a real
     * property (one cacheable vendor chunk) for a cosmetic one. Naming the limit says the size is
     * a decision rather than an oversight — and leaves the warning meaningful if it ever fires.
     */
    chunkSizeWarningLimit: 4500,  // above today's vendor chunk, so a jump past it is news
    rollupOptions: {
      output: {
        manualChunks: (id: string) => (id.includes("node_modules") ? "vendor" : undefined),
      },
    },
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
