#!/usr/bin/env node
/**
 * Refresh platform-domain, platform-ops, and omnigent-dev from bytedesk-platform.
 * Run from any checkout:
 *   node scripts/sync-from-platform.mjs
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const marketplaceRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const platformBootstrap = join(marketplaceRoot, "..", "bytedesk-platform", "scripts", "dev", "bootstrap-marketplace.mjs");
const { applyBootstrap } = await import(platformBootstrap);
applyBootstrap(marketplaceRoot);
console.log(`sync-from-platform: refreshed ${marketplaceRoot}`);