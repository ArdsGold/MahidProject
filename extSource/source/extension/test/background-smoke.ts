import assert from "node:assert/strict";
import type { BusinessProfile } from "@backlink-autofill/shared";
import { Window } from "happy-dom";
import { articleExpectation, verifyPublicArticleHtml } from "../src/automation/verification";
import { observeBlogWorkflow } from "../src/automation/blog-workflow";
import { loginGuardKey, registrationRecoveryValid, createListingRun, writeListingRun, publicationProfileFingerprint, type ListingRun } from "../src/listing-run";

const documentRef = new Window().document as unknown as Document;

const profile: BusinessProfile = {
  id: "background-smoke-profile",
  businessName: "AmpBlogs Smoke Business",
  firstName: "Smoke",
  lastName: "Business",
  contactName: "Smoke Business",
  username: "ampblogs-smoke-user",
  email: "ampblogs-smoke@example.test",
  password: "not-a-real-password",
  phone: "555-0100",
  website: "https://example.test",
  imageUrl: "",
  address: "1 Test Street",
  completeAddress: "1 Test Street, Testville, TS 12345, Testland",
  city: "Testville",
  state: "TS",
  postalCode: "12345",
  country: "Testland",
  description: "Our independent smoke test business provides careful local services with reliable scheduling and helpful customer support every working day.",
  shortDescription: "Smoke test.",
  category: "Testing",
  services: ["Testing"],
  facebook: "",
  instagram: "",
  linkedin: "",
  twitter: "",
  youtube: "",
  tiktok: "",
  pinterest: "",
  socialLinks: [],
  businessHours: [],
  logoUrl: "",
  brochureUrl: "",
  internalLinks: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

type Observation = {
  supported: boolean;
  pageState: string;
  url: string;
  title: string;
  loginHref?: string;
  signupHref?: string;
  startNowHref?: string;
  captcha: boolean;
  captchaState: "absent" | "present" | "verified";
  terms: boolean;
};

const storage: Record<string, unknown> = {};
const interrupted = createListingRun("https://blogocial.com/new", profile.id, 42);
interrupted.stage = "VERIFYING_SUCCESS";
interrupted.publicVerification = { status: "verifying", candidateUrl: "https://smoke.blogocial.com/article-1", attemptId: "interrupted", reason: "checking" };
storage["ba2.listingRun"] = interrupted;
let sheetBackendCalls = 0;
let sheetPreparationCalls = 0;
let sheetSessionKey: string | undefined;
let sheetBackendLost = false;
let sheetBackendStatus = "recorded";
let sheetReadBackConfirmed = true;
let mutateOnSheetIntent: (() => void) | undefined;
let fetchCount = 0;
let fetchScenario = "valid";
let releaseFetch: (() => void) | undefined;
const publicUrl = "https://hotmesscleanupjunkremoval.blogocial.com/hot-mess-cleanup-junk-removal-79619470";
const expectedArticle = articleExpectation(profile.businessName, profile.description, documentRef);
globalThis.fetch = async (input, init) => {
  if (String(input).startsWith("http://localhost:3000/api/google-sheets/write-back")) {
    const preparing = new URL(String(input)).searchParams.get('mode') === 'prepare';
    if (preparing) sheetPreparationCalls += 1;
    else sheetBackendCalls += 1;
    assert.equal(init?.credentials, "omit");
    assert.equal(init?.redirect, "error");
    assert.equal(new Headers(init?.headers).get("x-ba2-sheets-key"), sheetSessionKey);
    const body = JSON.parse(String(init?.body));
    assert.equal(body.publicationAuthorized, true);
    assert.equal(body.verification.status, "verified");
    assert.equal(body.verification.url, body.liveUrl);
    assert.equal("password" in body, false);
    assert.equal("username" in body, false);
    assert.equal("profile" in body, false);
    assert.equal("expectedArticle" in body, false);
    assert.equal((storage["ba2.listingRun"] as ListingRun).sheetSync?.status, "syncing", "sync intent must persist before backend dispatch");
    if (sheetBackendLost) throw Error("fixture backend disconnected after possible write");
    return Response.json({ status: preparing ? 'ready' : sheetBackendStatus, code: "fixture-result", rowNumber: 23, range: "Sheet1!B23", readBackConfirmed: !preparing && sheetReadBackConfirmed });
  }
  fetchCount += 1;
  assert.equal(init?.credentials, "omit");
  assert.equal(init?.redirect, "manual");
  assert.equal(init?.referrerPolicy, "no-referrer");
  assert.equal(init?.cache, "no-store");
  assert.equal(init?.headers, undefined, "no authorization/token headers may be sent");
  if (fetchScenario === "network" || fetchScenario === "blocked-redirect") throw new TypeError("fixture network or redirect rejection");
  if (fetchScenario === "pending") await new Promise<void>((resolve) => { releaseFetch = resolve; });
  const html = fetchScenario === "wrong" ? "<article><h1>Unrelated business</h1><p>Unrelated article.</p></article>"
    : fetchScenario === "suspended" ? `<title>Account suspended</title><article><h1>${profile.businessName}</h1><p>${profile.description}</p></article>`
    : fetchScenario === "login-html" ? '<form><input type="password"></form>'
    : `<article><h1>${profile.businessName}</h1><p>${profile.description}</p></article>`;
  const response = new Response(html, { status: fetchScenario === "unavailable" ? 404 : 200, headers: { "content-type": "text/html; charset=utf-8" } });
  Object.defineProperty(response, "url", { value: fetchScenario === "login-redirect" ? "https://blogocial.com/login" : fetchScenario === "unrelated-redirect" ? "https://unrelated.test/other-article" : String(input) });
  Object.defineProperty(response, "redirected", { value: fetchScenario.endsWith("redirect") });
  return response;
};
let activeProfile = false;
let currentTab = { id: 42, url: "https://ampblogs.com/" };
let extraOpenTabs: Array<{ id: number; url: string }> = [];
let observation: Observation = {
  supported: true,
  pageState: "HOMEPAGE",
  url: currentTab.url,
  title: "AmpBlogs",
  loginHref: "https://ampblogs.com/login",
  signupHref: "https://ampblogs.com/signup",
  startNowHref: "https://ampblogs.com/signup",
  captcha: false,
  captchaState: "absent",
  terms: false,
};
let automaticLoginChecks = { ok: false, captcha: "pending", reason: "Complete CAPTCHA on site" };
let automaticLoginFills = 0;
let automaticLoginSubmits = 0;
let automaticLoginLost = false;
let automaticLoginWatches = 0;
let automaticRegistrationChecks = { ok: false, captcha: 'absent', reason: 'Review Terms manually' };
let automaticRegistrationSubmits = 0;
let automaticRegistrationFills = 0;
let automaticRegistrationLost = false;
let loginFillCount = 0;
let loginSubmitCount = 0;
let genericWorkflowResponse: unknown = null;
let publicationDispatches = 0;
let genericFills = 0;
let publicationValidationError: string | undefined;
let publicationDelivery = "ok";
let publicationObservation: unknown = { stage: "EDITOR", confidence: 0.95, reason: "editor unchanged" };
let publicationReaderMissing = false;
let publicationReaderInjections = 0;
let publicationWatches = 0;
let releasePublication: (() => void) | undefined;
let logoRetrievals = 0;
let logoAttachMode: "undefined" | "success" | undefined;
let logoAttachCalls = 0;
let emptyListingReply = false;
let emptyValidationReply = false;
let dashboardAssets: { available: boolean; injectionCount: number; messages: number; url: string; applicationError?: string; transportError?: string; navigateOnInjection?: boolean; failInjection?: boolean; keepMissing?: boolean } | undefined;
const updates: string[] = [];
let navigationUpdateHook: (() => Promise<void>) | undefined;
let runtimeListener: ((message: unknown, sender: unknown, sendResponse: (response: unknown) => void) => unknown) | undefined;
let tabUpdatedListener: ((tabId: number, changeInfo: { status?: string; url?: string }) => void) | undefined;
let tabRemovedListener: ((tabId: number) => void) | undefined;
let tabReplacedListener: ((addedTabId: number, removedTabId: number) => void) | undefined;
const missingTabs = new Set<number>();
const tabLookupErrors = new Map<number, string>();

const event = () => ({ addListener: (listener: (...args: any[]) => unknown) => listener });
(globalThis as Record<string, unknown>).chrome = {
  runtime: {
    id: "a".repeat(32),
    getURL: (path: string) => "chrome-extension://" + "a".repeat(32) + "/" + path,
    onInstalled: event(),
    onMessage: { addListener: (listener: typeof runtimeListener) => { runtimeListener = listener; } },
  },
  tabs: {
    onUpdated: { addListener: (listener: typeof tabUpdatedListener) => { tabUpdatedListener = listener; } },
    onRemoved: { addListener: (listener: typeof tabRemovedListener) => { tabRemovedListener = listener; } },
    onReplaced: { addListener: (listener: typeof tabReplacedListener) => { tabReplacedListener = listener; } },
    query: async (options?: { url?: string[]; active?: boolean }) => options?.url && dashboardAssets ? [{ id: 84, url: dashboardAssets.url }] : options?.active ? [currentTab] : [currentTab, ...extraOpenTabs],
    get: async (tabId: number) => {
      if (tabLookupErrors.has(tabId)) throw Error(tabLookupErrors.get(tabId));
      if (missingTabs.has(tabId)) throw Error(`No tab with id: ${tabId}`);
      return tabId === 84 && dashboardAssets ? { id: 84, url: dashboardAssets.url } : extraOpenTabs.find(tab => tab.id === tabId) || currentTab;
    },
    update: async (_tabId: number, patch: { url?: string }) => {
      if (patch.url) {
        const extra = extraOpenTabs.find(tab => tab.id === _tabId);
        if (extra) extra.url = patch.url;
        else currentTab = { ...currentTab, url: patch.url };
        updates.push(patch.url);
      }
      await navigationUpdateHook?.();
      return currentTab;
    },
    sendMessage: async (_tabId: number, message: { type: string }, options?: { frameId?: number }) => {
      if (message.type === 'BA2_AUTOFILL') {
        const request = message as { type: string; loginOnly?: { profileId: string; profileUpdatedAt: string; url: string } };
        assert.equal(options?.frameId, 0);
        assert.deepEqual(request.loginOnly, { profileId: profile.id, profileUpdatedAt: profile.updatedAt, url: currentTab.url });
        return { ok: true, report: { profileName: profile.businessName, filled: [], skipped: [] } };
      }
      if (message.type === "BA2_ATTACH_PROFILE_LOGO" && logoAttachMode) {
        logoAttachCalls += 1;
        return logoAttachMode === "undefined" ? undefined : { ok: true, fileName: "fixture.png", fileSize: 3, fileType: "image/png", diagnostics: [] };
      }
      if (_tabId === 84 && dashboardAssets && ["BA2_GET_PROFILE_LOGO", "BA2_GET_PROFILE_BROCHURE"].includes(message.type)) {
        dashboardAssets.messages += 1;
        if (dashboardAssets.transportError) throw Error(dashboardAssets.transportError);
        if (!dashboardAssets.available) throw Error("Could not establish connection. Receiving end does not exist.");
        assert.equal(options?.frameId, 0, "asset reads must target dashboard top frame only");
        if (dashboardAssets.applicationError) return { ok: false, error: dashboardAssets.applicationError };
        return { ok: true, fileName: "fixture.png", mimeType: "image/png", data: [1, 2, 3], size: 3, diagnostics: ["Ownership verified"] };
      }
      if (message.type === "BA2_LOGIN_PREPARE") {
        assert.equal(options?.frameId, 0);
        const saved = storage["ba2.listingRun"] as ListingRun;
        assert.equal(saved.autoLogin, true);
        assert.ok(saved.loginApproval?.authorizedAt, "approval must persist before account fill");
        if ((message as { fill?: boolean }).fill) automaticLoginFills += 1;
        return automaticLoginChecks;
      }
      if (message.type === "BA2_LOGIN_SUBMIT_ONCE") {
        assert.equal(options?.frameId, 0);
        const saved = storage["ba2.listingRun"] as ListingRun;
        assert.equal(saved.login?.state, "intent");
        assert.ok(saved.login?.attemptId);
        assert.equal(saved.submissionAttempted, undefined, "login intent must not become article intent");
        assert.equal((storage[loginGuardKey(saved)] as { state: string }).state, "intent");
        automaticLoginSubmits += 1;
        if (automaticLoginLost) throw Error("synthetic delivery interruption");
        return { ok: true };
      }
      if (message.type === "BA2_LOGIN_WATCH") { automaticLoginWatches += 1; return { ok: true }; }
      if (message.type === "BA2_GET_PROFILE_LOGO") {
        logoRetrievals += 1;
        throw new Error("Could not establish connection. Receiving end does not exist.");
      }
      if (["BA2_BLOG_PUBLISH_ONCE", "BA2_BLOG_VALIDATE", "BA2_BLOG_OBSERVE"].includes(message.type)) assert.equal(options?.frameId, 0, "publication commands must target only the existing top frame");
      if (message.type === "BA2_BLOG_VALIDATE") {
        const saved = storage["ba2.listingRun"] as ListingRun;
        assert.equal(saved.autoPublish, true, "authorization must persist before validation");
        assert.ok(saved.publicationApproval?.authorizedAt);
        if (emptyValidationReply) return undefined;
        return { ok: !publicationValidationError, error: publicationValidationError };
      }
      if (message.type === "BA2_BLOG_PUBLISH") assert.fail("legacy unguarded publication command must never be sent");
      if (message.type === "BA2_BLOG_PUBLISH_ONCE") {
        publicationDispatches += 1;
        const saved = storage["ba2.listingRun"] as ListingRun;
        assert.equal(saved.submissionAttempted, true, "intent must precede message dispatch");
        assert.equal(saved.stage, "SUBMITTING");
        assert.equal(saved.publicationSubmission?.attemptId, (message as { type: string; attemptId: string }).attemptId);
        assert.ok(Object.keys(storage).some((key) => key.startsWith("ba2.publicationGuard:") && (storage[key] as { runId: string }).runId === saved.id), "duplicate guard must persist with intent");
        if (publicationDelivery === "pending") await new Promise<void>((resolve) => { releasePublication = resolve; });
        if (publicationDelivery === "lost") throw new Error("fixture disconnected after potential click");
        if (publicationDelivery === "no-reply") return undefined;
        return { ok: true };
      }
      if (message.type === "BA2_BLOG_OBSERVE") {
        if (publicationReaderMissing) throw Error('Could not establish connection. Receiving end does not exist.');
        return publicationObservation;
      }
      if (message.type === 'BA2_WATCH_PUBLICATION') { publicationWatches += 1; return { ok: true }; }
      if (message.type === 'BA2_REGISTRATION_PREPARE') {
        const saved = storage['ba2.listingRun'] as ListingRun;
        assert.equal(saved.autoRegister, true);
        assert.equal(saved.accountStatus, 'new');
        assert.ok(saved.registrationApproval?.authorizedAt);
        assert.equal(options?.frameId, 0);
        if ((message as { fill?: boolean }).fill) automaticRegistrationFills++;
        return automaticRegistrationChecks;
      }
      if (message.type === 'BA2_REGISTRATION_SUBMIT_ONCE') {
        const saved = storage['ba2.listingRun'] as ListingRun;
        assert.equal(saved.registration?.state, 'intent');
        assert.equal(saved.submissionAttempted, undefined, 'registration never creates a publication intent');
        assert.equal((storage[`ba2.registrationGuard:${new URL(saved.sourceUrl).origin}:${saved.profileId}`] as { runId: string }).runId, saved.id);
        automaticRegistrationSubmits++;
        if (automaticRegistrationLost) throw Error('fixture lost registration response');
        return { ok: true, captcha: 'absent', reason: 'fixture registration delivered' };
      }
      if (message.type === 'BA2_REGISTRATION_WATCH') return { ok: true };
      if (message.type === "BA2_VERIFY_PUBLIC_ARTICLE") {
        const request = message as unknown as { html: string; expected: typeof expectedArticle; responseUrl?: string };
        return verifyPublicArticleHtml(request.html, request.expected, documentRef, request.responseUrl);
      }
      if (message.type === "BA2_BUILD_ARTICLE_EXPECTATION") {
        const request = message as unknown as { title: string; html: string };
        return articleExpectation(request.title, request.html, documentRef);
      }
      if (message.type === "BA2_LISTING_AUTOFILL") {
        genericFills += 1;
        if (emptyListingReply) return undefined;
        const saved = storage["ba2.listingRun"] as ListingRun;
        if (saved.autoPublish) {
          assert.ok(saved.publicationApproval, "per-run authorization must persist before workflow autofill");
          assert.equal(options?.frameId, 0, "authorized editor autofill must not accept a child-frame response");
        }
        if (!genericWorkflowResponse) throw new Error("Generic workflow response not configured");
        return genericWorkflowResponse;
      }
      if (message.type === 'BA2_GET_ACTIVE_PROFILE') return { ok: true, profileName: profile.businessName, syncedAt: null };
      if (message.type === "BA2_AMPBLOGS_OBSERVE") return { ok: true, observation: { ...observation, url: currentTab.url } };
      if (message.type === "BA2_AMPBLOGS_LOGIN_AUTOFILL") {
        loginFillCount += 1;
        return { ok: true, report: { profileName: profile.businessName, filled: [{ field: "username", descriptor: "input name=\"username\"", value: profile.username }, { field: "password", descriptor: "input name=\"password\"", value: "[masked]" }], skipped: [], manual: ["CAPTCHA"] } };
      }
      if (message.type === "BA2_AMPBLOGS_SUBMIT_LOGIN") {
        loginSubmitCount += 1;
        return { ok: true };
      }
      throw new Error(`Unexpected tab message ${message.type}`);
    },
  },
  scripting: { executeScript: async (options: { target: { tabId: number; frameIds?: number[] }; files: string[] }) => {
    if (options.files.includes('content/publication-reader.js')) {
      assert.deepEqual(options.target.frameIds, [0]);
      assert.deepEqual(options.files, ['content/publication-reader.js']);
      publicationReaderInjections++;
      publicationReaderMissing = false;
    }
    if (options.target.tabId === 84 && dashboardAssets) {
      assert.deepEqual(options.target.frameIds, [0]);
      assert.deepEqual(options.files, ["content/dashboard-assets.js"], "repair must not reinject automation/profile-sync code");
      dashboardAssets.injectionCount += 1;
      if (dashboardAssets.failInjection) throw Error("Cannot access contents of the page");
      dashboardAssets.available = !dashboardAssets.keepMissing;
      if (dashboardAssets.navigateOnInjection) dashboardAssets.url = "https://untrusted.test/";
    }
  } },
  storage: {
    session: { get: async (key: string) => ({ [key]: sheetSessionKey }) },
    onChanged: { addListener: () => undefined },
    local: {
      get: async (key: string | string[] | null) => {
        if (key === null) return { ...storage };
        if (Array.isArray(key)) return Object.fromEntries(key.map(item => [item, storage[item]]));
        if (key === "ba2.activeProfile") return { [key]: activeProfile ? { profile, syncedAt: "2026-10-15T00:00:00.000Z", source: "local-storage" } : undefined };
        return { [key]: storage[key] };
      },
      set: async (values: Record<string, unknown>) => { Object.assign(storage, values); if ((values["ba2.listingRun"] as ListingRun | undefined)?.sheetSync?.status === "syncing") mutateOnSheetIntent?.(); },
    },
  },
} as unknown as typeof chrome;

const background = await import("../src/background");

function dispatch(message: unknown, sender: unknown = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    if (!runtimeListener) return reject(new Error("background runtime listener was not registered"));
    void runtimeListener(message, sender, resolve);
  });
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 5));
}

await flush();
assert.equal((storage["ba2.listingRun"] as ListingRun).publicVerification?.status, "unverified", "worker startup must mark interrupted verification unverified");
assert.equal((storage["ba2.listingRun"] as ListingRun).awaitingManualResume, false);
assert.equal(fetchCount, 0, "startup must not repeat an interrupted request");
storage["ba2.listingRun"] = undefined;

activeProfile = false;
const startupFailure = await dispatch({ type: "BA2_START_LISTING_AUTOFILL" });
assert.equal(startupFailure.ok, false, "missing active profile must produce a visible startup failure");
assert.match(startupFailure.error, /No active profile/);

activeProfile = true;
const started = await dispatch({ type: "BA2_START_LISTING_AUTOFILL" });
assert.equal(started.ok, true, "one AUTOFILL command should start a persisted AmpBlogs run");
assert.deepEqual(updates, ["https://ampblogs.com/login"], "one click should navigate the existing tab to login");

currentTab = { ...currentTab, url: "https://ampblogs.com/login" };
observation = { ...observation, pageState: "LOGIN_FORM", url: currentTab.url, loginHref: undefined, captcha: true, captchaState: "present" };
tabUpdatedListener?.(42, { status: "complete", url: currentTab.url });
await flush();
assert.equal(loginFillCount, 1, "navigation resume should fill the login form once");
assert.equal(loginSubmitCount, 0, "CAPTCHA checkpoint must not submit automatically");

const blockedAuthorization = await dispatch({ type: "BA2_START_LISTING_AUTOFILL" });
assert.equal(blockedAuthorization.ok, false, "authorization must remain blocked while CAPTCHA is present");
assert.match(blockedAuthorization.error, /CAPTCHA/);

observation = { ...observation, captcha: false, captchaState: "absent" };
const authorized = await dispatch({ type: "BA2_START_LISTING_AUTOFILL" });
assert.equal(authorized.ok, true, "explicit AUTOFILL retry should authorize login after CAPTCHA verification");
assert.equal(loginSubmitCount, 1, "authorized login should submit exactly once");

const duplicate = await dispatch({ type: "BA2_START_LISTING_AUTOFILL" });
assert.equal(duplicate.ok, true, "a duplicate retry should remain a status check, not a second submission");
assert.equal(loginSubmitCount, 1, "duplicate authorization must not submit twice");

currentTab = { ...currentTab, url: "https://ampblogs.com/dashboard" };
observation = { ...observation, pageState: "AUTHENTICATED_DASHBOARD", url: currentTab.url };
tabUpdatedListener?.(42, { status: "complete", url: currentTab.url });
await flush();
const completedRun = storage["ba2.listingRun"] as { ampBlogsState?: string; awaitingManualResume?: boolean };
assert.equal(completedRun.ampBlogsState, "AUTHENTICATED_DASHBOARD", "interrupted navigation should resume into authenticated dashboard detection");
assert.equal(completedRun.awaitingManualResume, false, "authenticated outcome should end the manual resume checkpoint");

storage["ba2.listingRun"] = undefined;
currentTab = { ...currentTab, url: "https://ampblogs.com/" };
observation = { ...observation, pageState: "HOMEPAGE", url: currentTab.url, loginHref: "https://ampblogs.com/login", signupHref: "https://ampblogs.com/signup", startNowHref: "https://ampblogs.com/signup" };
const registrationStart = await dispatch({ type: "BA2_START_LISTING_AUTOFILL", ampBlogsAccountStatus: "new" });
assert.equal(registrationStart.ok, true, "explicit registration status should be accepted without changing the default login path");
assert.equal(updates.at(-1), "https://ampblogs.com/signup", "explicit registration should navigate through Start now/Sign Up in the existing tab");

storage["ba2.listingRun"] = undefined;
currentTab = { id: 42, url: "https://blogocial.com/posts" };
genericWorkflowResponse = { ok: true, report: { profileName: profile.businessName, filled: [], skipped: [], manual: [], workflow: { stage: "AUTHENTICATED_DASHBOARD", confidence: 0.95, action: { kind: "new-post", label: "New post", href: "https://blogocial.com/new" }, reason: "dashboard" } } };
const dashboardStart = await dispatch({ type: "BA2_START_LISTING_AUTOFILL" });
assert.equal(dashboardStart.ok, true, "generic dashboard workflow should start from the existing tab");
assert.equal(updates.at(-1), "https://blogocial.com/new", "generic dashboard should navigate to the current-page New post action");

currentTab = { id: 42, url: "https://blogocial.com/new" };
genericWorkflowResponse = { ok: true, report: { profileName: profile.businessName, filled: [{ field: "businessName", descriptor: "input name=\"title\"", value: profile.businessName }, { field: "description", descriptor: "CKEditor content", value: "<p>body</p>" }], expectedArticle, skipped: [], manual: ["Final Submit"], workflow: { stage: "EDITOR", confidence: 0.95, reason: "editor" } } };
tabUpdatedListener?.(42, { status: "complete", url: currentTab.url });
await flush();
const editorRun = storage["ba2.listingRun"] as { stage?: string; awaitingManualResume?: boolean; manual?: string[] };
assert.equal(editorRun.stage, "MANUAL_GATE", "generic editor completion should stop at manual publication review");
assert.equal(editorRun.awaitingManualResume, true, "editor publication review should resume after a later page transition");
assert.ok(editorRun.manual?.includes("Final Submit"), "generic editor run must keep final publication manual");

currentTab = { id: 42, url: "https://blogocial.com/new" };
genericWorkflowResponse = { ok: true, report: { profileName: profile.businessName, filled: [], skipped: [], manual: [], workflow: { stage: "CONFIRMATION", confidence: 0.95, publicationEvidence: true, publicUrl, reason: "published" } } };
tabUpdatedListener?.(42, { status: "complete", url: currentTab.url });
await flush();
const confirmationRun = storage["ba2.listingRun"] as { stage?: string; liveUrl?: string };
assert.equal(confirmationRun.stage, "COMPLETE", "generic confirmation should complete the current ListingRun");
assert.equal(confirmationRun.liveUrl, publicUrl, "generic confirmation should preserve only the anonymously verified public URL");
assert.equal((storage["ba2.listingRun"] as ListingRun).publicVerification?.status, "verified");
const fetchesAfterSuccess = fetchCount;
await dispatch({ type: "BA2_START_LISTING_AUTOFILL" });
tabUpdatedListener?.(42, { status: "complete" });
await flush();
assert.equal(fetchCount, fetchesAfterSuccess, "completed verification must not repeat");

for (const scenario of ["wrong", "unavailable", "login-html", "login-redirect", "unrelated-redirect", "network", "blocked-redirect", "pending", "external", "no-evidence", "no-expectation"]) {
  currentTab = { id: 42, url: "https://blogocial.com/new" };
  fetchScenario = scenario;
  const run = createListingRun("https://blogocial.com/new", profile.id, 42);
  run.stage = "MANUAL_GATE";
  run.awaitingManualResume = true;
  if (scenario !== "no-expectation") run.expectedArticle = expectedArticle;
  storage["ba2.listingRun"] = run;
  genericWorkflowResponse = { ok: true, report: { profileName: profile.businessName, filled: [], skipped: [], manual: [], workflow: { stage: "CONFIRMATION", confidence: 0.95, publicationEvidence: scenario !== "no-evidence", publicUrl: scenario === "external" ? "https://unrelated.test/other-article" : publicUrl, reason: "published" } } };
  const before: number = fetchCount;
  const resultPromise = dispatch({ type: "BA2_START_LISTING_AUTOFILL" });
  if (scenario === "pending") {
    await flush();
    await dispatch({ type: "BA2_START_LISTING_AUTOFILL" });
    tabUpdatedListener?.(42, { status: "complete" });
    assert.equal(fetchCount, before + 1, "concurrent starts and tab events share one verification");
    releaseFetch?.();
  }
  await resultPromise;
  const checked = storage["ba2.listingRun"] as ListingRun;
  const expectedStatus = scenario === "pending" ? "verified" : ["network", "blocked-redirect", "external", "no-evidence", "no-expectation"].includes(scenario) ? "unverified" : "failed";
  assert.equal(checked.publicVerification?.status, expectedStatus, scenario);
  assert.equal(checked.liveUrl, expectedStatus === "verified" ? publicUrl : undefined, scenario);
  assert.equal(checked.awaitingManualResume, false, scenario);
  assert.equal(fetchCount, before + (["external", "no-evidence", "no-expectation"].includes(scenario) ? 0 : 1));
  await dispatch({ type: "BA2_START_LISTING_AUTOFILL" });
  assert.equal(fetchCount, before + (["external", "no-evidence", "no-expectation"].includes(scenario) ? 0 : 1), "terminal failures must not refetch or refill");
}

// A late response must not resurrect an old run after the operator moves to another workflow.
fetchScenario = "pending";
const oldRun = createListingRun("https://blogocial.com/new", profile.id, 42);
oldRun.expectedArticle = expectedArticle;
oldRun.stage = "MANUAL_GATE";
oldRun.awaitingManualResume = true;
storage["ba2.listingRun"] = oldRun;
genericWorkflowResponse = { ok: true, report: { profileName: profile.businessName, filled: [], skipped: [], manual: [], workflow: { stage: "CONFIRMATION", confidence: 0.95, publicationEvidence: true, publicUrl, reason: "published" } } };
const oldRequest = dispatch({ type: "BA2_START_LISTING_AUTOFILL" });
await flush();
const replacement = createListingRun("https://citation.test/form", profile.id, 42);
storage["ba2.listingRun"] = replacement;
releaseFetch?.();
await oldRequest;
assert.equal((storage["ba2.listingRun"] as ListingRun).id, replacement.id, "late verification must not overwrite a replacement citation run");

storage["ba2.listingRun"] = { ...oldRun, stage: "COMPLETE", awaitingManualResume: false, publicVerification: { status: "verified", candidateUrl: publicUrl, confirmationUrl: "https://blogocial.com/new", attemptId: "finished", reason: "verified" } };
currentTab = { id: 42, url: "https://citation.test/dashboard" };
genericWorkflowResponse = { ok: true, report: { profileName: profile.businessName, filled: [], skipped: [], manual: [], workflow: { stage: "AUTHENTICATED_DASHBOARD", confidence: 0.95, action: { kind: "new-post", label: "New post", href: "https://citation.test/new" }, reason: "dashboard" } } };
await dispatch({ type: "BA2_START_LISTING_AUTOFILL" });
assert.equal(updates.at(-1), "https://citation.test/new", "verification deduplication must not block later workflows in the same Chrome tab");

assert.equal(publicationDispatches, 0, "existing verification and default-OFF paths must never publish");

function autoEditorFixture(host: string): void {
  storage["ba2.listingRun"] = undefined;
  currentTab = { id: 42, url: `https://${host}/new` };
  genericWorkflowResponse = { ok: true, report: { profileName: profile.businessName, filled: [{ field: "businessName", descriptor: "title", value: profile.businessName }, { field: "description", descriptor: "editor", value: profile.description }], expectedArticle, skipped: [], manual: ["Final Submit"], workflow: { stage: "EDITOR", confidence: 0.95, reason: "editor" } } };
  publicationValidationError = undefined;
  publicationDelivery = "ok";
  publicationObservation = { stage: "EDITOR", confidence: 0.95, reason: "unchanged editor" };
  fetchScenario = "valid";
}

autoEditorFixture("authorization.test");
await dispatch({ type: "BA2_START_LISTING_AUTOFILL" });
assert.equal((storage["ba2.listingRun"] as ListingRun).autoPublish, false);
assert.equal(publicationDispatches, 0);
const rejectedUpgrade = await dispatch({ type: "BA2_START_LISTING_AUTOFILL", autoPublish: true });
assert.equal(rejectedUpgrade.ok, false, "an active unapproved run cannot be silently upgraded");
assert.equal(publicationDispatches, 0);

autoEditorFixture("validation.test");
publicationValidationError = "Complete CAPTCHA manually before publication.";
await dispatch({ type: "BA2_START_LISTING_AUTOFILL", autoPublish: true });
assert.equal((storage["ba2.listingRun"] as ListingRun).submissionAttempted, undefined, "validation failure must not create intent");
assert.equal((storage["ba2.listingRun"] as ListingRun).stage, "MANUAL_GATE");
assert.equal(publicationDispatches, 0);
const fillsBeforeResume = genericFills;
publicationValidationError = undefined;
await dispatch({ type: "BA2_START_LISTING_AUTOFILL" });
assert.equal(genericFills, fillsBeforeResume, "human checkpoint continuation must validate without overwriting manually completed fields");
assert.equal(publicationDispatches, 1);
assert.equal((storage["ba2.listingRun"] as ListingRun).publicationSubmission?.outcome, "uncertain", "no confirmation must never mean success");
await dispatch({ type: "BA2_START_LISTING_AUTOFILL", autoPublish: true });
tabUpdatedListener?.(42, { status: "complete" });
await flush();
assert.equal(publicationDispatches, 1, "uncertain outcomes cannot redispatch");
assert.equal(genericFills, fillsBeforeResume, "post-intent resume is observation only");
storage["ba2.listingRun"] = createListingRun("https://another.test/", profile.id, 99);
const uncertainReceipt = await dispatch({ type: "BA2_START_LISTING_AUTOFILL", autoPublish: true });
assert.equal(uncertainReceipt.ok, false, "uncertain receipt must survive current-run replacement");
assert.match(uncertainReceipt.error, /duplicate publication is blocked/);
assert.equal(publicationDispatches, 1);

autoEditorFixture("lost-response.test");
publicationDelivery = "lost";
await dispatch({ type: "BA2_START_LISTING_AUTOFILL", autoPublish: true });
assert.equal(publicationDispatches, 2, "lost response gets only one dispatch");
assert.equal((storage["ba2.listingRun"] as ListingRun).publicationSubmission?.outcome, "uncertain");
await background.recoverListingRun();
assert.equal(publicationDispatches, 2, "worker recovery observes without retrying uncertain intent");
publicationObservation = { stage: "CONFIRMATION", confidence: 0.95, publicationEvidence: true, publicUrl: "https://lost-response.test/article-1", reason: "Article published" };
tabUpdatedListener?.(42, { status: "complete" });
await flush();
assert.equal((storage["ba2.listingRun"] as ListingRun).publicVerification?.status, "verified", "later confirmation must resume anonymous public verification");
assert.equal(publicationDispatches, 2);

// A new run/tab must not erase a known publication receipt for the same publisher/profile.
storage["ba2.listingRun"] = createListingRun("https://other-workflow.test/", profile.id, 99);
const duplicateReceipt = await dispatch({ type: "BA2_START_LISTING_AUTOFILL", autoPublish: true });
assert.equal(duplicateReceipt.ok, false);
assert.match(duplicateReceipt.error, /duplicate publication is blocked/);
assert.equal(publicationDispatches, 2);

autoEditorFixture("concurrent-publication.test");
publicationDelivery = "pending";
const initialPublication = dispatch({ type: "BA2_START_LISTING_AUTOFILL", autoPublish: true });
await flush();
const repeatedPublication = dispatch({ type: "BA2_START_LISTING_AUTOFILL", autoPublish: true });
await flush();
assert.equal(publicationDispatches, 3, "simultaneous starts must share one intent");
releasePublication?.();
await Promise.all([initialPublication, repeatedPublication]);
assert.equal(publicationDispatches, 3);
await background.recoverListingRun();
assert.equal(publicationDispatches, 3);

autoEditorFixture("interrupted-intent.test");
const interruptedIntent = createListingRun(currentTab.url, profile.id, currentTab.id);
interruptedIntent.autoPublish = true;
interruptedIntent.stage = "SUBMITTING";
interruptedIntent.submissionAttempted = true;
interruptedIntent.awaitingManualResume = true;
interruptedIntent.publicationSubmission = { attemptId: "interrupted-before-delivery", url: currentTab.url, startedAt: new Date().toISOString(), outcome: "intent" };
storage["ba2.listingRun"] = interruptedIntent;
const interruptedFillCount = genericFills;
await background.recoverListingRun();
assert.equal((storage["ba2.listingRun"] as ListingRun).publicationSubmission?.outcome, "uncertain");
assert.equal(publicationDispatches, 3, "persisted intent without a known click must still not retry after restart");
assert.equal(genericFills, interruptedFillCount);

autoEditorFixture("ajax-confirmation.test");
setTimeout(() => { publicationObservation = { stage: "CONFIRMATION", confidence: 0.95, publicationEvidence: true, publicUrl: "https://ajax-confirmation.test/article-1", reason: "Article published" }; }, 50);
await dispatch({ type: "BA2_START_LISTING_AUTOFILL", autoPublish: true });
assert.equal(publicationDispatches, 4, "delayed same-document confirmation must require only one publication dispatch");
assert.equal((storage["ba2.listingRun"] as ListingRun).publicVerification?.status, "verified", "bounded observation must capture AJAX confirmation without another publication or tab navigation");

// Generic login is a separate manual checkpoint, never publication authorization.
for (const host of ["onesmablog.com", "same-family.example"]) {
  storage["ba2.listingRun"] = undefined;
  currentTab = { id: 42, url: `https://${host}/login` };
  profile.logoAsset = { id: "fixture-logo", fileName: "logo.png", mimeType: "image/png", size: 10 };
  genericWorkflowResponse = { ok: true, report: { profileName: profile.businessName, filled: [], skipped: [], manual: ["CAPTCHA", "SIGN IN / LOGIN"], form: {}, workflow: { stage: "LOGIN", confidence: 0.9, reason: "Login form recognized" } } };
  publicationObservation = { stage: "LOGIN", confidence: 0.9, reason: "Login remains on page, including operator-completed puzzle" };
  const submitsBeforeLogin: number = loginSubmitCount;
  const publicationsBeforeLogin: number = publicationDispatches;
  const assetsBeforeLogin = logoRetrievals;
  await dispatch({ type: "BA2_START_LISTING_AUTOFILL", autoPublish: true });
  const manualLogin = storage["ba2.listingRun"] as ListingRun;
  assert.equal(manualLogin.awaitingManualLogin, true);
  assert.equal(manualLogin.awaitingManualResume, true, "manual site login must retain same-run navigation resume");
  assert.equal(manualLogin.stage, "MANUAL_GATE");
  assert.match(manualLogin.manual[0], /website's Sign In/);
  assert.equal(manualLogin.manual.includes("CAPTCHA"), false, "presence-only diagnostics must not assert an unsolved puzzle at this checkpoint");
  assert.equal(logoRetrievals, assetsBeforeLogin, "a login form must not schedule unrelated logo Blob work");
  const fillsAfterLogin = genericFills;
  await dispatch({ type: "BA2_START_LISTING_AUTOFILL" });
  assert.equal((storage["ba2.listingRun"] as ListingRun).id, manualLogin.id);
  assert.equal(genericFills, fillsAfterLogin, "CHECK LOGIN must observe without refilling credentials or touching puzzle state");
  assert.equal(loginSubmitCount, submitsBeforeLogin, "article authorization must never submit generic Sign In");
  assert.equal(publicationDispatches, publicationsBeforeLogin);
  assert.equal(logoRetrievals, assetsBeforeLogin);

  // Existing installed runs may predate the explicit manual-login flag.
  storage["ba2.listingRun"] = { ...manualLogin, awaitingManualLogin: undefined, awaitingManualResume: false, manual: ["CAPTCHA", "SIGN IN / LOGIN"] };
  await dispatch({ type: "BA2_START_LISTING_AUTOFILL" });
  assert.equal((storage["ba2.listingRun"] as ListingRun).id, manualLogin.id, "legacy login gates should resume the same run");
  assert.equal((storage["ba2.listingRun"] as ListingRun).autoPublish, true, "login recheck must not replace article authorization");
  assert.equal(genericFills, fillsAfterLogin);
  publicationObservation = { stage: "UNSUPPORTED", confidence: 0, reason: "Unknown login outcome" };
  await dispatch({ type: "BA2_START_LISTING_AUTOFILL" });
  assert.equal((storage["ba2.listingRun"] as ListingRun).awaitingManualLogin, true, "ambiguous outcomes must remain manual");
  assert.equal(genericFills, fillsAfterLogin);

  // Simulate the operator signing in on the site, without sending any auth command.
  currentTab = { id: 42, url: `https://${host}/posts` };
  publicationObservation = { stage: "AUTHENTICATED_DASHBOARD", confidence: 0.95, action: { kind: "new-post", label: "New post", href: `https://${host}/new` }, reason: "Dashboard recognized" };
  genericWorkflowResponse = { ok: true, report: { profileName: profile.businessName, filled: [], skipped: [], manual: [], workflow: publicationObservation } };
  tabUpdatedListener?.(42, { status: "complete" });
  for (let wait = 0; wait < 100 && updates.at(-1) !== `https://${host}/new`; wait += 1) await flush();
  assert.equal((storage["ba2.listingRun"] as ListingRun).id, manualLogin.id);
  assert.equal((storage["ba2.listingRun"] as ListingRun).awaitingManualLogin, false);
  assert.equal(updates.at(-1), `https://${host}/new`, "operator login navigation should resume the existing dashboard/editor workflow");
  assert.equal(loginSubmitCount, submitsBeforeLogin);
  assert.equal(publicationDispatches, publicationsBeforeLogin);
  delete profile.logoAsset;
}

console.log("background smoke test passed: existing workflows, default-OFF authorization, gates, persisted one-time publication, lost/uncertain outcomes, receipts, concurrent starts, and interruption recovery");

// Auto Login coordinator fixtures: only mocked messages, never real account access.
function resetAutoLogin(host = "onesmablog.com") {
  storage["ba2.listingRun"] = undefined;
  delete storage["ba2.loginGuard:https://" + host + ":" + profile.id];
  currentTab = { id: 42, url: "https://" + host + "/login" };
  publicationObservation = { stage: "LOGIN", confidence: 0.9, reason: "fixture login" };
  automaticLoginChecks = { ok: false, captcha: "pending", reason: "Complete CAPTCHA on site" };
  automaticLoginLost = false;
  genericWorkflowResponse = { ok: true, report: { profileName: profile.businessName, filled: [], skipped: [], manual: ["SIGN IN / LOGIN"], workflow: publicationObservation } };
}
const loginNotification = async () => {
  const run = storage["ba2.listingRun"] as ListingRun;
  return dispatch({ type: "BA2_LOGIN_CHANGED", runId: run.id }, { tab: { id: 42 }, frameId: 0, url: currentTab.url });
};
const publicationsBeforeAutoLogin = publicationDispatches;
resetAutoLogin();
publicationObservation = { stage: "SIGNUP", confidence: 0.9, reason: "fixture registration" };
await dispatch({ type: "BA2_START_LISTING_AUTOFILL", autoLogin: true });
assert.equal((storage["ba2.listingRun"] as ListingRun).login?.state, "manual");
assert.equal(automaticLoginFills, 0, "registration must not reach account fill or Terms processing");

resetAutoLogin();
await dispatch({ type: "BA2_START_LISTING_AUTOFILL" });
assert.equal((storage["ba2.listingRun"] as ListingRun).autoLogin, false);
assert.equal(automaticLoginFills, 0);
assert.equal(automaticLoginSubmits, 0);
const deniedUpgrade = await dispatch({ type: "BA2_START_LISTING_AUTOFILL", autoLogin: true });
assert.equal(deniedUpgrade.ok, false, "continuation must not upgrade authorization");
resetAutoLogin();
await Promise.all([dispatch({ type: "BA2_START_LISTING_AUTOFILL", autoLogin: true }), dispatch({ type: "BA2_START_LISTING_AUTOFILL", autoLogin: true })]);
let autoLoginRun = storage["ba2.listingRun"] as ListingRun;
assert.equal(autoLoginRun.autoLogin, true);
assert.equal(autoLoginRun.autoPublish, false);
assert.equal(autoLoginRun.login?.state, "waiting-captcha");
assert.equal(automaticLoginFills, 1, "continuation must not refill account");
assert.equal(automaticLoginSubmits, 0);
await background.recoverListingRun();
assert.ok(automaticLoginWatches > 0, "worker recovery must rearm existing page observation");
const unrelatedWakeup = await dispatch({ type: "BA2_LOGIN_CHANGED", runId: autoLoginRun.id }, { tab: { id: 99 }, frameId: 0, url: currentTab.url });
assert.equal(unrelatedWakeup.ok, false);
automaticLoginChecks = { ok: true, captcha: "verified", reason: "fixture verified" };
await Promise.all([loginNotification(), loginNotification()]);
assert.equal(automaticLoginSubmits, 1, "CAPTCHA notification submits without CONTINUE RUN, once");
autoLoginRun = storage["ba2.listingRun"] as ListingRun;
assert.equal(autoLoginRun.id, (storage["ba2.loginGuard:https://onesmablog.com:" + profile.id] as { runId: string }).runId);
assert.equal(autoLoginRun.login?.state, "intent");
autoLoginRun.login!.startedAt = "2000-01-01T00:00:00Z";
await background.recoverListingRun();
assert.equal((storage["ba2.listingRun"] as ListingRun).login?.state, "uncertain");
await dispatch({ type: "BA2_START_LISTING_AUTOFILL" });
assert.equal(automaticLoginSubmits, 1, "interrupted/unchanged login must not be replayed");
// A successful operator/site transition resumes the same run's existing editor route.
currentTab = { id: 42, url: "https://onesmablog.com/posts" };
publicationObservation = { stage: "AUTHENTICATED_DASHBOARD", confidence: 0.95, action: { kind: "new-post", label: "New post", href: "https://onesmablog.com/new" }, reason: "fixture dashboard" };
genericWorkflowResponse = { ok: true, report: { profileName: profile.businessName, filled: [], skipped: [], manual: [], workflow: publicationObservation } };
await loginNotification();
assert.equal((storage["ba2.listingRun"] as ListingRun).id, autoLoginRun.id);
assert.equal((storage["ba2.listingRun"] as ListingRun).login?.state, "authenticated");
assert.equal(updates.at(-1), "https://onesmablog.com/new");
assert.equal(publicationDispatches, publicationsBeforeAutoLogin, "Auto Login must not authorize Publish");
resetAutoLogin();
automaticLoginChecks = { ok: false, captcha: "ambiguous", reason: "CAPTCHA completion is ambiguous; Sign In remains manual" };
await dispatch({ type: "BA2_START_LISTING_AUTOFILL", autoLogin: true });
assert.equal((storage["ba2.listingRun"] as ListingRun).login?.state, "manual");
assert.equal(automaticLoginSubmits, 1);
resetAutoLogin();
automaticLoginChecks = { ok: true, captcha: "verified", reason: "fixture verified" };
automaticLoginLost = true;
await dispatch({ type: "BA2_START_LISTING_AUTOFILL", autoLogin: true });
assert.equal((storage["ba2.listingRun"] as ListingRun).login?.state, "uncertain");
assert.equal(automaticLoginSubmits, 2);
await background.recoverListingRun();
await dispatch({ type: "BA2_START_LISTING_AUTOFILL" });
assert.equal(automaticLoginSubmits, 2, "lost delivery must never retry");
publicationObservation = { stage: "LOGIN", confidence: 0.9, loginError: true, reason: "fixture login error" };
await loginNotification();
assert.equal((storage["ba2.listingRun"] as ListingRun).login?.state, "failed");
storage["ba2.listingRun"] = undefined;
const blockedReceipt = await dispatch({ type: "BA2_START_LISTING_AUTOFILL", autoLogin: true });
assert.equal(blockedReceipt.ok, false, "replaced run must retain uncertain/failed account guard");
assert.equal(automaticLoginSubmits, 2);
resetAutoLogin("ampblogs.com");
await dispatch({ type: "BA2_START_LISTING_AUTOFILL", autoLogin: true });
assert.equal((storage["ba2.listingRun"] as ListingRun).login?.state, "waiting-captcha", "opted-in AmpBlogs reuses shared login; default-OFF legacy tests remain above");
assert.equal(publicationDispatches, publicationsBeforeAutoLogin);
console.log("automatic login background fixtures passed: independent persisted authorization, default OFF, automatic CAPTCHA wakeup, one intent, interrupted/unchanged/lost outcomes, failure, success, and durable duplicate guard");

// Navigation completion must survive an in-flight tabs.update response.
for (const lateRejection of [true, false]) {
  resetAutoLogin("navigation-race.test");
  currentTab = { id: 42, url: "https://navigation-race.test/posts" };
  const authenticatedRun = createListingRun("https://navigation-race.test/", profile.id, 42);
  authenticatedRun.stage = "FORM";
  authenticatedRun.autoLogin = true;
  authenticatedRun.autoPublish = true;
  authenticatedRun.navigationVerified = true;
  authenticatedRun.loginApproval = { authorizedAt: new Date().toISOString(), profileUpdatedAt: profile.updatedAt };
  authenticatedRun.publicationApproval = { authorizedAt: new Date().toISOString(), profileFingerprint: await publicationProfileFingerprint(profile) };
  authenticatedRun.login = { url: "https://navigation-race.test/login", state: "authenticated", attemptId: "completed-login", claimed: true, reason: "fixture authenticated" };
  storage["ba2.listingRun"] = authenticatedRun;

  const editorResponse = { ok: true, report: { profileName: profile.businessName, filled: [{ field: "businessName", descriptor: "title", value: profile.businessName }, { field: "description", descriptor: "editor", value: profile.description }], expectedArticle, skipped: [], manual: ["Final Submit"], workflow: { stage: "EDITOR", confidence: 0.95, reason: "fixture editor" } } };
  genericWorkflowResponse = { ok: true, report: { profileName: profile.businessName, filled: [], skipped: [], manual: [], workflow: { stage: "AUTHENTICATED_DASHBOARD", confidence: 0.95, action: { kind: "new-post", label: "New post", href: "https://navigation-race.test/new" }, reason: "fixture dashboard" } } };
  publicationObservation = editorResponse.report.workflow;
  publicationValidationError = "Complete the fixture human checkpoint before publication.";
  const beforeFills = genericFills;
  const beforePublish: number = publicationDispatches;
  let navRunId = "";
  navigationUpdateHook = async () => {
    navRunId = (storage["ba2.listingRun"] as ListingRun).id;
    genericWorkflowResponse = editorResponse;
    tabUpdatedListener?.(42, { status: "complete", url: currentTab.url });
    tabUpdatedListener?.(42, { status: "complete", url: currentTab.url });
    await flush();
    if (lateRejection) throw Error("Navigation rejected.");
  };
  await dispatch({ type: "BA2_START_LISTING_AUTOFILL", autoLogin: true, autoPublish: true });
  for (let wait = 0; wait < 100 && (storage["ba2.listingRun"] as ListingRun).stage === "NAVIGATING"; wait += 1) await flush();
  const resumed = storage["ba2.listingRun"] as ListingRun;
  assert.equal(resumed.id, navRunId);
  assert.equal(resumed.stage, "MANUAL_GATE", "early target completion must reach editor validation even when the navigation response arrives late");
  assert.equal(genericFills, beforeFills + 2, "dashboard and editor must each be filled once");
  assert.equal(resumed.autoLogin, true);
  assert.equal(resumed.login?.state, "authenticated");
  assert.equal(resumed.login?.attemptId, "completed-login");
  assert.equal(resumed.autoPublish, true);
  assert.equal(resumed.navigationVerified, true);
  assert.equal(resumed.error, undefined);
  assert.equal(publicationDispatches, beforePublish, "human checkpoint must still prevent publication after navigation recovery");
  navigationUpdateHook = undefined;
}
console.log("navigation completion race fixtures passed");

for (const scenario of ["not-arrived", "wrong-page", "wrong-origin", "replaced-run"] as const) {
  resetAutoLogin("navigation-negative.test");
  const saved = createListingRun("https://navigation-negative.test/", profile.id, 42);
  saved.navigationVerified = true; // Stale success from an earlier page is not this intent's evidence.
  storage["ba2.listingRun"] = saved;
  currentTab = { id: 42, url: "https://navigation-negative.test/posts" };
  genericWorkflowResponse = { ok: true, report: { profileName: profile.businessName, filled: [], skipped: [], manual: [], workflow: { stage: "AUTHENTICATED_DASHBOARD", confidence: 0.95, action: { kind: "new-post", label: "New post", href: "https://navigation-negative.test/new" }, reason: "fixture dashboard" } } };
  publicationObservation = { stage: scenario === "wrong-page" ? "LOGIN" : "EDITOR", confidence: 0.95, reason: "fixture page" };
  const beforeFills = genericFills;
  const beforePublish: number = publicationDispatches;
  let replacement: ListingRun | undefined;
  navigationUpdateHook = async () => {
    assert.equal((storage["ba2.listingRun"] as ListingRun).navigationVerified, false, "new intent must clear old verification before tabs.update");
    if (scenario === "not-arrived") currentTab = { id: 42, url: "https://navigation-negative.test/posts" };
    if (scenario === "wrong-origin") currentTab = { id: 42, url: "https://unrelated.test/new" };
    if (scenario === "replaced-run") {
      replacement = createListingRun("https://other-family.test/", profile.id, 99);
      storage["ba2.listingRun"] = replacement;
    }
    throw Error("Navigation rejected.");
  };
  await dispatch({ type: "BA2_START_LISTING_AUTOFILL" });
  await flush();
  const failed = storage["ba2.listingRun"] as ListingRun;
  if (replacement) assert.equal(failed, replacement, "late navigation error cannot overwrite another run");
  else {
    assert.equal(failed.stage, "ERROR", scenario + ": genuine rejection must not be swallowed");
    assert.equal(failed.error, "Navigation rejected.");
    assert.equal(failed.navigationVerified, false, "error persistence must retain current intent rather than resurrect old success");
    assert.equal(failed.navigationTarget, "https://navigation-negative.test/new");
  }
  assert.equal(genericFills, beforeFills + 1, "unsafe recovery must not autofill again");
  assert.equal(publicationDispatches, beforePublish);
  navigationUpdateHook = undefined;
}
// An unrelated completed page must not verify the saved target.
resetAutoLogin("navigation-target.test");
const waitingNavigation = createListingRun("https://navigation-target.test/", profile.id, 42);
waitingNavigation.stage = "NAVIGATING";
waitingNavigation.navigationTarget = "https://navigation-target.test/new";
waitingNavigation.expectedStage = "FORM";
waitingNavigation.navigationVerified = false;
storage["ba2.listingRun"] = waitingNavigation;
currentTab = { id: 42, url: "https://navigation-target.test/posts" };
const fillsBeforeWrongCompletion = genericFills;
tabUpdatedListener?.(42, { status: "complete", url: currentTab.url });
await flush();
assert.equal((storage["ba2.listingRun"] as ListingRun).navigationVerified, false);
assert.equal(genericFills, fillsBeforeWrongCompletion);
console.log("navigation guard fixtures passed: stale flags, target mismatch, wrong page/origin, replaced run, and genuine rejection");

// A queued registration wakeup must not probe the outgoing document while the
// same authorized navigation is loading (native failure: closed message channel).
const registrationNavigation = createListingRun('https://registration-navigation.test/', profile.id, 42);
registrationNavigation.stage = 'NAVIGATING';
registrationNavigation.navigationTarget = 'https://registration-navigation.test/signup';
registrationNavigation.autoRegister = true;
registrationNavigation.registration = { url: registrationNavigation.navigationTarget, state: 'waiting-human', reason: 'fixture human gate' };
registrationNavigation.continuous = { loginReceiptsSnapshot: '{}', registrationReceiptSnapshot: 'null' };
storage['ba2.listingRun'] = registrationNavigation;
currentTab = Object.assign({ id: 42, url: 'https://registration-navigation.test/' }, { status: 'loading' });
const navigationSnapshot = JSON.stringify(storage);
const preflightSendMessage = chrome.tabs.sendMessage;
let outgoingDocumentMessages = 0;
chrome.tabs.sendMessage = (async () => { outgoingDocumentMessages++; throw Error('A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received'); }) as typeof chrome.tabs.sendMessage;
try { await background.recoverListingRun(); }
finally { chrome.tabs.sendMessage = preflightSendMessage; }
assert.equal(outgoingDocumentMessages, 0, 'loading/target gate must precede receiver status or action messages');
assert.equal(JSON.stringify(storage), navigationSnapshot, 'pending navigation preserves run, approvals and all receipts');
console.log('Registration navigation wakeup passed: no receiver probe on loading outgoing document, no ERROR, unchanged state and zero actions');

// Sheets integration uses synthetic OAuth/backend results and existing public verifier.
const previousBusinessName = profile.businessName;
profile.businessName = "Hot Mess Cleanup & Junk Removal";
const sheetArticleUrl = "https://onesmablog.com/hot-mess-fixture-article-98765";
async function verifiedSheetFixture() {
  const run = createListingRun("https://onesmablog.com/new", profile.id, 42);
  run.stage = "COMPLETE";
  run.status = "success";
  run.autoPublish = true;
  run.publicationApproval = { authorizedAt: new Date().toISOString(), profileFingerprint: await publicationProfileFingerprint(profile) };
  run.submissionAttempted = true;
  run.publicationSubmission = { url: run.sourceUrl, attemptId: "fixture-publication", claimed: true, outcome: "intent", startedAt: new Date().toISOString() };
  run.publicVerification = { status: "verified", candidateUrl: sheetArticleUrl, confirmationUrl: run.sourceUrl, attemptId: "fixture-verification", checkedAt: new Date().toISOString(), reason: "fixture verified" };
  run.liveUrl = sheetArticleUrl;
  run.expectedArticle = articleExpectation(profile.businessName, profile.description, documentRef);
  storage["ba2.listingRun"] = run;
  currentTab = { id: 42, url: run.sourceUrl };
  sheetSessionKey = "fixture-local-backend-key-only-not-oauth";
  sheetBackendLost = false;
  sheetBackendStatus = "recorded";
  sheetReadBackConfirmed = true;
  fetchScenario = "valid";
  return run;
}
let sheetsRun = await verifiedSheetFixture();
let sheetsCallsBefore: number = sheetBackendCalls;
await Promise.all([background.synchronizeVerifiedListing(sheetsRun.id), background.synchronizeVerifiedListing(sheetsRun.id)]);
assert.equal(sheetBackendCalls, sheetsCallsBefore + 1);
assert.equal((storage["ba2.listingRun"] as ListingRun).sheetSync?.status, "recorded");
assert.equal((storage["ba2.listingRun"] as ListingRun).sheetSync?.readBackConfirmed, true);
assert.equal((storage["ba2.listingRun"] as ListingRun).sheetSync?.range, "Sheet1!B23");
await background.synchronizeVerifiedListing(sheetsRun.id);
assert.equal(sheetBackendCalls, sheetsCallsBefore + 1, "recorded synchronization must not repeat");
for (const condition of ["empty-url", "failed-verification", "unverified", "unauthorized", "missing-approval", "missing-intent"] as const) {
  sheetsRun = await verifiedSheetFixture();
  if (condition === "empty-url") sheetsRun.liveUrl = "";
  if (condition === "failed-verification") sheetsRun.publicVerification!.status = "failed";
  if (condition === "unverified") sheetsRun.publicVerification!.status = "unverified";
  if (condition === "unauthorized") sheetsRun.autoPublish = false;
  if (condition === "missing-approval") sheetsRun.publicationApproval = undefined;
  if (condition === "missing-intent") sheetsRun.submissionAttempted = false;
  sheetsCallsBefore = sheetBackendCalls;
  await background.synchronizeVerifiedListing(sheetsRun.id);
  assert.equal(sheetBackendCalls, sheetsCallsBefore, condition);
}
for (const scenario of ["network", "unavailable", "wrong", "login-html", "suspended", "blocked-redirect"]) {
  sheetsRun = await verifiedSheetFixture();
  fetchScenario = scenario;
  sheetsCallsBefore = sheetBackendCalls;
  await background.synchronizeVerifiedListing(sheetsRun.id);
  assert.equal(sheetBackendCalls, sheetsCallsBefore, "public article must reverify before Sheets: " + scenario);
  assert.equal((storage["ba2.listingRun"] as ListingRun).sheetSync?.code, "article-unavailable");
}
sheetsRun = await verifiedSheetFixture();
sheetSessionKey = undefined;
await background.synchronizeVerifiedListing(sheetsRun.id);
assert.equal((storage["ba2.listingRun"] as ListingRun).sheetSync?.status, "blocked");
sheetSessionKey = "fixture-local-backend-key-only-not-oauth";
await background.synchronizeVerifiedListing(sheetsRun.id);
assert.equal((storage["ba2.listingRun"] as ListingRun).sheetSync?.status, "blocked", "blocked sync requires explicit operator retry after authorization");
const callsBeforeUntrustedMessage = sheetBackendCalls;
await dispatch({ type: "BA2_SYNC_VERIFIED_LISTING" }, { id: "a".repeat(32), url: "https://onesmablog.com/new" });
assert.equal(sheetBackendCalls, callsBeforeUntrustedMessage, "content pages cannot authorize a Sheets retry");
await dispatch({ type: "BA2_SYNC_VERIFIED_LISTING" }, { id: "a".repeat(32), url: "chrome-extension://" + "a".repeat(32) + "/popup/popup.html" });
assert.equal((storage["ba2.listingRun"] as ListingRun).sheetSync?.status, "recorded");
sheetsRun = await verifiedSheetFixture();
sheetBackendLost = true;
await background.synchronizeVerifiedListing(sheetsRun.id);
assert.equal((storage["ba2.listingRun"] as ListingRun).sheetSync?.status, "uncertain");
sheetsCallsBefore = sheetBackendCalls;
await background.synchronizeVerifiedListing(sheetsRun.id, true);
await background.recoverListingRun();
assert.equal(sheetBackendCalls, sheetsCallsBefore, "lost delivery must never retry automatically");
sheetsRun = await verifiedSheetFixture();
sheetReadBackConfirmed = false;
await background.synchronizeVerifiedListing(sheetsRun.id);
assert.equal((storage["ba2.listingRun"] as ListingRun).sheetSync?.status, "uncertain", "a backend success label without read-back proof is not synchronized");
sheetsRun = await verifiedSheetFixture();
sheetsRun.sheetSync = { status: "syncing", attemptId: "interrupted-sync", liveUrl: sheetArticleUrl, code: "started", reason: "fixture" };
sheetsCallsBefore = sheetBackendCalls;
await background.recoverListingRun();
assert.equal((storage["ba2.listingRun"] as ListingRun).sheetSync?.status, "uncertain");
assert.equal(sheetBackendCalls, sheetsCallsBefore);
// Natural publication-confirmation completion invokes sync automatically.
sheetsRun = await verifiedSheetFixture();
sheetsRun.stage = "VERIFYING_SUCCESS";
sheetsRun.publicVerification = undefined;
sheetsRun.liveUrl = undefined;
publicationObservation = { stage: "CONFIRMATION", confidence: 0.95, publicationEvidence: true, publicUrl: sheetArticleUrl, reason: "fixture publication confirmed" };
sheetsCallsBefore = sheetBackendCalls;
const publicationsBeforeSheetCompletion = publicationDispatches;
await dispatch({ type: "BA2_START_LISTING_AUTOFILL" });
assert.equal((storage["ba2.listingRun"] as ListingRun).publicVerification?.status, "verified");
assert.equal((storage["ba2.listingRun"] as ListingRun).sheetSync?.status, 'ready');
assert.equal((storage["ba2.listingRun"] as ListingRun).sheetSync?.mode, 'prepare');
assert.equal((storage["ba2.listingRun"] as ListingRun).sheetSync?.range, 'Sheet1!B23');
assert.equal(sheetBackendCalls, sheetsCallsBefore, "verified completion must prepare only, never invoke write-back");
assert.equal(publicationDispatches, publicationsBeforeSheetCompletion, "Sheets must not trigger publication");
profile.businessName = previousBusinessName;
console.log("Sheets coordinator fixtures passed: verified/authorized gate, fresh accessibility and identity, persisted result, duplicate/interruption prevention, and automatic completion hook");

// A replaced run must survive a late synchronization intent; do not dispatch.
sheetsRun = await verifiedSheetFixture();
const replacementDuringSync = createListingRun("https://other-family.test/", profile.id, 99);
sheetsCallsBefore = sheetBackendCalls;
mutateOnSheetIntent = () => { storage["ba2.listingRun"] = replacementDuringSync; };
await background.synchronizeVerifiedListing(sheetsRun.id);
mutateOnSheetIntent = undefined;
assert.equal(storage["ba2.listingRun"], replacementDuringSync);
assert.equal(sheetBackendCalls, sheetsCallsBefore, "replaced sync intent must not reach backend");
profile.businessName = previousBusinessName;

// Fresh homepage starts preserve the stopped run and never inherit its editor/authorizations.
const popupSender = { id: 'a'.repeat(32), url: 'chrome-extension://' + 'a'.repeat(32) + '/popup/popup.html' };
// Publication guard keys use the hostname, unlike login guards which use the origin.
const publisherReceiptKey = 'ba2.publicationGuard:onesmablog.com:' + profile.id;
async function freshHomepageFixture(): Promise<ListingRun> {
  resetAutoLogin();
  delete storage[publisherReceiptKey];
  currentTab = { id: 42, url: 'https://onesmablog.com/' };
  const saved = createListingRun('https://onesmablog.com/', profile.id, 42);
  saved.stage = 'MANUAL_GATE';
  saved.awaitingManualResume = true;
  saved.manual = ['Editor page changed; inspect manually before publication.'];
  saved.publicationEditorUrl = 'https://onesmablog.com/new';
  saved.autoPublish = true;
  saved.autoLogin = true;
  saved.publicationApproval = { authorizedAt: '2000-01-01T00:00:00.000Z', profileFingerprint: await publicationProfileFingerprint(profile) };
  storage['ba2.listingRun'] = saved;
  publicationObservation = { stage: 'HOMEPAGE', confidence: 0.95, reason: 'fixture homepage', loginAction: { kind: 'login', href: 'https://onesmablog.com/login', label: 'Login' } };
  genericWorkflowResponse = { ok: true, report: { profileName: profile.businessName, filled: [], skipped: [], manual: [], workflow: publicationObservation } };
  publicationValidationError = undefined;
  publicationDelivery = 'ok';
  sheetSessionKey = undefined;
  return saved;
}
const freshMessage = (run: ListingRun, choices = { autoLogin: true, autoPublish: true }) => ({ type: 'BA2_START_LISTING_AUTOFILL', freshFromRunId: run.id, ...choices });

for (const rejectedCase of ['page', 'origin', 'query', 'stale-id', 'sender', 'missing-choice', 'receipt', 'login-receipt', 'attempt', 'verification', 'profile', 'not-waiting']) {
  const saved = await freshHomepageFixture();
  let message: Record<string, unknown> = freshMessage(saved);
  if (rejectedCase === 'page') currentTab.url = 'https://onesmablog.com/new';
  if (rejectedCase === 'origin') currentTab.url = 'https://different.test/';
  if (rejectedCase === 'query') currentTab.url += '?return=/new';
  if (rejectedCase === 'stale-id') message.freshFromRunId = 'another-run';
  if (rejectedCase === 'missing-choice') delete message.autoPublish;
  if (rejectedCase === 'receipt') storage[publisherReceiptKey] = { runId: 'earlier-uncertain-run' };
  if (rejectedCase === 'login-receipt') storage['ba2.loginGuard:https://onesmablog.com:' + profile.id] = { state: 'uncertain' };
  if (rejectedCase === 'attempt') saved.submissionAttempted = true;
  if (rejectedCase === 'verification') saved.publicVerification = { status: 'unverified', attemptId: 'prior-check', reason: 'not established' };
  if (rejectedCase === 'profile') saved.profileId = 'another-profile';
  if (rejectedCase === 'not-waiting') saved.awaitingManualResume = false;
  const snapshot = JSON.stringify(storage);
  const result = await dispatch(message, rejectedCase === 'sender' ? { tab: { id: 42 }, url: currentTab.url } : popupSender);
  assert.equal(result.ok, false, rejectedCase + ' must refuse fresh replacement');
  assert.equal(JSON.stringify(storage), snapshot, rejectedCase + ' must preserve run, archive and receipts');
}

let stopped = await freshHomepageFixture();
const fillsBeforeOff = genericFills;
const pubBeforeFresh = publicationDispatches;
await dispatch(freshMessage(stopped, { autoLogin: false, autoPublish: false }), popupSender);
let freshRun = storage['ba2.listingRun'] as ListingRun;
assert.notEqual(freshRun.id, stopped.id);
assert.deepEqual(storage['ba2.listingRunArchive:' + stopped.id], stopped);
assert.equal(freshRun.autoPublish, false);
assert.equal(freshRun.autoLogin, false);
assert.equal(freshRun.publicationApproval, undefined);
assert.equal(freshRun.publicationEditorUrl, undefined);
assert.ok(genericFills > fillsBeforeOff);
assert.equal(publicationDispatches, pubBeforeFresh);

stopped = await freshHomepageFixture();
storage['ba2.siteFlowRecipes'] = [{ domain: 'onesmablog.com', entryUrl: 'https://onesmablog.com/new', categoryMappings: [] }];
const freshStarts = await Promise.all([dispatch(freshMessage(stopped), popupSender), dispatch(freshMessage(stopped), popupSender)]);
assert.equal(freshStarts.filter(result => result.ok).length, 1, 'double click must create only one fresh run');
freshRun = storage['ba2.listingRun'] as ListingRun;
assert.equal(freshRun.homepageStart, true);
assert.equal(freshRun.sourceUrl, 'https://onesmablog.com/');
assert.equal(updates.at(-1), 'https://onesmablog.com/login', 'learned /new recipe must not skip homepage/login');
assert.notEqual(freshRun.publicationApproval?.authorizedAt, stopped.publicationApproval?.authorizedAt);
assert.equal(freshRun.publicationEditorUrl, undefined);
assert.deepEqual(storage['ba2.listingRunArchive:' + stopped.id], stopped);
assert.equal(publicationDispatches, pubBeforeFresh);

publicationObservation = { stage: 'LOGIN', confidence: 0.95, reason: 'fixture login' };
genericWorkflowResponse = { ok: true, report: { profileName: profile.businessName, filled: [], skipped: [], manual: ['SIGN IN / LOGIN'], workflow: publicationObservation } };
const loginClicksBeforeFresh = automaticLoginSubmits;
await dispatch({ type: 'BA2_START_LISTING_AUTOFILL' });
assert.equal((storage['ba2.listingRun'] as ListingRun).login?.state, 'waiting-captcha');
assert.equal(automaticLoginSubmits, loginClicksBeforeFresh);
automaticLoginChecks = { ok: true, captcha: 'absent', reason: 'fixture human checkpoint complete' };
await dispatch({ type: 'BA2_START_LISTING_AUTOFILL' });
await dispatch({ type: 'BA2_START_LISTING_AUTOFILL' });
assert.equal(automaticLoginSubmits, loginClicksBeforeFresh + 1, 'one guarded Sign In');
currentTab.url = 'https://onesmablog.com/dashboard';
publicationObservation = { stage: 'AUTHENTICATED_DASHBOARD', confidence: 0.95, reason: 'fixture signed-in dashboard', action: { kind: 'new-post', href: 'https://onesmablog.com/new', label: 'New post' } };
genericWorkflowResponse = { ok: true, report: { profileName: profile.businessName, filled: [], skipped: [], manual: [], workflow: publicationObservation } };
await dispatch({ type: 'BA2_START_LISTING_AUTOFILL' });
assert.equal(updates.at(-1), 'https://onesmablog.com/new');
assert.equal((storage['ba2.listingRun'] as ListingRun).login?.state, 'authenticated');

const homepagePublicUrl = 'https://onesmablog.com/article/smoke-entry-12345';
publicationObservation = { stage: 'CONFIRMATION', confidence: 0.95, reason: 'fixture publication confirmation', publicationEvidence: true, publicUrl: homepagePublicUrl };
genericWorkflowResponse = { ok: true, report: { profileName: profile.businessName, filled: [{ field: 'businessName', descriptor: 'title', value: profile.businessName }, { field: 'description', descriptor: 'editor', value: profile.description }], expectedArticle, skipped: [], manual: ['Final Submit'], workflow: { stage: 'EDITOR', confidence: 0.95, reason: 'fixture filled editor' } } };
const backendBeforeFresh = sheetBackendCalls;
fetchScenario = 'valid';
await dispatch({ type: 'BA2_START_LISTING_AUTOFILL' });
freshRun = storage['ba2.listingRun'] as ListingRun;
assert.equal(publicationDispatches, pubBeforeFresh + 1);
assert.equal(freshRun.stage, 'COMPLETE');
assert.equal(freshRun.publicVerification?.status, 'verified');
assert.equal(freshRun.liveUrl, homepagePublicUrl);
assert.equal(freshRun.sheetSync?.status, 'blocked', 'missing key blocks automatic read-only preparation');
assert.equal(freshRun.sheetSync?.mode, 'prepare');
assert.equal(sheetBackendCalls, backendBeforeFresh);
await dispatch({ type: 'BA2_START_LISTING_AUTOFILL' });
assert.equal(publicationDispatches, pubBeforeFresh + 1, 'verified outcome never republishes');
assert.ok(storage[publisherReceiptKey]);
console.log('Fresh homepage fixtures passed: original archive, new consent, receipts, duplicate starts, homepage/login/dashboard/editor, one guarded publication, public verification before blocked Sheets sync');

// Reproduce a missing dashboard receiver without reading a real asset or changing a run.
const assetStorageBefore = JSON.stringify(storage);
const publicationBeforeAssetRepair = publicationDispatches;
for (const kind of ['logo', 'brochure'] as const) {
  dashboardAssets = { available: false, injectionCount: 0, messages: 0, url: 'http://localhost:3000/' };
  const result = kind === 'logo' ? await background.getActiveProfileLogo(profile.id, 'fixture-asset', 'fixture.png')
    : await background.getActiveProfileBrochure(profile.id, 'fixture-asset', 'fixture.pdf');
  assert.equal(result.ok, true, kind + ' must recover one missing dashboard receiver');
  assert.equal(dashboardAssets.injectionCount, 1);
  assert.equal(dashboardAssets.messages, 2);
}
assert.equal(JSON.stringify(storage), assetStorageBefore, 'asset recovery must not mutate run, profile or receipts');
assert.equal(publicationDispatches, publicationBeforeAssetRepair, 'asset repair never publishes');
dashboardAssets = undefined;

for (const scenario of ['ready', 'wrong-owner', 'port-closed', 'foreign-origin', 'injection-failed', 'navigated', 'still-missing']) {
  dashboardAssets = { available: scenario === 'ready' || scenario === 'wrong-owner', injectionCount: 0, messages: 0,
    url: scenario === 'foreign-origin' ? 'https://untrusted.test/' : 'http://localhost:3000/',
    applicationError: scenario === 'wrong-owner' ? 'Active Profile logo asset does not belong to the selected profile' : undefined,
    transportError: scenario === 'port-closed' ? 'The message port closed before a response was received.' : undefined,
    failInjection: scenario === 'injection-failed', navigateOnInjection: scenario === 'navigated', keepMissing: scenario === 'still-missing' };
  const result = await background.getActiveProfileLogo(profile.id, 'fixture-asset', 'fixture.png');
  assert.equal(result.ok, scenario === 'ready', scenario);
  assert.equal(dashboardAssets.injectionCount, ['injection-failed', 'navigated', 'still-missing'].includes(scenario) ? 1 : 0, 'only missing receiver may inject');
  assert.ok(dashboardAssets.messages <= 2, 'read recovery is bounded');
  if (scenario === 'navigated') assert.equal(dashboardAssets.messages, 1, 'never send an asset request after foreign navigation');
}
assert.equal(JSON.stringify(storage), assetStorageBefore);
assert.equal(publicationDispatches, publicationBeforeAssetRepair);
dashboardAssets = undefined;
console.log('Dashboard sender recovery passed: one top-frame reader reinjection, bounded read retry, no retry on ownership/port errors, no foreign-origin leakage, no state/publication changes');

// An old media gate is NOT a fresh authorization: normal resume goes straight to publication validation.
autoEditorFixture('asset-resume.test');
profile.logoAsset = { id: 'fixture-logo', fileName: 'logo.png', mimeType: 'image/png', size: 3 };
(genericWorkflowResponse as { report: { form?: object } }).report.form = {};
dashboardAssets = { available: false, injectionCount: 0, messages: 0, url: 'http://localhost:3000/', failInjection: true };
const pubBeforeMediaGate = publicationDispatches;
await dispatch({ type: 'BA2_START_LISTING_AUTOFILL', autoPublish: true });
const mediaGate = storage['ba2.listingRun'] as ListingRun;
assert.equal(mediaGate.stage, 'MANUAL_GATE');
assert.equal(mediaGate.awaitingManualResume, true);
assert.equal(mediaGate.publicationEditorUrl, 'https://asset-resume.test/new');
assert.equal(mediaGate.submissionAttempted, undefined);
assert.equal(publicationDispatches, pubBeforeMediaGate);
const priorApproval = structuredClone(mediaGate.publicationApproval);
const assetRequestsBeforeResume = dashboardAssets.messages;
const fillsBeforeMediaResume = genericFills;
dashboardAssets.available = true;
publicationValidationError = 'Fixture holds publication for human review';
await dispatch({ type: 'BA2_START_LISTING_AUTOFILL' });
assert.deepEqual((storage['ba2.listingRun'] as ListingRun).publicationApproval, priorApproval, 'normal resume reuses existing approval; it never grants fresh consent');
assert.equal(dashboardAssets.messages, assetRequestsBeforeResume, 'ordinary media-gate resume does not retry asset retrieval');
assert.equal(genericFills, fillsBeforeMediaResume);
assert.equal(publicationDispatches, pubBeforeMediaGate, 'validation remains authoritative');
delete profile.logoAsset;
dashboardAssets = undefined;
publicationValidationError = undefined;
console.log('Media-gate recovery semantics verified: current run/approval preserved; normal resume validates for publication directly, never silently renews authorization');

// Exact live failure: a rich article has an inline logo but no native upload input.
autoEditorFixture('undefined-logo.test');
profile.logoAsset = { id: 'fixture-logo', fileName: 'logo.png', mimeType: 'image/png', size: 3 };
(genericWorkflowResponse as { report: { form?: object } }).report.form = { logo: { attached: false, requested: false } };
dashboardAssets = { available: true, injectionCount: 0, messages: 0, url: 'http://localhost:3000/' };
logoAttachMode = 'undefined';
publicationObservation = { stage: 'CONFIRMATION', confidence: 0.95, publicationEvidence: true, publicUrl: 'https://undefined-logo.test/articles/fixture-12345', reason: 'fixture published' };
const publicationsBeforeNoTarget = publicationDispatches;
const attachmentsBeforeNoTarget = logoAttachCalls;
await dispatch({ type: 'BA2_START_LISTING_AUTOFILL', autoPublish: true });
const noTargetRun = storage['ba2.listingRun'] as ListingRun;
assert.equal(noTargetRun.stage, 'COMPLETE', 'no native upload input must not abort authorized rich-article publication: ' + noTargetRun.error);
assert.equal(logoAttachCalls, attachmentsBeforeNoTarget, 'inline article image must not trigger a separate native upload');
assert.equal(dashboardAssets.messages, 0, 'no upload target means no unrelated Blob request');
assert.equal(publicationDispatches, publicationsBeforeNoTarget + 1, 'authorized autofill must reach guarded publication without another click');
logoAttachMode = undefined;
dashboardAssets = undefined;
delete profile.logoAsset;

// Expected native uploads still need an acknowledgement; never interpret undefined as success.
for (const mode of ['undefined', 'success', 'unknown-target', 'empty-validation'] as const) {
  autoEditorFixture('upload-' + mode + '.test');
  profile.logoAsset = { id: 'fixture-logo', fileName: 'logo.png', mimeType: 'image/png', size: 3 };
  (genericWorkflowResponse as { report: { form?: object } }).report.form = mode === 'unknown-target' ? {} : { logo: { requested: true, attached: false } };
  dashboardAssets = { available: true, injectionCount: 0, messages: 0, url: 'http://localhost:3000/' };
  logoAttachMode = mode === 'undefined' ? 'undefined' : 'success';
  emptyValidationReply = mode === 'empty-validation';
  const beforePublication: number = publicationDispatches;
  publicationObservation = { stage: 'CONFIRMATION', confidence: 0.95, publicationEvidence: true,
    publicUrl: 'https://upload-' + mode + '.test/articles/fixture-12345', reason: 'fixture confirmed' };
  await dispatch({ type: 'BA2_START_LISTING_AUTOFILL', autoPublish: true });
  const result = storage['ba2.listingRun'] as ListingRun;
  assert.equal(result.stage, mode === 'success' ? 'COMPLETE' : 'MANUAL_GATE', mode);
  assert.equal(publicationDispatches, beforePublication + (mode === 'success' ? 1 : 0), mode);
  if (mode !== 'success') {
    assert.equal(result.submissionAttempted, undefined);
    assert.notEqual(result.error?.includes("reading 'ok'"), true);
    assert.ok(result.manual.length);
  }
  if (mode === 'unknown-target') assert.equal(dashboardAssets.messages, 0, 'unknown evidence must pause without guessing');
}
emptyValidationReply = false;
logoAttachMode = undefined;
dashboardAssets = undefined;
delete profile.logoAsset;

// A missing autofill acknowledgement is not permission to repeat a possibly executed action.
autoEditorFixture('empty-listing.test');
emptyListingReply = true;
const beforeEmptyFills = genericFills;
const beforeEmptyPublications = publicationDispatches;
await dispatch({ type: 'BA2_START_LISTING_AUTOFILL', autoPublish: true });
assert.equal((storage['ba2.listingRun'] as ListingRun).stage, 'ERROR');
assert.match((storage['ba2.listingRun'] as ListingRun).error || '', /returned no response/);
assert.equal(genericFills, beforeEmptyFills + 1);
assert.equal(publicationDispatches, beforeEmptyPublications);
emptyListingReply = false;

// No publication acknowledgement is uncertain, never a second dispatch.
autoEditorFixture('empty-publish.test');
publicationDelivery = 'no-reply';
const beforeEmptyAck = publicationDispatches;
await dispatch({ type: 'BA2_START_LISTING_AUTOFILL', autoPublish: true });
await dispatch({ type: 'BA2_START_LISTING_AUTOFILL' });
assert.equal(publicationDispatches, beforeEmptyAck + 1);
assert.equal((storage['ba2.listingRun'] as ListingRun).publicationSubmission?.outcome, 'uncertain');
assert.equal((storage['ba2.listingRun'] as ListingRun).stage, 'MANUAL_GATE');
publicationDelivery = 'ok';

// A pre-publication ERROR can be archived from a new homepage tab, without resetting the old record.
const failedEditorRun = await freshHomepageFixture();
failedEditorRun.stage = 'ERROR';
failedEditorRun.awaitingManualResume = false;
failedEditorRun.error = "Cannot read properties of undefined (reading 'ok')";
const errorSnapshot = structuredClone(failedEditorRun);
currentTab = { id: 43, url: 'https://onesmablog.com/' };
const freshAfterError = await dispatch(freshMessage(failedEditorRun, { autoLogin: false, autoPublish: false }), popupSender);
assert.equal(freshAfterError.ok, true);
assert.deepEqual(storage['ba2.listingRunArchive:' + failedEditorRun.id], errorSnapshot);
assert.equal((storage['ba2.listingRun'] as ListingRun).tabId, 43);
assert.equal((storage['ba2.listingRun'] as ListingRun).autoPublish, false);
assert.equal((storage['ba2.listingRun'] as ListingRun).publicationApproval, undefined);
console.log('Undefined-response regressions passed: no-target editor auto-continuation, native-upload/missing-validation fail-closed, no acknowledgement replay, archived ERROR with fresh OFF consent');

async function recoveryFixture() {
  activeProfile = true;
  const run = await verifiedSheetFixture();
  run.stage = 'MANUAL_GATE';
  run.liveUrl = undefined;
  run.awaitingManualResume = false;
  run.publicationSubmission!.outcome = 'uncertain';
  run.publicVerification = { status: 'unverified', candidateUrl: sheetArticleUrl, confirmationUrl: run.sourceUrl, attemptId: 'old-interrupted-check', reason: 'interrupted' };
  storage[`ba2.publicationGuard:onesmablog.com:${profile.id}`] = { runId: run.id };
  publicationObservation = { stage: 'CONFIRMATION', confidence: 0.95, publicationEvidence: true, publicUrl: sheetArticleUrl, reason: 'Article was successfully published. Visit / Edit' };
  sheetSessionKey = undefined;
  return run;
}
const recoveryPublishesBefore = publicationDispatches;
const recoveryFillsBefore = genericFills;
const recoveryWritesBefore = sheetBackendCalls;
let published = await recoveryFixture();
publicationReaderMissing = true;
const injectionsBeforeRecovery = publicationReaderInjections;
await Promise.all([background.recoverPublishedArticle(published.id, 42), background.recoverPublishedArticle(published.id, 42)]);
let recoveredPublication = storage['ba2.listingRun'] as ListingRun;
assert.equal(recoveredPublication.id, published.id);
assert.equal(recoveredPublication.publicVerification?.status, 'verified');
assert.equal(recoveredPublication.publicationConfirmation?.visitUrl, sheetArticleUrl);
assert.equal(recoveredPublication.liveUrl, sheetArticleUrl);
assert.equal(currentTab.url, sheetArticleUrl, 'open only the anonymously verified article using GET');
assert.equal(publicationReaderInjections, injectionsBeforeRecovery + 1, 'restore only one read-only top-frame receiver');
assert.equal((storage[`ba2.publicationGuard:onesmablog.com:${profile.id}`] as { runId: string }).runId, published.id);
await background.recoverPublishedArticle(published.id, 42);
assert.equal(recoveredPublication.publicationSubmission?.attemptId, published.publicationSubmission?.attemptId);

for (const condition of ['receipt-owner', 'missing-intent', 'missing-evidence', 'editor', 'changed-profile', 'untrusted-popup']) {
  published = await recoveryFixture();
  if (condition === 'receipt-owner') storage[`ba2.publicationGuard:onesmablog.com:${profile.id}`] = { runId: 'other-run' };
  if (condition === 'missing-intent') published.publicationSubmission = undefined;
  if (condition === 'missing-evidence') published.expectedArticle = undefined;
  if (condition === 'editor') publicationObservation = { stage: 'EDITOR', confidence: 0.95, reason: 'editor' };
  if (condition === 'changed-profile') published.publicationApproval!.profileFingerprint = 'changed';
  const before = JSON.stringify(storage);
  if (condition === 'untrusted-popup') await dispatch({ type: 'BA2_RECOVER_PUBLICATION', runId: published.id, tabId: 42 }, { id: 'a'.repeat(32), url: 'https://onesmablog.com/new' });
  else await background.recoverPublishedArticle(published.id, 42);
  assert.equal(JSON.stringify(storage), before, condition + ': fail closed, preserve run/receipts');
}

// A browser/service-worker interruption is not publication failure. Retry only
// the bounded public read after startup records the interrupted verification.
published = await recoveryFixture();
published.publicVerification!.status = 'verifying';
await background.recoverListingRun();
assert.equal((storage['ba2.listingRun'] as ListingRun).publicVerification?.status, 'verified', 'startup automatically recovers the interrupted success page');
await background.recoverPublishedArticle(published.id, 42);
assert.equal((storage['ba2.listingRun'] as ListingRun).publicVerification?.status, 'verified');

// Legacy runs retain their old expectation; rebuild full evidence only from
// the unchanged approved profile, never from the public page itself.
published = await recoveryFixture();
published.expectedArticle = { title: published.expectedArticle!.title, bodyExcerpt: published.expectedArticle!.bodyExcerpt };
await background.recoverPublishedArticle(published.id, 42);
assert.ok((storage['ba2.listingRun'] as ListingRun).expectedArticle?.bodyText);
assert.equal((storage['ba2.listingRun'] as ListingRun).publicVerification?.status, 'verified');

const ordinaryFetch = globalThis.fetch;
for (const scenario of ['redirect', 'canonical', 'external', 'loop', 'opaque', 'canonical-mismatch']) {
  published = await recoveryFixture();
  const visited: string[] = [];
  const canonical = 'https://onesmablog.com/canonical-fixture-article-12345';
  globalThis.fetch = async (input, init) => {
    assert.equal(init?.method, 'GET');
    assert.equal(init?.credentials, 'omit');
    assert.equal(init?.redirect, 'manual');
    const url = String(input);
    visited.push(url);
    assert.equal(new URL(url).hostname, 'onesmablog.com', 'never request an untrusted redirect');
    if (scenario === 'opaque') return new Response(null, { status: 200 }); // no observable URL/body
    if (scenario === 'external' || scenario === 'loop' || scenario === 'redirect' && visited.length === 1) {
      const target = scenario === 'external' ? 'https://evil.test/article-12345' : scenario === 'loop' ? url : canonical;
      return new Response(null, { status: 302, headers: { location: target } });
    }
    const canonicalTag = scenario === 'canonical' && visited.length === 1 ? `<link rel="canonical" href="${canonical}">` : '';
    const html = scenario === 'canonical-mismatch' ? '<article><h1>Another article</h1></article>' : `<article><h1>${profile.businessName}</h1><p>${profile.description}</p></article>`;
    const response = new Response(canonicalTag + html, { headers: { 'content-type': 'text/html' } });
    Object.defineProperty(response, 'url', { value: url });
    return response;
  };
  await background.recoverPublishedArticle(published.id, 42);
  const checked = storage['ba2.listingRun'] as ListingRun;
  assert.equal(checked.publicVerification?.status === 'verified', ['redirect', 'canonical'].includes(scenario), scenario);
  if (['redirect', 'canonical'].includes(scenario)) assert.equal(checked.liveUrl, canonical);
  assert.ok(visited.length <= 4, 'bounded public GETs');
}
globalThis.fetch = ordinaryFetch;
assert.equal(publicationDispatches, recoveryPublishesBefore, 'all recovery scenarios dispatch zero publications');
assert.equal(genericFills, recoveryFillsBefore, 'recovery never autofills or starts a run');
assert.equal(sheetBackendCalls, recoveryWritesBefore, 'recovery never invokes write-back');
console.log('Post-publication recovery passed: current run/receipt preservation, trusted popup, receiver lifecycle, interruption, legacy evidence, Visit/GET opening, safe redirects/canonical and zero submissions/writes');

// One initial authorized action; delayed success wakes the coordinator without
// another AUTOFILL/check/recover action, and only read-only Sheets preparation.
const previousProfileId = profile.id;
profile.id = 'automatic-onesmablog-fixture';
autoEditorFixture('onesmablog.com');
sheetSessionKey = 'fixture-local-backend-key-only-not-oauth';
const autoPublishesBefore = publicationDispatches;
const autoWatchesBefore = publicationWatches;
const autoPreparesBefore = sheetPreparationCalls;
const autoWritesBefore = sheetBackendCalls;
await dispatch({ type: 'BA2_START_LISTING_AUTOFILL', autoPublish: true });
const pendingAutomatic = storage['ba2.listingRun'] as ListingRun;
assert.equal(pendingAutomatic.publicationSubmission?.outcome, 'uncertain');
assert.equal(publicationDispatches, autoPublishesBefore + 1);
assert.equal(publicationWatches, autoWatchesBefore + 1, 'observation arms before the one permitted publication');
publicationObservation = { stage: 'CONFIRMATION', confidence: 0.95, publicationEvidence: true, publicUrl: sheetArticleUrl, reason: 'The Article was successfully published. Visit / Edit' };
const automaticMessage = { type: 'BA2_PUBLICATION_CHANGED', runId: pendingAutomatic.id, attemptId: pendingAutomatic.publicationSubmission!.attemptId };
const pageSender = { id: 'a'.repeat(32), tab: { id: 42 }, frameId: 0, url: 'https://onesmablog.com/new' };
for (const sender of [{ ...pageSender, frameId: 1 }, { ...pageSender, url: 'https://evil.test/' }, { ...pageSender, tab: { id: 99 } }]) {
  const snapshot = JSON.stringify(storage);
  await dispatch(automaticMessage, sender);
  assert.equal(JSON.stringify(storage), snapshot, 'foreign frame/origin/tab cannot advance a publication');
}
await Promise.all([dispatch(automaticMessage, pageSender), dispatch(automaticMessage, pageSender)]);
const automaticComplete = storage['ba2.listingRun'] as ListingRun;
assert.equal(automaticComplete.id, pendingAutomatic.id);
assert.equal(automaticComplete.publicVerification?.status, 'verified');
assert.equal(automaticComplete.liveUrl, sheetArticleUrl);
assert.equal(currentTab.url, sheetArticleUrl);
assert.equal(automaticComplete.sheetSync?.status, 'ready');
assert.equal(automaticComplete.sheetSync?.range, 'Sheet1!B23');
assert.equal(automaticComplete.sheetSync?.mode, 'prepare');
assert.equal(sheetPreparationCalls, autoPreparesBefore + 1);
assert.equal(sheetBackendCalls, autoWritesBefore);
assert.equal(publicationDispatches, autoPublishesBefore + 1, 'success never resubmits');
await dispatch(automaticMessage, pageSender);
await background.recoverListingRun();
assert.equal(sheetPreparationCalls, autoPreparesBefore + 1, 'duplicates/startup do not repeat prepared work');
assert.equal((storage['ba2.publicationGuard:onesmablog.com:' + profile.id] as { runId: string }).runId, pendingAutomatic.id);
profile.id = previousProfileId;

// Full-document completion also resumes an interrupted success page automatically.
published = await recoveryFixture();
tabUpdatedListener?.(42, { status: 'complete' });
for (let wait = 0; wait < 30 && (storage['ba2.listingRun'] as ListingRun).publicVerification?.status !== 'verified'; wait++) await flush();
assert.equal((storage['ba2.listingRun'] as ListingRun).publicVerification?.status, 'verified');
await flush();

// Persisted budgets prevent worker restarts from becoming unbounded public reads.
published = await recoveryFixture();
fetchScenario = 'network';
const boundedReadsBefore = fetchCount;
await background.recoverListingRun();
await background.recoverListingRun();
await background.recoverListingRun();
assert.equal(fetchCount, boundedReadsBefore + 2);
assert.equal((storage['ba2.listingRun'] as ListingRun).automaticPublicationRecoveries, 2);
fetchScenario = 'valid';

// A crash after the verified URL was persisted continues GET/preparation only.
published = await verifiedSheetFixture();
const verifiedPreparesBefore = sheetPreparationCalls;
const verifiedWritesBefore = sheetBackendCalls;
await background.recoverListingRun();
assert.equal(currentTab.url, sheetArticleUrl);
assert.equal((storage['ba2.listingRun'] as ListingRun).sheetSync?.status, 'ready');
assert.equal(sheetPreparationCalls, verifiedPreparesBefore + 1);
published = await verifiedSheetFixture();
published.sheetSync = { mode: 'prepare', readAttempts: 1, status: 'syncing', liveUrl: sheetArticleUrl, attemptId: 'interrupted-read', code: 'started', reason: 'fixture' };
await background.recoverListingRun();
assert.equal((storage['ba2.listingRun'] as ListingRun).sheetSync?.status, 'ready');
assert.equal((storage['ba2.listingRun'] as ListingRun).sheetSync?.readAttempts, 2);
assert.equal(sheetBackendCalls, verifiedWritesBefore, 'restart never upgrades preparation to a write');
console.log('Automatic Onesmablog transition passed: one authorized action, delayed/loaded success, authenticated notifications, same run/receipt, public GET verification, exact B preparation, interruption budgets and zero writes');

// Registration is an additional leg of the same ListingRun, with independent consent.
const establishedProfileId = profile.id;
profile.id = 'new-registration-flow-profile';
const archivedBeforeRegistration = structuredClone(storage['ba2.listingRun'] as ListingRun);
currentTab = { id: 42, url: 'https://registration-flow.test/' };
const registrationHomepage = { stage: 'HOMEPAGE', confidence: 0.95, reason: 'fixture homepage',
  loginAction: { kind: 'login', label: 'Login', href: 'https://registration-flow.test/login' },
  signupAction: { kind: 'signup', label: 'Sign Up', href: 'https://registration-flow.test/signup' } };
publicationObservation = registrationHomepage;
genericWorkflowResponse = { ok: true, report: { profileName: profile.businessName, filled: [], skipped: [], manual: [], workflow: registrationHomepage } };
const registrationsBefore = automaticRegistrationSubmits;
const registrationPublishesBefore = publicationDispatches;
const registrationSheetWritesBefore = sheetBackendCalls;
const untrustedRegistration = await dispatch({ type: 'BA2_START_LISTING_AUTOFILL', autoRegister: true, autoPublish: true });
assert.equal(untrustedRegistration.ok, false, 'only explicit trusted-popup registration consent can start this leg');
const authorizedRegistrationStart = await dispatch({ type: 'BA2_START_LISTING_AUTOFILL', autoRegister: true, autoLogin: true, autoPublish: true }, popupSender);
assert.equal(authorizedRegistrationStart.ok, true);
const registrationFlowId = (storage['ba2.listingRun'] as ListingRun).id;
assert.equal(currentTab.url, 'https://registration-flow.test/signup', 'new account chooses Sign Up before Login');
assert.deepEqual(storage['ba2.listingRunArchive:' + archivedBeforeRegistration.id], archivedBeforeRegistration);
publicationObservation = { stage: 'SIGNUP', confidence: 0.95, reason: 'native signup' };
tabUpdatedListener?.(42, { status: 'complete' });
for (let wait = 0; wait < 40 && !(storage['ba2.listingRun'] as ListingRun).registration; wait++) await flush();
assert.equal((storage['ba2.listingRun'] as ListingRun).registration?.state, 'waiting-human');
assert.equal(automaticRegistrationSubmits, registrationsBefore, 'Terms/CAPTCHA are never bypassed');
const registrationSender = { id: 'a'.repeat(32), tab: { id: 42 }, frameId: 0, url: 'https://registration-flow.test/signup' };
automaticRegistrationChecks = { ok: true, captcha: 'verified', reason: 'fixture human gates completed' };
await dispatch({ type: 'BA2_REGISTRATION_CHANGED', runId: registrationFlowId }, registrationSender);
assert.equal(automaticRegistrationSubmits, registrationsBefore + 1);
await dispatch({ type: 'BA2_REGISTRATION_CHANGED', runId: registrationFlowId }, registrationSender);
await background.recoverListingRun();
assert.equal(automaticRegistrationSubmits, registrationsBefore + 1, 'unchanged form/restart never replays registration');
publicationObservation = { stage: 'ACCOUNT_VERIFICATION', confidence: 0.95, reason: 'Check your email' };
await dispatch({ type: 'BA2_REGISTRATION_CHANGED', runId: registrationFlowId }, registrationSender);
assert.equal((storage['ba2.listingRun'] as ListingRun).registration?.state, 'verification');
assert.equal(publicationDispatches, registrationPublishesBefore);
// Family 1 may require Sign In after explicit account creation, rather than
// automatically authenticating. The same START/approvals must own both legs.
const registrationApprovals = structuredClone(storage['ba2.listingRun'] as ListingRun);
const loginsAfterRegistrationBefore = automaticLoginSubmits;
const registrationSuccessPage = new Window({ url: 'https://registration-flow.test/signup' });
registrationSuccessPage.document.write('<div role="status">Your account is succesfuly created</div><a href="/login">Click here to login</a>');
publicationObservation = observeBlogWorkflow(registrationSuccessPage.document as unknown as Document, registrationSuccessPage.location.href);
assert.equal((publicationObservation as { stage: string }).stage, 'ACCOUNT_CREATED', 'use real observer output for the reported wording');
await registrationSuccessPage.happyDOM.close();
genericWorkflowResponse = { ok: true, report: { profileName: profile.businessName, filled: [], skipped: [], manual: [], workflow: publicationObservation } };
await dispatch({ type: 'BA2_REGISTRATION_CHANGED', runId: registrationFlowId }, registrationSender);
assert.equal((storage['ba2.listingRun'] as ListingRun).registration?.state, 'confirmed');
assert.equal(currentTab.url, 'https://registration-flow.test/login', 'confirmed registration selects Sign In, not Sign Up');
assert.equal(automaticLoginSubmits, loginsAfterRegistrationBefore, 'safe GET navigation is not a login submission');
publicationObservation = { stage: 'LOGIN', confidence: 0.95, reason: 'Sign In form' };
automaticLoginChecks = { ok: false, captcha: 'pending', reason: 'Human CAPTCHA required after registration' };
tabUpdatedListener?.(42, { status: 'complete' });
for (let wait = 0; wait < 40 && (storage['ba2.listingRun'] as ListingRun).login?.state !== 'waiting-captcha'; wait++) await flush();
assert.equal((storage['ba2.listingRun'] as ListingRun).login?.state, 'waiting-captcha');
assert.equal(automaticLoginSubmits, loginsAfterRegistrationBefore, 'registration success does not bypass human CAPTCHA');
assert.equal((storage['ba2.listingRun'] as ListingRun).login?.attemptId, undefined, 'no submission intent while CAPTCHA pending');
automaticLoginChecks = { ok: true, captcha: 'verified', reason: 'fixture human CAPTCHA verified' };
const postRegistrationLoginSender = { ...registrationSender, url: currentTab.url };
await Promise.all([
  dispatch({ type: 'BA2_LOGIN_CHANGED', runId: registrationFlowId }, postRegistrationLoginSender),
  dispatch({ type: 'BA2_LOGIN_CHANGED', runId: registrationFlowId }, postRegistrationLoginSender),
]);
assert.equal(automaticLoginSubmits, loginsAfterRegistrationBefore + 1, 'existing authorized Login submits once after registration');
const registeredLogin = storage['ba2.listingRun'] as ListingRun;
assert.equal(registeredLogin.id, registrationFlowId);
assert.deepEqual(registeredLogin.registrationApproval, registrationApprovals.registrationApproval);
assert.deepEqual(registeredLogin.loginApproval, registrationApprovals.loginApproval);
assert.deepEqual(registeredLogin.publicationApproval, registrationApprovals.publicationApproval, 'no renewed or inherited approval');
assert.equal((storage[`ba2.registrationGuard:https://registration-flow.test:${profile.id}`] as { state: string }).state, 'confirmed');
const registeredLoginGuard = structuredClone(storage[`ba2.loginGuard:https://registration-flow.test:${profile.id}`]);
await background.recoverListingRun();
assert.equal(automaticLoginSubmits, loginsAfterRegistrationBefore + 1, 'interruption never replays Sign In');
assert.deepEqual(storage[`ba2.loginGuard:https://registration-flow.test:${profile.id}`], registeredLoginGuard);
assert.equal(publicationDispatches, registrationPublishesBefore, 'Login never publishes');
publicationObservation = { stage: 'AUTHENTICATED_DASHBOARD', confidence: 0.95, authenticationEvidence: true, action: { kind: 'new-post', label: 'New Post', href: 'https://registration-flow.test/new' }, reason: 'authenticated dashboard' };
genericWorkflowResponse = { ok: true, report: { profileName: profile.businessName, filled: [], skipped: [], manual: [], workflow: publicationObservation } };
currentTab.url = 'https://registration-flow.test/dashboard';
await dispatch({ type: 'BA2_REGISTRATION_CHANGED', runId: registrationFlowId }, { ...registrationSender, url: currentTab.url });
assert.equal((storage['ba2.listingRun'] as ListingRun).registration?.state, 'confirmed');
assert.equal(currentTab.url, 'https://registration-flow.test/new');
publicationObservation = { stage: 'EDITOR', confidence: 0.95, authenticationEvidence: true, reason: 'editor' };
genericWorkflowResponse = { ok: true, report: { profileName: profile.businessName, filled: [{ field: 'businessName', descriptor: 'title', value: profile.businessName }, { field: 'description', descriptor: 'body', value: profile.description }], skipped: [], manual: ['Final Submit'], expectedArticle, workflow: publicationObservation } };
tabUpdatedListener?.(42, { status: 'complete' });
for (let wait = 0; wait < 100 && publicationDispatches === registrationPublishesBefore; wait++) await flush();
assert.equal(publicationDispatches, registrationPublishesBefore + 1);
const registrationArticle = 'https://registration-flow.test/approved-article-12345';
publicationObservation = { stage: 'CONFIRMATION', confidence: 0.95, publicationEvidence: true, publicUrl: registrationArticle, reason: 'published Visit / Edit' };
const registrationPublishedRun = storage['ba2.listingRun'] as ListingRun;
await dispatch({ type: 'BA2_PUBLICATION_CHANGED', runId: registrationFlowId, attemptId: registrationPublishedRun.publicationSubmission!.attemptId }, { ...registrationSender, url: currentTab.url });
const registeredComplete = storage['ba2.listingRun'] as ListingRun;
assert.equal(registeredComplete.id, registrationFlowId, 'one START owns the entire registration-to-publication run');
assert.equal(registeredComplete.publicVerification?.status, 'verified');
assert.equal(registeredComplete.liveUrl, registrationArticle);
assert.equal(registeredComplete.sheetSync?.mode, 'prepare');
assert.equal(sheetBackendCalls, registrationSheetWritesBefore);
assert.equal(automaticRegistrationSubmits, registrationsBefore + 1);
assert.equal((storage['ba2.registrationGuard:https://registration-flow.test:' + profile.id] as { state: string }).state, 'confirmed');

// Sites that sign in during registration skip Login, retaining the same run.
profile.id = 'automatic-registration-login-profile';
currentTab = { id: 42, url: 'https://automatic-registration.test/' };
publicationObservation = { ...registrationHomepage, signupAction: { kind: 'signup', label: 'Sign Up', href: 'https://automatic-registration.test/signup' } };
genericWorkflowResponse = { ok: true, report: { profileName: profile.businessName, filled: [], skipped: [], manual: [], workflow: publicationObservation } };
const automaticRegistrationStart = await dispatch({ type: 'BA2_START_LISTING_AUTOFILL', autoRegister: true, autoLogin: true, autoPublish: false }, popupSender);
assert.equal(automaticRegistrationStart.ok, true);
const automaticRegistrationRunId = (storage['ba2.listingRun'] as ListingRun).id;
publicationObservation = { stage: 'SIGNUP', confidence: 0.95, reason: 'native signup' };
await background.recoverListingRun();
assert.ok((storage['ba2.listingRun'] as ListingRun).registration?.attemptId, 'automatic-sign-in fixture first dispatches a guarded registration');
const automaticSignInLogins = automaticLoginSubmits;
const automaticSignInPublishes = publicationDispatches;
publicationObservation = { stage: 'AUTHENTICATED_DASHBOARD', confidence: 0.95, authenticationEvidence: true,
  action: { kind: 'new-post', label: 'New Post', href: 'https://automatic-registration.test/new' }, reason: 'automatically signed in' };
genericWorkflowResponse = { ok: true, report: { profileName: profile.businessName, filled: [], skipped: [], manual: [], workflow: publicationObservation } };
currentTab.url = 'https://automatic-registration.test/dashboard';
await dispatch({ type: 'BA2_REGISTRATION_CHANGED', runId: automaticRegistrationRunId }, { ...registrationSender, url: currentTab.url });
assert.equal((storage['ba2.listingRun'] as ListingRun).id, automaticRegistrationRunId);
assert.equal((storage['ba2.listingRun'] as ListingRun).registration?.state, 'confirmed');
assert.equal(currentTab.url, 'https://automatic-registration.test/new');
assert.equal(automaticLoginSubmits, automaticSignInLogins, 'authenticated registration dashboard never forces Sign In');
assert.equal(publicationDispatches, automaticSignInPublishes, 'registration never grants Publish');
assert.equal(storage[`ba2.loginGuard:https://automatic-registration.test:${profile.id}`], undefined, 'no fabricated Login attempt/receipt');
assert.equal(sheetBackendCalls, registrationSheetWritesBefore);
profile.id = 'new-registration-flow-profile';
storage['ba2.listingRun'] = registeredComplete; // Restore completed fixture before testing another site.

// Lost registration acknowledgement remains uncertain with a durable receipt.
currentTab = { id: 42, url: 'https://registration-lost.test/signup' };
publicationObservation = { stage: 'SIGNUP', confidence: 0.95, reason: 'signup' };
automaticRegistrationLost = true;
const lostStart = await dispatch({ type: 'BA2_START_LISTING_AUTOFILL', autoRegister: true, autoLogin: false, autoPublish: false }, popupSender);
assert.equal(lostStart.ok, true);
const lostRun = storage['ba2.listingRun'] as ListingRun;
assert.equal(lostRun.registration?.state, 'uncertain');
const lostSubmits = automaticRegistrationSubmits;
await background.recoverListingRun();
await dispatch({ type: 'BA2_REGISTRATION_CHANGED', runId: lostRun.id }, { ...registrationSender, url: currentTab.url });
assert.equal(automaticRegistrationSubmits, lostSubmits);
assert.equal((storage['ba2.listingRun'] as ListingRun).id, lostRun.id);
assert.ok(storage['ba2.registrationGuard:https://registration-lost.test:' + profile.id]);
automaticRegistrationLost = false;
profile.id = establishedProfileId;
console.log('Registration coordinator passed: trusted separate consent, Sign Up before Login, one START/receipt, human verification pause, dashboard/editor/one publication/public verification, no writes and no registration replay');

// HOMEPAGE without authentication/error evidence leaves a claimed login unresolved.
// Fresh registration consent must not bypass that account uncertainty via another tab.
const unresolvedProfileId = profile.id;
for (const scenario of ['same-tab', 'other-tab', 'foreign-receipt', 'missing-receipt', 'receipt-only', 'active-run']) {
  profile.id = `unresolved-blogolize-${scenario}`;
  const prior = createListingRun('https://blogolize.com/', profile.id, 42);
  prior.stage = scenario === 'active-run' ? 'NAVIGATING' : 'MANUAL_GATE';
  prior.awaitingManualResume = true;
  prior.autoLogin = true;
  prior.autoPublish = true;
  prior.login = { url: 'https://blogolize.com/login', state: 'uncertain', reason: 'Outcome unresolved', attemptId: 'claimed-login', claimed: true };
  storage['ba2.listingRun'] = prior;
  storage[`ba2.listingRunArchive:${prior.id}`] = structuredClone(prior);
  const key = `ba2.loginGuard:https://blogolize.com:${profile.id}`;
  if (scenario !== 'missing-receipt') storage[key] = { runId: scenario === 'foreign-receipt' ? 'older-run' : prior.id, state: 'uncertain' };
  if (scenario === 'receipt-only') storage['ba2.listingRun'] = createListingRun('https://other.test/', profile.id, 17);
  currentTab = { id: scenario === 'same-tab' ? 42 : 99, url: 'https://blogolize.com/' };
  publicationObservation = { stage: 'HOMEPAGE', confidence: 0.95, authenticationEvidence: false, loginErrorEvidence: false, reason: 'Outcome unknown' };
  const snapshot = JSON.stringify(storage);
  const effects: number[] = [automaticLoginSubmits, automaticRegistrationSubmits, publicationDispatches, genericFills, sheetBackendCalls, sheetPreparationCalls];
  const result = await dispatch({ type: 'BA2_START_LISTING_AUTOFILL', autoRegister: true, autoLogin: false, autoPublish: false }, popupSender);
  assert.equal(result.ok, false, scenario);
  assert.match(result.error || '', /login outcome is unresolved/, scenario);
  assert.equal(JSON.stringify(storage), snapshot, `${scenario}: current run, archive and all receipts unchanged`);
  assert.deepEqual([automaticLoginSubmits, automaticRegistrationSubmits, publicationDispatches, genericFills, sheetBackendCalls, sheetPreparationCalls], effects, `${scenario}: no actions or Sheets access`);
  assert.equal(currentTab.url, 'https://blogolize.com/', 'no navigation');
}
profile.id = unresolvedProfileId;
console.log('Unresolved login blocks registration across tabs/consent changes before mutation; homepage is not failure evidence, saved runs/archives/receipts preserved');

// Explicit recovery creates a separate account lifecycle, never erases/replays
// the old uncertain Login, and only permits new Login after new creation evidence.
let recoverySequence = 0;
function registrationRecoveryFixture() {
  profile.id = `explicit-recovery-${++recoverySequence}`;
  currentTab = { id: 42, url: 'https://blogolize.com/signup' };
  const old = createListingRun('https://blogolize.com/', profile.id, 42);
  Object.assign(old, { stage: 'MANUAL_GATE', awaitingManualResume: true, autoLogin: true, autoPublish: true,
    loginApproval: { authorizedAt: '2000-01-01T00:00:00Z', profileUpdatedAt: profile.updatedAt },
    login: { url: 'https://blogolize.com/login', state: 'uncertain', attemptId: 'old-login', claimed: true, reason: 'Unresolved, not failed' } });
  storage['ba2.listingRun'] = old;
  const key = loginGuardKey(old);
  storage[key] = { runId: old.id, state: 'uncertain', historicalEvidence: 'preserve verbatim' };
  publicationObservation = { stage: 'SIGNUP', confidence: 0.95, reason: 'native REGISTER control despite Sign In heading' };
  automaticRegistrationChecks = { ok: false, captcha: 'pending', reason: 'Human Terms/CAPTCHA checkpoint' };
  return { old: structuredClone(old), key, guard: structuredClone(storage[key]) as { runId: string; state: string; historicalEvidence: string }, message: {
    type: 'BA2_START_LISTING_AUTOFILL', registrationRecoveryFromRunId: old.id, firstRegistrationConfirmed: true,
    autoRegister: true, autoLogin: true, autoPublish: true,
  } };
}
for (const scenario of ['untrusted', 'no-register', 'no-attestation', 'no-login-choice', 'no-publish-choice', 'wrong-id', 'missing-guard', 'foreign-guard', 'publication', 'registration', 'not-signup', 'unsafe-homepage', 'archive-conflict']) {
  const fixture = registrationRecoveryFixture();
  const message: Record<string, unknown> = { ...fixture.message };
  if (scenario === 'no-register') message.autoRegister = false;
  if (scenario === 'no-attestation') message.firstRegistrationConfirmed = false;
  if (scenario === 'no-login-choice') delete message.autoLogin;
  if (scenario === 'no-publish-choice') delete message.autoPublish;
  if (scenario === 'wrong-id') message.registrationRecoveryFromRunId = 'other';
  if (scenario === 'missing-guard') delete storage[fixture.key];
  if (scenario === 'foreign-guard') storage[fixture.key] = { runId: 'other', state: 'uncertain' };
  if (scenario === 'publication') storage[`ba2.publicationGuard:blogolize.com:${profile.id}`] = { runId: 'other' };
  if (scenario === 'registration') storage[`ba2.registrationGuard:https://blogolize.com:${profile.id}`] = { runId: 'other' };
  if (scenario === 'not-signup') publicationObservation = { stage: 'LOGIN', confidence: 0.95, reason: 'Sign In only' };
  if (scenario === 'unsafe-homepage') publicationObservation = { stage: 'HOMEPAGE', confidence: 0.95, reason: 'Untrusted signup', signupAction: { kind: 'signup', label: 'Sign Up', href: 'https://other.test/signup' } };
  if (scenario === 'archive-conflict') storage['ba2.listingRunArchive:' + fixture.old.id] = { ...fixture.old, error: 'different history' };
  const snapshot = JSON.stringify(storage);
  assert.equal((await dispatch(message, scenario === 'untrusted' ? {} : popupSender)).ok, false, scenario);
  assert.equal(JSON.stringify(storage), snapshot, `${scenario}: nothing replaced/archived/cleared`);
}
for (const reason of ['missing', 'closed', 'replaced', 'registration-attempt', 'publication-attempt']) {
  const fixture = registrationRecoveryFixture();
  const old = storage['ba2.listingRun'] as ListingRun;
  if (reason === 'registration-attempt') {
    old.autoRegister = true;
    old.registration = { url: currentTab.url, state: 'uncertain', attemptId: 'existing-registration', claimed: true, reason: 'Unknown outcome' };
    storage[`ba2.registrationGuard:https://blogolize.com:${profile.id}`] = { runId: old.id, state: 'uncertain', evidence: 'retain' };
  }
  if (reason === 'publication-attempt') {
    old.submissionAttempted = true;
    old.publicationSubmission = { attemptId: 'existing-publication', url: currentTab.url, startedAt: new Date().toISOString(), outcome: 'uncertain' };
    storage[`ba2.publicationGuard:blogolize.com:${profile.id}`] = { runId: old.id, evidence: 'retain' };
  }
  const receipts = JSON.stringify(Object.fromEntries(Object.entries(storage).filter(([key]) => key.includes('Guard:'))));
  const attempts: number[] = [automaticLoginSubmits, automaticRegistrationSubmits, publicationDispatches, sheetBackendCalls];
  missingTabs.add(42);
  currentTab = { id: 99, url: 'https://blogolize.com/signup' };
  if (reason === 'missing') await background.recoverListingRun();
  else if (reason === 'replaced') tabReplacedListener?.(99, 42);
  else tabRemovedListener?.(42);
  for (let wait = 0; wait < 30 && !(storage['ba2.listingRun'] as ListingRun).tabUnavailable; wait++) await flush();
  const paused = storage['ba2.listingRun'] as ListingRun;
  assert.equal(paused.tabId, 42, `${reason}: never rebind the saved run`);
  assert.equal(paused.tabUnavailable?.tabId, 42, reason);
  assert.equal(paused.login?.state, 'uncertain');
  if (reason === 'replaced') assert.equal(paused.tabUnavailable?.replacementTabId, 99, 'replacement is diagnostic evidence only');
  assert.equal(JSON.stringify(Object.fromEntries(Object.entries(storage).filter(([key]) => key.includes('Guard:')))), receipts, 'lifecycle observation never reconstructs receipts');
  const snapshot = JSON.stringify(storage);
  await background.recoverListingRun();
  tabUpdatedListener?.(99, { status: 'complete' });
  await flush();
  assert.equal(JSON.stringify(storage), snapshot, 'paused worker/navigation cannot replay or rebind');
  if (reason === 'registration-attempt' || reason === 'publication-attempt') {
    assert.equal((await dispatch(fixture.message, popupSender)).ok, false, 'existing uncertain submissions block a fresh registration');
    assert.equal(JSON.stringify(storage), snapshot);
  }
  assert.deepEqual([automaticLoginSubmits, automaticRegistrationSubmits, publicationDispatches, sheetBackendCalls], attempts);
  missingTabs.delete(42);
}
for (const failure of ['original-still-open', 'unrelated-api-error']) {
  const fixture = registrationRecoveryFixture();
  currentTab = { id: 99, url: 'https://blogolize.com/signup' };
  if (failure === 'unrelated-api-error') tabLookupErrors.set(42, 'Tabs API unavailable');
  const snapshot = JSON.stringify(storage);
  assert.equal((await dispatch(fixture.message, popupSender)).ok, false, failure);
  assert.equal(JSON.stringify(storage), snapshot, 'only a confirmed missing original tab permits a new-tab recovery');
  tabLookupErrors.delete(42);
}
const recovery = registrationRecoveryFixture();
// Reproduce the live ERROR with a missing saved ID and a different active ID.
recovery.old.tabId = 691263529;
recovery.old.stage = 'ERROR';
recovery.old.error = 'No tab with id: 691263529';
storage['ba2.listingRun'] = structuredClone(recovery.old);
currentTab = { id: 691263716, url: 'https://blogolize.com/' };
missingTabs.add(691263529);
publicationObservation = { stage: 'HOMEPAGE', confidence: 0.95, reason: 'publisher homepage', signupAction: { kind: 'signup', label: 'Sign Up', href: 'https://blogolize.com/signup' }, loginAction: { kind: 'login', label: 'Login', href: 'https://blogolize.com/login' } };
genericWorkflowResponse = { ok: true, report: { profileName: profile.businessName, filled: [], skipped: [], manual: [], workflow: publicationObservation } };
const strandedSnapshot = JSON.stringify(storage);
const ordinaryStrandedStart = await dispatch({ type: 'BA2_START_LISTING_AUTOFILL', autoRegister: true, autoLogin: true, autoPublish: true }, popupSender);
assert.equal(ordinaryStrandedStart.ok, false, 'ordinary START cannot replace a stranded ERROR run');
assert.equal(ordinaryStrandedStart.error, 'Saved tab is unavailable. Inspect the saved attempt and use an eligible explicit recovery; automatic tab replacement is blocked.', 'exact live error identifies ordinary START without recovery context');
assert.equal(JSON.stringify(storage), strandedSnapshot);
const recoveryEffects = [automaticLoginSubmits, automaticRegistrationSubmits, publicationDispatches, sheetBackendCalls, sheetPreparationCalls];
const concurrentRecovery = await Promise.all([dispatch(recovery.message, popupSender), dispatch(recovery.message, popupSender)]);
assert.equal(concurrentRecovery.filter(result => result.ok).length, 1, 'one serialized recovery only');
assert.equal(currentTab.url, 'https://blogolize.com/signup', 'fresh authorized homepage run selects observed Sign Up before Login');
publicationObservation = { stage: 'SIGNUP', confidence: 0.95, reason: 'Registration form' };
tabUpdatedListener?.(currentTab.id, { status: 'complete' });
for (let wait = 0; wait < 40 && !(storage['ba2.listingRun'] as ListingRun).registration; wait++) await flush();
let recoveryRun = storage['ba2.listingRun'] as ListingRun;
assert.notEqual(recoveryRun.id, recovery.old.id);
assert.equal(recoveryRun.tabId, 691263716, 'only the freshly authorized new run adopts the observed current tab');
assert.deepEqual(storage['ba2.listingRunArchive:' + recovery.old.id], recovery.old);
assert.deepEqual(storage[recovery.key], recovery.guard);
assert.notDeepEqual(recoveryRun.loginApproval, recovery.old.loginApproval, 'old consent never renewed/reused');
assert.equal(recoveryRun.autoRegister, true);
assert.equal(recoveryRun.registration?.state, 'waiting-human');
assert.deepEqual([automaticLoginSubmits, automaticRegistrationSubmits, publicationDispatches, sheetBackendCalls, sheetPreparationCalls], recoveryEffects, 'human gates stop all submissions and Sheets reads/writes');
assert.equal(await registrationRecoveryValid(recoveryRun, true), false, 'no new Login before new account-created evidence');
const recoverySender = { id: 'a'.repeat(32), tab: { id: currentTab.id }, frameId: 0, url: currentTab.url };
const recoverySignal = { type: 'BA2_REGISTRATION_CHANGED', runId: recoveryRun.id };
const recoveryApprovals = structuredClone({ registration: recoveryRun.registrationApproval, login: recoveryRun.loginApproval, publication: recoveryRun.publicationApproval });
const preservedArchive = storage['ba2.listingRunArchive:' + recovery.old.id];
storage['ba2.listingRunArchive:' + recovery.old.id] = undefined;
assert.equal(await registrationRecoveryValid(recoveryRun), false, 'missing archive cannot become recovery evidence');
storage['ba2.listingRunArchive:' + recovery.old.id] = preservedArchive;
// Changed historical receipt stops unchanged, including on worker recovery.
storage[recovery.key] = { ...recovery.guard, state: 'authenticated' };
const changedRecovery = JSON.stringify(storage);
await background.recoverListingRun();
await dispatch(recoverySignal, recoverySender);
assert.equal(JSON.stringify(storage), changedRecovery);
storage[recovery.key] = recovery.guard; // Fixture-only restoration; never a live operation.
automaticRegistrationChecks = { ok: true, captcha: 'verified', reason: 'Fixture human gates completed' };
automaticRegistrationLost = true;
await Promise.all([dispatch(recoverySignal, recoverySender), dispatch(recoverySignal, recoverySender)]);
automaticRegistrationLost = false;
assert.equal(automaticRegistrationSubmits, recoveryEffects[1] + 1);
assert.equal((storage['ba2.listingRun'] as ListingRun).registration?.state, 'uncertain');
await background.recoverListingRun();
assert.equal(automaticRegistrationSubmits, recoveryEffects[1] + 1, 'lost registration never repeats');
currentTab.url = 'https://blogolize.com/login';
publicationObservation = { stage: 'LOGIN', confidence: 0.95, reason: 'Login alone does not confirm account creation' };
await dispatch(recoverySignal, { ...recoverySender, url: currentTab.url });
assert.equal(automaticLoginSubmits, recoveryEffects[0]);
publicationObservation = { stage: 'LOGIN', confidence: 0.95, registrationEvidence: true, reason: 'Account successfully created; Sign In' };
automaticLoginChecks = { ok: true, captcha: 'verified', reason: 'Fixture Sign In validated' };
automaticLoginLost = true;
await dispatch(recoverySignal, { ...recoverySender, url: currentTab.url });
automaticLoginLost = false;
recoveryRun = storage['ba2.listingRun'] as ListingRun;
assert.equal(recoveryRun.registration?.state, 'confirmed');
assert.equal(recoveryRun.registrationCompletion?.kind, 'account-created');
assert.equal(automaticLoginSubmits, recoveryEffects[0] + 1);
assert.equal(recoveryRun.login?.state, 'uncertain');
assert.deepEqual(storage[recovery.key], recovery.guard, 'old guard unchanged after new Login');
assert.notEqual(loginGuardKey(recoveryRun), recovery.key);
assert.equal((storage[loginGuardKey(recoveryRun)] as { runId: string }).runId, recoveryRun.id);
const newReceipt = storage[loginGuardKey(recoveryRun)];
storage[loginGuardKey(recoveryRun)] = { runId: 'foreign', state: 'uncertain' };
assert.equal(await registrationRecoveryValid(recoveryRun, true), false, 'new Login receipt cannot be reconstructed or replaced');
storage[loginGuardKey(recoveryRun)] = newReceipt;
await background.recoverListingRun();
assert.equal(automaticLoginSubmits, recoveryEffects[0] + 1, 'new uncertain Login never replayed');
publicationObservation = { stage: 'AUTHENTICATED_DASHBOARD', confidence: 0.95, authenticationEvidence: true, action: { kind: 'new-post', label: 'New Post', href: 'https://blogolize.com/new' }, reason: 'Authenticated' };
genericWorkflowResponse = { ok: true, report: { profileName: profile.businessName, filled: [], skipped: [], manual: [], workflow: publicationObservation } };
currentTab.url = 'https://blogolize.com/dashboard';
await dispatch(recoverySignal, { ...recoverySender, url: currentTab.url });
assert.equal(currentTab.url, 'https://blogolize.com/new');
assert.equal((storage['ba2.listingRun'] as ListingRun).login?.state, 'authenticated');
assert.deepEqual(storage[recovery.key], recovery.guard);
assert.deepEqual(storage['ba2.listingRunArchive:' + recovery.old.id], recovery.old);
assert.equal(publicationDispatches, recoveryEffects[2]);
assert.equal(sheetBackendCalls, recoveryEffects[3]);
// Reuse existing editor/publication/verification continuation, with no second START.
publicationObservation = { stage: 'EDITOR', confidence: 0.95, authenticationEvidence: true, reason: 'editor' };
genericWorkflowResponse = { ok: true, report: { profileName: profile.businessName,
  filled: [{ field: 'businessName', descriptor: 'title', value: profile.businessName }, { field: 'description', descriptor: 'body', value: profile.description }],
  skipped: [], manual: ['Final Submit'], expectedArticle, workflow: publicationObservation } };
tabUpdatedListener?.(currentTab.id, { status: 'complete' });
for (let wait = 0; wait < 100 && publicationDispatches === recoveryEffects[2]; wait++) await flush();
assert.equal(publicationDispatches, recoveryEffects[2] + 1);
const recoveryPublished = storage['ba2.listingRun'] as ListingRun;
publicationObservation = { stage: 'CONFIRMATION', confidence: 0.95, publicationEvidence: true, publicUrl: 'https://blogolize.com/recovery-article-12345', reason: 'Published Visit / Edit' };
await dispatch({ type: 'BA2_PUBLICATION_CHANGED', runId: recoveryPublished.id, attemptId: recoveryPublished.publicationSubmission!.attemptId }, { ...recoverySender, url: currentTab.url });
const recoveryVerified = storage['ba2.listingRun'] as ListingRun;
assert.equal(recoveryVerified.publicVerification?.status, 'verified');
assert.equal(currentTab.id, 691263716, 'Visit opens in the newly authorized tab, never the missing original');
assert.equal(currentTab.url, 'https://blogolize.com/recovery-article-12345', 'public article opens automatically without a Visit click');
assert.equal(recoveryVerified.sheetSync?.mode, 'prepare');
assert.equal(sheetBackendCalls, recoveryEffects[3], 'recovery never activates Sheets writes');
assert.deepEqual({ registration: recoveryVerified.registrationApproval, login: recoveryVerified.loginApproval, publication: recoveryVerified.publicationApproval }, recoveryApprovals);
assert.deepEqual(storage[recovery.key], recovery.guard, 'original Login stays uncertain even after independently verified publication');
assert.deepEqual(storage['ba2.listingRunArchive:' + recovery.old.id], recovery.old);
await background.recoverListingRun();
assert.equal(publicationDispatches, recoveryEffects[2] + 1, 'interrupted completion never republishes');
profile.id = unresolvedProfileId;
console.log('Explicit registration recovery passed: preserved uncertain history, fresh separate consent, signup evidence, serialized archive, new account lifecycle before new Login, distinct receipts, interruption no replay and no writes');
console.log('Stale tab recovery passed: absent saved/live different IDs, closure/replacement pause without receipt mutation, no blind reassignment, guarded fresh run through registration/Login/publication/Visit/verification');

// Actual reported Blogolize checkpoint: fill-only testing grants no coordinator
// consent and an authenticated receipt from another run cannot authorize START.
const disconnectedBlogolize = createListingRun('https://blogolize.com/', profile.id, 691263529);
disconnectedBlogolize.stage = 'MANUAL_GATE';
disconnectedBlogolize.awaitingManualResume = false;
disconnectedBlogolize.autoRegister = false;
disconnectedBlogolize.autoLogin = false;
disconnectedBlogolize.autoPublish = false;
disconnectedBlogolize.tabUnavailable = { tabId: 691263529, detectedAt: new Date().toISOString(), reason: 'missing' };
storage['ba2.listingRun'] = disconnectedBlogolize;
storage[`ba2.loginGuard:https://blogolize.com:${profile.id}`] = { runId: 'previous-authenticated-run', state: 'authenticated' };
delete storage[`ba2.registrationGuard:https://blogolize.com:${profile.id}`];
currentTab = { id: 691263716, url: 'https://blogolize.com/login' };
publicationObservation = { stage: 'LOGIN', confidence: 0.95, reason: 'Operator filled separate test; no current consent' };
const disconnectedSnapshot = JSON.stringify(storage);
const disconnectedEffects = [updates.length, automaticRegistrationSubmits, automaticLoginSubmits, publicationDispatches, sheetBackendCalls, sheetPreparationCalls];
const disconnectedSender = { id: 'a'.repeat(32), tab: { id: currentTab.id }, frameId: 0, url: currentTab.url };
assert.equal((await dispatch({ type: 'BA2_REGISTRATION_CHANGED', runId: disconnectedBlogolize.id }, disconnectedSender)).ok, false);
assert.equal((await dispatch({ type: 'BA2_LOGIN_CHANGED', runId: disconnectedBlogolize.id }, disconnectedSender)).ok, false);
await background.recoverListingRun();
const disconnectedStart = await dispatch({ type: 'BA2_START_LISTING_AUTOFILL', autoRegister: false, autoLogin: false, autoPublish: false });
assert.equal(disconnectedStart.ok, false);
assert.match(disconnectedStart.error, /Saved tab is unavailable/);
assert.equal(JSON.stringify(storage), disconnectedSnapshot, 'no rebinding, inherited consent, receipt edits or archived-run replacement');
assert.deepEqual([updates.length, automaticRegistrationSubmits, automaticLoginSubmits, publicationDispatches, sheetBackendCalls, sheetPreparationCalls], disconnectedEffects);
console.log('Reported disconnected Blogolize checkpoint passed: separate fill cannot resume missing tab or inherit foreign authenticated receipt; no submissions or storage changes');

function existingAccountFixture() {
  profile.id = 'existing-account-recovery-profile';
  const old = createListingRun('https://blogolize.com/', profile.id, 691263529);
  old.stage = 'MANUAL_GATE'; old.awaitingManualResume = false;
  old.autoRegister = false; old.autoLogin = false; old.autoPublish = false;
  old.loginApproval = { authorizedAt: '2000-01-01T00:00:00Z', profileUpdatedAt: profile.updatedAt };
  old.publicationApproval = { authorizedAt: '2000-01-01T00:00:00Z', profileFingerprint: 'old-approval' };
  old.tabUnavailable = { tabId: old.tabId, detectedAt: new Date().toISOString(), reason: 'missing' };
  storage['ba2.listingRun'] = old;
  const base = `ba2.loginGuard:https://blogolize.com:${profile.id}`;
  const regKey = `ba2.registrationGuard:https://blogolize.com:${profile.id}`;
  const pubKey = `ba2.publicationGuard:blogolize.com:${profile.id}`;
  storage[base] = { runId: 'prior-account-login', state: 'authenticated' };
  delete storage[regKey]; delete storage[pubKey];
  missingTabs.add(old.tabId); tabLookupErrors.delete(old.tabId);
  currentTab = { id: 691263716, url: 'https://blogolize.com/login' };
  publicationObservation = { stage: 'LOGIN', confidence: 0.95, reason: 'Actual existing-account Login form' };
  automaticLoginChecks = { ok: false, captcha: 'pending', reason: 'Complete human CAPTCHA' };
  const message = { type: 'BA2_START_LISTING_AUTOFILL', existingAccountRecoveryFromRunId: old.id, accountStatus: 'existing', autoLogin: true, autoRegister: false, autoPublish: false };
  return { old, base, regKey, pubKey, message };
}
for (const condition of ['no-consent', 'publish', 'register', 'sender', 'login-uncertain', 'malformed-guard', 'registration-uncertain', 'publication', 'attempted-run', 'original-open', 'other-tab-error', 'wrong-page', 'changed-profile', 'archive-conflict']) {
  const f = existingAccountFixture();
  const message = { ...f.message };
  if (condition === 'no-consent') message.autoLogin = false;
  if (condition === 'publish') message.autoPublish = true;
  if (condition === 'register') message.autoRegister = true;
  if (condition === 'login-uncertain') storage[f.base] = { runId: 'prior-account-login', state: 'uncertain' };
  if (condition === 'malformed-guard') storage[f.base] = false;
  if (condition === 'registration-uncertain') storage[f.regKey] = { runId: 'prior-registration', state: 'uncertain' };
  if (condition === 'publication') storage[f.pubKey] = { runId: 'prior-publication' };
  if (condition === 'attempted-run') f.old.login = { url: currentTab.url, state: 'uncertain', claimed: true, attemptId: 'unresolved', reason: 'Never replay' };
  if (condition === 'original-open') missingTabs.delete(f.old.tabId);
  if (condition === 'other-tab-error') tabLookupErrors.set(f.old.tabId, 'Tabs API unavailable');
  if (condition === 'wrong-page') publicationObservation = { stage: 'SIGNUP', confidence: 0.95, reason: 'Not Login' };
  if (condition === 'changed-profile') f.old.profileId = 'different-profile';
  if (condition === 'archive-conflict') storage['ba2.listingRunArchive:' + f.old.id] = { ...f.old, stage: 'ERROR' };
  const before = JSON.stringify(storage);
  const effects: number[] = [updates.length, automaticLoginFills, automaticLoginSubmits, automaticRegistrationSubmits, publicationDispatches];
  assert.equal((await dispatch(message, condition === 'sender' ? { tab: { id: currentTab.id }, url: currentTab.url } : popupSender)).ok, false, condition);
  assert.equal(JSON.stringify(storage), before, condition + ': nothing replaced');
  assert.deepEqual([updates.length, automaticLoginFills, automaticLoginSubmits, automaticRegistrationSubmits, publicationDispatches], effects, condition);
}
const existingRecovery = existingAccountFixture();
// Preserve even a confirmed registration receipt; never synthesize or replay it.
storage[existingRecovery.regKey] = { runId: 'prior-successful-registration', state: 'confirmed' };
const existingOldSnapshot = structuredClone(existingRecovery.old);
const priorExistingGuards = [structuredClone(storage[existingRecovery.base]), structuredClone(storage[existingRecovery.regKey])];
const existingEffects = [automaticLoginFills, automaticLoginSubmits, automaticRegistrationSubmits, publicationDispatches, sheetBackendCalls, sheetPreparationCalls];
const existingStarts = await Promise.all([dispatch(existingRecovery.message, popupSender), dispatch(existingRecovery.message, popupSender)]);
assert.equal(existingStarts.filter(result => result.ok).length, 1, 'one explicit recovery wins concurrent START');
let existingRun = storage['ba2.listingRun'] as ListingRun;
assert.equal(existingRun.tabId, currentTab.id);
assert.equal(existingRun.login?.state, 'waiting-captcha');
assert.equal(existingRun.autoRegister, false); assert.equal(existingRun.autoPublish, false);
assert.equal(existingRun.registration, undefined); assert.equal(existingRun.publicationApproval, undefined);
assert.notDeepEqual(existingRun.loginApproval, existingRecovery.old.loginApproval, 'fresh Login consent, never old timestamp');
assert.equal(automaticLoginFills, existingEffects[0] + 1);
assert.equal(automaticLoginSubmits, existingEffects[1]);
assert.deepEqual(storage['ba2.listingRunArchive:' + existingRecovery.old.id], existingOldSnapshot);
assert.deepEqual([storage[existingRecovery.base], storage[existingRecovery.regKey]], priorExistingGuards);
assert.equal(await registrationRecoveryValid(existingRun, true), true);
// Interrupted worker observes pending CAPTCHA, never renews consent or submits.
await background.recoverListingRun();
assert.equal(automaticLoginSubmits, existingEffects[1]);
const existingSignal = { type: 'BA2_LOGIN_CHANGED', runId: existingRun.id };
const existingSender = { id: 'a'.repeat(32), tab: { id: currentTab.id }, frameId: 0, url: currentTab.url };
storage[existingRecovery.base] = { runId: 'changed', state: 'uncertain' };
const changedExistingSnapshot = JSON.stringify(storage);
automaticLoginChecks = { ok: true, captcha: 'verified', reason: 'Human completed CAPTCHA' };
await dispatch(existingSignal, existingSender);
assert.equal(JSON.stringify(storage), changedExistingSnapshot, 'changed historical guard blocks continuation unchanged');
storage[existingRecovery.base] = structuredClone(priorExistingGuards[0]);
automaticLoginLost = true;
await Promise.all([dispatch(existingSignal, existingSender), dispatch(existingSignal, existingSender)]);
automaticLoginLost = false;
existingRun = storage['ba2.listingRun'] as ListingRun;
assert.equal(existingRun.login?.state, 'uncertain', 'lost response burns the new attempt');
assert.equal(automaticLoginSubmits, existingEffects[1] + 1);
assert.notEqual(loginGuardKey(existingRun), existingRecovery.base);
assert.equal((storage[loginGuardKey(existingRun)] as { runId: string }).runId, existingRun.id);
await background.recoverListingRun();
await dispatch(existingSignal, existingSender);
assert.equal(automaticLoginSubmits, existingEffects[1] + 1, 'interrupted Login never replayed');
publicationObservation = { stage: 'AUTHENTICATED_DASHBOARD', confidence: 0.95, authenticationEvidence: true, action: { kind: 'new-post', label: 'New Post', href: 'https://blogolize.com/new' }, reason: 'Authenticated dashboard' };
genericWorkflowResponse = { ok: true, report: { profileName: profile.businessName, filled: [], skipped: [], manual: [], workflow: publicationObservation } };
currentTab.url = 'https://blogolize.com/dashboard';
await dispatch(existingSignal, { ...existingSender, url: currentTab.url });
assert.equal(currentTab.url, 'https://blogolize.com/new', 'same coordinator continues dashboard to actual New Post');
assert.equal((storage['ba2.listingRun'] as ListingRun).login?.state, 'authenticated');
assert.deepEqual(storage['ba2.listingRunArchive:' + existingRecovery.old.id], existingOldSnapshot);
assert.deepEqual([storage[existingRecovery.base], storage[existingRecovery.regKey]], priorExistingGuards);
assert.deepEqual([automaticRegistrationSubmits, publicationDispatches, sheetBackendCalls, sheetPreparationCalls], existingEffects.slice(2), 'Login-only recovery cannot register, publish or call Sheets');
profile.id = unresolvedProfileId;
console.log('Existing-account recovery passed: trusted fresh Login-only consent, observed Login/missing-tab/history checks, atomic archive, concurrent start, human CAPTCHA, distinct receipt, interrupted no-replay and dashboard navigation');

// Dispatch inspection is a separate, read-only message even when its nested
// proposed START would be fully authorized. No automation API may be reached.
const dispatchFixture = existingAccountFixture();
const dispatchStorageBefore = JSON.stringify(storage);
const dispatchEffectsBefore = [updates.length, genericFills, automaticLoginFills, automaticLoginSubmits, automaticRegistrationSubmits, publicationDispatches, fetchCount, sheetBackendCalls, sheetPreparationCalls];
const originalDiagnosticSet = chrome.storage.local.set;
const originalDiagnosticSend = chrome.tabs.sendMessage;
const originalDiagnosticUpdate = chrome.tabs.update;
const originalDiagnosticCreate = chrome.tabs.create;
const originalDiagnosticScript = chrome.scripting.executeScript;
let diagnosticMutationCalls = 0;
const forbiddenDiagnosticAction = async () => { diagnosticMutationCalls++; throw Error('Inspection cannot reach an action API'); };
chrome.storage.local.set = forbiddenDiagnosticAction;
chrome.tabs.sendMessage = forbiddenDiagnosticAction;
chrome.tabs.update = forbiddenDiagnosticAction;
chrome.tabs.create = forbiddenDiagnosticAction;
chrome.scripting.executeScript = forbiddenDiagnosticAction;
try {
  for (const action of [
    { type: 'BA2_START_LISTING_AUTOFILL' },
    dispatchFixture.message,
    { ...dispatchFixture.message, existingAccountRecoveryFromRunId: 'not-the-saved-run' },
    { type: 'BA2_START_LISTING_AUTOFILL', registrationRecoveryFromRunId: dispatchFixture.old.id, autoRegister: true, autoLogin: true, autoPublish: true },
    { type: 'BA2_START_LISTING_AUTOFILL', freshFromRunId: dispatchFixture.old.id, autoLogin: true, autoPublish: true },
    { type: 'BA2_LOGIN_SUBMIT_ONCE', credentials: 'must-not-be-output', token: 'must-not-be-output' },
    null,
  ]) {
    const result = await dispatch({ type: 'BA2_INSPECT_LISTING_DISPATCH', action }, popupSender);
    assert.deepEqual(Object.keys(result).sort(), ['actionType','authorization','recoveryFields','sameOrigin','savedOrigin','savedTabId','savedTabUnavailable','selectedOrigin','selectedTabId','workerRoute']);
    assert.equal(result.actionType, action?.type === 'BA2_START_LISTING_AUTOFILL' ? action.type : null);
    assert.equal(result.selectedTabId, currentTab.id);
    assert.equal(result.savedTabId, dispatchFixture.old.tabId);
    assert.equal(result.selectedOrigin, 'https://blogolize.com');
    assert.equal(result.savedOrigin, 'https://blogolize.com');
    assert.equal(result.sameOrigin, true);
    assert.equal(result.savedTabUnavailable, true);
    assert.equal(result.workerRoute, action?.type !== 'BA2_START_LISTING_AUTOFILL' ? 'unsupported-action'
      : 'existingAccountRecoveryFromRunId' in action ? 'startListingRun:existing-account-recovery'
      : 'registrationRecoveryFromRunId' in action ? 'startListingRun:registration-recovery'
      : 'startListingRun:saved-tab-unavailable');
    assert.deepEqual(result.recoveryFields.existingAccount, {
      present: action != null && 'existingAccountRecoveryFromRunId' in action,
      matchesSavedRun: action != null && 'existingAccountRecoveryFromRunId' in action && action.existingAccountRecoveryFromRunId === dispatchFixture.old.id,
    });
    assert.equal(JSON.stringify(storage), dispatchStorageBefore);
    assert.doesNotMatch(JSON.stringify(result), /must-not-be-output/);
    assert.ok(!JSON.stringify(result).includes(dispatchFixture.old.id), 'run IDs are not diagnostic output');
    assert.deepEqual([updates.length, genericFills, automaticLoginFills, automaticLoginSubmits, automaticRegistrationSubmits, publicationDispatches, fetchCount, sheetBackendCalls, sheetPreparationCalls], dispatchEffectsBefore);
  }
  const diagnosticTab = currentTab;
  currentTab = { id: 200, url: 'https://bloguetechno.com/?private=must-not-be-output#must-not-be-output' };
  const crossSiteDiagnostic = await dispatch({ type: 'BA2_INSPECT_LISTING_DISPATCH', action: { type: 'BA2_START_LISTING_AUTOFILL', autoRegister: false, autoLogin: true, autoPublish: false } }, popupSender);
  assert.equal(crossSiteDiagnostic.selectedOrigin, 'https://bloguetechno.com');
  assert.equal(crossSiteDiagnostic.savedOrigin, 'https://blogolize.com');
  assert.equal(crossSiteDiagnostic.sameOrigin, false);
  assert.equal(crossSiteDiagnostic.selectedTabId, 200);
  assert.equal(crossSiteDiagnostic.savedTabId, dispatchFixture.old.tabId);
  assert.equal(crossSiteDiagnostic.workerRoute, 'startListingRun:saved-tab-unavailable', 'current global stale-tab gate precedes website comparison');
  assert.deepEqual(crossSiteDiagnostic.authorization, { autoRegister: false, autoLogin: true, autoPublish: false });
  assert.doesNotMatch(JSON.stringify(crossSiteDiagnostic), /must-not-be-output/);
  assert.equal(JSON.stringify(storage), dispatchStorageBefore, 'unrelated old run/approvals/receipts remain unchanged');
  assert.deepEqual([updates.length, genericFills, automaticLoginFills, automaticLoginSubmits, automaticRegistrationSubmits, publicationDispatches, fetchCount, sheetBackendCalls, sheetPreparationCalls], dispatchEffectsBefore);
  currentTab = diagnosticTab;
  assert.equal(await dispatch({ type: 'BA2_INSPECT_LISTING_DISPATCH', action: dispatchFixture.message }, { tab: { id: currentTab.id }, url: currentTab.url }), null, 'inspection restricted to trusted popup');
  assert.equal(diagnosticMutationCalls, 0, 'even fully authorized nested START never reaches storage/content/navigation/injection');
} finally {
  chrome.storage.local.set = originalDiagnosticSet;
  chrome.tabs.sendMessage = originalDiagnosticSend;
  chrome.tabs.update = originalDiagnosticUpdate;
  chrome.tabs.create = originalDiagnosticCreate;
  chrome.scripting.executeScript = originalDiagnosticScript;
}
profile.id = unresolvedProfileId;
console.log('Dispatch inspection passed: sanitized ordinary/recovery/malformed actions, trusted popup only, no coordinator dispatch, content messages, mutation, navigation, submission or credential output');

// Homepage entry must precede learned editor recipes for every account state.
// Deliberately nonstandard fixture URLs prove routes come from observed links.
const homepageProfileId = profile.id;
for (const host of ['ampblogs.com', 'onesmablog.com', 'blogocial.com', 'blogolize.com', 'bloguetechno.com']) {
  for (const account of ['new', 'existing', 'authenticated']) {
    profile.id = `homepage-${host}-${account}`;
    resetAutoLogin(host);
    currentTab = { id: 42, url: `https://${host}/` };
    const target = `https://${host}/observed-${account}-entry`;
    const document = new Window({ url: currentTab.url }).document;
    document.body.innerHTML = account === 'authenticated'
      ? `<p>Dashboard</p> <a href="/sign-out">Log out</a> <a href="${target}">New post</a>`
      : `<a href="${account === 'new' ? target : '/other-signup'}">Sign Up</a><a href="${account === 'existing' ? target : '/other-login'}">Login</a>`;
    publicationObservation = observeBlogWorkflow(document as unknown as Document, currentTab.url);
    assert.equal((publicationObservation as { stage: string }).stage, account === 'authenticated' ? 'AUTHENTICATED_DASHBOARD' : 'HOMEPAGE');
    genericWorkflowResponse = { ok: true, report: { profileName: profile.businessName, filled: [], skipped: [], manual: [], workflow: publicationObservation } };
    storage['ba2.siteFlowRecipes'] = [{ domain: host, entryUrl: `https://${host}/stale-editor`, failureCount: 0, categoryMappings: [] }];
    const before: { updates: number; login: number; registration: number; publish: number } = { updates: updates.length, login: automaticLoginSubmits, registration: automaticRegistrationSubmits, publish: publicationDispatches };
    const ack = await dispatch({ type: 'BA2_START_LISTING_AUTOFILL', autoRegister: account === 'new', autoLogin: true, autoPublish: false }, popupSender);
    assert.equal(ack.ok, true, `${host}/${account}: ordinary homepage START`);
    const saved = storage['ba2.listingRun'] as ListingRun;
    assert.equal(saved.sourceUrl, `https://${host}/`);
    assert.equal(saved.homepageStart, true);
    assert.deepEqual(updates.slice(before.updates), [target], `${host}/${account}: observed route, never learned editor or universal path`);
    assert.equal(saved.autoRegister, account === 'new' ? true : undefined);
    assert.equal(saved.autoPublish, false);
    assert.equal(automaticLoginSubmits, before.login);
    assert.equal(automaticRegistrationSubmits, before.registration);
    assert.equal(publicationDispatches, before.publish);
  }
}
profile.id = homepageProfileId;
console.log('Homepage-first matrix passed: five Family 1 hosts x new/existing/authenticated states; observed DOM routes outrank learned editor recipes, zero submissions');

// Same explicit fresh-start path, but a verified Login page rather than home.
const loginEntryProfileId = profile.id;
for (const scenario of ['ready', 'registered', 'publish', 'no-consent', 'wrong-page', 'attempt', 'uncertain-login', 'prior-login', 'registration-uncertain', 'publication', 'archive-conflict', 'other-tab']) {
  profile.id = `login-entry-${scenario}`;
  resetAutoLogin('bloguetechno.com');
  currentTab = { id: 42, url: 'https://bloguetechno.com/account/observed-sign-in' };
  const old = createListingRun('https://bloguetechno.com/', profile.id, 42);
  Object.assign(old, { stage: 'MANUAL_GATE', awaitingManualResume: false, autoLogin: false, autoPublish: true,
    publicationApproval: { authorizedAt: '2000-01-01T00:00:00.000Z', profileFingerprint: 'old-consent' }, manual: ['Human input required'] });
  storage['ba2.listingRun'] = old;
  publicationObservation = { stage: 'LOGIN', confidence: 0.95, reason: 'Observed native Login form' };
  const base = `ba2.loginGuard:https://bloguetechno.com:${profile.id}`;
  const registrationKey = `ba2.registrationGuard:https://bloguetechno.com:${profile.id}`;
  const publicationKey = `ba2.publicationGuard:bloguetechno.com:${profile.id}`;
  if (scenario === 'wrong-page') publicationObservation = { stage: 'SIGNUP', confidence: 0.95, reason: 'Not Login' };
  if (scenario === 'attempt') old.login = { url: currentTab.url, state: 'uncertain', reason: 'Unknown', attemptId: 'preserved' };
  if (scenario === 'uncertain-login' || scenario === 'prior-login') storage[base] = { runId: 'historical', state: scenario === 'prior-login' ? 'authenticated' : 'uncertain' };
  if (scenario === 'registration-uncertain') storage[registrationKey] = { runId: 'historical', state: 'uncertain' };
  if (scenario === 'registered') storage[registrationKey] = { runId: 'historical-created-account', state: 'confirmed' };
  if (scenario === 'publication') storage[publicationKey] = { runId: 'historical' };
  if (scenario === 'archive-conflict') storage['ba2.listingRunArchive:' + old.id] = { ...old, manual: ['Different history'] };
  if (scenario === 'other-tab') currentTab.id = 84;
  const before = JSON.stringify(storage), oldSnapshot = JSON.stringify(old);
  const effects: number[] = [automaticLoginSubmits, automaticRegistrationSubmits, publicationDispatches, sheetBackendCalls];
  const previousUpdates: number = updates.length, previousFills: number = automaticLoginFills;
  if (scenario === 'ready') {
    const ordinary = await dispatch({ type: 'BA2_START_LISTING_AUTOFILL', autoLogin: true, autoPublish: false }, popupSender);
    assert.equal(ordinary.ok, false, 'ordinary START must not replace the stopped run from Login');
    assert.equal(JSON.stringify(storage), before);
  }
  const result = await dispatch({ type: 'BA2_START_LISTING_AUTOFILL', freshFromRunId: old.id,
    autoLogin: scenario !== 'no-consent', autoPublish: scenario === 'publish', autoRegister: false }, popupSender);
  const succeeds = ['ready', 'registered', 'publish'].includes(scenario);
  assert.equal(result.ok, succeeds, scenario);
  if (!succeeds) assert.equal(JSON.stringify(storage), before, scenario + ': preserve all history and receipts');
  else {
    const fresh = storage['ba2.listingRun'] as ListingRun;
    assert.notEqual(fresh.id, old.id);
    assert.equal(fresh.sourceUrl, 'https://bloguetechno.com/account/observed-sign-in');
    assert.equal(fresh.login?.state, 'waiting-captcha');
    assert.equal(fresh.autoRegister, undefined);
    assert.equal(fresh.autoPublish, scenario === 'publish');
    assert.equal(Boolean(fresh.publicationApproval), scenario === 'publish');
    assert.notEqual(fresh.publicationApproval?.authorizedAt, old.publicationApproval?.authorizedAt);
    assert.equal(automaticLoginFills, previousFills + 1);
    assert.equal(JSON.stringify(storage['ba2.listingRunArchive:' + old.id]), oldSnapshot);
    assert.equal(updates.length, previousUpdates, 'Login entry never returns to homepage or registration');
    if (scenario === 'registered') assert.deepEqual(storage[registrationKey], { runId: 'historical-created-account', state: 'confirmed' });
  }
  assert.deepEqual([automaticLoginSubmits, automaticRegistrationSubmits, publicationDispatches, sheetBackendCalls], effects);
  if (scenario === 'publish') {
    const fresh = storage['ba2.listingRun'] as ListingRun;
    const signal = { type: 'BA2_LOGIN_CHANGED', runId: fresh.id };
    const sender = () => ({ tab: { id: 42 }, frameId: 0, url: currentTab.url });
    automaticLoginChecks = { ok: true, captcha: 'verified', reason: 'Human completed fixture CAPTCHA' };
    await Promise.all([dispatch(signal, sender()), dispatch(signal, sender())]);
    assert.equal(automaticLoginSubmits, effects[0] + 1, 'one authorized Login after human CAPTCHA, no second START');
    currentTab.url = 'https://bloguetechno.com/observed-dashboard';
    publicationObservation = { stage: 'AUTHENTICATED_DASHBOARD', confidence: 0.95, reason: 'Observed dashboard',
      action: { kind: 'new-post', href: 'https://bloguetechno.com/observed-editor', label: 'New post' } };
    genericWorkflowResponse = { ok: true, report: { profileName: profile.businessName, filled: [], skipped: [], manual: [], workflow: publicationObservation } };
    await dispatch(signal, sender());
    assert.equal(updates.at(-1), 'https://bloguetechno.com/observed-editor');
    const visit = 'https://bloguetechno.com/article/verified-entry-12345';
    publicationObservation = { stage: 'CONFIRMATION', confidence: 0.95, reason: 'Explicit success and Visit', publicationEvidence: true, publicUrl: visit };
    genericWorkflowResponse = { ok: true, report: { profileName: profile.businessName,
      filled: [{ field: 'businessName', descriptor: 'title', value: profile.businessName }, { field: 'description', descriptor: 'editor', value: profile.description }],
      expectedArticle, skipped: [], manual: ['Final Submit'], workflow: { stage: 'EDITOR', confidence: 0.95, reason: 'Filled approved editor' } } };
    fetchScenario = 'valid'; sheetSessionKey = undefined; publicationDelivery = 'ok'; publicationValidationError = undefined;
    tabUpdatedListener?.(42, { status: 'complete' });
    for (let wait = 0; wait < 100 && (storage['ba2.listingRun'] as ListingRun).stage !== 'COMPLETE'; wait++) await flush();
    const completed = storage['ba2.listingRun'] as ListingRun;
    assert.equal(completed.id, fresh.id);
    assert.equal(publicationDispatches, effects[2] + 1);
    assert.equal(completed.publicVerification?.status, 'verified');
    assert.equal(completed.liveUrl, visit);
    assert.equal(updates.at(-1), visit, 'existing Visit navigation follows automatically');
    assert.equal(automaticRegistrationSubmits, effects[1]);
    assert.equal(sheetBackendCalls, effects[3]);
    assert.equal(JSON.stringify(storage['ba2.listingRunArchive:' + old.id]), oldSnapshot);
  }
}
profile.id = loginEntryProfileId;
console.log('Fresh verified Login entry passed: stopped run archived intact, fresh independent consent, one credential preparation/CAPTCHA pause, no homepage redirect, receipt/attempt/conflict checks fail closed');

// Explicit cross-website archive detaches only the pointer; no automation starts.
function stoppedArchiveFixture() {
  profile.id = 'archive-only-profile';
  currentTab = { id: 200, url: 'https://bloguetechno.com/' };
  const old = createListingRun('https://onesmablog.com/', profile.id, 42);
  old.stage = 'MANUAL_GATE'; old.awaitingManualResume = true;
  old.autoLogin = true; old.autoPublish = true;
  old.loginApproval = { authorizedAt: '2000-01-01', profileUpdatedAt: profile.updatedAt };
  old.login = { state: 'uncertain', url: 'https://onesmablog.com/login', reason: 'preserve', attemptId: 'old-login', claimed: true };
  old.registration = { state: 'confirmed', url: 'https://onesmablog.com/signup', reason: 'preserve', attemptId: 'old-registration', claimed: true };
  old.submissionAttempted = true;
  old.publicationSubmission = { attemptId: 'old-publication', url: 'https://onesmablog.com/new', startedAt: '2000-01-01', outcome: 'uncertain', claimed: true };
  old.publicVerification = { status: 'unverified', attemptId: 'old-verification', reason: 'unknown; never infer failed' };
  old.tabUnavailable = { tabId: 42, detectedAt: '2000-01-01', reason: 'missing' };
  storage['ba2.listingRun'] = old;
  storage[loginGuardKey(old)] = { runId: old.id, state: 'uncertain', extraEvidence: 'keep' };
  storage[`ba2.registrationGuard:https://onesmablog.com:${profile.id}`] = { runId: old.id, state: 'confirmed', extraEvidence: 'keep-account' };
  storage[`ba2.publicationGuard:onesmablog.com:${profile.id}`] = { runId: old.id, extraEvidence: 'keep-uncertain' };
  return old;
}
const archiveEffects = () => [updates.length, genericFills, automaticLoginFills, automaticLoginSubmits, automaticRegistrationSubmits, publicationDispatches, fetchCount, sheetBackendCalls, sheetPreparationCalls];
for (const scenario of ['untrusted', 'wrong-id', 'same-site', 'not-homepage', 'active', 'missing-publication-guard', 'missing-login-guard', 'missing-registration-guard', 'foreign-guard', 'conflicting-archive', 'sheet-busy']) {
  const old = stoppedArchiveFixture();
  if (scenario === 'same-site') currentTab.url = 'https://www.onesmablog.com/';
  if (scenario === 'not-homepage') currentTab.url += 'login';
  if (scenario === 'active') old.stage = 'NAVIGATING';
  if (scenario === 'missing-publication-guard') delete storage[`ba2.publicationGuard:onesmablog.com:${profile.id}`];
  if (scenario === 'missing-login-guard') delete storage[loginGuardKey(old)];
  if (scenario === 'missing-registration-guard') delete storage[`ba2.registrationGuard:https://onesmablog.com:${profile.id}`];
  if (scenario === 'foreign-guard') storage[loginGuardKey(old)] = { runId: 'different-run', state: 'uncertain' };
  if (scenario === 'conflicting-archive') storage['ba2.listingRunArchive:' + old.id] = { ...old, manual: ['different history'] };
  if (scenario === 'sheet-busy') old.sheetSync = { status: 'syncing', attemptId: 'busy', liveUrl: '', reason: '', code: '' };
  const snapshot = JSON.stringify(storage), effects = archiveEffects();
  const ack = await dispatch({ type: 'BA2_ARCHIVE_STOPPED_LISTING_RUN', runId: scenario === 'wrong-id' ? 'wrong' : old.id }, scenario === 'untrusted' ? { tab: currentTab, url: currentTab.url } : popupSender);
  assert.equal(ack.ok, false, scenario);
  assert.equal(JSON.stringify(storage), snapshot, scenario + ': preserve all records');
  assert.deepEqual(archiveEffects(), effects);
}
for (const race of ['changed-run', 'changed-receipt', 'changed-tab']) {
  const old = stoppedArchiveFixture();
  const originalQuery = chrome.tabs.query;
  let queries = 0, expectedState = JSON.stringify(storage);
  chrome.tabs.query = async () => {
    if (++queries === 2) {
      if (race === 'changed-run') storage['ba2.listingRun'] = { ...old, manual: ['external change'] };
      if (race === 'changed-receipt') storage[loginGuardKey(old)] = { runId: old.id, state: 'authenticated' };
      if (race === 'changed-tab') currentTab.url = 'https://bloguetechno.com/changed-page';
      expectedState = JSON.stringify(storage);
    }
    return originalQuery({ active: true, currentWindow: true });
  };
  try {
    const ack = await dispatch({ type: 'BA2_ARCHIVE_STOPPED_LISTING_RUN', runId: old.id }, popupSender);
    assert.equal(ack.ok, false, race + ': stale snapshot cannot archive');
    assert.equal(JSON.stringify(storage), expectedState, race + ': no archive/pointer write');
  } finally { chrome.tabs.query = originalQuery; }
}
const archiveOld = stoppedArchiveFixture();
const archiveSnapshot = structuredClone(storage), archiveBeforeEffects = archiveEffects();
const archiveResults = await Promise.all([dispatch({ type: 'BA2_ARCHIVE_STOPPED_LISTING_RUN', runId: archiveOld.id }, popupSender), dispatch({ type: 'BA2_ARCHIVE_STOPPED_LISTING_RUN', runId: archiveOld.id }, popupSender)]);
assert.equal(archiveResults.filter(r => r.ok).length, 1, 'only one archive, no duplicate effects');
assert.equal(storage['ba2.listingRun'], null);
assert.deepEqual(storage['ba2.listingRunArchive:' + archiveOld.id], archiveOld, 'uncertain publication, approvals and evidence preserved exactly');
for (const [key, value] of Object.entries(archiveSnapshot)) if (key !== 'ba2.listingRun') assert.deepEqual(storage[key], value, 'no receipt/history regeneration');
assert.deepEqual(archiveEffects(), archiveBeforeEffects);
await background.recoverListingRun();
await dispatch({ type: 'BA2_LOGIN_CHANGED', runId: archiveOld.id }, { tab: { id: 42 }, frameId: 0, url: 'https://onesmablog.com/login' });
assert.deepEqual(archiveEffects(), archiveBeforeEffects, 'startup and archived notifications never resume old run');
publicationObservation = { stage: 'HOMEPAGE', confidence: 0.95, reason: 'homepage', loginAction: { kind: 'login', label: 'Login', href: 'https://bloguetechno.com/observed-login' } };
genericWorkflowResponse = { ok: true, report: { profileName: profile.businessName, filled: [], skipped: [], manual: [], workflow: publicationObservation } };
const afterArchiveStart = await dispatch({ type: 'BA2_START_LISTING_AUTOFILL', autoLogin: false, autoRegister: false, autoPublish: false }, popupSender);
assert.equal(afterArchiveStart.ok, true);
const nextWebsite = storage['ba2.listingRun'] as unknown as ListingRun;
assert.notEqual(nextWebsite.id, archiveOld.id);
assert.equal(nextWebsite.autoLogin, false); assert.equal(nextWebsite.autoPublish, false);
assert.equal(nextWebsite.loginApproval, undefined); assert.equal(nextWebsite.publicationApproval, undefined);
assert.equal(currentTab.url, 'https://bloguetechno.com/observed-login');
assert.deepEqual(storage['ba2.listingRunArchive:' + archiveOld.id], archiveOld);
assert.deepEqual(archiveEffects().slice(2), archiveBeforeEffects.slice(2), 'new navigation cannot reuse consent or submit');
currentTab = { id: 201, url: 'https://onesmablog.com/' };
const oldSiteRetry = await dispatch({ type: 'BA2_START_LISTING_AUTOFILL', autoLogin: false, autoPublish: true }, popupSender);
assert.equal(oldSiteRetry.ok, false, 'archived publisher receipt still prevents duplicate publication');
profile.id = homepageProfileId;
console.log('Explicit cross-site archive passed: uncertain history/receipts unchanged, no START/side effects, guarded rejection/concurrency, startup no replay, fresh website navigation with no inherited consent and old-site duplicate protection');

// Loaded HTTPS homepage with no current MV3 observation receiver (live report).
// Reuse the standalone, bounded reader recovery; never reinject automation.
const receiverProfileId = profile.id;
for (const scenario of ['missing', 'persistent-missing', 'unrelated-error', 'navigation-during-injection']) {
  profile.id = `initial-reader-${scenario}`;
  resetAutoLogin('bloguetechno.com');
  currentTab = { id: 691264027, url: 'https://bloguetechno.com/' };
  Object.assign(currentTab, { status: 'complete' });
  publicationObservation = { stage: 'HOMEPAGE', confidence: 0.95, reason: 'Homepage observed', loginAction: { kind: 'login', label: 'Login', href: 'https://bloguetechno.com/observed-sign-in' } };
  genericWorkflowResponse = { ok: true, report: { profileName: profile.businessName, filled: [], skipped: [], manual: [], workflow: publicationObservation } };
  publicationReaderMissing = true;
  const originalSend = chrome.tabs.sendMessage, originalInject = chrome.scripting.executeScript;
  let observations = 0, injections = 0;
  const before: Record<string, number> = { login: automaticLoginSubmits, registration: automaticRegistrationSubmits, publish: publicationDispatches, sheet: sheetBackendCalls, reads: sheetPreparationCalls, fills: automaticLoginFills, updates: updates.length };
  chrome.tabs.sendMessage = (async (tabId: number, message: { type: string }, options?: { frameId?: number }) => {
    if (message.type === 'BA2_BLOG_OBSERVE') {
      observations++;
      if (scenario === 'unrelated-error') throw Error('Unrelated transport rejection');
    }
    return originalSend(tabId, message, options || {});
  }) as typeof chrome.tabs.sendMessage;
  chrome.scripting.executeScript = (async (options: { target: { tabId: number; frameIds?: number[] }; files: string[] }) => {
    injections++;
    assert.deepEqual(options.target, { tabId: 691264027, frameIds: [0] });
    assert.deepEqual(options.files, ['content/publication-reader.js'], 'must not load full content automation entry');
    if (scenario === 'navigation-during-injection') currentTab = { ...currentTab, url: 'https://other.test/' };
    if (scenario !== 'persistent-missing') publicationReaderMissing = false;
    return [];
  }) as typeof chrome.scripting.executeScript;
  try {
    const ack = await dispatch({ type: 'BA2_START_LISTING_AUTOFILL', autoLogin: true, autoRegister: false, autoPublish: false }, popupSender);
    assert.equal(ack.ok, scenario === 'missing', scenario);
    assert.equal(observations, scenario === 'missing' || scenario === 'persistent-missing' ? 2 : 1, scenario + ': one bounded read retry only');
    assert.equal(injections, scenario === 'unrelated-error' ? 0 : 1);
    const saved = storage['ba2.listingRun'] as unknown as ListingRun;
    assert.equal(saved.submissionAttempted, undefined);
    assert.equal(saved.login?.attemptId, undefined);
    if (scenario === 'missing') assert.deepEqual(updates.slice(before.updates), ['https://bloguetechno.com/observed-sign-in']);
    else { assert.equal(saved.stage, 'ERROR'); assert.equal(updates.length, before.updates); }
    assert.deepEqual([automaticLoginSubmits, automaticRegistrationSubmits, publicationDispatches, sheetBackendCalls, sheetPreparationCalls, automaticLoginFills], [before.login, before.registration, before.publish, before.sheet, before.reads, before.fills]);
  } finally {
    chrome.tabs.sendMessage = originalSend; chrome.scripting.executeScript = originalInject;
    publicationReaderMissing = false;
  }
}
profile.id = receiverProfileId;
console.log('Initial HTTPS homepage reader passed: frame-zero observation-only bounded injection/retry, persistent/nonreceiver/navigation errors fail closed, no Login/registration/publication/Sheets actions');

// Loading the fix must not automatically restart the reported failed run.
resetAutoLogin('bloguetechno.com');
currentTab = { id: 691264027, url: 'https://bloguetechno.com/' };
const preservedReceiverFailure = createListingRun(currentTab.url, profile.id, currentTab.id);
preservedReceiverFailure.stage = 'ERROR'; preservedReceiverFailure.autoLogin = true;
preservedReceiverFailure.autoPublish = false; preservedReceiverFailure.autoRegister = false;
preservedReceiverFailure.error = 'Could not establish connection. Receiving end does not exist.';
storage['ba2.listingRun'] = preservedReceiverFailure;
const preservedFailureSnapshot = JSON.stringify(storage);
const preservedEffects = archiveEffects(), preservedInjections = publicationReaderInjections;
await background.recoverListingRun();
assert.equal(JSON.stringify(storage), preservedFailureSnapshot, 'failed run, archive and receipts preserved on startup');
assert.deepEqual(archiveEffects(), preservedEffects, 'no automatic restart or Login after loading fix');
assert.equal(publicationReaderInjections, preservedInjections);
console.log('Reported receiver-failure ERROR remains unchanged on startup; no automatic repair/resume or side effects');

// Exact Bloguetechno missing-ack checkpoint has two observationally identical
// outcomes: no autofill handler, or completed fill whose response was lost.
// Neither permits automatic replay or proves why the live reply was absent.
const missingAckProfileId = profile.id;
for (const scenario of ['observer-only', 'executed-with-lost-reply', 'executed-with-rejected-reply']) {
  profile.id = `homepage-missing-ack-${scenario}`;
  resetAutoLogin('bloguetechno.com');
  currentTab = { id: 691264027, url: 'https://bloguetechno.com/' };
  publicationObservation = { stage: 'HOMEPAGE', confidence: 0.95, reason: 'Homepage observed', loginAction: { kind: 'login', label: 'Login', href: 'https://bloguetechno.com/login' } };
  const nativeSend = chrome.tabs.sendMessage, nativeInject = chrome.scripting.executeScript;
  let dispatches = 0, fixtureFills = 0, injections = 0;
  const beforeEffects = archiveEffects();
  chrome.tabs.sendMessage = (async (tabId: number, message: { type: string }, options?: { frameId?: number }) => {
    if (message.type === 'BA2_LISTING_AUTOFILL') {
      assert.equal(tabId, 691264027);
      dispatches++;
      if (scenario !== 'observer-only') fixtureFills++;
      if (scenario === 'executed-with-rejected-reply') throw Error('The message port closed before a response was received.');
      return undefined;
    }
    return nativeSend(tabId, message, options || {});
  }) as typeof chrome.tabs.sendMessage;
  chrome.scripting.executeScript = (async () => { injections++; throw Error('Empty acknowledgement must never cause action reinjection'); }) as typeof chrome.scripting.executeScript;
  try {
    const ack = await dispatch({ type: 'BA2_START_LISTING_AUTOFILL', autoLogin: true, autoPublish: false, autoRegister: false }, popupSender);
    assert.equal(ack.ok, false);
    const saved = storage['ba2.listingRun'] as unknown as ListingRun;
    assert.equal(saved.stage, 'ERROR');
    assert.equal(saved.error, scenario === 'executed-with-rejected-reply'
      ? 'Listing autofill acknowledgement failed. The action may have executed. Inspect the saved run; no automatic retry.'
      : 'Listing autofill returned no response. Inspect the saved run; no automatic retry.');
    assert.equal(saved.tabId, currentTab.id);
    assert.equal(saved.navigationTarget, undefined);
    assert.equal(Boolean(saved.navigationVerified), false);
    assert.equal(saved.login?.attemptId, undefined);
    assert.equal(saved.submissionAttempted, undefined);
    assert.equal(saved.autoLogin, true); assert.equal(saved.autoPublish, false);
    assert.equal(dispatches, 1); assert.equal(injections, 0);
    assert.equal(fixtureFills, scenario !== 'observer-only' ? 1 : 0);
    const afterFailure = JSON.stringify(storage);
    await background.recoverListingRun();
    assert.equal(JSON.stringify(storage), afterFailure, 'startup preserves uncertain autofill result and all records');
    assert.equal(dispatches, 1);
    assert.deepEqual(archiveEffects(), beforeEffects, 'no navigation/Login/registration/publication/Sheets or native action replay');
  } finally { chrome.tabs.sendMessage = nativeSend; chrome.scripting.executeScript = nativeInject; }
}
profile.id = missingAckProfileId;
console.log('Exact Bloguetechno homepage missing acknowledgement passed: absent, executed/empty and executed/rejected replies stop once, preserve approval/state/history and never replay on startup');

// Full-receiver readiness precedes action dispatch. Observation-only status
// absence may be repaired once; a missing ACTION acknowledgement never is.
const fullReceiverProfileId = profile.id;
for (const scenario of ['empty', 'missing', 'persistent-empty', 'invalid', 'timeout', 'transport-error', 'page-changed', 'run-changed', 'lost-action-reply', 'rejected-action-reply']) {
  profile.id = `receiver-preflight-${scenario}`;
  resetAutoLogin('bloguetechno.com');
  currentTab = { id: 691264027, url: 'https://bloguetechno.com/' };
  publicationObservation = { stage: 'HOMEPAGE', confidence: 0.95, reason: 'Homepage observed', loginAction: { kind: 'login', label: 'Login', href: 'https://bloguetechno.com/observed-login' } };
  genericWorkflowResponse = { ok: true, report: { profileName: profile.businessName, filled: [], skipped: [], manual: [], workflow: publicationObservation } };
  const originalSend = chrome.tabs.sendMessage, originalInject = chrome.scripting.executeScript;
  let probes = 0, injections = 0, actions = 0;
  const beforeEffects: number[] = [automaticLoginSubmits, automaticRegistrationSubmits, publicationDispatches, sheetBackendCalls, sheetPreparationCalls];
  chrome.tabs.sendMessage = (async (tabId: number, message: { type: string }, options?: { frameId?: number }) => {
    if (message.type === 'BA2_GET_ACTIVE_PROFILE') {
      assert.equal(options?.frameId, 0); probes++;
      if (scenario === 'rejected-action-reply') return { ok: true, profileName: 'Fixture', syncedAt: null };
      if (scenario === 'invalid') return {};
      if (scenario === 'timeout') return new Promise(() => {});
      if (scenario === 'transport-error') throw Error('Unrelated rejection');
      if (scenario === 'run-changed') (storage['ba2.listingRun'] as ListingRun).manual.push('Concurrent change');
      if (scenario === 'missing' && injections === 0) throw Error('Could not establish connection. Receiving end does not exist.');
      if (injections === 0 || scenario === 'persistent-empty') return undefined;
      return { ok: false, error: 'No active profile synced.' }; // valid readiness contract, not permission to submit
    }
    if (message.type === 'BA2_LISTING_AUTOFILL') {
      actions++;
      if (scenario === 'lost-action-reply') return undefined;
      if (scenario === 'rejected-action-reply') throw Error('The message port closed before a response was received.');
    }
    return originalSend(tabId, message, options || {});
  }) as typeof chrome.tabs.sendMessage;
  chrome.scripting.executeScript = (async (options: { target: { tabId: number; frameIds?: number[] }; files: string[] }) => {
    assert.deepEqual(options.target, { tabId: 691264027, frameIds: [0] });
    assert.deepEqual(options.files, ['content/content.js']); injections++;
    if (scenario === 'page-changed') currentTab = { ...currentTab, url: 'https://other.test/' };
    return [];
  }) as typeof chrome.scripting.executeScript;
  try {
    const ack = await dispatch({ type: 'BA2_START_LISTING_AUTOFILL', autoLogin: true, autoRegister: false, autoPublish: false }, popupSender);
    const succeeds = ['empty', 'missing'].includes(scenario);
    assert.equal(ack.ok, succeeds, scenario);
    assert.equal(actions, succeeds || ['lost-action-reply', 'rejected-action-reply'].includes(scenario) ? 1 : 0, scenario + ': no action replay after readiness');
    if (scenario === 'rejected-action-reply') assert.equal(injections, 0, 'a rejected action is not proof it did not execute');
    assert.ok(injections <= 1 && probes <= 2, 'bounded receiver repair');
    if (['invalid', 'timeout', 'transport-error', 'run-changed'].includes(scenario)) assert.equal(injections, 0);
    if (scenario === 'lost-action-reply') assert.equal((storage['ba2.listingRun'] as ListingRun).error, 'Listing autofill returned no response. Inspect the saved run; no automatic retry.');
    assert.deepEqual([automaticLoginSubmits, automaticRegistrationSubmits, publicationDispatches, sheetBackendCalls, sheetPreparationCalls], beforeEffects);
  } finally { chrome.tabs.sendMessage = originalSend; chrome.scripting.executeScript = originalInject; }
}
profile.id = fullReceiverProfileId;
console.log('Full receiver preflight passed: read-only status before action; bounded empty/missing repair, valid error acceptance, invalid/timeout/changed ownership fail closed, no lost-action replay or account/Sheets effects');

// One authorizing action chooses an observed entry; existing coordinator owns all later stages.
const continuousOriginalProfileId = profile.id;
const continuousLogo = profile.logoAsset;
delete profile.logoAsset;
const continuousMessage = { type: 'BA2_START_LISTING_AUTOFILL', continuous: true };
for (const entry of ['HOMEPAGE', 'SIGNUP', 'LOGIN', 'AUTHENTICATED_DASHBOARD', 'EDITOR', 'ACCOUNT_CREATED']) {
  profile.id = `continuous-entry-${entry}`;
  resetAutoLogin('bloguetechno.com');
  const path = entry === 'HOMEPAGE' ? '/' : entry === 'EDITOR' ? '/observed-editor' : '/observed-entry';
  currentTab = { id: 42, url: `https://bloguetechno.com${path}` };
  const old = createListingRun('https://bloguetechno.com/', profile.id, 42);
  Object.assign(old, { stage: 'MANUAL_GATE', awaitingManualResume: false, manual: ['Human input required'] });
  storage['ba2.listingRun'] = old;
  const oldSnapshot = JSON.stringify(old);
  const loginBase = `ba2.loginGuard:https://bloguetechno.com:${profile.id}`;
  if (entry === 'LOGIN') storage[loginBase] = { runId: 'historical-authenticated-run', state: 'authenticated' };
  const oldReceipt = JSON.stringify(storage[loginBase]);
  publicationObservation = { stage: entry, confidence: 0.95, reason: 'Verified fixture stage', registrationEvidence: entry === 'ACCOUNT_CREATED',
    loginAction: { kind: 'login', label: 'Click here to login', href: 'https://bloguetechno.com/observed-login' },
    signupAction: { kind: 'signup', label: 'Start now', href: 'https://bloguetechno.com/observed-signup' },
    action: { kind: 'new-post', label: 'New post', href: 'https://bloguetechno.com/observed-editor' } };
  genericWorkflowResponse = { ok: true, report: { profileName: profile.businessName, filled: [], skipped: [], manual: ['Human input required'], adaptive: { stage: 'UNKNOWN', diagnostics: ['Stage: UNKNOWN'] } } };
  automaticRegistrationChecks = { ok: false, captcha: 'pending', reason: 'Complete CAPTCHA and required Terms manually' };
  const submits: number[] = [automaticLoginSubmits, automaticRegistrationSubmits, publicationDispatches, sheetBackendCalls];
  const beforeFills: number = genericFills;
  const sender = () => ({ id: 'a'.repeat(32), tab: { id: 42 }, frameId: 0, url: currentTab.url });
  const originalSend = chrome.tabs.sendMessage;
  if (entry === 'EDITOR') {
    genericWorkflowResponse = { ok: true, report: { profileName: profile.businessName, expectedArticle, skipped: [], manual: ['Final Submit'],
      filled: [{ field: 'businessName', descriptor: 'title', value: profile.businessName }, { field: 'description', descriptor: 'editor', value: profile.description }],
      form: { logo: { requested: false, attached: false } }, workflow: { stage: 'EDITOR', confidence: 0.95, reason: 'Approved fixture article' } } };
    fetchScenario = 'valid'; publicationDelivery = 'ok'; publicationValidationError = undefined; sheetSessionKey = undefined;
    chrome.tabs.sendMessage = (async (tabId: number, message: { type: string }, options?: { frameId?: number }) => {
      const response = await originalSend(tabId, message, options || {});
      if (message.type === 'BA2_BLOG_PUBLISH_ONCE') publicationObservation = { stage: 'CONFIRMATION', confidence: 0.95,
        publicationEvidence: true, publicUrl: 'https://bloguetechno.com/article/continuous-entry-12345', reason: 'Published; Visit' };
      return response;
    }) as typeof chrome.tabs.sendMessage;
  }
  try {
    assert.equal((await dispatch(continuousMessage, popupSender)).ok, true, entry);
    const run = storage['ba2.listingRun'] as ListingRun;
    assert.notEqual(run.id, old.id);
    assert.ok(run.continuous);
    assert.equal(run.autoLogin, true); assert.equal(run.autoPublish, true);
    assert.equal(run.autoRegister, entry === 'HOMEPAGE' || entry === 'SIGNUP');
    assert.equal(JSON.stringify(storage['ba2.listingRunArchive:' + old.id]), oldSnapshot);
    assert.equal(JSON.stringify(storage[loginBase]), oldReceipt);
    if (entry === 'HOMEPAGE') { assert.equal(updates.at(-1), 'https://bloguetechno.com/observed-signup'); assert.equal(genericFills, beforeFills, 'blog observer precedes generic UNKNOWN handler'); }
    if (entry === 'AUTHENTICATED_DASHBOARD') { assert.equal(updates.at(-1), 'https://bloguetechno.com/observed-editor'); assert.equal(automaticLoginSubmits, submits[0]); }
    if (entry === 'ACCOUNT_CREATED') assert.equal(updates.at(-1), 'https://bloguetechno.com/observed-login');
    if (entry === 'SIGNUP') assert.equal(run.registration?.state, 'waiting-human');
    if (entry === 'LOGIN') {
      assert.equal(run.login?.state, 'waiting-captcha');
      assert.equal(loginGuardKey(run), `${loginBase}:continuous:${run.id}`);
      automaticLoginChecks = { ok: true, captcha: 'verified', reason: 'Human completed fixture CAPTCHA' };
      await Promise.all([dispatch({ type: 'BA2_LOGIN_CHANGED', runId: run.id }, sender()), dispatch({ type: 'BA2_LOGIN_CHANGED', runId: run.id }, sender())]);
      assert.equal(automaticLoginSubmits, submits[0] + 1);
      assert.equal(JSON.stringify(storage[loginBase]), oldReceipt, 'historical authenticated receipt must never be overwritten');
      const scoped = storage[loginGuardKey(run)] as { runId: string };
      assert.equal(scoped.runId, run.id);
      await background.recoverListingRun();
      assert.equal(automaticLoginSubmits, submits[0] + 1, 'interrupted intent cannot be replayed');
    }
    if (entry === 'EDITOR') {
      assert.equal(run.publicVerification?.status, 'verified');
      assert.equal(run.liveUrl, 'https://bloguetechno.com/article/continuous-entry-12345');
      assert.equal(updates.at(-1), run.liveUrl);
      await dispatch(continuousMessage, popupSender);
      assert.equal(publicationDispatches, submits[2] + 1, 'repeat AUTOFILL never republishes');
    }
    assert.equal(automaticRegistrationSubmits, submits[1]);
    assert.equal(sheetBackendCalls, submits[3]);
  } finally { chrome.tabs.sendMessage = originalSend; }
}
for (const conflict of ['uncertain-base', 'uncertain-scoped', 'uncertain-registration', 'archive', 'publication', 'foreign-sender']) {
  profile.id = `continuous-block-${conflict}`;
  resetAutoLogin('bloguetechno.com');
  currentTab = { id: 42, url: 'https://bloguetechno.com/login' };
  const old = createListingRun('https://bloguetechno.com/', profile.id, 42);
  old.stage = 'MANUAL_GATE'; old.awaitingManualResume = false;
  storage['ba2.listingRun'] = old;
  publicationObservation = { stage: 'LOGIN', confidence: 0.95, reason: 'Login fixture' };
  const base = `ba2.loginGuard:https://bloguetechno.com:${profile.id}`;
  if (conflict === 'uncertain-base') storage[base] = { runId: 'old', state: 'uncertain' };
  if (conflict === 'uncertain-scoped') storage[base + ':continuous:old'] = { runId: 'old', state: 'intent' };
  if (conflict === 'uncertain-registration') storage[`ba2.registrationGuard:https://bloguetechno.com:${profile.id}`] = { runId: 'old', state: 'uncertain' };
  if (conflict === 'archive') storage['ba2.listingRunArchive:' + old.id] = { ...old, manual: ['Different historical record'] };
  if (conflict === 'publication') storage[`ba2.publicationGuard:bloguetechno.com:${profile.id}`] = { runId: 'published' };
  const before = JSON.stringify(storage);
  const counts: number[] = [automaticLoginSubmits, automaticRegistrationSubmits, publicationDispatches];
  const ack = await dispatch(continuousMessage, conflict === 'foreign-sender' ? { id: 'foreign' } : popupSender);
  assert.equal(ack.ok, ['publication', 'uncertain-registration'].includes(conflict), conflict);
  if (conflict === 'publication') {
    assert.deepEqual(storage['ba2.listingRunArchive:' + old.id], old);
    assert.deepEqual(storage[`ba2.publicationGuard:bloguetechno.com:${profile.id}`], { runId: 'published' }, 'receipt blocks Publish, not safe Login preparation');
    assert.equal((storage['ba2.listingRun'] as ListingRun).login?.state, 'waiting-captcha');
  } else {
    assert.equal(JSON.stringify(storage), before, conflict + ': no storage changes');
    if (conflict === 'uncertain-registration') assert.match(ack.message, /filled only.*registration remains unresolved/);
  }
  assert.deepEqual([automaticLoginSubmits, automaticRegistrationSubmits, publicationDispatches], counts);
}
profile.id = continuousOriginalProfileId;
if (continuousLogo) profile.logoAsset = continuousLogo;
console.log('One continuous AUTOFILL passed: observed entry matrix, old authenticated Login receipt preserved/scoped new attempt, CAPTCHA continuation, automatic Publish/Visit, no duplicates and unresolved/archive/foreign-source guards');

// Joined continuous lifecycle: exactly one authorizing START, all continuation via events.
profile.id = 'continuous-complete-lifecycle';
const savedContinuousLogo = profile.logoAsset; delete profile.logoAsset;
resetAutoLogin('bloguetechno.com');
currentTab = { id: 42, url: 'https://bloguetechno.com/' };
publicationObservation = { stage: 'HOMEPAGE', confidence: 0.95, reason: 'Homepage', signupAction: { kind: 'signup', label: 'Start now', href: 'https://bloguetechno.com/observed-signup' } };
automaticRegistrationChecks = { ok: false, captcha: 'pending', reason: 'Human CAPTCHA/Terms checkpoint' };
const joinedCounts: number[] = [automaticRegistrationSubmits, automaticLoginSubmits, publicationDispatches, sheetBackendCalls];
assert.equal((await dispatch(continuousMessage, popupSender)).ok, true);
const joined = storage['ba2.listingRun'] as ListingRun;
const joinedSignalSender = () => ({ id: 'a'.repeat(32), tab: { id: 42 }, frameId: 0, url: currentTab.url });
publicationObservation = { stage: 'SIGNUP', confidence: 0.95, reason: 'Native registration form' };
tabUpdatedListener?.(42, { status: 'complete' });
for (let wait = 0; wait < 100 && (storage['ba2.listingRun'] as ListingRun).registration?.state !== 'waiting-human'; wait++) await flush();
assert.equal((storage['ba2.listingRun'] as ListingRun).registration?.state, 'waiting-human');
automaticRegistrationChecks = { ok: true, captcha: 'verified', reason: 'Human completed required gates' };
await dispatch({ type: 'BA2_REGISTRATION_CHANGED', runId: joined.id }, joinedSignalSender());
assert.equal(automaticRegistrationSubmits, joinedCounts[0] + 1);
publicationObservation = { stage: 'ACCOUNT_VERIFICATION', confidence: 0.95, reason: 'Email verification required' };
await dispatch({ type: 'BA2_REGISTRATION_CHANGED', runId: joined.id }, joinedSignalSender());
assert.equal((storage['ba2.listingRun'] as ListingRun).registration?.state, 'verification');
publicationObservation = { stage: 'ACCOUNT_CREATED', confidence: 0.95, registrationEvidence: true, reason: 'Your account is succesfuly created',
  loginAction: { kind: 'login', label: 'Click here to login', href: 'https://bloguetechno.com/observed-login' } };
await dispatch({ type: 'BA2_REGISTRATION_CHANGED', runId: joined.id }, joinedSignalSender());
assert.equal(updates.at(-1), 'https://bloguetechno.com/observed-login');
publicationObservation = { stage: 'LOGIN', confidence: 0.95, reason: 'Verified Login form' };
tabUpdatedListener?.(42, { status: 'complete' });
for (let wait = 0; wait < 100 && (storage['ba2.listingRun'] as ListingRun).login?.state !== 'waiting-captcha'; wait++) await flush();
assert.equal((storage['ba2.listingRun'] as ListingRun).login?.state, 'waiting-captcha');
automaticLoginChecks = { ok: true, captcha: 'verified', reason: 'Human CAPTCHA verified' };
await dispatch({ type: 'BA2_LOGIN_CHANGED', runId: joined.id }, joinedSignalSender());
assert.equal(automaticLoginSubmits, joinedCounts[1] + 1);
currentTab.url = 'https://bloguetechno.com/observed-dashboard';
publicationObservation = { stage: 'AUTHENTICATED_DASHBOARD', confidence: 0.95, authenticationEvidence: true, reason: 'Logged in',
  action: { kind: 'new-post', label: 'New post', href: 'https://bloguetechno.com/observed-editor' } };
await dispatch({ type: 'BA2_LOGIN_CHANGED', runId: joined.id }, joinedSignalSender());
assert.equal(updates.at(-1), 'https://bloguetechno.com/observed-editor');
publicationObservation = { stage: 'EDITOR', confidence: 0.95, authenticationEvidence: true, reason: 'Editor' };
genericWorkflowResponse = { ok: true, report: { profileName: profile.businessName, expectedArticle, skipped: [], manual: ['Final Submit'],
  filled: [{ field: 'businessName', descriptor: 'title', value: profile.businessName }, { field: 'description', descriptor: 'editor', value: profile.description }],
  form: { logo: { requested: false, attached: false } }, workflow: publicationObservation } };
publicationValidationError = 'Complete CAPTCHA manually before publication; unsupported or ambiguous challenges remain blocked.';
tabUpdatedListener?.(42, { status: 'complete' });
for (let wait = 0; wait < 100 && !(storage['ba2.listingRun'] as ListingRun).publicationEditorUrl; wait++) await flush();
for (let wait = 0; wait < 25; wait++) await flush();
assert.equal(publicationDispatches, joinedCounts[2], 'publication CAPTCHA never bypassed');
publicationValidationError = undefined; publicationDelivery = 'ok'; fetchScenario = 'valid'; sheetSessionKey = undefined;
const joinedOriginalSend = chrome.tabs.sendMessage;
chrome.tabs.sendMessage = (async (tabId: number, message: { type: string }, options?: { frameId?: number }) => {
  const response = await joinedOriginalSend(tabId, message, options || {});
  if (message.type === 'BA2_BLOG_PUBLISH_ONCE') publicationObservation = { stage: 'CONFIRMATION', confidence: 0.95, publicationEvidence: true,
    publicUrl: 'https://bloguetechno.com/article/continuous-joined-12345', reason: 'Published Visit / Edit' };
  return response;
}) as typeof chrome.tabs.sendMessage;
try {
  await Promise.all([dispatch({ type: 'BA2_PUBLICATION_READY', runId: joined.id }, joinedSignalSender()), dispatch({ type: 'BA2_PUBLICATION_READY', runId: joined.id }, joinedSignalSender())]);
  const complete = storage['ba2.listingRun'] as ListingRun;
  assert.equal(complete.id, joined.id);
  assert.equal(complete.publicVerification?.status, 'verified');
  assert.equal(complete.liveUrl, 'https://bloguetechno.com/article/continuous-joined-12345');
  assert.equal(updates.at(-1), complete.liveUrl);
  assert.deepEqual([automaticRegistrationSubmits, automaticLoginSubmits, publicationDispatches, sheetBackendCalls], [joinedCounts[0] + 1, joinedCounts[1] + 1, joinedCounts[2] + 1, joinedCounts[3]]);
  await dispatch(continuousMessage, popupSender);
  assert.equal(publicationDispatches, joinedCounts[2] + 1);
} finally { chrome.tabs.sendMessage = joinedOriginalSend; }
profile.id = continuousOriginalProfileId;
if (savedContinuousLogo) profile.logoAsset = savedContinuousLogo;
console.log('Joined continuous lifecycle passed: one AUTOFILL, registration/CAPTCHA/email verification/Login/CAPTCHA/dashboard/editor/publication-CAPTCHA/one Publish/Visit/public verification; no second START or real writes');

profile.id = 'continuous-concurrent-authorization';
resetAutoLogin('bloguetechno.com');
currentTab = { id: 42, url: 'https://bloguetechno.com/login' };
publicationObservation = { stage: 'LOGIN', confidence: 0.95, reason: 'Verified Login' };
const concurrentBase = `ba2.loginGuard:https://bloguetechno.com:${profile.id}`;
storage[concurrentBase] = { runId: 'authenticated-history', state: 'authenticated' };
const continuousFillsBefore: number = automaticLoginFills;
const continuousSubmitsBefore: number = automaticLoginSubmits;
const concurrentStarts = await Promise.all([dispatch(continuousMessage, popupSender), dispatch(continuousMessage, popupSender)]);
assert.ok(concurrentStarts.every(ack => ack.ok));
assert.equal(concurrentStarts[0].runId, concurrentStarts[1].runId, 'concurrent actions join one run');
assert.equal(automaticLoginFills, continuousFillsBefore + 1);
assert.equal(automaticLoginSubmits, continuousSubmitsBefore);
const currentContinuous = storage['ba2.listingRun'] as ListingRun;
storage[concurrentBase] = { runId: 'authenticated-history', state: 'uncertain' };
const alteredReceiptSnapshot = JSON.stringify(storage);
automaticLoginChecks = { ok: true, captcha: 'verified', reason: 'Human fixture completion' };
assert.equal((await dispatch(continuousMessage, popupSender)).ok, false, 'changed historical evidence cannot authorize continuation');
await dispatch({ type: 'BA2_LOGIN_CHANGED', runId: currentContinuous.id }, { id: 'a'.repeat(32), tab: { id: 42 }, frameId: 0, url: currentTab.url });
assert.equal(automaticLoginSubmits, continuousSubmitsBefore);
assert.equal(JSON.stringify(storage), alteredReceiptSnapshot, 'changed receipt is preserved without rewriting it');
const foreignTabSnapshot = JSON.stringify(storage);
assert.equal((await dispatch(continuousMessage, { id: 'a'.repeat(32), tab: { id: 84 }, frameId: 0, url: currentTab.url })).ok, false);
assert.equal((await dispatch(continuousMessage, { id: 'a'.repeat(32), tab: { id: 42 }, frameId: 1, url: currentTab.url })).ok, false);
assert.equal(JSON.stringify(storage), foreignTabSnapshot);
profile.id = continuousOriginalProfileId;
console.log('Continuous concurrency/ownership passed: one run and credential preparation, changed historical receipt blocks before Login, foreign tab/subframe cannot authorize');

profile.id = 'continuous-failed-delivery-preserved';
resetAutoLogin('bloguetechno.com');
currentTab = { id: 42, url: 'https://bloguetechno.com/' };
const continuousFailed = createListingRun(currentTab.url, profile.id, 42);
Object.assign(continuousFailed, { stage: 'ERROR', autoRegister: true, autoLogin: true, autoPublish: true,
  continuous: { loginReceiptsSnapshot: '{}', registrationReceiptSnapshot: 'null' }, error: 'Listing autofill returned no response.' });
storage['ba2.listingRun'] = continuousFailed;
const continuousFailedSnapshot = JSON.stringify(storage), continuousFailedFills: number = genericFills;
await background.recoverListingRun();
assert.equal(genericFills, continuousFailedFills);
assert.equal(JSON.stringify(storage), continuousFailedSnapshot);
assert.equal((await dispatch(continuousMessage, popupSender)).ok, true, 'fresh explicit click prepares the currently observed page; never replays old unacknowledged command');
assert.deepEqual(storage['ba2.listingRunArchive:' + continuousFailed.id], continuousFailed);
assert.notEqual((storage['ba2.listingRun'] as ListingRun).id, continuousFailed.id);
assert.equal(genericFills, continuousFailedFills, 'old listing action was not redispatched');
profile.id = continuousOriginalProfileId;
console.log('Continuous failed delivery passed: startup never replays; explicit click archives unchanged error and prepares observed page without old action replay');

// Non-blog listing behavior stays conservative under the same normal button.
profile.id = 'continuous-non-blog-fill';
resetAutoLogin('generic-directory.example');
currentTab = { id: 42, url: 'https://generic-directory.example/observed-listing-form' };
publicationObservation = { stage: 'UNSUPPORTED', confidence: 0, reason: 'Not a blogging account/editor page' };
genericWorkflowResponse = { ok: true, report: { profileName: profile.businessName, filled: [{ field: 'businessName', descriptor: 'listing title', value: profile.businessName }], skipped: [], manual: ['Final Submit'], adaptive: { stage: 'FORM', diagnostics: ['Generic form autofill started'] } } };
const conservativeCounts: number[] = [automaticLoginSubmits, automaticRegistrationSubmits, publicationDispatches, sheetBackendCalls];
assert.equal((await dispatch(continuousMessage, popupSender)).ok, true);
const conservative = storage['ba2.listingRun'] as ListingRun;
assert.equal(conservative.stage, 'MANUAL_GATE');
assert.equal(conservative.autoRegister, false); assert.equal(conservative.autoLogin, false); assert.equal(conservative.autoPublish, false);
assert.equal(conservative.publicationApproval, undefined);
assert.deepEqual([automaticLoginSubmits, automaticRegistrationSubmits, publicationDispatches, sheetBackendCalls], conservativeCounts);
profile.id = continuousOriginalProfileId;
console.log('Non-blog compatibility passed: existing conservative listing fill, manual final submit, no account/publication/Sheets action');

// A prepared field checkpoint is not an account submission. Legacy runs and
// stopped preparations in another tab must not force a recovery UI.
for (const checkpoint of ['legacy-login', 'other-tab-login', 'registration', 'active-preparation'] as const) {
  profile.id = `prepared-refresh-${checkpoint}`;
  resetAutoLogin('bloguetechno.com');
  currentTab = { id: 42, url: 'https://bloguetechno.com/login' };
  publicationObservation = { stage: 'LOGIN', confidence: 0.95, reason: 'Verified Login' };
  const old = createListingRun(currentTab.url, profile.id, checkpoint === 'other-tab-login' ? 43 : 42);
  Object.assign(old, { stage: 'MANUAL_GATE', awaitingManualResume: true, autoLogin: true,
    loginApproval: { authorizedAt: '2000-01-01T00:00:00Z', profileUpdatedAt: profile.updatedAt } });
  if (checkpoint === 'registration') old.registration = { url: 'https://bloguetechno.com/signup', state: 'waiting-human', reason: 'Prepared only' };
  else old.login = { url: currentTab.url, state: 'manual', reason: 'Empty fields after refresh' };
  if (checkpoint === 'active-preparation') old.stage = 'FORM';
  storage['ba2.listingRun'] = old;
  const before = JSON.stringify(old), effects: number[] = [automaticLoginSubmits, automaticRegistrationSubmits, publicationDispatches, sheetBackendCalls];
  assert.equal((await dispatch(continuousMessage, popupSender)).ok, true, checkpoint);
  const fresh = storage['ba2.listingRun'] as ListingRun;
  assert.notEqual(fresh.id, old.id);
  assert.equal(fresh.tabId, 42);
  assert.equal(fresh.login?.state, 'waiting-captcha');
  assert.ok(fresh.continuous);
  assert.notEqual(fresh.loginApproval?.authorizedAt, old.loginApproval?.authorizedAt);
  assert.equal(JSON.stringify(storage['ba2.listingRunArchive:' + old.id]), before);
  assert.deepEqual([automaticLoginSubmits, automaticRegistrationSubmits, publicationDispatches, sheetBackendCalls], effects);
}
for (const blocked of ['uncertain-login', 'claimed-login', 'uncertain-registration'] as const) {
  profile.id = `prepared-refresh-blocked-${blocked}`;
  resetAutoLogin('bloguetechno.com');
  currentTab = { id: 42, url: 'https://bloguetechno.com/login' };
  const old = createListingRun(currentTab.url, profile.id, 43);
  old.stage = 'MANUAL_GATE';
  if (blocked === 'uncertain-login') old.login = { url: currentTab.url, state: 'uncertain', reason: 'Missing outcome' };
  if (blocked === 'claimed-login') old.login = { url: currentTab.url, state: 'waiting-captcha', claimed: true, reason: 'Malformed claim' };
  if (blocked === 'uncertain-registration') old.registration = { url: currentTab.url, state: 'uncertain', reason: 'Missing outcome' };
  storage['ba2.listingRun'] = old;
  const snapshot = JSON.stringify(storage), effects: number[] = [automaticLoginFills, automaticLoginSubmits, automaticRegistrationSubmits, publicationDispatches];
  const ack = await dispatch(continuousMessage, popupSender);
  assert.equal(ack.ok, false, blocked);
  assert.match(ack.error, /Login outcome|registration outcome|still active/);
  assert.equal(JSON.stringify(storage), snapshot);
  assert.deepEqual([automaticLoginFills, automaticLoginSubmits, automaticRegistrationSubmits, publicationDispatches], effects);
}
profile.id = continuousOriginalProfileId;
console.log('Prepared refresh lifecycle passed: idle legacy/different-tab/FORM preparation archived unchanged with fresh authorization; uncertain/claimed attempts still blocked, no submissions');

// A different website's saved attempt must not veto current-site editor filling.
for (const prior of ['uncertain-login', 'uncertain-registration', 'uncertain-publication', 'active', 'archive-conflict'] as const) {
  profile.id = `cross-site-editor-${prior}`;
  resetAutoLogin('thezenweb.com');
  currentTab = { id: 42, url: 'https://thezenweb.com/new' };
  const old = createListingRun('https://pointblog.net/signup', profile.id, 43);
  Object.assign(old, { stage: prior === 'active' ? 'FORM' : 'MANUAL_GATE', autoLogin: true, autoPublish: true,
    loginApproval: { authorizedAt: '2000-01-01T00:00:00Z', profileUpdatedAt: profile.updatedAt } });
  if (prior === 'uncertain-login') old.login = { url: old.sourceUrl, state: 'uncertain', attemptId: 'old-login', claimed: true, reason: 'Unresolved' };
  if (prior === 'uncertain-registration') old.registration = { url: old.sourceUrl, state: 'uncertain', attemptId: 'old-registration', claimed: true, reason: 'Unresolved' };
  if (prior === 'uncertain-publication') { old.submissionAttempted = true; old.publicationSubmission = { attemptId: 'old-publication', url: old.sourceUrl, startedAt: old.startedAt, outcome: 'uncertain', claimed: true }; }
  await writeListingRun(old);
  const archiveKey = 'ba2.listingRunArchive:' + old.id;
  if (prior === 'archive-conflict') storage[archiveKey] = { ...old, manual: ['Earlier historical snapshot'] };
  const originalArchive = JSON.stringify(storage[archiveKey]);
  const oldSnapshot = JSON.stringify(old);
  const oldGuards = JSON.stringify(Object.fromEntries(Object.entries(storage).filter(([key]) => key.includes('Guard:') && key.includes('pointblog.net'))));
  publicationObservation = { stage: 'EDITOR', confidence: 0.95, reason: 'Operator-confirmed editor controls' };
  genericWorkflowResponse = { ok: true, report: { profileName: profile.businessName, filled: [{ field: 'businessName', descriptor: 'title', value: profile.businessName }], skipped: [], manual: ['Final Submit'], workflow: publicationObservation, expectedArticle } };
  publicationValidationError = 'Controlled fill-only acceptance; no Publish';
  const fills: number = genericFills;
  const effects: number[] = [automaticLoginSubmits, automaticRegistrationSubmits, publicationDispatches, sheetBackendCalls];
  const ack = await dispatch(continuousMessage, popupSender);
  assert.equal(ack.ok, true, prior + ': unrelated Pointblog run cannot block TheZENweb editor');
  const fresh = storage['ba2.listingRun'] as ListingRun;
  assert.equal(fresh.domain, 'thezenweb.com'); assert.notEqual(fresh.id, old.id);
  assert.equal(fresh.autoRegister, false);
  assert.notEqual(fresh.loginApproval?.authorizedAt, old.loginApproval?.authorizedAt, 'fresh click supplies consent, not old record');
  assert.equal(genericFills, fills + 1);
  assert.ok(Object.entries(storage).some(([key, record]) => key.startsWith(archiveKey) && JSON.stringify(record) === oldSnapshot), 'old snapshot preserved without altering any prior archive');
  if (originalArchive) assert.equal(JSON.stringify(storage[archiveKey]), originalArchive);
  assert.equal(JSON.stringify(Object.fromEntries(Object.entries(storage).filter(([key]) => key.includes('Guard:') && key.includes('pointblog.net')))), oldGuards);
  assert.deepEqual([automaticLoginSubmits, automaticRegistrationSubmits, publicationDispatches, sheetBackendCalls], effects);
}
publicationValidationError = undefined;
profile.id = continuousOriginalProfileId;
console.log('Cross-website editor isolation passed: uncertain/active Pointblog history and conflicting archives preserved, TheZENweb filled, no Login/registration/Publish/Sheets');

// Existing publication completion is read-only, even when the selected
// success tab differs from the saved tab. Never route it to fresh START.
const strandedPublication = await recoveryFixture();
strandedPublication.sourceUrl = 'https://bloguetechno.com/new';
strandedPublication.domain = 'bloguetechno.com';
strandedPublication.tabId = 43;
strandedPublication.publicVerification = undefined;
strandedPublication.sheetSync = undefined;
currentTab = { id: 42, url: strandedPublication.sourceUrl };
const strandedUrl = 'https://fixture.bloguetechno.com/existing-publication-80348278';
storage[`ba2.publicationGuard:bloguetechno.com:${profile.id}`] = { runId: strandedPublication.id };
publicationObservation = { stage: 'CONFIRMATION', confidence: 0.95, publicationEvidence: true, publicUrl: strandedUrl, reason: 'Existing Visit' };
const strandedEffects: number[] = [genericFills, automaticLoginSubmits, automaticRegistrationSubmits, publicationDispatches, sheetBackendCalls];
const strandedAck = await dispatch(continuousMessage, popupSender);
assert.equal(strandedAck.ok, true, 'existing publication observation must precede fresh-run rejection: ' + strandedAck.error);
assert.equal((storage['ba2.listingRun'] as ListingRun).id, strandedPublication.id);
assert.equal((storage['ba2.listingRun'] as ListingRun).liveUrl, strandedUrl);
assert.equal((storage['ba2.listingRun'] as ListingRun).publicVerification?.status, 'verified');
assert.deepEqual([genericFills, automaticLoginSubmits, automaticRegistrationSubmits, publicationDispatches, sheetBackendCalls], strandedEffects);
console.log('Existing publication START boundary passed: observe/verify own saved success before new-run guard; no publication replay or new run');
for (const scenario of ['wrong-article', 'foreign-receipt', 'changed-profile', 'foreign-page', 'changed-marker', 'changed-receipt'] as const) {
  const pending = await recoveryFixture();
  pending.tabId = 43;
  currentTab = { id: 42, url: pending.sourceUrl };
  fetchScenario = scenario === 'wrong-article' ? 'wrong' : 'valid';
  const guardKey = `ba2.publicationGuard:onesmablog.com:${profile.id}`;
  if (scenario === 'foreign-receipt') storage[guardKey] = { runId: 'unrelated-owner' };
  if (scenario === 'changed-profile') pending.publicationApproval!.profileFingerprint = 'different-profile';
  if (scenario === 'foreign-page') currentTab.url = 'https://foreign.test/new';
  const before = JSON.stringify(storage), runBefore = JSON.stringify(pending);
  const send = chrome.tabs.sendMessage;
  chrome.tabs.sendMessage = (async (tabId: number, message: { type: string }, options?: { frameId?: number }) => {
    const reply = await send(tabId, message, options || {});
    if (message.type === 'BA2_VERIFY_PUBLIC_ARTICLE') {
      if (scenario === 'changed-marker') publicationObservation = { stage: 'EDITOR', confidence: 0.95, reason: 'Success marker changed during verification' };
      if (scenario === 'changed-receipt') storage[guardKey] = { runId: 'new-unrelated-owner' };
    }
    return reply;
  }) as typeof chrome.tabs.sendMessage;
  try { await background.recoverPublishedArticle(pending.id, 42, true); }
  finally { chrome.tabs.sendMessage = send; }
  assert.equal(JSON.stringify(storage['ba2.listingRun']), runBefore, scenario + ': do not adopt unverified or changed candidate tab');
  if (scenario === 'changed-receipt') assert.equal((storage[guardKey] as { runId: string }).runId, 'new-unrelated-owner', 'never overwrite a receipt changed during GET');
  else assert.equal(JSON.stringify(storage), before, scenario + ': no saved-state mutation');
}
fetchScenario = 'valid';
const interruptedVisit = await recoveryFixture();
interruptedVisit.tabId = 43;
interruptedVisit.tabUnavailable = { tabId: 43, detectedAt: new Date().toISOString(), reason: 'closed' };
currentTab = { id: 42, url: interruptedVisit.sourceUrl };
await background.recoverListingRun();
assert.equal((storage['ba2.listingRun'] as ListingRun).id, interruptedVisit.id);
assert.equal((storage['ba2.listingRun'] as ListingRun).publicVerification?.status, 'verified');
assert.equal((storage['ba2.listingRun'] as ListingRun).tabId, 42);
assert.equal((storage['ba2.listingRun'] as ListingRun).tabUnavailable, undefined, 'clear stale live-tab flag only after independent verification');
assert.deepEqual([genericFills, automaticLoginSubmits, automaticRegistrationSubmits, publicationDispatches, sheetBackendCalls], strandedEffects);
console.log('Existing success candidate guards passed: wrong content/receipt/profile/site or changed marker/receipt preserve state; startup automatically completes verified own publication without START');

// Reproduce BOTH live messages through real handlers before testing recovery:
// unknown publication outcome, then original tab closure. The success document
// is already open in another tab; chrome://extensions is active after reload.
const lostPublisher = await recoveryFixture();
lostPublisher.publicVerification = undefined;
lostPublisher.sheetSync = undefined;
lostPublisher.sourceUrl = 'https://bloguetechno.com/new';
lostPublisher.domain = 'bloguetechno.com';
currentTab = { id: 42, url: lostPublisher.sourceUrl };
storage[`ba2.publicationGuard:bloguetechno.com:${profile.id}`] = { runId: lostPublisher.id };
publicationObservation = { stage: 'EDITOR', confidence: 0.95, reason: 'No success yet' };
await background.recoverListingRun();
assert.match((storage['ba2.listingRun'] as ListingRun).manual.join(' '), /Publication outcome is not confirmed\./, 'first live message must come from actual outcome observer');
missingTabs.add(42);
tabRemovedListener?.(42);
for (let wait = 0; wait < 60 && !(storage['ba2.listingRun'] as ListingRun).tabUnavailable; wait++) await flush();
const lost = storage['ba2.listingRun'] as ListingRun;
assert.ok(lost.tabUnavailable);
assert.ok(lost.manual.includes('Saved publisher tab is unavailable. Attempts and receipts are preserved; no automatic tab reassignment or resubmission.'), 'second live message must come from actual tab-loss handler');
const lostAttempt = JSON.stringify(lost.publicationSubmission);
const lostEffects: number[] = [genericFills, automaticLoginSubmits, automaticRegistrationSubmits, publicationDispatches, sheetBackendCalls];
currentTab = { id: 77, url: 'chrome://extensions/' };
extraOpenTabs = [{ id: 55, url: lostPublisher.sourceUrl }];
publicationObservation = { stage: 'CONFIRMATION', confidence: 0.95, publicationEvidence: true, publicUrl: strandedUrl, reason: 'Existing visible Visit in already-open success tab' };
await background.recoverListingRun();
const completedLost = storage['ba2.listingRun'] as ListingRun;
assert.equal(completedLost.publicVerification?.status, 'verified', 'already-open success must be discovered without original tab or active publisher');
assert.equal(completedLost.id, lostPublisher.id);
assert.equal(completedLost.tabId, 55);
assert.equal(JSON.stringify(completedLost.publicationSubmission), lostAttempt);
assert.equal(completedLost.liveUrl, strandedUrl);
assert.equal(currentTab.url, 'chrome://extensions/', 'do not navigate unrelated active tab');
assert.deepEqual([genericFills, automaticLoginSubmits, automaticRegistrationSubmits, publicationDispatches, sheetBackendCalls], lostEffects);
extraOpenTabs = [];
missingTabs.delete(42);
console.log('Both live messages reproduced then resolved: missing original tab + existing inactive success tab, same verified run/intent/receipt, no action or submission');
for (const scenario of ['ambiguous-successes', 'wrong-content'] as const) {
  const pending = await recoveryFixture();
  pending.sourceUrl = 'https://bloguetechno.com/new'; pending.domain = 'bloguetechno.com'; pending.tabId = 43;
  pending.tabUnavailable = { tabId: 43, detectedAt: new Date().toISOString(), reason: 'closed' };
  storage[`ba2.publicationGuard:bloguetechno.com:${profile.id}`] = { runId: pending.id };
  currentTab = { id: 77, url: 'chrome://extensions/' };
  extraOpenTabs = [{ id: 55, url: pending.sourceUrl }, ...(scenario === 'ambiguous-successes' ? [{ id: 56, url: 'https://bloguetechno.com/other-success' }] : [])];
  const send = chrome.tabs.sendMessage;
  chrome.tabs.sendMessage = (async (tabId: number, message: { type: string }, options?: { frameId?: number }) => {
    if (message.type === 'BA2_BLOG_OBSERVE') return { stage: 'CONFIRMATION', confidence: 0.95, publicationEvidence: true,
      publicUrl: strandedUrl + (tabId === 56 ? '-different-article' : ''), reason: 'Fixture success' };
    return send(tabId, message, options || {});
  }) as typeof chrome.tabs.sendMessage;
  fetchScenario = scenario === 'wrong-content' ? 'wrong' : 'valid';
  const before = JSON.stringify(storage);
  try { await background.recoverListingRun(); }
  finally { chrome.tabs.sendMessage = send; }
  assert.equal(JSON.stringify(storage), before, scenario + ': never guess a tab or replace evidence');
}
fetchScenario = 'valid';
publicationObservation = { stage: 'CONFIRMATION', confidence: 0.95, publicationEvidence: true, publicUrl: strandedUrl, reason: 'Matching success finished loading' };
const loadedPendingId = (storage['ba2.listingRun'] as ListingRun).id;
tabUpdatedListener?.(55, { status: 'complete', url: extraOpenTabs[0].url });
for (let wait = 0; wait < 100 && (storage['ba2.listingRun'] as ListingRun).publicVerification?.status !== 'verified'; wait++) await flush();
assert.equal((storage['ba2.listingRun'] as ListingRun).id, loadedPendingId);
assert.equal((storage['ba2.listingRun'] as ListingRun).publicVerification?.status, 'verified');
assert.equal((storage['ba2.listingRun'] as ListingRun).tabId, 55);
extraOpenTabs = [];
assert.deepEqual([genericFills, automaticLoginSubmits, automaticRegistrationSubmits, publicationDispatches, sheetBackendCalls], lostEffects);
console.log('Open-tab discovery guards passed: ambiguous/wrong content preserve records; matching page completion wakes same saved publication without START');

for (const condition of ['matching', 'wrong-visit', 'foreign-receipt'] as const) {
  const saved = await recoveryFixture();
  saved.stage = 'COMPLETE'; saved.liveUrl = sheetArticleUrl;
  saved.publicationConfirmation = { url: saved.sourceUrl, visitUrl: sheetArticleUrl, observedAt: new Date().toISOString() };
  saved.publicVerification = { status: 'verified', candidateUrl: sheetArticleUrl, confirmationUrl: saved.sourceUrl,
    attemptId: 'preserved-success-verification', reason: 'Already verified' };
  await writeListingRun(saved);
  currentTab = { id: saved.tabId, url: saved.sourceUrl };
  publicationObservation = { stage: 'CONFIRMATION', confidence: 0.95, publicationEvidence: true,
    publicUrl: condition === 'wrong-visit' ? sheetArticleUrl + '-another-article' : sheetArticleUrl, reason: 'Existing success document' };
  if (condition === 'foreign-receipt') storage[`ba2.publicationGuard:onesmablog.com:${saved.profileId}`] = { runId: 'another-owner' };
  const snapshot = JSON.stringify(storage);
  const effects: number[] = [genericFills, automaticLoginSubmits, automaticRegistrationSubmits, publicationDispatches, sheetBackendCalls];
  const ack = await dispatch(continuousMessage, popupSender);
  assert.equal(ack.ok, condition === 'matching', condition);
  if (condition === 'matching') {
    assert.equal(currentTab.url, sheetArticleUrl);
    assert.equal((storage['ba2.listingRun'] as ListingRun).publicVerification?.attemptId, 'preserved-success-verification');
  } else assert.equal(JSON.stringify(storage), snapshot, condition + ': unchanged history/receipt');
  assert.deepEqual([genericFills, automaticLoginSubmits, automaticRegistrationSubmits, publicationDispatches, sheetBackendCalls], effects);
}
console.log('Current verified success dispatch passed: original Visit/verification identity retained; mismatched href/foreign receipt blocked, no action replay');
