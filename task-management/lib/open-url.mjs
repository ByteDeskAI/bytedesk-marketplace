/**
 * Open a local URL in the user's browser. Never throws — a failed open must not
 * take the dashboard down with it.
 */
import { execFile } from "node:child_process";

export function openUrl(url, { platform = process.platform, env = process.env } = {}) {
  if (!url) return false;
  if (env.TM_NO_BROWSER || env.CI) return false;
  try {
    if (platform === "darwin") execFile("open", [url], { detached: true, stdio: "ignore" }).unref();
    else if (platform === "win32") execFile("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore", windowsHide: true }).unref();
    else execFile("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
    return true;
  } catch {
    return false;
  }
}
