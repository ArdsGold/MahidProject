import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("resident launcher retains token only in process and exposes supervised operations", async () => {
  const source = await readFile(new URL("../resident-dev-auth.ps1", import.meta.url), "utf8");
  for (const operation of ["Prepare", "Start", "Resume", "Status", "Reset", "Exit"]) assert.match(source, new RegExp(operation));
  assert.match(source, /RandomNumberGenerator/);
  assert.match(source, /BA2_PLAYWRIGHT_TOKEN/);
  assert.match(source, /\/ampblogs\/dev\/auth\/resume/);
  assert.match(source, /\/ampblogs\/dev\/auth\/reset/);
  assert.match(source, /finally/);
  assert.match(source, /catch/);
  assert.match(source, /Show-SafeError/);
  assert.match(source, /Operation failed safely/);
  assert.match(source, /\$token = \$null/);
  assert.doesNotMatch(source, /Write-Host[^\n]*(token|password)/i);
  assert.doesNotMatch(source, /ArgumentList[^\n]*\$token/);
});

test("resident launcher refuses production or unverified development ownership", async () => {
  const source = await readFile(new URL("../resident-dev-auth.ps1", import.meta.url), "utf8");
  assert.match(source, /productionPid/);
  assert.match(source, /Port 3211 is owned by production/);
  assert.match(source, /unverified process/);
  assert.match(source, /profile overlaps production/);
  assert.match(source, /ApproveReplacement/);
  assert.match(source, /taskkill \/PID/);
});
