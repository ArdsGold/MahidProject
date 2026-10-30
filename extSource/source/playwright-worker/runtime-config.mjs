import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const WORKER_HOST = "127.0.0.1";
export const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function portValue(value) {
  const port = Number(value || 3210);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Playwright worker port must be an integer between 1024 and 65535.");
  return port;
}

function directoryValue(value, fallback) {
  return resolve(value || fallback);
}

export function readWorkerConfig(env = process.env) {
  const profileDir = directoryValue(env.BA2_PLAYWRIGHT_PROFILE_DIR, join(PROJECT_ROOT, ".playwright-profile"));
  const ampBlogsProfileDir = directoryValue(env.BA2_AMP_BLOGS_PROFILE_DIR, join(PROJECT_ROOT, ".ampblogs-playwright-profile"));
  const diagnosticsDir = directoryValue(env.BA2_PLAYWRIGHT_DIAGNOSTICS_DIR, join(PROJECT_ROOT, "playwright-worker", ".diagnostics"));
  const ampBlogsStateDir = directoryValue(env.BA2_AMP_BLOGS_STATE_DIR, join(PROJECT_ROOT, "playwright-worker", ".ampblogs-state"));
  if (profileDir === ampBlogsProfileDir) throw new Error("Playwright and AmpBlogs profile directories must be different.");
  return {
    host: WORKER_HOST,
    port: portValue(env.BA2_PLAYWRIGHT_PORT),
    token: env.BA2_PLAYWRIGHT_TOKEN || "ba2-playwright-local-token",
    profileDir,
    ampBlogsProfileDir,
    extensionDir: directoryValue(env.BA2_EXTENSION_DIR, join(PROJECT_ROOT, "extension", "dist")),
    loadExtension: env.BA2_PLAYWRIGHT_LOAD_EXTENSION !== "false",
    diagnosticsDir,
    diagnosticsFile: join(diagnosticsDir, "category.jsonl"),
    ampBlogsStateDir,
  };
}

export function isIsolatedFromProduction(config, production = readWorkerConfig({})) {
  return config.port !== production.port
    && config.profileDir !== production.profileDir
    && config.ampBlogsProfileDir !== production.ampBlogsProfileDir
    && config.diagnosticsDir !== production.diagnosticsDir
    && config.ampBlogsStateDir !== production.ampBlogsStateDir
    && config.token !== production.token;
}
