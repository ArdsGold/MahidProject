import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("development launcher propagates an in-memory token without exposing it", async () => {
  const source = await readFile(new URL("../start-dev-auth-session.ps1", import.meta.url), "utf8");
  assert.match(source, /RandomNumberGenerator/);
  assert.match(source, /BA2_PLAYWRIGHT_TOKEN/);
  assert.match(source, /Start-Process/);
  assert.match(source, /dev-auth-start\.ps1/);
  assert.match(source, /PrepareOnly/);
  assert.doesNotMatch(source, /ArgumentList[^\n]*BA2_PLAYWRIGHT_TOKEN/);
  assert.doesNotMatch(source, /Write-Host[^\n]*(token|password)/i);
});

test("development launcher refuses production or unverified profile ownership", async () => {
  const source = await readFile(new URL("../start-dev-auth-session.ps1", import.meta.url), "utf8");
  assert.match(source, /productionPid/);
  assert.match(source, /playwright-worker\[[^\]]+\]server/);
  assert.match(source, /Port 3211 is owned by production/);
  assert.match(source, /unverified process/);
  assert.match(source, /profile ownership could not be verified/);
  assert.match(source, /productionProfile/);
  assert.match(source, /productionAmpBlogsProfile/);
});
