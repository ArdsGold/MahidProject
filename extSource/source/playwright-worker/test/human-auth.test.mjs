import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { chromium } from "playwright";
import {
  DEV_AUTH_PHASES,
  DEV_AUTH_STATE_DIR,
  prepareDevAmpBlogsAuth,
  resetDevAmpBlogsAuth,
  resumeDevAmpBlogsAuth,
  startDevAmpBlogsAuth,
} from "../ampblogs/human-auth.mjs";
import { EXPECTED_AMP_BLOGS_BUSINESS } from "../ampblogs/profile.mjs";

const fixtureDir = new URL("./fixtures/", import.meta.url);
const fixtures = new Map([
  ["/", "ampblogs-homepage.html"],
  ["/signup", "ampblogs-signup.html"],
  ["/login", "ampblogs-login.html"],
  ["/account-created", "ampblogs-account-created.html"],
  ["/maintenance", "ampblogs-unsupported.html"],
  ["/auth-error", "ampblogs-auth-error.html"],
]);

async function createContext() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  await context.route("https://ampblogs.com/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const fixture = fixtures.get(path);
    if (!fixture) return route.fulfill({ status: 404, body: "not found" });
    return route.fulfill({ status: 200, contentType: "text/html", body: await readFile(new URL(fixture, fixtureDir), "utf8") });
  });
  return { browser, context };
}

function profile() {
  return { profileId: "human-auth-test-profile", businessName: EXPECTED_AMP_BLOGS_BUSINESS };
}

test("human auth requires an account decision, redacts credentials, and prevents duplicate starts", async () => {
  const { browser, context } = await createContext();
  let runId;
  try {
    const prepared = await prepareDevAmpBlogsAuth({ context, profile: profile() });
    runId = prepared.run.runId;
    assert.equal(prepared.status, "needs-human");
    assert.equal(prepared.run.phase, DEV_AUTH_PHASES.ACCOUNT_DECISION);
    assert.match(prepared.run.reason, /account existence/i);

    const duplicatePrepare = await prepareDevAmpBlogsAuth({ context, profile: profile() });
    assert.equal(duplicatePrepare.run.runId, runId);
    assert.equal(duplicatePrepare.run.duplicatePrevented, true);

    const username = `human-${runId.slice(0, 8)}`;
    const email = `${runId.slice(0, 8)}@example.test`;
    const password = `runtime-secret-${runId}`;
    const started = await startDevAmpBlogsAuth({
      context,
      runId,
      accountStatus: "new",
      credentials: { username, email, password },
    });
    const responseText = JSON.stringify(started);
    assert.equal(started.status, "needs-human");
    assert.equal(started.run.phase, DEV_AUTH_PHASES.AWAITING_MANUAL_AUTH);
    assert.equal(responseText.includes(username), false);
    assert.equal(responseText.includes(email), false);
    assert.equal(responseText.includes(password), false);

    const persisted = await readFile(`${DEV_AUTH_STATE_DIR}/dev-auth-${runId}.json`, "utf8");
    assert.equal(persisted.includes(username), false);
    assert.equal(persisted.includes(email), false);
    assert.equal(persisted.includes(password), false);

    const page = context.pages().at(-1);
    assert.equal(await page.locator('input[name="username"]').inputValue(), username);
    assert.equal(await page.locator('input[name="email"]').inputValue(), email);
    assert.equal(await page.locator('input[name="password"]').inputValue(), password);
    assert.equal(page.url(), "https://ampblogs.com/signup");

    const duplicateStart = await startDevAmpBlogsAuth({
      context,
      runId,
      accountStatus: "new",
      credentials: { username: "different", email: "different@example.test", password: "different-secret" },
    });
    assert.equal(duplicateStart.status, "blocked");
    assert.equal(duplicateStart.run.duplicatePrevented, true);
    assert.equal(JSON.stringify(duplicateStart).includes("different-secret"), false);

    await page.goto("https://ampblogs.com/account-created");
    const outcome = await resumeDevAmpBlogsAuth({ context, runId });
    assert.equal(outcome.status, "outcome-detected");
    assert.equal(outcome.run.outcome, "ACCOUNT_CREATED");
    assert.equal(outcome.run.phase, DEV_AUTH_PHASES.OUTCOME_DETECTED);

    const reset = await resetDevAmpBlogsAuth({ runId });
    assert.equal(reset.status, "reset");
  } finally {
    await context.close();
    await browser.close();
  }
});

test("human auth resume stops on unexpected and authentication-error states", async () => {
  const { browser, context } = await createContext();
  let runId;
  try {
    const prepared = await prepareDevAmpBlogsAuth({ context, profile: profile() });
    runId = prepared.run.runId;
    await startDevAmpBlogsAuth({ context, runId, accountStatus: "existing", credentials: { username: "runtime-user", password: `runtime-${runId}` } });
    const page = context.pages().at(-1);
    await page.goto("https://ampblogs.com/maintenance");
    const unexpected = await resumeDevAmpBlogsAuth({ context, runId });
    assert.equal(unexpected.status, "blocked");
    assert.equal(unexpected.run.phase, DEV_AUTH_PHASES.AMBIGUOUS);
    assert.equal(unexpected.observation.pageState, "UNSUPPORTED");
    await resetDevAmpBlogsAuth({ runId });

    const second = await prepareDevAmpBlogsAuth({ context, profile: profile() });
    runId = second.run.runId;
    await startDevAmpBlogsAuth({ context, runId, accountStatus: "existing", credentials: { username: "runtime-user", password: `runtime-${runId}` } });
    const secondPage = context.pages().at(-1);
    await secondPage.goto("https://ampblogs.com/auth-error");
    const error = await resumeDevAmpBlogsAuth({ context, runId });
    assert.equal(error.status, "outcome-detected");
    assert.equal(error.run.outcome, "AUTH_ERROR");
    assert.equal(error.observation.pageState, "AUTH_ERROR");
    await resetDevAmpBlogsAuth({ runId });
  } finally {
    await context.close();
    await browser.close();
  }
});

test("human auth implementation contains no automatic final action", async () => {
  const source = await readFile(new URL("../ampblogs/human-auth.mjs", import.meta.url), "utf8");
  assert.equal(/\.click\(|\.check\(|requestSubmit|\.submit\(|\.press\(/.test(source), false);
});
