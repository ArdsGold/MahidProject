import assert from "node:assert/strict";
import test from "node:test";
import { isIsolatedFromProduction, readWorkerConfig, WORKER_HOST } from "../runtime-config.mjs";

test("production worker defaults remain localhost and retain the extension profile", () => {
  const config = readWorkerConfig({});
  assert.equal(config.host, WORKER_HOST);
  assert.equal(config.port, 3210);
  assert.equal(config.loadExtension, true);
  assert.match(config.profileDir, /\.playwright-profile$/i);
  assert.match(config.ampBlogsProfileDir, /\.ampblogs-playwright-profile$/i);
  assert.notEqual(config.profileDir, config.ampBlogsProfileDir);
});

test("development worker uses separate port, token, profiles, state, diagnostics, and no extension", () => {
  const config = readWorkerConfig({
    BA2_PLAYWRIGHT_PORT: "3211",
    BA2_PLAYWRIGHT_TOKEN: "isolated-dev-token",
    BA2_PLAYWRIGHT_PROFILE_DIR: "C:/Mahid-dev/playwright-profile",
    BA2_AMP_BLOGS_PROFILE_DIR: "C:/Mahid-dev/ampblogs-profile",
    BA2_PLAYWRIGHT_DIAGNOSTICS_DIR: "C:/Mahid-dev/diagnostics",
    BA2_AMP_BLOGS_STATE_DIR: "C:/Mahid-dev/state",
    BA2_PLAYWRIGHT_LOAD_EXTENSION: "false",
  });
  assert.equal(config.host, WORKER_HOST);
  assert.equal(config.port, 3211);
  assert.equal(config.token, "isolated-dev-token");
  assert.equal(config.loadExtension, false);
  assert.equal(isIsolatedFromProduction(config), true);
  assert.notEqual(config.profileDir, readWorkerConfig({}).profileDir);
  assert.notEqual(config.ampBlogsProfileDir, readWorkerConfig({}).ampBlogsProfileDir);
  assert.notEqual(config.diagnosticsDir, readWorkerConfig({}).diagnosticsDir);
  assert.notEqual(config.ampBlogsStateDir, readWorkerConfig({}).ampBlogsStateDir);
});

test("worker configuration rejects overlapping browser profiles", () => {
  assert.throws(() => readWorkerConfig({
    BA2_PLAYWRIGHT_PROFILE_DIR: "C:/Mahid-dev/shared",
    BA2_AMP_BLOGS_PROFILE_DIR: "C:/Mahid-dev/shared",
  }), /must be different/);
});
