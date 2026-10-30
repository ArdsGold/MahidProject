import { manualAutofillFamily, smartAutofillOnly, currentPageAutofillOnly, SMART_AUTOFILL_ENABLED } from "../manual-autofill-policy";
import { runSmartAutofill } from './smart-autofill';
import { getFamily3Adapter } from "../automation/adapters";
import { installDirectory3Receiver } from "./directory3-continuation";
import { isAutomationExcluded, AUTOMATION_EXCLUDED_MESSAGE } from "@backlink-autofill/shared";
import "./dashboard-assets";
import "./publication-reader";
import { runAutofill } from "./autofill";
import { clickSelectedLocation, clickSelectedCategory, fillLoginFields, handleBlogPublication, handleAutomaticLogin, handleAutomaticRegistration, watchAuthorizedLogin, watchAuthorizedPublication, runListingAutofill, runListingAutofillAsync } from "./listing-autofill";
import { findAmpBlogsLoginSubmit, isAmpBlogsUrl, observeAmpBlogsPage } from "../ampblogs";
import { observeBlogWorkflow } from "../automation/blog-workflow";
import { readListingRun } from "../listing-run";
import { assetBufferFromMessage, attachBrochureToLiveInput, attachLogoToLiveInput, attachLogoFile, findProfileLogoInput, findBrochureInputs, findLogoInputs } from "./logo-upload";
import { captureCurrentSource, isLikelyChallengeContent } from "./source-capture";
import { isDashboardUrl } from "../source-target";
import { getActiveProfile, isDashboardOrigin, syncFromDashboardPage } from "./transport";
import { installFloatingAutofillButton } from "./floating-button";
import { normalizeCaptureJob, STORAGE_KEYS, type CaptureJob } from "@backlink-autofill/shared";
import type {
  ActiveProfileResponse,
  AutofillResponse,
  ListingAutofillResponse,
  ListingAutofillReport,
  ExtensionMessage,
  SyncResponse,
  SourceCaptureResponse,
  AmpBlogsObservationResponse,
} from "../messages";

const DASHBOARD_SYNC_INTERVAL_MS = 2000;
const CAPTURE_JOB_POLL_INTERVAL_MS = 400;
let lastCaptureJobSignature = "";

function isTopFrame(): boolean {
  return window.top === window;
}

type ContentListener = Parameters<typeof chrome.runtime.onMessage.addListener>[0];
const contentState = globalThis as typeof globalThis & { __ba2FullContentListener?: ContentListener };
const fullReceiverInstalled = Boolean(contentState.__ba2FullContentListener && chrome.runtime.onMessage.hasListener(contentState.__ba2FullContentListener));
if ((currentPageAutofillOnly(location.href) || getFamily3Adapter(location.href)) && isTopFrame()) {
  const old = globalThis as typeof globalThis & { __ba2StopLoginWatch?: () => void; __ba2StopPublicationGateWatch?: () => void };
  old.__ba2StopLoginWatch?.(); old.__ba2StopPublicationGateWatch?.();
}
if (!fullReceiverInstalled) { installDirectory3Receiver(); void installFloatingAutofillButton(); }
if (!fullReceiverInstalled && isTopFrame()) {
  void readListingRun().then(run => {
    if (isAutomationExcluded(location.href) || currentPageAutofillOnly(location.href) || getFamily3Adapter(location.href)) return;
    if (run?.continuous && run.publicationEditorUrl === location.href && !run.submissionAttempted && !run.publicVerification)
      watchAuthorizedPublication(run.id);
    if (run?.autoRegister && run.registration && run.registration.state !== 'confirmed' && run.registration.state !== 'failed'
      && new URL(run.sourceUrl).origin === location.origin) {
      watchAuthorizedLogin(run.id, true);
      void chrome.runtime.sendMessage({ type: 'BA2_REGISTRATION_CHANGED', runId: run.id } satisfies ExtensionMessage).catch(() => undefined);
      return;
    }
    if (!run?.autoLogin || !run.login || run.login.state === "authenticated" || new URL(run.sourceUrl).origin !== location.origin) return;
    if (["waiting-captcha", "intent"].includes(run.login.state)) watchAuthorizedLogin(run.id);
    else if (run.login.attemptId) void chrome.runtime.sendMessage({ type: "BA2_LOGIN_CHANGED", runId: run.id } satisfies ExtensionMessage).catch(() => undefined);
  }).catch(() => undefined);
}

async function respondToAutofill(loginOnly?: Extract<ExtensionMessage, { type: 'BA2_AUTOFILL' }>['loginOnly']): Promise<AutofillResponse | ListingAutofillResponse> {
  const profile = await getActiveProfile();
  if (!profile) {
    return {
      ok: false,
      error: "No active Business Profile synced. Open the dashboard, create/select a profile.",
    };
  }
  if (loginOnly) {
    if (profile.id !== loginOnly.profileId || profile.updatedAt !== loginOnly.profileUpdatedAt || location.href !== loginOnly.url)
      return { ok: false, error: 'Login page or selected profile changed; no action retried.' };
    // A protected-history fill must not wake a stale page-local submit watcher.
    (globalThis as typeof globalThis & { __ba2StopLoginWatch?: () => void }).__ba2StopLoginWatch?.();
    if (!fillLoginFields(profile)) return { ok: false, error: 'Login form is unsafe, incomplete or contains a different account. Nothing submitted.' };
    return { ok: true, report: { profileName: profile.businessName || 'Untitled', filled: [], skipped: [] } };
  }
  if (smartAutofillOnly(location.href)) return { ok: true, report: await fillCurrentListing(profile) };
  if (manualAutofillFamily(location.href) || getFamily3Adapter(location.href)) return { ok: true, report: await fillCurrentListing(profile) };
  return { ok: true, report: runAutofill(profile) };
}

async function fillCurrentListing(profile: Parameters<typeof runSmartAutofill>[0], categoryMapping?: Extract<ExtensionMessage, { type: 'BA2_LISTING_AUTOFILL' }>['categoryMapping']): Promise<ListingAutofillReport> {
  const smart = async (): Promise<ListingAutofillReport> => {
    const saved = await getActiveProfile(true);
    return saved?.id === profile.id && saved.updatedAt === profile.updatedAt ? runSmartAutofill(saved)
      : { profileName: profile.businessName, filled: [], skipped: [], manual: ['Active profile changed; nothing filled.'] };
  };
  if (smartAutofillOnly(location.href)) return smart();
  const report = await runListingAutofillAsync(profile, categoryMapping);
  if (SMART_AUTOFILL_ENABLED && !report.filled.length && !report.navigationUrl
    && (!getFamily3Adapter(location.href) || location.pathname === '/submit.php')
    && !report.manual.some(reason => /(?:origin|protocol|form action|hidden native)/i.test(reason))) {
    const fallback = await smart();
    if (fallback.filled.length) return fallback;
  }
  return report;
}

async function respondToSync(): Promise<SyncResponse> {
  try {
    const profile = await syncFromDashboardPage();
    return { ok: true, profileName: profile?.businessName ?? null };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Sync failed." };
  }
}

const fullContentListener: ContentListener = (message: ExtensionMessage, _sender, sendResponse) => {
  if (isAutomationExcluded(location.href) && !["BA2_GET_ACTIVE_PROFILE", "BA2_SYNC_FROM_DASHBOARD"].includes(message.type)) { sendResponse({ ok: false, error: AUTOMATION_EXCLUDED_MESSAGE }); return; }
  if (getFamily3Adapter(location.href) && ['BA2_WATCH_PUBLICATION_READY', 'BA2_REGISTRATION_PREPARE', 'BA2_REGISTRATION_SUBMIT_ONCE', 'BA2_REGISTRATION_WATCH', 'BA2_LOGIN_PREPARE', 'BA2_LOGIN_SUBMIT_ONCE', 'BA2_LOGIN_WATCH', 'BA2_AMPBLOGS_SUBMIT_LOGIN', 'BA2_BLOG_PUBLISH_ONCE', 'BA2_SELECT_ENTRY', 'BA2_SELECT_LOCATION', 'BA2_SELECT_CATEGORY', 'BA2_ATTACH_PROFILE_LOGO', 'BA2_ATTACH_PROFILE_BROCHURE'].includes(message.type)) {
    sendResponse({ ok: false, error: 'Directory CAPTCHA and final Continue/Submit are human-only. No page action performed.' }); return;
  }
  if (currentPageAutofillOnly(location.href) && ['BA2_WATCH_PUBLICATION_READY', 'BA2_REGISTRATION_PREPARE', 'BA2_REGISTRATION_SUBMIT_ONCE', 'BA2_REGISTRATION_WATCH', 'BA2_LOGIN_PREPARE', 'BA2_LOGIN_SUBMIT_ONCE', 'BA2_LOGIN_WATCH', 'BA2_AMPBLOGS_SUBMIT_LOGIN', 'BA2_BLOG_PUBLISH_ONCE', 'BA2_SELECT_ENTRY', 'BA2_SELECT_LOCATION', 'BA2_SELECT_CATEGORY', 'BA2_ATTACH_PROFILE_LOGO', 'BA2_ATTACH_PROFILE_BROCHURE'].includes(message.type)) {
    sendResponse({ ok: false, error: 'Manual navigation and submission only for this family.' }); return;
  }
  if (message.type === 'BA2_WATCH_PUBLICATION_READY') {
    if (!isTopFrame() || _sender.id !== chrome.runtime.id) return;
    watchAuthorizedPublication(message.runId); sendResponse({ ok: true }); return true;
  }
  if (message.type === 'BA2_REGISTRATION_PREPARE' || message.type === 'BA2_REGISTRATION_SUBMIT_ONCE') {
    if (!isTopFrame() || _sender.id !== chrome.runtime.id) return;
    void handleAutomaticRegistration(message.runId, message.type === 'BA2_REGISTRATION_PREPARE' && message.fill,
      message.type === 'BA2_REGISTRATION_SUBMIT_ONCE' ? message.attemptId : undefined)
      .then(sendResponse).catch(() => sendResponse({ ok: false, captcha: 'ambiguous', reason: 'Registration validation or delivery unavailable. Inspect the site; no automatic retry.' }));
    return true;
  }
  if (message.type === 'BA2_REGISTRATION_WATCH') {
    if (!isTopFrame() || _sender.id !== chrome.runtime.id) return;
    watchAuthorizedLogin(message.runId, true); sendResponse({ ok: true }); return true;
  }
  if (message.type === "BA2_LOGIN_PREPARE" || message.type === "BA2_LOGIN_SUBMIT_ONCE") {
    if (!isTopFrame()) return undefined;
    void handleAutomaticLogin(message.runId, message.type === "BA2_LOGIN_PREPARE" && message.fill === true,
      message.type === "BA2_LOGIN_SUBMIT_ONCE" ? message.attemptId : undefined).then(sendResponse)
      .catch(() => sendResponse({ ok: false, captcha: "ambiguous", reason: "Login validation or delivery failed. Inspect the site; do not retry automatically." }));
    return true;
  }
  if (message.type === "BA2_LOGIN_WATCH") {
    if (!isTopFrame()) return undefined;
    watchAuthorizedLogin(message.runId);
    sendResponse({ ok: true });
    return true;
  }
  if (message.type === "BA2_AUTOFILL") {
    if (smartAutofillOnly(location.href) && (message.loginOnly || !isTopFrame() || _sender.id !== chrome.runtime.id)) {
      sendResponse({ ok: false, error: 'Smart autofill prepares business fields in the current top frame only; Login remains manual.' }); return true;
    }
    if (message.loginOnly && (!isTopFrame() || _sender.id !== chrome.runtime.id)) {
      sendResponse({ ok: false, error: 'Trusted top-frame Login preparation required.' }); return true;
    }
    void respondToAutofill(message.loginOnly).then(sendResponse)
      .catch(() => sendResponse({ ok: false, error: 'Login autofill unavailable. No automatic retry or submission.' }));
    return true;
  }
  if (message.type === "BA2_AMPBLOGS_OBSERVE") {
    if (!isTopFrame()) return undefined;
    const response: AmpBlogsObservationResponse = { ok: true, observation: observeAmpBlogsPage(document, location.href) };
    sendResponse(response);
    return true;
  }
  if (message.type === "BA2_AMPBLOGS_LOGIN_AUTOFILL") {
    if (!isTopFrame()) return undefined;
    if (!isAmpBlogsUrl(location.href)) {
      sendResponse({ ok: false, error: "AmpBlogs login autofill is only available on ampblogs.com." });
      return true;
    }
    void getActiveProfile().then((profile) => {
      sendResponse(profile ? { ok: true, report: runListingAutofill(profile) } : { ok: false, error: "No active profile. Open the dashboard and set an Active Profile before using AUTOFILL." });
    }).catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : "Could not read the Active Profile." }));
    return true;
  }
  if (message.type === "BA2_AMPBLOGS_SUBMIT_LOGIN") {
    if (!isTopFrame()) return undefined;
    if (!isAmpBlogsUrl(location.href)) {
      sendResponse({ ok: false, error: "AmpBlogs login submission is only available on ampblogs.com." });
      return true;
    }
    const observation = observeAmpBlogsPage(document, location.href);
    if (observation.pageState !== "LOGIN_FORM") {
      sendResponse({ ok: false, error: `AmpBlogs login submission stopped at ${observation.pageState}.` });
      return true;
    }
    if (observation.captchaState === "present") {
      sendResponse({ ok: false, error: "CAPTCHA is still present. Complete it before authorizing Sign In." });
      return true;
    }
    const submit = findAmpBlogsLoginSubmit(document);
    if (!submit) {
      sendResponse({ ok: false, error: "AmpBlogs Sign In control was missing or ambiguous." });
      return true;
    }
    submit.click();
    sendResponse({ ok: true });
    return true;
  }
  if (message.type === "BA2_BLOG_PUBLISH_ONCE" || message.type === "BA2_BLOG_VALIDATE") {
    if (!isTopFrame()) return undefined;
    void handleBlogPublication(message.runId, message.type === "BA2_BLOG_PUBLISH_ONCE" ? message.attemptId : undefined)
      .then(sendResponse).catch(() => sendResponse({ ok: false, error: "Publication validation or delivery failed. Inspect the site before any further action; do not retry publication." }));
    return true;
  }
  if (message.type === "BA2_LISTING_AUTOFILL") {
    if ((SMART_AUTOFILL_ENABLED || manualAutofillFamily(location.href) === 2 || getFamily3Adapter(location.href)) && (!isTopFrame() || _sender.id !== chrome.runtime.id)) return;
       void getActiveProfile().then(async (profile) => {
        if (profile && manualAutofillFamily(location.href) === 2) {
          const url = location.href;
          const report = await fillCurrentListing(profile, message.categoryMapping);
          const input = report.smartFallback ? null : findProfileLogoInput(document);
          if (input) {
            if (!profile.logoAsset) { sendResponse({ ok: false, error: 'Fields filled; no saved Business Logo in the active profile. Update Profile remains manual.' }); return; }
            const logo = await chrome.runtime.sendMessage({ type: 'BA2_GET_PROFILE_LOGO', profileId: profile.id, assetId: profile.logoAsset.id, fileName: profile.logoAsset.fileName } satisfies ExtensionMessage);
            const current = await getActiveProfile();
            if (location.href !== url || current?.id !== profile.id || current.updatedAt !== profile.updatedAt || current.logoAsset?.id !== profile.logoAsset.id || findProfileLogoInput(document) !== input) {
              sendResponse({ ok: false, error: 'Page or active profile changed; logo not selected. Click AUTOFILL again.' }); return;
            }
            const bytes = logo?.ok && assetBufferFromMessage(logo.data);
            if (!bytes) { sendResponse({ ok: false, error: logo?.error || 'Saved Business Logo unavailable; Update Profile remains manual.' }); return; }
            const attached = await attachLogoFile(input, bytes, profile.logoAsset.fileName, logo.mimeType);
            if (!attached.ok) { sendResponse({ ok: false, error: attached.error || 'Business Logo file selection failed.' }); return; }
            report.form = { ...report.form, logo: { requested: true, attached: true } };
          }
          sendResponse({ ok: true, report }); return;
        }
        sendResponse(profile ? { ok: true, report: await fillCurrentListing(message.articleImage && manualAutofillFamily(location.href) === 1
          && message.articleImage.profileId === profile.id && message.articleImage.profileUpdatedAt === profile.updatedAt
          ? { ...profile, imageUrl: message.articleImage.url } : profile, message.categoryMapping) } : { ok: false, error: "No active profile. Open the dashboard and set an Active Profile before using AUTOFILL." });
    }).catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : "Could not read the Active Profile." }));
    return true;
  }
  if (message.type === "BA2_SELECT_LOCATION") {
    const selected = clickSelectedLocation(message.label, message.href);
    sendResponse(selected ? { ok: true, selected: selected.label, href: selected.href } : { ok: false, error: `Location action failed: ${message.label}` });
    return true;
  }
  if (message.type === "BA2_SELECT_ENTRY") {
    const target = Array.from(document.querySelectorAll<HTMLElement>("a[href], button, input[type=button], input[type=submit], [role=button]")).find((element) => {
      const text = (element.textContent || element.getAttribute("aria-label") || element.getAttribute("value") || "").replace(/\s+/g, " ").trim().toLowerCase();
      const href = element.tagName.toLowerCase() === "a" ? (element as HTMLAnchorElement).href : undefined;
      return text === message.label.toLowerCase() && (!message.href || href === message.href);
    });
    if (!target) { sendResponse({ ok: false, error: `Entry action failed: ${message.label}` }); return true; }
    target.click();
    sendResponse({ ok: true, selected: message.label });
    return true;
  }
  if (message.type === "BA2_SELECT_CATEGORY") {
    const selected = clickSelectedCategory(message.label, message.href);
    sendResponse(selected ? { ok: true, selected: selected.label, href: selected.href } : { ok: false, error: `Category action failed: ${message.label}` });
    return true;
  }
  if (message.type === "BA2_SYNC_FROM_DASHBOARD") {
    void respondToSync().then(sendResponse);
    return true;
  }
  if (message.type === "BA2_ATTACH_PROFILE_LOGO") {
    const inputs = findLogoInputs(document);
    if (!inputs.length) return undefined;
    const bytes = assetBufferFromMessage(message.data);
    if (!bytes) { sendResponse({ ok: false, error: "Invalid logo byte message; input unchanged." }); return true; }
    void attachLogoToLiveInput(document, bytes, message.fileName, message.mimeType).then((result) => sendResponse({ ...result, diagnostics: [`Upload inputs detected: ${document.querySelectorAll('input[type="file"]').length}; using first appropriate image input`, ...result.steps] }));
    return true;
  }
  if (message.type === "BA2_ATTACH_PROFILE_BROCHURE") {
    const inputs = findBrochureInputs(document);
    if (!inputs.length) return undefined;
    const bytes = assetBufferFromMessage(message.data);
    if (!bytes) { sendResponse({ ok: false, error: "Invalid brochure byte message; input unchanged." }); return true; }
    void attachBrochureToLiveInput(document, bytes, message.fileName, message.mimeType).then((result) => sendResponse({ ...result, diagnostics: [`Attachment inputs detected: ${document.querySelectorAll('input[type="file"]').length}`, ...result.steps] }));
    return true;
  }
  if (message.type === "BA2_FIND_BROCHURE_INPUT") {
    if (!findBrochureInputs(document).length) return undefined;
    sendResponse({ ok: true });
    return true;
  }
  if (message.type === "BA2_GET_ACTIVE_PROFILE") {
    void getActiveProfile().then((profile) => {
      const response: ActiveProfileResponse = profile
        ? { ok: true, profileName: profile.businessName, syncedAt: null }
        : { ok: false, error: "No active profile synced." };
      sendResponse(response);
    }).catch(() => sendResponse({ ok: false, error: "Active profile read failed. No automation action was attempted." }));
    return true;
  }
  if (message.type === "BA2_CAPTURE_SOURCE") {
    const dashboard = isDashboardUrl(location.href);
    const challenge = !dashboard && isLikelyChallengeContent(document.title, document.body?.innerText || "");
    const snapshot = dashboard || challenge ? null : captureCurrentSource();
    const response: SourceCaptureResponse = snapshot
      ? { ok: true, snapshot }
      : { ok: false, error: dashboard ? "Website capture rejected: dashboard tab cannot be used as a source." : challenge ? "Complete website verification, then Retry Capture." : "Could not identify a rendered source page.", code: dashboard ? "wrong_source" : challenge ? "action_required" : "no_data" };
    sendResponse(response);
    return true;
  }
  if (message.type === "BA2_DELIVER_SOURCE_CAPTURE" && isDashboardOrigin()) {
    window.dispatchEvent(new CustomEvent("ba2-source-capture", { detail: message.snapshot }));
    sendResponse({ ok: true });
    return true;
  }
  if (message.type === "BA2_CAPTURE_REQUEST" && isDashboardOrigin()) {
    void chrome.runtime.sendMessage(message).then((response) => {
      window.dispatchEvent(new CustomEvent("ba2-capture-ack", { detail: { jobId: message.jobId, response } }));
      sendResponse(response);
    }).catch((error) => { window.dispatchEvent(new CustomEvent("ba2-capture-ack", { detail: { jobId: message.jobId, response: { ok: false, error: error instanceof Error ? error.message : "Extension disconnected." } } })); });
    return true;
  }
  return undefined;
};
if (!fullReceiverInstalled) {
  chrome.runtime.onMessage.addListener(fullContentListener);
  contentState.__ba2FullContentListener = fullContentListener;
}



if (!fullReceiverInstalled && isDashboardOrigin()) {
  window.addEventListener("ba2-request-capture", (event) => {
    const detail = (event as CustomEvent<{ jobId: string; sourceType: "website" | "gmb"; sourceUrl: string }>).detail;
    if (!detail?.jobId || !detail.sourceUrl) return;
    void chrome.runtime.sendMessage({ type: "BA2_CAPTURE_REQUEST", ...detail } satisfies ExtensionMessage).then((response) => {
      window.dispatchEvent(new CustomEvent("ba2-capture-ack", { detail: { jobId: detail.jobId, response } }));
    }).catch(() => {
      window.dispatchEvent(new CustomEvent("ba2-capture-ack", { detail: { jobId: detail.jobId, response: { ok: false, error: "Extension disconnected. Reload the Backlink Autofill extension, then retry capture." } } }));
    });
  });
  async function pollCaptureJob(): Promise<void> {
    const data = await chrome.storage.local.get(STORAGE_KEYS.captureJob);
    const job = normalizeCaptureJob(data[STORAGE_KEYS.captureJob]);
    if (!job) return;
    const signature = `${job.id}:${job.status}:${job.updatedAt}`;
    if (signature === lastCaptureJobSignature) return;
    lastCaptureJobSignature = signature;
    window.dispatchEvent(new CustomEvent("ba2-capture-job", { detail: job satisfies CaptureJob }));
  }
  void syncFromDashboardPage();
  void pollCaptureJob();
  window.setInterval(() => {
    void syncFromDashboardPage();
  }, DASHBOARD_SYNC_INTERVAL_MS);
  window.setInterval(() => { void pollCaptureJob(); }, CAPTURE_JOB_POLL_INTERVAL_MS);
}
