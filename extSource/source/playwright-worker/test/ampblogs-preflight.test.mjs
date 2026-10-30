import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { chromium } from "playwright";
import { AMP_BLOGS_PAGE_STATES, ampBlogsLocators, detectAmpBlogsPage, inspectCurrentPage, inspectPage, navigateAmpBlogsPage, observeAmpBlogs } from "../ampblogs/observer.mjs";
import { resumeAmpBlogsPreflight } from "../ampblogs/preflight.mjs";
import { validateAmpBlogsProfile, EXPECTED_AMP_BLOGS_BUSINESS } from "../ampblogs/profile.mjs";
import { readAmpBlogsSheet, validateAmpBlogsSheetRow } from "../ampblogs/sheets.mjs";
import { createAmpBlogsWorkflow, isReadOnlyAmpBlogsState, transitionAmpBlogsWorkflow } from "../ampblogs/workflow-state.mjs";

test("sheet row validation accepts only ampblogs.com and preserves A:C", () => {
  const result = validateAmpBlogsSheetRow(["https://ampblogs.com", "", "Live", "must-not-read"]);
  assert.equal(result.ok, true);
  assert.deepEqual(result.row, { directoryUrl: "https://ampblogs.com/", existingListingUrl: "", existingStatus: "Live" });
  assert.equal("must-not-read" in result.row, false);
});

test("sheet row validation rejects another directory and malformed existing URLs", () => {
  assert.equal(validateAmpBlogsSheetRow(["https://pages10.com", "", "Live"]).code, "row-mismatch");
  assert.equal(validateAmpBlogsSheetRow(["https://ampblogs.com", "not-a-url", "Live"]).code, "invalid-existing-url");
});

test("missing Sheets authorization returns blocked setup guidance without a network call", async () => {
  let calls = 0;
  const result = await readAmpBlogsSheet({ accessToken: "", fetchImpl: async () => { calls += 1; throw new Error("must not call"); } });
  assert.equal(result.status, "blocked");
  assert.equal(result.code, "sheets-authorization-missing");
  assert.equal(calls, 0);
  assert.ok(result.setupPlan.length >= 2);
});

test("Sheets client reads only Sheet1 A18:C18 with GET", async () => {
  let request;
  const result = await readAmpBlogsSheet({
    accessToken: "test-token",
    fetchImpl: async (url, init) => {
      request = { url: String(url), init };
      return new Response(JSON.stringify({ values: [["https://ampblogs.com", "https://ampblogs.com/example", "Live"]] }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  assert.equal(result.status, "ready");
  assert.equal(decodeURIComponent(new URL(request.url).pathname).endsWith("/values/Sheet1!A18:C18"), true);
  assert.equal(request.init.method, "GET");
  assert.equal(request.url.includes("D18"), false);
  assert.equal(request.url.includes("F18"), false);
});

test("profile gate accepts only the approved AmpBlogs business", () => {
  assert.equal(validateAmpBlogsProfile({ profileId: "profile-1", businessName: EXPECTED_AMP_BLOGS_BUSINESS }).ok, true);
  assert.equal(validateAmpBlogsProfile({ profileId: "profile-1", businessName: "Other Business" }).code, "profile-mismatch");
  assert.equal(validateAmpBlogsProfile(null).code, "profile-missing");
});

test("workflow transitions are explicit and reject unsafe jumps", () => {
  let run = createAmpBlogsWorkflow();
  run = transitionAmpBlogsWorkflow(run, "PREFLIGHT");
  run = transitionAmpBlogsWorkflow(run, "OPENING_SITE");
  run = transitionAmpBlogsWorkflow(run, "SIGNUP_DETECTED");
  run = transitionAmpBlogsWorkflow(run, "NEEDS_HUMAN", { reason: "read-only checkpoint" });
  assert.equal(run.state, "NEEDS_HUMAN");
  assert.throws(() => transitionAmpBlogsWorkflow(run, "COMPLETE"), /Invalid AmpBlogs transition/);
  assert.equal(isReadOnlyAmpBlogsState(run.state), true);
});

test("workflow can represent account-created and resume into authenticated observation", () => {
  let run = createAmpBlogsWorkflow();
  run = transitionAmpBlogsWorkflow(run, "PREFLIGHT");
  run = transitionAmpBlogsWorkflow(run, "OPENING_SITE");
  run = transitionAmpBlogsWorkflow(run, "SIGNUP_DETECTED");
  run = transitionAmpBlogsWorkflow(run, "ACCOUNT_CREATED", { pageState: AMP_BLOGS_PAGE_STATES.ACCOUNT_CREATED });
  run = transitionAmpBlogsWorkflow(run, "NEEDS_HUMAN");
  run = transitionAmpBlogsWorkflow(run, "AUTHENTICATED", { pageState: AMP_BLOGS_PAGE_STATES.AUTHENTICATED_DASHBOARD });
  assert.equal(run.state, "AUTHENTICATED");
  assert.equal(isReadOnlyAmpBlogsState("ACCOUNT_CREATED"), true);
});

test("AmpBlogs page detection reports auth controls, CAPTCHA, and Terms without values", () => {
  const result = detectAmpBlogsPage({
    url: "https://ampblogs.com/signup",
    title: "Signup ampblogs.com",
    bodyText: "Sign in to continue Assemble the puzzle captcha I have read and agree to the terms.",
    links: [],
    fields: [
      { name: "username", type: "text", label: "Username", visible: true, disabled: false },
      { name: "password", type: "password", label: "Password", value: "super-secret-password", visible: true, disabled: false },
      { name: "email", type: "text", label: "Email", visible: true, disabled: false },
      { name: "agree", type: "checkbox", label: "I have read and agree to the terms.", visible: true, disabled: false },
    ],
  });
  assert.equal(result.hasSignup, true);
  assert.equal(result.captcha, true);
  assert.equal(result.terms, true);
  assert.equal(JSON.stringify(result).includes("secret"), false);
  assert.equal(JSON.stringify(result).includes("super-secret-password"), false);
});

test("unsupported page state is detected without any form action", () => {
  const result = detectAmpBlogsPage({ url: "https://ampblogs.com/unknown", title: "Unexpected page", bodyText: "Maintenance", links: [], fields: [] });
  assert.equal(result.unsupported, true);
  assert.equal(result.hasSignup, false);
  assert.equal(result.hasLogin, false);
});

test("preflight observer source contains no form writer or submit calls", async () => {
  const source = await readFile(new URL("../ampblogs/observer.mjs", import.meta.url), "utf8");
  assert.equal(/\.fill\(|\.check\(|\.click\(|requestSubmit|\.submit\(/.test(source), false);
});

test("Playwright fixtures recognize every page state and use guarded navigation", async () => {
  const fixtureDir = new URL("./fixtures/", import.meta.url);
  const fixtures = new Map([
    ["/", "ampblogs-homepage.html"],
    ["/signup", "ampblogs-signup.html"],
    ["/login", "ampblogs-login.html"],
    ["/account-created", "ampblogs-account-created.html"],
    ["/dashboard", "ampblogs-dashboard.html"],
    ["/maintenance", "ampblogs-unsupported.html"],
  ]);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  await context.route("https://ampblogs.com/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const fixture = fixtures.get(path);
    if (!fixture) return route.fulfill({ status: 404, body: "not found" });
    return route.fulfill({ status: 200, contentType: "text/html", body: await readFile(new URL(fixture, fixtureDir), "utf8") });
  });
  try {
    const page = await context.newPage();
    const homepage = await inspectPage(page, "https://ampblogs.com/");
    assert.equal(homepage.pageState, AMP_BLOGS_PAGE_STATES.HOMEPAGE);
    assert.equal(homepage.locators.signupNavigation.length, 1);
    assert.equal(homepage.locators.loginNavigation.length, 1);
    const observedWorkflow = await observeAmpBlogs(context, "https://ampblogs.com/");
    assert.equal(observedWorkflow.pages.signup.pageState, AMP_BLOGS_PAGE_STATES.SIGNUP_FORM);
    assert.equal(observedWorkflow.pages.login.pageState, AMP_BLOGS_PAGE_STATES.LOGIN_FORM);

    const signup = await navigateAmpBlogsPage(page, "signup");
    assert.equal(signup.pageState, AMP_BLOGS_PAGE_STATES.SIGNUP_FORM);
    assert.equal(signup.locators.username.length, 1);
    assert.equal(signup.locators.email.length, 1);
    assert.equal(signup.locators.password.length, 1);
    assert.equal(signup.locators.captcha.container.length, 1);
    assert.equal(signup.locators.captcha.image.length, 1);
    assert.equal(signup.locators.captcha.answer.length, 1);
    assert.equal(signup.locators.captcha.present, true);
    assert.equal(await ampBlogsLocators(page).captchaContainer.count(), 1);
    assert.equal(await ampBlogsLocators(page).captchaImage.count(), 1);
    assert.equal(signup.locators.termsCheckbox.length, 1);
    assert.equal(await ampBlogsLocators(page).termsCheckbox.count() > 0, true);
    await page.goto("https://ampblogs.com/");
    const login = await navigateAmpBlogsPage(page, "login");
    assert.equal(login.pageState, AMP_BLOGS_PAGE_STATES.LOGIN_FORM);
    assert.equal(login.locators.loginNavigation.length, 0);
    assert.equal(login.locators.captcha.container.length, 1);
    assert.equal(login.locators.captcha.image.length, 0);
    assert.equal(login.locators.captcha.answer.length, 0);
    assert.equal(login.locators.signInButton.length, 1);
    assert.equal(login.locators.signInButton[0].selector, 'button[name="login"]');

    await page.goto("https://ampblogs.com/account-created");
    assert.equal((await inspectCurrentPage(page)).pageState, AMP_BLOGS_PAGE_STATES.ACCOUNT_CREATED);
    await page.goto("https://ampblogs.com/dashboard");
    assert.equal((await inspectCurrentPage(page)).pageState, AMP_BLOGS_PAGE_STATES.AUTHENTICATED_DASHBOARD);
    await page.goto("https://ampblogs.com/maintenance");
    assert.equal((await inspectCurrentPage(page)).pageState, AMP_BLOGS_PAGE_STATES.UNSUPPORTED);
    await assert.rejects(() => navigateAmpBlogsPage(page, "login"), /Guarded AmpBlogs navigation stopped/);
  } finally {
    await context.close();
    await browser.close();
  }
});

test("human-intervention resume observes the current dashboard without writing", async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  await context.route("https://ampblogs.com/**", (route) => route.fulfill({
    status: 200,
    contentType: "text/html",
    body: "<nav><a href='/logout'>Log Out</a></nav><h1>Dashboard</h1><a href='/dashboard/article/new'>New Article</a>",
  }));
  try {
    const page = await context.newPage();
    await page.goto("https://ampblogs.com/dashboard");
    let run = createAmpBlogsWorkflow();
    run = transitionAmpBlogsWorkflow(run, "PREFLIGHT");
    run = transitionAmpBlogsWorkflow(run, "OPENING_SITE");
    run = transitionAmpBlogsWorkflow(run, "SIGNUP_DETECTED");
    run = transitionAmpBlogsWorkflow(run, "NEEDS_HUMAN");
    const result = await resumeAmpBlogsPreflight({ context, run, page });
    assert.equal(result.status, "needs-human");
    assert.equal(result.observation.pageState, AMP_BLOGS_PAGE_STATES.AUTHENTICATED_DASHBOARD);
    assert.equal(result.run.state, "NEEDS_HUMAN");
    assert.equal(JSON.stringify(result).includes("super-secret"), false);
  } finally {
    await context.close();
    await browser.close();
  }
});
