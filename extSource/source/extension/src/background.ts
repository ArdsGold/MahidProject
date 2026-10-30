import { manualAutofillFamily, currentPageAutofillOnly } from "./manual-autofill-policy";
import { isAutomationExcluded, AUTOMATION_EXCLUDED_MESSAGE } from "@backlink-autofill/shared";
import { getFamily3Adapter, isFamily3Host, isGroup1Url } from "./automation/adapters";
import { isFamily3Page, isFamily3Transition, waitForDirectoryForm } from "./family3-navigation";
import { authorizeDirectory3, claimDirectory3, digestDirectory3Material, observeDirectory3ManualSubmit, prepareDirectory3, progressDirectory3 } from "./directory3-coordinator";
import { createCaptureJob, normalizeCaptureJob, STORAGE_KEYS, type CaptureJob } from "@backlink-autofill/shared";
import { getActiveProfilePayload } from "./content/transport";
import type { ActiveProfileResponse, AmpBlogsObservationResponse, CaptureRequestAck, ExtensionMessage, ListingAutofillReport, ListingAutofillResponse, ListingRunAck, LogoAttachResponse, ProfileLogoResponse, SourceCaptureResponse } from "./messages";
import { isAllowedCaptureUrl, isDashboardUrl, matchesSourceOrigin, sourceOrigin } from "./source-target";
import { withTimeout } from "./capture-lifecycle";
import { canArchiveStoppedRun, canStartFreshLoginRun, loginGuardKey, publicationGuardKey } from './listing-run';
import { LISTING_RUN_KEY, isMissingTabError, canPrepareExistingAccountRecovery, canPrepareRegistrationRecovery, registrationRecoveryValid, canStartFreshHomepageRun, createListingRun, isGenericManualLogin, isListingRunActive, isListingRunStale, publicationProfileFingerprint, readPublicationGuard, readListingRun, updateListingRun, writeListingRun, type ListingRun } from "./listing-run";
import type { BlogWorkflowObservation, LoginCheck } from "./automation/blog-workflow";
import { getCrossDomainStructuralRecipe, getSiteCategoryMapping, getSiteFlowRecipe, normalizeCategoryKey, recordSiteFlowSuccess } from "./site-flow";
import { startAmpBlogsPreflight } from "./ampblogs-client";
import { isAmpBlogsUrl, type AmpBlogsObservation } from "./ampblogs";
import { publicArticleUrl, type ArticleExpectation, type PublicArticleCheck } from "./automation/verification";
import { BUILD_ID, TRACE_READ_ONLY, publicationTrace, traceBlocked, traceStep, traceTransport } from './publication-trace';

declare const __BA2_SHEETS_WRITE_ENABLED__: boolean;
// Production builds remain read/prepare-only. The existing write-contract
// regressions explicitly enable their intercepted, in-memory fixture build.
const SHEETS_WRITE_ENABLED = typeof __BA2_SHEETS_WRITE_ENABLED__ !== 'undefined' && __BA2_SHEETS_WRITE_ENABLED__;

const CATEGORY_ACTION_TIMEOUT_MS = 5_000;
const listingResumeLocks = new Map<string, Promise<void>>();
let listingStartQueue: Promise<void> = Promise.resolve();

chrome.runtime.onInstalled.addListener((details) => {
  console.log(`Backlink Autofill 2.0 installed (${details.reason}).`);
});

traceStep(0, 'observed', `Worker build ${BUILD_ID}; manifest ${chrome.runtime.getManifest?.().version || 'unknown'}.`);
if (!TRACE_READ_ONLY) void recoverInterruptedCaptureJob();
const startupContinuation = recoverListingRun().catch(() => traceBlocked('Startup continuation threw; no raw error or private data recorded.'));

chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
  if (message.type === 'BA2_GET_PROFILE_LOGO') {
    if (_sender.id !== chrome.runtime.id || _sender.frameId !== 0 || !_sender.tab?.id || manualAutofillFamily(_sender.url) !== 2) return;
    void (async () => {
      const payload = await getActiveProfilePayload();
      const profile = payload?.profile;
      if (!profile || profile.id !== message.profileId || profile.logoAsset?.id !== message.assetId)
        return { ok: false, error: 'Active profile logo changed. Click AUTOFILL again.' };
      return getActiveProfileLogo(profile.id, profile.logoAsset.id, profile.logoAsset.fileName);
    })().then(sendResponse).catch(() => sendResponse({ ok: false, error: 'Saved Business Logo could not be read. Update Profile remains manual.' }));
    return true;
  }
  if (message.type === 'BA2_GET_PUBLICATION_TRACE') {
    if (_sender.id !== chrome.runtime.id || _sender.url !== chrome.runtime.getURL('popup/popup.html')) { sendResponse(null); return; }
    void startupContinuation.then(() => sendResponse(publicationTrace()));
    return true;
  }
  if (TRACE_READ_ONLY && !['BA2_GET_ACTIVE_PROFILE', 'BA2_GET_LISTING_STATUS', 'BA2_INSPECT_LISTING_DISPATCH'].includes(message.type)) {
    sendResponse({ ok: false, error: 'Read-only trace build: automation, navigation and storage changes are disabled.' });
    return;
  }
  if (message.type === "BA2_D3_DIGEST") {
    void digestDirectory3Material(message.material, _sender).then(sendResponse).catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (message.type === "BA2_D3_PREPARE" || message.type === "BA2_D3_AUTHORIZE") {
    if (_sender.id !== chrome.runtime.id || _sender.tab || _sender.url !== chrome.runtime.getURL("popup/popup.html")) { sendResponse({ ok: false, reason: "Trusted popup required" }); return true; }
    const operation = message.type === "BA2_D3_PREPARE" ? prepareDirectory3(message.runId) : authorizeDirectory3(message.runId, message.digest, message.acceptTerms, message.authorize);
    void operation.then(sendResponse).catch(() => sendResponse({ ok: false, reason: "Directory3 operation blocked; inspect the current run" }));
    return true;
  }
  if (message.type === "BA2_D3_CLAIM") { void claimDirectory3(message.runId, message.intentId, _sender).then(sendResponse); return true; }
  if (message.type === "BA2_D3_MANUAL_SUBMIT") { void observeDirectory3ManualSubmit(message.runId, _sender).then(sendResponse).catch(() => sendResponse({ ok: false })); return true; }
  if (message.type === "BA2_D3_CHANGED") {
    void readListingRun().then(async run => {
      if (!run || run.id !== message.runId || run.domain !== "directory3.org" || _sender.id !== chrome.runtime.id || _sender.frameId !== 0 || _sender.tab?.id !== run.tabId || !_sender.url || new URL(_sender.url).origin !== new URL(run.sourceUrl).origin) return;
      await progressDirectory3(run.id);
    }).then(() => sendResponse({ ok: true })).catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (message.type === 'BA2_ARCHIVE_STOPPED_LISTING_RUN') {
    if (_sender.id !== chrome.runtime.id || _sender.url !== chrome.runtime.getURL('popup/popup.html')) {
      sendResponse({ ok: false, error: 'Archival requires an explicit popup action.' }); return;
    }
    void serializedListingStart(message).then(sendResponse).catch(() => sendResponse({ ok: false, error: 'Archival failed; inspect saved state before retrying.' }));
    return true;
  }
  // Separate message type: an older worker cannot mistake inspection for START.
  // Never enqueue/start/resume, observe content, or write storage on this path.
  if (message.type === 'BA2_INSPECT_LISTING_DISPATCH') {
    if (_sender.id !== chrome.runtime.id || _sender.url !== chrome.runtime.getURL('popup/popup.html')) { sendResponse(null); return; }
    void Promise.all([chrome.tabs.query({ active: true, currentWindow: true }), readListingRun()]).then(([tabs, run]) => {
      const action = message.action;
      const field = (value: unknown) => ({ present: value !== undefined, matchesSavedRun: typeof value === 'string' && Boolean(run && value === run.id) });
      const flag = (value: unknown) => typeof value === 'boolean' ? value : null;
      const origin = (value?: string) => {
        try { const url = new URL(value || ''); return /^https?:$/.test(url.protocol) ? url.origin : null; } catch { return null; }
      };
      const selectedOrigin = origin(tabs[0]?.url), savedOrigin = origin(run?.sourceUrl);
      const savedTabUnavailable = Boolean(run && (run.tabUnavailable || run.stage === 'ERROR' && isMissingTabError(run.error, run.tabId)));
      sendResponse({
        actionType: action?.type === 'BA2_START_LISTING_AUTOFILL' ? action.type : null,
        recoveryFields: { existingAccount: field(action?.existingAccountRecoveryFromRunId), registration: field(action?.registrationRecoveryFromRunId), freshHomepage: field(action?.freshFromRunId) },
        selectedTabId: typeof tabs[0]?.id === 'number' ? tabs[0].id : null,
        savedTabId: typeof run?.tabId === 'number' ? run.tabId : null,
        selectedOrigin, savedOrigin,
        sameOrigin: selectedOrigin && savedOrigin ? selectedOrigin === savedOrigin : null,
        savedTabUnavailable,
        // Snapshot of START branch ordering, not a preflight authorization or invocation.
        workerRoute: action?.type !== 'BA2_START_LISTING_AUTOFILL' ? 'unsupported-action'
          : action.continuous ? 'startContinuousListingRun:entry'
          : action.existingAccountRecoveryFromRunId !== undefined ? 'startListingRun:existing-account-recovery'
          : action.registrationRecoveryFromRunId !== undefined ? 'startListingRun:registration-recovery'
          : savedTabUnavailable ? 'startListingRun:saved-tab-unavailable' : 'startListingRun:remaining-preflight',
        authorization: { autoRegister: flag(action?.autoRegister), autoLogin: flag(action?.autoLogin), autoPublish: flag(action?.autoPublish) },
      } satisfies import('./messages').ListingDispatchInspection);
    }).catch(() => sendResponse(null));
    return true;
  }
  if (message.type === 'BA2_REGISTRATION_CHANGED') {
    void (async () => {
      const run = await readListingRun();
      if (_sender.id !== chrome.runtime.id || !run || run.id !== message.runId || !run.autoRegister || !run.registration
        || _sender.tab?.id !== run.tabId || _sender.frameId !== 0 || !_sender.url || new URL(_sender.url).origin !== new URL(run.sourceUrl).origin) return { ok: false };
      await listingResumeLocks.get(run.id);
      const latest = await readListingRun();
      if (latest?.id === run.id) await resumeListingRun(latest);
      return { ok: true };
    })().then(sendResponse).catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (message.type === "BA2_PUBLICATION_CHANGED") {
    void (async () => {
      const run = await readListingRun();
      if (_sender.id !== chrome.runtime.id || !run || run.id !== message.runId || !_sender.tab?.id
        || _sender.frameId !== 0 || !_sender.url || new URL(_sender.url).origin !== new URL(run.sourceUrl).origin
        || run.publicationSubmission?.attemptId !== message.attemptId) return { ok: false };
      if (_sender.tab.id !== run.tabId) {
        const [selected] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (selected?.id !== _sender.tab.id || selected.url !== _sender.url) return { ok: false };
      }
      await recoverPublishedArticle(run.id, _sender.tab.id, true);
      return { ok: true };
    })().then(sendResponse).catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (message.type === "BA2_LOGIN_CHANGED") {
    void (async () => {
      const run = await readListingRun();
      if (!run || run.id !== message.runId || _sender.tab?.id !== run.tabId || _sender.frameId !== 0 || !_sender.url
        || new URL(_sender.url).origin !== new URL(run.sourceUrl).origin || !run.autoLogin) return { ok: false };
      // A signal arriving during a click must be observed after that operation settles.
      await listingResumeLocks.get(run.id);
      const latest = await readListingRun();
      if (latest?.id === run.id) await resumeListingRun(latest);
      return { ok: true };
    })().then(sendResponse).catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (message.type === "BA2_GET_ACTIVE_PROFILE") {
    void getActiveProfilePayload().then((payload) => {
      const response: ActiveProfileResponse = payload
        ? { ok: true, profileName: payload.profile.businessName, syncedAt: payload.syncedAt }
        : { ok: false, error: "No active profile synced." };
      sendResponse(response);
    });
    return true;
  }
  if (message.type === "BA2_START_LISTING_AUTOFILL") {
    if (message.continuous && (_sender.id !== chrome.runtime.id
      || _sender.url !== chrome.runtime.getURL('popup/popup.html') && !(_sender.tab?.id && _sender.frameId === 0))) {
      sendResponse({ ok: false, error: 'Continuous AUTOFILL requires the MAHID popup or top-frame button.' }); return true;
    }
    if (message.autoRegister === true && (_sender.id !== chrome.runtime.id || _sender.url !== chrome.runtime.getURL('popup/popup.html'))) {
      sendResponse({ ok: false, error: 'Registration requires explicit consent from the extension popup.' }); return true;
    }
    if ((message.freshFromRunId !== undefined || message.registrationRecoveryFromRunId !== undefined || message.existingAccountRecoveryFromRunId !== undefined) && (_sender.id !== chrome.runtime.id || _sender.url !== chrome.runtime.getURL("popup/popup.html"))) {
      sendResponse({ ok: false, error: "A fresh homepage run must be explicitly started from the extension popup." }); return true;
    }
    const operation = message.continuous ? (async () => {
      const [selected] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (_sender.url !== chrome.runtime.getURL('popup/popup.html') && (_sender.tab?.id !== selected?.id || _sender.url !== selected?.url))
        return { ok: false as const, error: 'AUTOFILL source tab changed. Nothing started.' };
      return serializedListingStart(message, selected?.id, selected?.url);
    })() : serializedListingStart(message);
    void operation.then(sendResponse).catch(() => sendResponse({ ok: false, error: "Could not start Autofill. Review the saved run before retrying." } satisfies ListingRunAck));
    return true;
  }
  if (message.type === 'BA2_PUBLICATION_READY') {
    void (async () => {
      const run = await readListingRun();
      if (!run?.continuous || run.id !== message.runId || _sender.id !== chrome.runtime.id || _sender.tab?.id !== run.tabId
        || _sender.frameId !== 0 || _sender.url !== run.publicationEditorUrl || run.submissionAttempted || run.publicVerification) return { ok: false };
      await resumeListingRun(run);
      return { ok: true };
    })().then(sendResponse).catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (message.type === "BA2_START_AMPBLOGS_PREFLIGHT") {
    void startAmpBlogsPreflightFromActiveProfile().then(sendResponse).catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : "Could not start AmpBlogs preflight." }));
    return true;
  }
  if (message.type === "BA2_GET_LISTING_STATUS") {
    void readListingRun().then(sendResponse).catch(() => sendResponse(null));
    return true;
  }
  if (message.type === "BA2_RECOVER_PUBLICATION") {
    if (_sender.id !== chrome.runtime.id || _sender.url !== chrome.runtime.getURL("popup/popup.html")) { sendResponse({ ok: false }); return true; }
    void recoverPublishedArticle(message.runId, message.tabId).then(async () => {
      const saved = await readListingRun();
      sendResponse({ ok: saved?.id === message.runId && saved.publicVerification?.status === "verified" });
    })
      .catch(() => sendResponse({ ok: false, error: "Recovery could not verify the saved publication. No submission was performed." }));
    return true;
  }
  if (message.type === "BA2_SYNC_VERIFIED_LISTING") {
    if (_sender.id !== chrome.runtime.id || _sender.url !== chrome.runtime.getURL("popup/popup.html")) { sendResponse({ ok: false }); return true; }
    void readListingRun().then(async run => {
      if (run) await synchronizeVerifiedListing(run.id, true);
      sendResponse({ ok: true });
    }).catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (message.type === "BA2_CAPTURE_REQUEST") {
    void startCaptureJob(message).then((response) => sendResponse(response)).catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : "Could not start capture." } satisfies CaptureRequestAck));
    return true;
  }
  return undefined;
});

async function startAmpBlogsPreflightFromActiveProfile() {
  if (manualAutofillFamily('https://ampblogs.com/')) return { ok: false, error: 'Ampblogs navigation is manual. Open its form and use AUTOFILL.' };
  const payload = await getActiveProfilePayload();
  if (!payload) return { ok: false, error: "No active profile synced. Open the dashboard and set an Active Business Profile first." };
  return startAmpBlogsPreflight({ profileId: payload.profile.id, businessName: payload.profile.businessName });
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (TRACE_READ_ONLY) return;
  if (changeInfo.status !== "complete") return;
  void resumeCompletedListingNavigation(tabId).catch(() => undefined);
});

// Closure/replacement is evidence of tab loss, never permission to move a run.
chrome.tabs.onRemoved?.addListener(tabId => { if (!TRACE_READ_ONLY) void pauseUnavailableListingTab(tabId, "closed").catch(() => undefined); });
chrome.tabs.onReplaced?.addListener((addedTabId, removedTabId) => { if (!TRACE_READ_ONLY) void pauseUnavailableListingTab(removedTabId, "replaced", addedTabId).catch(() => undefined); });

async function pauseUnavailableListingTab(tabId: number, reason: "closed" | "replaced", replacementTabId?: number): Promise<void> {
  const run = await readListingRun();
  if (!run || run.tabId !== tabId || currentPageAutofillOnly(run.sourceUrl)) return;
  await listingResumeLocks.get(run.id);
  await markListingTabUnavailable(run, reason, replacementTabId);
  await recoverPublicationInOpenTabs(run.id);
}

async function markListingTabUnavailable(run: ListingRun, reason: "missing" | "closed" | "replaced", replacementTabId?: number): Promise<void> {
  const latest = await readListingRun();
  if (!latest || latest.id !== run.id || latest.tabId !== run.tabId || latest.tabUnavailable) return;
  // Observation-only pause: writing just the run preserves all receipts verbatim.
  await chrome.storage.local.set({ [LISTING_RUN_KEY]: updateListingRun(latest, {
    tabUnavailable: { tabId: latest.tabId, detectedAt: new Date().toISOString(), reason, ...(replacementTabId === undefined ? {} : { replacementTabId }) },
    status: "needs-human", manual: [...latest.manual, "Saved publisher tab is unavailable. Attempts and receipts are preserved; no automatic tab reassignment or resubmission."],
    steps: [...latest.steps, "Publisher tab unavailable; automation paused without retry"],
  }) });
}

async function resumeCompletedListingNavigation(tabId: number): Promise<void> {
  const pending = await readListingRun();
  if (!pending || isAutomationExcluded(pending.sourceUrl) || currentPageAutofillOnly(pending.sourceUrl)) return;
  if (pending.submissionAttempted && pending.publicationSubmission && (pending.tabId !== tabId || pending.tabUnavailable)) {
    const tab = await chrome.tabs.get(tabId).catch(() => undefined);
    if (tab?.url && new URL(tab.url).origin === new URL(pending.sourceUrl).origin) await recoverPublicationInOpenTabs(pending.id);
    return;
  }
  if (pending.tabId !== tabId || pending.tabUnavailable) return;
  // Completion can arrive before tabs.update settles. Joining that operation
  // loses the continuation; wait, then re-read instead of saving its old snapshot.
  await listingResumeLocks.get(pending.id);
  const run = await readListingRun();
  if (!run || run.id !== pending.id || run.tabId !== tabId) return;
  if (run.submissionAttempted && run.publicVerification?.status !== "verified" && run.publicVerification?.status !== "failed") {
    await recoverPublishedArticle(run.id, tabId, true);
    return;
  }
  if (isAutomationExcluded((await chrome.tabs.get(tabId)).url)) return;
  if (run.directory3) { await progressDirectory3(run.id); return; }
  if (run.nativeDirectory) { if (run.nativeDirectory.phase === "navigating") await resumeListingRun(run); return; }
  if (run.awaitingManualResume) { await resumeListingRun(run); return; }
  if (run.stage !== "NAVIGATING") return;
  await resumeListingRun(run);
}

async function serializedListingStart(message: Extract<ExtensionMessage, { type: "BA2_START_LISTING_AUTOFILL" | "BA2_ARCHIVE_STOPPED_LISTING_RUN" }>, sourceTabId?: number, sourceUrl?: string): Promise<ListingRunAck> {
  const previous = listingStartQueue;
  let release!: () => void;
  listingStartQueue = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  if (message.type === 'BA2_ARCHIVE_STOPPED_LISTING_RUN') {
    try { return await archiveStoppedListingRun(message.runId); } finally { release(); }
  }
  let selected: chrome.tabs.Tab | undefined;
  try { [selected] = await chrome.tabs.query({ active: true, currentWindow: true }); }
  catch (error) { release(); throw error; }
  if (isAutomationExcluded(selected?.url)) { release(); return { ok: false, error: AUTOMATION_EXCLUDED_MESSAGE }; }
  if (selected?.url && getFamily3Adapter(selected.url)) {
    try { return await startFamily3ListingRun(selected, release, sourceTabId, sourceUrl); } finally { release(); }
  }
  if (selected?.url && isFamily3Host(selected.url)) { release(); return { ok: false, error: "This directory URL/protocol is not verified. Use its recorded supported homepage; no blog/account workflow was started." }; }
  if (currentPageAutofillOnly(selected?.url)) {
    try {
      if (!selected?.id || !selected.url || !/^https?:$/.test(new URL(selected.url).protocol) || sourceTabId !== undefined && (sourceTabId !== selected.id || sourceUrl !== selected.url))
        return { ok: false, error: 'Current AUTOFILL tab changed. Nothing filled.' };
      let articleImage: { profileId: string; profileUpdatedAt: string; url: string } | undefined;
      if (manualAutofillFamily(selected.url) === 1) {
        const payload = await getActiveProfilePayload();
        if (!payload) return { ok: false, error: 'Select an active MAHID profile.' };
        const observation = await chrome.tabs.sendMessage(selected.id, { type: 'BA2_BLOG_OBSERVE' }, { frameId: 0 }) as BlogWorkflowObservation | undefined;
        if (observation?.stage === 'EDITOR' && !payload.profile.imageUrl?.trim() && payload.profile.logoAsset) {
          const asset = payload.profile.logoAsset;
          const logo = await getActiveProfileLogo(payload.profile.id, asset.id, asset.fileName);
          if (!logo.ok) return { ok: false, error: logo.error };
          if (!/^image\/(?:png|jpeg|gif|webp)$/i.test(logo.mimeType)) return { ok: false, error: 'Saved image format cannot be embedded safely.' };
          const bytes = new Uint8Array(logo.data instanceof ArrayBuffer ? logo.data : logo.data);
          let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
          articleImage = { profileId: payload.profile.id, profileUpdatedAt: payload.profile.updatedAt, url: 'data:' + logo.mimeType + ';base64,' + btoa(binary) };
        }
      }
      if ((await chrome.tabs.get(selected.id)).url !== selected.url) return { ok: false, error: 'Current page changed. Nothing filled.' };
      const response = await withTimeout(chrome.tabs.sendMessage(selected.id, { type: 'BA2_LISTING_AUTOFILL', articleImage } satisfies ExtensionMessage, { frameId: 0 }) as Promise<ListingAutofillResponse>, 10_000, undefined);
      if (!response?.ok) return { ok: false, error: response?.error || 'No autofill acknowledgement. Inspect the fields; nothing automatically retried.' };
      const categoryNotice = manualAutofillFamily(selected.url) !== 1 ? response.report.manual.filter(reason => reason.startsWith('Category:') || response.report.smartFallback && reason.startsWith('Credentials:')).join(' ') : '';
      if (categoryNotice) return { ok: true, runId: '', message: `${categoryNotice} ${response.report.smartFallback && !response.report.filled.length ? 'Nothing filled; complete these fields manually.' : 'Other recognized fields filled only.'} Navigate and submit manually; saved runs and receipts are unchanged.` };
      return { ok: true, runId: '', message: response.report.filled.length
        ? 'Current form filled only. Navigate and submit manually; saved runs and receipts are unchanged.'
        : 'No recognized fields on this page. Navigate to the form manually, then click AUTOFILL.' };
    } catch { return { ok: false, error: 'Current-page autofill delivery failed. Nothing automatically retried.' }; }
    finally { release(); }
  }
  if (message.continuous) {
    try { return await startContinuousListingRun(release, sourceTabId, sourceUrl); } finally { release(); }
  }
  try { return await startListingRun(message.ampBlogsAccountStatus || message.accountStatus, message.accountStatus, message.autoPublish, release, message.autoLogin, message.freshFromRunId, message.autoRegister, message.registrationRecoveryFromRunId, message.firstRegistrationConfirmed, message.existingAccountRecoveryFromRunId); }
  finally { release(); }
}

// Native directories use the same serialized START, run archive and receiver.
// They never inherit continuous-blog registration/Login/publication approvals.
async function startFamily3ListingRun(tab: chrome.tabs.Tab, releaseStart: () => void, sourceTabId?: number, sourceUrl?: string): Promise<ListingRunAck> {
  if (!tab.id || !tab.url || !isFamily3Page(tab.url)) return { ok: false, error: "Open the supported directory homepage or native submission form." };
  if (sourceTabId !== undefined && (sourceTabId !== tab.id || sourceUrl !== tab.url)) return { ok: false, error: "AUTOFILL source tab changed. Nothing started." };
  const payload = await getActiveProfilePayload();
  if (!payload) return { ok: false, error: "Select an active MAHID business profile." };
  let previous = await readListingRun();
  if (previous) {
    await Promise.allSettled([...listingResumeLocks].filter(([key]) => key === previous!.id || key.startsWith(previous!.id + ':')).map(([, operation]) => operation));
    previous = await readListingRun();
  }
  const adapter = getFamily3Adapter(tab.url)!;
  if (previous && getFamily3Adapter(previous.sourceUrl)?.config.id === adapter.config.id
    && (previous.directory3 || previous.submissionAttempted || previous.nativeDirectory?.phase === 'failed' || previous.nativeDirectory?.phase === 'filling'))
    return { ok: false, error: "The saved directory outcome is protected. No autofill or submission was retried; historical run and receipts remain unchanged." };
  if (previous?.sheetSync?.status === 'syncing') return { ok: false, error: "A recording operation is pending. Nothing replaced." };
  if (adapter.config.id === 'directory3') {
    const receipt = await chrome.storage.local.get(`ba2.directory3.profileReceipt:${payload.profile.id}`);
    if (receipt[`ba2.directory3.profileReceipt:${payload.profile.id}`]) return { ok: false, error: "Directory3 submission receipt already exists. No retry or replacement." };
  }
  const current = await chrome.tabs.get(tab.id);
  const active = await getActiveProfilePayload();
  if (current.url !== tab.url || active?.profile.id !== payload.profile.id || active.profile.updatedAt !== payload.profile.updatedAt)
    return { ok: false, error: "Directory page or profile changed before starting." };
  const run = createListingRun(tab.url, payload.profile.id, tab.id);
  run.nativeDirectory = { profileUpdatedAt: payload.profile.updatedAt, phase: 'entry' };
  run.autoPublish = false; run.autoRegister = false; run.autoLogin = false;
  await writeListingRun(run, previous || undefined);
  releaseStart();
  await resumeListingRun(run);
  return listingRunAck(run.id);
}

async function continueFamily3ListingRun(initial: ListingRun): Promise<void> {
  let run = initial;
  const adapter = getFamily3Adapter(run.sourceUrl);
  if (!adapter || !run.nativeDirectory || !['entry', 'navigating'].includes(run.nativeDirectory.phase)) return;
  try {
    const check = async () => {
      const saved = await readListingRun(), tab = await chrome.tabs.get(run.tabId), payload = await getActiveProfilePayload();
      if (saved?.id !== run.id || payload?.profile.id !== run.profileId || payload.profile.updatedAt !== run.nativeDirectory!.profileUpdatedAt
        || !tab.url || !isFamily3Page(tab.url) || getFamily3Adapter(tab.url)?.config.id !== adapter.config.id
        || new URL(tab.url).origin !== new URL(run.sourceUrl).origin) throw Error('Directory run, page or approved profile changed. Nothing retried.');
      return tab.url;
    };
    let url = await check();
    if (new URL(url).pathname === '/submit.php') await waitForDirectoryForm(run.tabId, url);
    // Persist delivery state BEFORE dispatch: a lost acknowledgement is never
    // repaired by replaying a possibly executed autofill command.
    const fill = async () => {
      await check();
      run = updateListingRun(run, { stage: 'FILLING', nativeDirectory: { ...run.nativeDirectory!, phase: 'filling' } });
      await writeListingRun(run);
      const response = await sendListingMessage(run.tabId, undefined, true);
      await check();
      if (!response?.ok) throw Error(response?.error || 'Directory autofill acknowledgement unavailable. No automatic retry.');
      return response.report;
    };
    let report = await fill();
    if (report.navigationUrl) {
      const target = report.navigationUrl;
      if (!['/', '/index.php'].includes(new URL(url).pathname) || !isFamily3Transition(url, target)
        || new URL(target).pathname !== '/submit.php'
        || !adapter.config.entryLabels.some(label => label.toLowerCase() === report.entryAction?.label.toLowerCase()))
        throw Error('Unverified directory navigation; no navigation attempted.');
      run = updateListingRun(run, { stage: 'NAVIGATING', navigationTarget: target, navigationCount: 1,
        nativeDirectory: { ...run.nativeDirectory!, phase: 'navigating' }, steps: [...run.steps, `Observed ${report.entryAction!.label} → native submission form`] });
      await writeListingRun(run);
      await chrome.tabs.update(run.tabId, { url: target });
      const landed = await waitForDirectoryForm(run.tabId, target);
      if (new URL(landed).origin !== new URL(run.sourceUrl).origin) {
        // Only this new, non-submitting directory run adopts the browser's
        // verified same-adapter HTTPS/canonical redirect. History stays intact.
        run = updateListingRun(run, { entryUrl: run.sourceUrl, sourceUrl: landed });
        await writeListingRun(run);
      }
      url = await check();
      report = await fill();
      if (report.navigationUrl) throw Error('Native submission form not reached. No further navigation attempted.');
    }
    run = updateListingRun(run, { stage: 'MANUAL_GATE', status: 'needs-human', nativeDirectory: { ...run.nativeDirectory!, phase: 'manual' },
      manual: [...report.manual, 'Navigation/autofill only. Complete CAPTCHA and final Continue/Submit manually. No Google Sheets write.'],
      steps: [...run.steps, ...report.filled.map(field => `Verified field: ${field.field}`), ...(report.adaptive?.diagnostics || [])] });
    await writeListingRun(run);
    if (!report.smartFallback && adapter.config.id === 'directory3' && report.adaptive?.stage === 'FORM') await progressDirectory3(run.id);
  } catch (error) {
    const saved = await readListingRun();
    if (saved?.id === run.id) await writeListingRun(updateListingRun(saved, { stage: 'ERROR', status: 'needs-human', nativeDirectory: { ...saved.nativeDirectory!, phase: 'failed' }, error: error instanceof Error ? error.message : 'Directory navigation/autofill failed. Nothing retried.' }));
  }
}

// Entry selection only: all navigation, claims, human gates and publication
// remain in the existing ListingRun coordinator below.
async function startContinuousListingRun(releaseStart: () => void, sourceTabId?: number, sourceUrl?: string): Promise<ListingRunAck> {
  const payload = await getActiveProfilePayload();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!payload || !tab?.id || !tab.url || new URL(tab.url).protocol !== 'https:')
    return { ok: false, error: 'Select an active MAHID profile and a supported HTTPS website.' };
  if (sourceTabId !== undefined && (sourceTabId !== tab.id || sourceUrl !== tab.url)) return { ok: false, error: 'AUTOFILL source tab changed. Nothing started.' };
  let previous = await readListingRun();
  const onCurrentWebsite = (run: ListingRun) => publicationGuardKey(run.sourceUrl, payload.profile.id) === publicationGuardKey(tab.url!, payload.profile.id);
  // Let an already-dispatched operation settle before preserving its snapshot.
  // An idle/uncertain attempt on another website does not own the current page.
  if (previous && !onCurrentWebsite(previous)) {
    const oldId = previous.id;
    await Promise.allSettled([...listingResumeLocks].filter(([key]) => key === oldId || key.startsWith(oldId + ':')).map(([, operation]) => operation));
    previous = await readListingRun();
  }
  const sameWebsite = !!previous && onCurrentWebsite(previous);
  const temporary = createListingRun(tab.url, payload.profile.id, tab.id);
  // A stopped publication owns its receipt, not every future page on this tab.
  // Observe before deciding whether this click is continuation or ordinary entry.
  let page = await readPublicationPage(temporary, { type: 'BA2_BLOG_OBSERVE' }) as BlogWorkflowObservation | undefined;
  const ordinaryEntry = (observation?: BlogWorkflowObservation) => !!observation
    && ['HOMEPAGE', 'SIGNUP', 'LOGIN', 'AUTHENTICATED_DASHBOARD', 'EDITOR'].includes(observation.stage);
  const historicalEntry = ordinaryEntry(page);
  const sameRun = previous?.tabId === tab.id && previous.profileId === payload.profile.id
    && new URL(previous.sourceUrl).origin === new URL(tab.url).origin;
  if (sameRun && previous && listingResumeLocks.has(previous.id)) {
    if (page?.stage === 'EDITOR' && previous.publicationEditorUrl && !previous.submissionAttempted && !previous.publicVerification) {
      // An automatic refresh validation may stop before filling this document.
      await listingResumeLocks.get(previous.id);
      return startContinuousListingRun(releaseStart, sourceTabId, sourceUrl);
    }
    // Coalesce concurrent clicks; a later click on an idle refreshed page fills again.
    releaseStart(); await resumeListingRun(previous); return listingRunAck(previous.id);
  }
  if (page?.stage === 'LOGIN' && isGroup1Url(tab.url)) {
    const key = `ba2.registrationGuard:${new URL(tab.url).origin}:${payload.profile.id}`;
    const receipt = (await chrome.storage.local.get(key))[key];
    const unresolved = receipt && (receipt.state !== 'confirmed' || typeof receipt.runId !== 'string')
      || sameWebsite && previous?.profileId === payload.profile.id && previous.registration?.state !== 'confirmed'
        && (previous.registration?.attemptId || previous.registration?.claimed);
    if (unresolved) {
      // Preparation is safe even though account actions remain blocked. No new
      // run, approval, claim, watcher or receipt is created by this path.
      try {
        const filled = await withTimeout(chrome.tabs.sendMessage(tab.id, { type: 'BA2_AUTOFILL', loginOnly: {
          profileId: payload.profile.id, profileUpdatedAt: payload.profile.updatedAt, url: tab.url,
        } } satisfies ExtensionMessage, { frameId: 0 }), 5_000, undefined);
        if (!filled?.ok) return { ok: false, error: filled?.error || 'Login fill acknowledgement unavailable. Registration history preserved; no automatic retry.' };
        return { ok: true, runId: previous?.id || receipt?.runId || temporary.id,
          message: 'Login fields filled only. Earlier registration remains unresolved; Sign In, registration and publication were not submitted. Saved history is preserved.' };
      } catch { return { ok: false, error: 'Login fill delivery failed. Registration history preserved; no automatic retry or submission.' }; }
    }
  }
  if (sameRun && previous?.submissionAttempted && page?.stage === 'CONFIRMATION' && previous.publicVerification) {
    if ((await readPublicationGuard(previous.sourceUrl, previous.profileId))?.runId !== previous.id
      || !page.publicationEvidence || !page.publicUrl)
      return { ok: false, error: 'Saved publication receipt or current success link is missing. Publish will not be repeated.' };
    releaseStart();
    if (previous.publicVerification.status === 'verified') {
      if (page.publicUrl !== (previous.publicationConfirmation?.visitUrl || previous.liveUrl))
        return { ok: false, error: 'Current Visit differs from the verified publication. Nothing submitted or replaced.' };
      await continueVerifiedPublication(previous.id);
    } else await recoverPublishedArticle(previous.id, tab.id);
    return listingRunAck(previous.id);
  }
  // Completing an existing publication is observation, never a fresh START.
  // A different selected success tab must verify before adopting its tab ID.
  if (!historicalEntry && previous?.submissionAttempted && previous.publicationSubmission && !sameRun
    && previous.profileId === payload.profile.id && new URL(previous.sourceUrl).origin === new URL(tab.url).origin) {
    releaseStart();
    await recoverPublishedArticle(previous.id, tab.id);
    const saved = await readListingRun();
    return saved?.id === previous.id && saved.publicVerification?.status === 'verified' && saved.tabId === tab.id
      ? listingRunAck(previous.id)
      : { ok: false, error: 'Existing publication could not be verified from this tab. No run replaced or submission repeated.' };
  }
  if (!historicalEntry && previous && sameRun && (previous.continuous || previous.submissionAttempted || previous.publicVerification)) {
    if (previous.continuous && previous.stage === 'ERROR' && !previous.submissionAttempted && !previous.login?.attemptId && !previous.registration?.attemptId)
      return { ok: false, error: 'Saved action delivery failed or is uncertain. Inspect it; this run will not be replayed.' };
    if (!await registrationRecoveryValid(previous)) return { ok: false, error: 'Saved attempt evidence changed. Nothing retried.' };
    if ((previous.submissionAttempted || previous.publicVerification) && (await readPublicationGuard(previous.sourceUrl, previous.profileId))?.runId !== previous.id)
      return { ok: false, error: 'Saved publication receipt ownership changed. No submission or replacement.' };
    releaseStart(); await resumeListingRun(previous); return listingRunAck(previous.id);
  }
  if (sameWebsite && previous) {
    // Preparation survives a document refresh, but is not a submission. A
    // stopped legacy/different-tab preparation can be archived below under this
    // fresh click; only real or ambiguous attempts must prevent replacement.
    const loginUnresolved = previous.login && previous.login.state !== 'authenticated'
      && (previous.login.attemptId || previous.login.claimed || !['waiting-captcha', 'manual'].includes(previous.login.state));
    const registrationUnresolved = previous.registration && previous.registration.state !== 'confirmed'
      && (previous.registration.attemptId || previous.registration.claimed || !['waiting-human', 'manual'].includes(previous.registration.state));
    const blockingReason = [...listingResumeLocks.keys()].some(key => key === previous.id || key.startsWith(previous.id + ':'))
      ? 'a coordinator operation is still running'
      : previous.sheetSync?.status === 'syncing' ? 'a recording operation is still pending'
      : loginUnresolved ? `Login outcome is ${previous.login!.state}; Sign In will not be replayed`
      : registrationUnresolved ? `registration outcome is ${previous.registration!.state}; registration will not be repeated`
      : !historicalEntry && previous.submissionAttempted && previous.publicVerification?.status !== 'verified'
        ? 'publication outcome is unverified; Publish will not be repeated'
      : undefined;
    if (blockingReason) return { ok: false, error: `Saved ${previous.domain} run: ${blockingReason}. Nothing retried or replaced.` };
  }
  const origin = new URL(tab.url).origin;
  const loginBase = `ba2.loginGuard:${origin}:${payload.profile.id}`;
  const registrationKey = `ba2.registrationGuard:${origin}:${payload.profile.id}`;
  const archiveKey = previous ? 'ba2.listingRunArchive:' + previous.id : '';
  const evidence = async () => {
    const data = await chrome.storage.local.get(null);
    return { logins: Object.fromEntries(Object.entries(data).filter(([key]) => key === loginBase || key.startsWith(loginBase + ':')).sort(([a], [b]) => a.localeCompare(b))),
      registration: data[registrationKey], archive: archiveKey ? data[archiveKey] : undefined,
      oldLogin: previous ? data[loginGuardKey(previous)] : undefined,
      oldRegistration: previous ? data[`ba2.registrationGuard:${new URL(previous.sourceUrl).origin}:${previous.profileId}`] : undefined,
      oldPublication: previous ? data[publicationGuardKey(previous.sourceUrl, previous.profileId)] : undefined,
      publication: await readPublicationGuard(tab.url!, payload.profile.id) };
  };
  const before = await evidence();
  if (Object.values(before.logins).some(receipt => receipt && (receipt.state !== 'authenticated' || typeof receipt.runId !== 'string')))
    return { ok: false, error: 'An earlier Login outcome is unresolved. No Login or registration replay.' };
  if (before.registration && (before.registration.state !== 'confirmed' || typeof before.registration.runId !== 'string'))
    return { ok: false, error: 'An earlier registration outcome is unresolved. No duplicate registration.' };
  if (before.publication) {
    page ??= await readPublicationPage(temporary, { type: 'BA2_BLOG_OBSERVE' }) as BlogWorkflowObservation | undefined;
    if (!ordinaryEntry(page)) return { ok: false, error: 'A publication receipt already exists. Inspect the recorded outcome; no duplicate publication.' };
    // Receipt remains immutable. Existing prepareAutoPublication checks it again
    // BEFORE creating any publication intent, after allowed navigation/filling.
  }
  if (sameWebsite && before.archive && JSON.stringify(before.archive) !== JSON.stringify(previous))
    return { ok: false, error: 'Historical archive conflicts with the saved run. Nothing replaced.' };
  if (sameWebsite && previous?.login?.attemptId && before.oldLogin?.runId !== previous.id)
    return { ok: false, error: 'Saved Login receipt ownership is missing. Nothing replaced.' };
  if (sameWebsite && (previous?.registration?.attemptId && before.oldRegistration?.runId !== previous.id
    || previous && (previous.submissionAttempted || previous.publicVerification) && before.oldPublication?.runId !== previous.id))
    return { ok: false, error: 'Saved account/publication receipt ownership is missing. Nothing replaced.' };
  page ??= await readPublicationPage(temporary, { type: 'BA2_BLOG_OBSERVE' }) as BlogWorkflowObservation | undefined;
  const supportedBlog = !!page && ['HOMEPAGE', 'SIGNUP', 'LOGIN', 'ACCOUNT_CREATED', 'AUTHENTICATED_DASHBOARD', 'EDITOR'].includes(page.stage);
  if (!page || !supportedBlog && page.stage !== 'UNSUPPORTED')
    return { ok: false, error: 'Current page is not a verified supported workflow stage. No action attempted.' };
  const knownAccount = Object.values(before.logins).some(Boolean) || !!before.registration || !!before.publication || page.registrationEvidence;
  if (page.stage === 'SIGNUP' && knownAccount && (!page.loginAction?.href || new URL(page.loginAction.href).origin !== origin))
    return { ok: false, error: 'Account creation is already recorded, but this page has no verified Login link. Registration will not be repeated.' };
  let unlock: (() => void) | undefined;
  if (previous) listingResumeLocks.set(previous.id, new Promise<void>(resolve => { unlock = resolve; }));
  const fresh = temporary;
  try {
    const authorizedAt = new Date().toISOString();
    fresh.homepageStart = true; // suppress learned shortcuts; stay on observed entry
    fresh.continuous = { loginReceiptsSnapshot: JSON.stringify(before.logins), registrationReceiptSnapshot: JSON.stringify(before.registration ?? null) };
    fresh.autoRegister = supportedBlog && !knownAccount && (page.stage === 'HOMEPAGE' || page.stage === 'SIGNUP');
    fresh.accountStatus = fresh.autoRegister ? 'new' : 'existing';
    fresh.autoLogin = supportedBlog; fresh.autoPublish = supportedBlog;
    if (supportedBlog) {
      fresh.loginApproval = { authorizedAt, profileUpdatedAt: payload.profile.updatedAt };
      fresh.publicationApproval = { authorizedAt, profileFingerprint: await publicationProfileFingerprint(payload.profile) };
    }
    if (fresh.autoRegister) fresh.registrationApproval = { authorizedAt, profileUpdatedAt: payload.profile.updatedAt };
    const finalPage = await readPublicationPage(temporary, { type: 'BA2_BLOG_OBSERVE' }) as BlogWorkflowObservation | undefined;
    const finalProfile = await getActiveProfilePayload();
    const [finalTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (finalPage?.stage !== page.stage || finalTab?.id !== tab.id || finalTab.url !== tab.url
      || finalProfile?.profile.id !== payload.profile.id || finalProfile.profile.updatedAt !== payload.profile.updatedAt
      || JSON.stringify(await readListingRun()) !== JSON.stringify(previous) || JSON.stringify(await evidence()) !== JSON.stringify(before))
      return { ok: false, error: 'Page, profile, run or receipts changed. Nothing replaced or submitted.' };
    await writeListingRun(fresh, previous || undefined);
  } finally { if (previous) { listingResumeLocks.delete(previous.id); unlock?.(); } }
  try { await ensureListingReceiver(fresh.tabId); }
  catch { await writeListingRun(updateListingRun(fresh, { stage: 'ERROR', error: 'Full receiver unavailable before any account action. No action retried.' })); return listingRunAck(fresh.id); }
  const operation = resumeListingRun(fresh);
  releaseStart();
  await operation;
  return listingRunAck(fresh.id);
}

async function archiveStoppedListingRun(runId: string): Promise<ListingRunAck> {
  const stopped = await readListingRun();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!stopped || stopped.id !== runId || !tab?.url || !canArchiveStoppedRun(stopped, tab.url)
    || [...listingResumeLocks.keys()].some(key => key === runId || key.startsWith(runId + ':')))
    return { ok: false, error: 'Archive requires an idle stopped run and a different website homepage. Nothing changed.' };
  const selectedTabId = tab.id, selectedUrl = tab.url;
  const runSnapshot = JSON.stringify(stopped);
  let unlock!: () => void;
  listingResumeLocks.set(runId, new Promise<void>(resolve => { unlock = resolve; }));
  try {
    const archiveKey = 'ba2.listingRunArchive:' + runId;
    const loginKey = loginGuardKey(stopped), registrationKey = `ba2.registrationGuard:${new URL(stopped.sourceUrl).origin}:${stopped.profileId}`;
    const evidence = async () => ({
      archive: (await chrome.storage.local.get(archiveKey))[archiveKey],
      login: (await chrome.storage.local.get(loginKey))[loginKey],
      registration: (await chrome.storage.local.get(registrationKey))[registrationKey],
      publication: await readPublicationGuard(stopped.sourceUrl, stopped.profileId),
    });
    const before = await evidence();
    if (before.archive && JSON.stringify(before.archive) !== JSON.stringify(stopped)
      || stopped.login?.attemptId && before.login?.runId !== runId
      || stopped.registration?.attemptId && before.registration?.runId !== runId
      || (stopped.submissionAttempted || stopped.publicationSubmission || stopped.publicVerification) && before.publication?.runId !== runId)
      return { ok: false, error: 'Saved history conflicts or an attempt receipt is missing. Nothing changed.' };
    const [finalTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (JSON.stringify(await readListingRun()) !== runSnapshot || finalTab?.id !== selectedTabId || finalTab?.url !== selectedUrl
      || JSON.stringify(await evidence()) !== JSON.stringify(before))
      return { ok: false, error: 'Saved run, homepage or receipts changed during archival. Nothing changed.' };
    // One existing archive write, no receipt regeneration and no coordinator continuation.
    await writeListingRun(null, stopped);
    return { ok: true, runId: stopped.id };
  } finally { listingResumeLocks.delete(runId); unlock(); }
}

async function startListingRun(ampBlogsAccountStatus: "existing" | "new" = "existing", accountStatus: "existing" | "new" = "existing", autoPublish?: boolean, releaseStart = () => {}, autoLogin?: boolean, freshFromRunId?: string, autoRegister?: boolean, registrationRecoveryFromRunId?: string, firstRegistrationConfirmed?: boolean, existingAccountRecoveryFromRunId?: string): Promise<ListingRunAck> {
  const payload = await getActiveProfilePayload();
  if (!payload) return { ok: false, error: "No active profile. Open the dashboard and set an Active Profile before using AUTOFILL." };
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url || !/^https?:$/i.test(new URL(tab.url).protocol)) return { ok: false, error: "Autofill is unavailable on this page." };
  let previous = await readListingRun();
  if (existingAccountRecoveryFromRunId !== undefined) {
    if (!previous || previous.id !== existingAccountRecoveryFromRunId || previous.profileId !== payload.profile.id
      || !canPrepareExistingAccountRecovery(previous, tab.url) || autoLogin !== true || autoRegister !== false || autoPublish !== false
      || accountStatus !== 'existing' || ampBlogsAccountStatus !== 'existing' || registrationRecoveryFromRunId !== undefined || freshFromRunId !== undefined)
      return { ok: false, error: 'Existing-account recovery requires the detached unattempted run, same profile/site, fresh Login consent, and Registration/Publish OFF.' };
    if (listingResumeLocks.has(previous.id) || listingResumeLocks.has(previous.id + ':sheets')) return { ok: false, error: 'Saved run is busy; recovery is blocked.' };
    const archived = previous;
    let unlock!: () => void;
    listingResumeLocks.set(archived.id, new Promise<void>(resolve => { unlock = resolve; }));
    let fresh: ListingRun;
    const oldTabMissing = async () => {
      try { await chrome.tabs.get(archived.tabId); return false; }
      catch (error) { if (isMissingTabError(error, archived.tabId)) return true; throw error; }
    };
    try {
      if (!await oldTabMissing()) return { ok: false, error: 'Original tab still exists. Existing-account recovery will not replace it.' };
      const base = `ba2.loginGuard:${new URL(tab.url).origin}:${payload.profile.id}`;
      const registrationKey = `ba2.registrationGuard:${new URL(tab.url).origin}:${payload.profile.id}`;
      const priorLogin = (await chrome.storage.local.get(base))[base];
      const priorRegistration = (await chrome.storage.local.get(registrationKey))[registrationKey];
      const archiveKey = 'ba2.listingRunArchive:' + archived.id;
      const existingArchive = (await chrome.storage.local.get(archiveKey))[archiveKey];
      if (priorLogin != null && (priorLogin.state !== 'authenticated' || typeof priorLogin.runId !== 'string')
        || priorRegistration != null && (priorRegistration.state !== 'confirmed' || typeof priorRegistration.runId !== 'string')
        || await readPublicationGuard(tab.url, payload.profile.id)
        || existingArchive && JSON.stringify(existingArchive) !== JSON.stringify(archived))
        return { ok: false, error: 'Existing account has unresolved or conflicting receipts/history. Nothing replaced.' };
      const loginSnapshot = JSON.stringify(priorLogin ?? null);
      const registrationSnapshot = JSON.stringify(priorRegistration ?? null);
      const page = await withTimeout(chrome.tabs.sendMessage(tab.id, { type: 'BA2_BLOG_OBSERVE' } satisfies ExtensionMessage, { frameId: 0 }) as Promise<BlogWorkflowObservation>, 3_000, undefined);
      if (page?.stage !== 'LOGIN') return { ok: false, error: 'Existing-account recovery requires the observed Login page. No login attempted.' };
      fresh = createListingRun(tab.url, payload.profile.id, tab.id);
      const authorizedAt = new Date().toISOString();
      fresh.autoRegister = false; fresh.autoPublish = false; fresh.autoLogin = true;
      fresh.loginApproval = { authorizedAt, profileUpdatedAt: payload.profile.updatedAt };
      fresh.existingAccountRecovery = { oldRunId: archived.id, loginGuardSnapshot: loginSnapshot, registrationGuardSnapshot: registrationSnapshot, authorizedAt };
      const finalPage = await withTimeout(chrome.tabs.sendMessage(tab.id, { type: 'BA2_BLOG_OBSERVE' } satisfies ExtensionMessage, { frameId: 0 }) as Promise<BlogWorkflowObservation>, 3_000, undefined);
      const finalProfile = await getActiveProfilePayload();
      if (finalPage?.stage !== 'LOGIN' || (await chrome.tabs.get(tab.id)).url !== tab.url || !await oldTabMissing()
        || JSON.stringify(await readListingRun()) !== JSON.stringify(archived)
        || JSON.stringify((await chrome.storage.local.get(archiveKey))[archiveKey]) !== JSON.stringify(existingArchive)
        || finalProfile?.profile.id !== payload.profile.id || finalProfile.profile.updatedAt !== payload.profile.updatedAt
        || JSON.stringify((await chrome.storage.local.get(base))[base] ?? null) !== loginSnapshot
        || JSON.stringify((await chrome.storage.local.get(registrationKey))[registrationKey] ?? null) !== registrationSnapshot
        || await readPublicationGuard(tab.url, payload.profile.id))
        return { ok: false, error: 'Page, profile, run or receipts changed. Nothing replaced.' };
      await writeListingRun(fresh, archived);
    } finally { listingResumeLocks.delete(archived.id); unlock(); }
    releaseStart(); await resumeListingRun(fresh!); return listingRunAck(fresh!.id);
  }
  if (registrationRecoveryFromRunId !== undefined) {
    if (!previous || previous.id !== registrationRecoveryFromRunId || previous.profileId !== payload.profile.id
      || !canPrepareRegistrationRecovery(previous, tab.url) || autoRegister !== true || firstRegistrationConfirmed !== true
      || typeof autoLogin !== "boolean" || typeof autoPublish !== "boolean" || freshFromRunId !== undefined)
        return { ok: false, error: "Recovery requires the stopped uncertain Login run, same profile/site, first-registration confirmation and fresh separate authorization choices." };
    if (listingResumeLocks.has(previous.id) || listingResumeLocks.has(previous.id + ':sheets')) return { ok: false, error: "Saved run is busy; recovery is blocked." };
    let unlock!: () => void;
    const archived = previous;
    listingResumeLocks.set(archived.id, new Promise<void>(resolve => { unlock = resolve; }));
    let fresh: ListingRun;
    const oldTabMissing = async () => {
      try { await chrome.tabs.get(archived.tabId); return false; }
      catch (error) { if (isMissingTabError(error, archived.tabId)) return true; throw error; }
    };
    try {
      if ((archived.tabId !== tab.id || archived.tabUnavailable) && !await oldTabMissing())
        return { ok: false, error: "Original tab still exists. Recovery will not move the run or bypass an active attempt." };
      const key = `ba2.loginGuard:${new URL(tab.url).origin}:${payload.profile.id}`;
      const receipt = (await chrome.storage.local.get(key))[key];
      const registrationKey = `ba2.registrationGuard:${new URL(tab.url).origin}:${payload.profile.id}`;
      const archiveKey = 'ba2.listingRunArchive:' + archived.id;
      const existingArchive = (await chrome.storage.local.get(archiveKey))[archiveKey];
      if (receipt?.runId !== archived.id || receipt.state !== 'uncertain'
        || (await chrome.storage.local.get(registrationKey))[registrationKey] || await readPublicationGuard(tab.url, payload.profile.id)
        || existingArchive && JSON.stringify(existingArchive) !== JSON.stringify(archived))
        return { ok: false, error: "Recovery receipts/history are missing, changed or conflicting. Nothing replaced." };
      const snapshot = JSON.stringify(receipt);
      const page = await withTimeout(chrome.tabs.sendMessage(tab.id, { type: 'BA2_BLOG_OBSERVE' } satisfies ExtensionMessage, { frameId: 0 }) as Promise<BlogWorkflowObservation>, 3_000, undefined);
      const signupHref = page?.stage === 'HOMEPAGE' ? page.signupAction?.href : undefined;
      const safeHomepage = signupHref && new URL(signupHref).protocol === 'https:' && new URL(signupHref).origin === new URL(tab.url).origin;
      if (page?.stage !== 'SIGNUP' && !safeHomepage) return { ok: false, error: "Recovery requires observed SIGNUP or a homepage with a safe same-origin Sign Up link; no account action attempted." };
      fresh = createListingRun(new URL(tab.url).origin + '/', payload.profile.id, tab.id, 'new', 'new');
      const authorizedAt = new Date().toISOString();
      fresh.homepageStart = true; fresh.autoRegister = true; fresh.autoLogin = autoLogin; fresh.autoPublish = autoPublish;
      fresh.registrationApproval = { authorizedAt, profileUpdatedAt: payload.profile.updatedAt };
      fresh.registrationRecovery = { oldRunId: archived.id, oldLoginAttemptId: archived.login!.attemptId!, guardSnapshot: snapshot, authorizedAt, firstRegistrationConfirmed: true };
      if (autoLogin) fresh.loginApproval = { authorizedAt, profileUpdatedAt: payload.profile.updatedAt };
      if (autoPublish) fresh.publicationApproval = { authorizedAt, profileFingerprint: await publicationProfileFingerprint(payload.profile) };
      const latestProfile = await getActiveProfilePayload();
      if (JSON.stringify(await readListingRun()) !== JSON.stringify(archived) || (await chrome.tabs.get(tab.id)).url !== tab.url
        || latestProfile?.profile.id !== payload.profile.id || latestProfile.profile.updatedAt !== payload.profile.updatedAt
        || JSON.stringify((await chrome.storage.local.get(key))[key]) !== snapshot
        || (await chrome.storage.local.get(registrationKey))[registrationKey] || await readPublicationGuard(tab.url, payload.profile.id))
        return { ok: false, error: "Page/profile/run/receipts changed during recovery. Nothing replaced." };
      if ((archived.tabId !== tab.id || archived.tabUnavailable) && !await oldTabMissing())
        return { ok: false, error: "Original tab reappeared during preparation. Nothing replaced." };
      await writeListingRun(fresh, archived);
    } finally { listingResumeLocks.delete(archived.id); unlock(); }
    releaseStart(); await resumeListingRun(fresh!); return listingRunAck(fresh!.id);
  }
  if (previous && (previous.tabUnavailable || previous.stage === "ERROR" && isMissingTabError(previous.error, previous.tabId))) return { ok: false, error: "Saved tab is unavailable. Inspect the saved attempt and use an eligible explicit recovery; automatic tab replacement is blocked." };
  if (freshFromRunId !== undefined) {
    if (autoRegister) return { ok: false, error: 'Registration cannot replace a saved run through fresh-start preparation.' };
    const homepageEntry = canStartFreshHomepageRun(previous, tab.url);
    const loginEntry = !homepageEntry && canStartFreshLoginRun(previous, tab.url);
    if (previous?.id !== freshFromRunId || !(homepageEntry || loginEntry) || previous.profileId !== payload.profile.id
      || typeof autoPublish !== "boolean" || typeof autoLogin !== "boolean" || accountStatus !== "existing" || ampBlogsAccountStatus !== "existing") {
      return { ok: false, error: "Fresh start requires the saved unsubmitted stopped run, the same active profile, the homepage or verified Login page, and fresh authorization choices." };
    }
    if (listingResumeLocks.has(previous.id)) return { ok: false, error: "The saved run is busy. Wait for it to stop before preparing a fresh start." };
    // Hold the existing run lock while archiving so late navigation/login signals cannot resume it.
    let unlock!: () => void;
    listingResumeLocks.set(previous.id, new Promise<void>(resolve => { unlock = resolve; }));
    const archived = previous;
    let fresh: ListingRun;
    try {
      if (loginEntry) {
        if (previous.tabId !== tab.id) return { ok: false, error: 'Fresh Login start cannot replace the saved tab.' };
        const page = await readPublicationPage(previous, { type: 'BA2_BLOG_OBSERVE' }) as BlogWorkflowObservation | undefined;
        if (!autoLogin || page?.stage !== 'LOGIN') return { ok: false, error: 'Fresh Login start requires fresh Auto Login consent and the observed Login page.' };
      }
      // Check receipts even with Auto Publish OFF; a fresh start must never hide an uncertain attempt.
      if (await readPublicationGuard(tab.url, payload.profile.id)) return { ok: false, error: "A publication receipt exists. Inspect existing posts/public URL; fresh publication is blocked." };
      const loginKey = `ba2.loginGuard:${new URL(tab.url).origin}:${payload.profile.id}`;
      const receipt = (await chrome.storage.local.get(loginKey))[loginKey] as { state?: string } | undefined;
      if (receipt && receipt.state !== "authenticated") return { ok: false, error: "An earlier login attempt requires manual inspection; fresh start is blocked." };
      const archiveKey = 'ba2.listingRunArchive:' + previous.id;
      const existingArchive = loginEntry ? (await chrome.storage.local.get(archiveKey))[archiveKey] : undefined;
      const registrationKey = `ba2.registrationGuard:${new URL(tab.url).origin}:${payload.profile.id}`;
      const registrationReceipt = loginEntry ? (await chrome.storage.local.get(registrationKey))[registrationKey] : undefined;
      if (loginEntry && (receipt || existingArchive && JSON.stringify(existingArchive) !== JSON.stringify(previous)))
        return { ok: false, error: 'Existing Login receipt or conflicting archive requires inspection. Nothing replaced.' };
      if (loginEntry && registrationReceipt && registrationReceipt.state !== 'confirmed')
        return { ok: false, error: 'Registration outcome requires inspection. Nothing replaced.' };
      fresh = createListingRun(tab.url, payload.profile.id, tab.id);
      fresh.homepageStart = true;
      fresh.autoLogin = autoLogin;
      fresh.autoPublish = autoPublish;
      if (autoLogin) fresh.loginApproval = { authorizedAt: new Date().toISOString(), profileUpdatedAt: payload.profile.updatedAt };
      if (autoPublish) fresh.publicationApproval = { authorizedAt: new Date().toISOString(), profileFingerprint: await publicationProfileFingerprint(payload.profile) };
      if (loginEntry) {
        const page = await readPublicationPage(previous, { type: 'BA2_BLOG_OBSERVE' }) as BlogWorkflowObservation | undefined;
        const finalProfile = await getActiveProfilePayload();
        if (page?.stage !== 'LOGIN' || finalProfile?.profile.id !== payload.profile.id || finalProfile.profile.updatedAt !== payload.profile.updatedAt
          || (await chrome.storage.local.get(loginKey))[loginKey] || await readPublicationGuard(tab.url, payload.profile.id)
          || JSON.stringify((await chrome.storage.local.get(registrationKey))[registrationKey]) !== JSON.stringify(registrationReceipt)
          || JSON.stringify((await chrome.storage.local.get(archiveKey))[archiveKey]) !== JSON.stringify(existingArchive))
          return { ok: false, error: 'Login page/profile/receipts/history changed. Nothing replaced.' };
      }
      const latest = await readListingRun();
      const actualTab = await chrome.tabs.get(tab.id);
      if (!latest || JSON.stringify(latest) !== JSON.stringify(archived) || actualTab.url !== tab.url) {
        return { ok: false, error: "Saved run or page changed during preparation. Nothing was replaced; inspect it again." };
      }
      await writeListingRun(fresh, archived);
    } finally { listingResumeLocks.delete(archived.id); unlock(); }
    releaseStart();
    await resumeListingRun(fresh);
    return listingRunAck(fresh.id);
  }
  if (previous?.tabId === tab.id && !previous.awaitingManualResume && !previous.awaitingManualLogin
    && canStartFreshLoginRun(previous, tab.url)) {
    const page = await readPublicationPage(previous, { type: 'BA2_BLOG_OBSERVE' }) as BlogWorkflowObservation | undefined;
    if (page?.stage === 'LOGIN') return { ok: false, error: 'Prepare a fresh Login run with fresh authorization; the stopped run must be archived, not replaced.' };
  }
  // Missing authorization on a continuation retains this run's choice; new runs default OFF.
  const sameOrigin = Boolean(previous && new URL(previous.sourceUrl).origin === new URL(tab.url).origin);
  const continuing = previous?.tabId === tab.id && sameOrigin && (isListingRunActive(previous) || previous.awaitingManualResume || previous.registration || previous.autoRegister || previous.login?.attemptId && previous.login.state !== "authenticated");
  const requestedAutoLogin = autoLogin === undefined && continuing ? previous?.autoLogin === true : autoLogin === true;
  const requestedAutoRegister = autoRegister === undefined && continuing ? previous?.autoRegister === true : autoRegister === true;
  if (previous?.registrationRecovery && !await registrationRecoveryValid(previous)) return { ok: false, error: "Recovery history/receipt changed; continuation blocked." };
  if (requestedAutoRegister) {
    // A different tab or Auto Login OFF must not hide an unresolved account attempt.
    // Homepage/absent authentication evidence does not establish a failed login.
    const key = `ba2.loginGuard:${new URL(tab.url).origin}:${payload.profile.id}`;
    const receipt = (await chrome.storage.local.get(key))[key] as { state?: string } | undefined;
    if (!(continuing && previous?.registrationRecovery) && (receipt && receipt.state !== "authenticated"
      || sameOrigin && previous?.profileId === payload.profile.id && previous.login?.attemptId && previous.login.state !== "authenticated")) {
      return { ok: false, error: "An earlier login outcome is unresolved. Inspect the existing account before authorizing registration; the saved run and login receipt are preserved." };
    }
  }
  if (continuing && requestedAutoRegister !== Boolean(previous?.autoRegister)) return { ok: false, error: 'Registration consent is locked for the saved run; it cannot be added during continuation.' };
  if (requestedAutoRegister) { accountStatus = 'new'; ampBlogsAccountStatus = 'new'; }
  if (requestedAutoLogin && !requestedAutoRegister && (accountStatus === "new" || ampBlogsAccountStatus === "new")) return { ok: false, error: "Auto Login authorizes an existing account only. Registration remains manual." };
  if (continuing && requestedAutoLogin !== (previous?.autoLogin === true)) return { ok: false, error: "Auto Login authorization is locked for this run. It cannot be added by continuing a run." };
  if (previous?.tabId === tab.id && sameOrigin && previous.login?.attemptId && previous.login.state !== "authenticated") {
    releaseStart();
    await resumeListingRun(previous);
    return listingRunAck(previous.id);
  }
  if (!previous?.autoLogin && previous?.tabId === tab.id && sameOrigin && isGenericManualLogin(previous) && !isListingRunStale(previous)) {
    previous = updateListingRun(previous, { awaitingManualLogin: true, awaitingManualResume: true });
    await writeListingRun(previous);
  }
  const requestedAutoPublish = autoPublish === undefined && previous?.tabId === tab.id && sameOrigin && (isListingRunActive(previous) || previous.awaitingManualResume)
    ? previous.autoPublish === true : autoPublish === true;
  if (continuing && previous?.autoRegister) {
    if (autoPublish !== undefined && autoPublish !== Boolean(previous.autoPublish)) return { ok: false, error: 'Auto Publish consent is locked for the registration run.' };
    releaseStart(); await resumeListingRun(previous); return listingRunAck(previous.id);
  }
  if (previous?.tabId === tab.id && previous.submissionAttempted && (sameOrigin || tab.url === previous.publicVerification?.candidateUrl)) {
    releaseStart();
    await resumeListingRun(previous);
    return listingRunAck(previous.id);
  }
  // A publication check is observational. Repeated starts must never refill or republish.
  if (previous?.tabId === tab.id && previous.publicVerification
    && [previous.publicVerification.confirmationUrl, previous.publicVerification.candidateUrl].includes(tab.url)) return listingRunAck(previous.id);
  const previousAccountStatus = previous?.ampBlogsAccountStatus || "existing";
  const sameAmpBlogsAccountStatus = previousAccountStatus === ampBlogsAccountStatus;
  const sameAutoPublish = Boolean(previous?.autoPublish) === requestedAutoPublish;
  if (previous?.tabId === tab.id && sameOrigin && (isListingRunActive(previous) || previous.awaitingManualResume) && !sameAutoPublish) {
    return { ok: false, error: "An existing ListingRun already has a different Auto Publish authorization. Finish or reset it before starting another run." };
  }
  if (previous?.domain === "ampblogs.com" && !sameAmpBlogsAccountStatus && (isListingRunActive(previous) || previous.awaitingManualResume)) {
    return { ok: false, error: "An AmpBlogs run is already active with a different account status. Finish or reset it before choosing another path." };
  }
  if (previous?.tabId === tab.id && sameOrigin && sameAmpBlogsAccountStatus && sameAutoPublish && previous.awaitingManualResume && !isListingRunStale(previous)) {
    releaseStart();
    if (previous.awaitingAmpBlogsLoginAuthorization) {
      await authorizeAmpBlogsLogin(previous);
    } else {
      await resumeListingRun(previous);
    }
    return listingRunAck(previous.id);
  }
  if (requestedAutoPublish && await readPublicationGuard(tab.url, payload.profile.id)) {
    return { ok: false, error: "This business already has a publication attempt or confirmation on this publisher. Inspect the existing posts/public URL; automatic duplicate publication is blocked." };
  }
  if (previous && isListingRunActive(previous)) {
    if (requestedAutoRegister && (previous.tabId !== tab.id || !sameOrigin)) return { ok: false, error: 'Another saved run is active. Registration will not replace it.' };
    if (previous.tabId === tab.id && sameOrigin && sameAmpBlogsAccountStatus && sameAutoPublish && !isListingRunStale(previous)) {
      releaseStart();
      await resumeListingRun(previous);
      return listingRunAck(previous.id);
    }
    await writeListingRun(updateListingRun(previous, { stage: "ERROR", status: "failed", error: isListingRunStale(previous) ? "Previous listing run was stale" : "Previous listing run replaced by a new tab run", steps: [...previous.steps, "Previous run safely replaced"] }));
  }
  const run = createListingRun(tab.url, payload.profile.id, tab.id, ampBlogsAccountStatus, accountStatus);
  // Inspect homepage evidence before any learned editor-entry shortcut.
  if (new URL(tab.url).pathname === "/") run.homepageStart = true;
  if (requestedAutoRegister) {
    if (previous && (listingResumeLocks.has(previous.id) || listingResumeLocks.has(`${previous.id}:sheets`) || previous.sheetSync?.status === 'syncing'))
      return { ok: false, error: 'Saved run is busy. Registration will not replace or archive it during an operation.' };
    const guardKey = `ba2.registrationGuard:${new URL(tab.url).origin}:${payload.profile.id}`;
    if ((await chrome.storage.local.get(guardKey))[guardKey] || await readPublicationGuard(tab.url, payload.profile.id))
      return { ok: false, error: 'A registration or publication receipt exists. Inspect the existing account; no duplicate registration.' };
    run.autoRegister = true;
    run.homepageStart = true;
    run.registrationApproval = { authorizedAt: new Date().toISOString(), profileUpdatedAt: payload.profile.updatedAt };
  }
  if (requestedAutoLogin) {
    const key = `ba2.loginGuard:${new URL(tab.url).origin}:${payload.profile.id}`;
    const receipt = (await chrome.storage.local.get(key))[key] as { state?: string } | undefined;
    if (receipt && receipt.state !== "authenticated") return { ok: false, error: "An earlier login submission requires manual inspection. Automatic login retry is blocked." };
  }
  run.autoLogin = requestedAutoLogin;
  if (requestedAutoLogin) run.loginApproval = { authorizedAt: new Date().toISOString(), profileUpdatedAt: payload.profile.updatedAt };
  run.autoPublish = requestedAutoPublish;
  if (requestedAutoPublish) run.publicationApproval = { authorizedAt: new Date().toISOString(), profileFingerprint: await publicationProfileFingerprint(payload.profile) };
  if (requestedAutoRegister && JSON.stringify(await readListingRun()) !== JSON.stringify(previous))
    return { ok: false, error: 'Saved run changed during registration preparation. Nothing was replaced.' };
  await writeListingRun(run, requestedAutoRegister ? previous || undefined : undefined);
  releaseStart();
  await resumeListingRun(run);
  return listingRunAck(run.id);
}

function resumeListingRun(run: ListingRun): Promise<void> {
  if (currentPageAutofillOnly(run.sourceUrl)) return Promise.resolve();
  const existing = listingResumeLocks.get(run.id);
  if (existing) return existing;
  const operation = continueListingRun(run).finally(() => listingResumeLocks.delete(run.id));
  listingResumeLocks.set(run.id, operation);
  return operation;
}

async function listingRunAck(runId: string): Promise<ListingRunAck> {
  const run = await readListingRun();
  if (run?.id === runId && (run.stage === "ERROR" || run.awaitingAmpBlogsLoginAuthorization && run.error)) {
    return { ok: false, error: run.error || "Autofill failed to start." };
  }
  return {
    ok: true,
    runId,
    message: run?.manual?.[0] || run?.steps.at(-1),
    requiresAuthorization: Boolean(run?.awaitingAmpBlogsLoginAuthorization),
  };
}

async function sendListingMessage(tabId: number, categoryMapping?: { profileKey: string; value: string; label: string }, topFrame = false): Promise<ListingAutofillResponse> {
  try { await ensureListingReceiver(tabId); }
  catch { return { ok: false, error: 'Full autofill receiver is unavailable. No autofill request was sent; inspect the saved run.' }; }
  const message: ExtensionMessage = { type: "BA2_LISTING_AUTOFILL", categoryMapping };
  // Receiver repair is read-only and happens before dispatch. Once sent, an
  // empty OR rejected acknowledgement cannot establish that no fill occurred.
  try {
    const response = await chrome.tabs.sendMessage(tabId, message, topFrame ? { frameId: 0 } : {}) as ListingAutofillResponse | undefined;
    return response || { ok: false, error: "Listing autofill returned no response. Inspect the saved run; no automatic retry." };
  } catch {
    return { ok: false, error: "Listing autofill acknowledgement failed. The action may have executed. Inspect the saved run; no automatic retry." };
  }
}

// Observation-only recovery does not install action handlers. Check this
// existing read-only contract BEFORE dispatching any possibly mutating fill.
async function ensureListingReceiver(tabId: number): Promise<void> {
  const run = await readListingRun(), tab = await chrome.tabs.get(tabId);
  if (!run || run.tabId !== tabId || !tab.url || new URL(tab.url).origin !== new URL(run.sourceUrl).origin) throw Error('Publisher changed');
  const runSnapshot = JSON.stringify(run), pageUrl = tab.url;
  const unchanged = async () => JSON.stringify(await readListingRun()) === runSnapshot && (await chrome.tabs.get(tabId)).url === pageUrl;
  const ready = async () => {
    const timeout = Symbol('timeout');
    const reply = await withTimeout(chrome.tabs.sendMessage(tabId, { type: 'BA2_GET_ACTIVE_PROFILE' } satisfies ExtensionMessage, { frameId: 0 }) as Promise<unknown>, 3_000, timeout);
    if (reply === timeout) throw Error('Receiver status timed out');
    if (reply == null) return false;
    const status = reply as Partial<ActiveProfileResponse>;
    if (typeof status !== 'object' || !(status.ok === true && typeof status.profileName === 'string' && (status.syncedAt === null || typeof status.syncedAt === 'string')
      || status.ok === false && typeof status.error === 'string')) throw Error('Invalid receiver status');
    return true;
  };
  let installed: boolean;
  try { installed = await ready(); }
  catch (error) { if (!String(error).includes('Receiving end does not exist')) throw error; installed = false; }
  if (!installed) {
    if (run.submissionAttempted || run.registration?.attemptId && run.registration.state !== 'confirmed'
      || run.login?.attemptId && run.login.state !== 'authenticated') throw Error('Unresolved attempt; no receiver reinjection');
    if (!await unchanged()) throw Error('Publisher changed');
    await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, files: ['content/content.js'] });
    if (!await unchanged() || !await ready()) throw Error('Receiver repair unconfirmed');
  }
  if (!await unchanged()) throw Error('Publisher changed');
}

async function sendBlogPublishMessage(run: ListingRun): Promise<{ ok: boolean; error?: string }> {
  try {
    // Versioned command cannot activate a stale, unguarded BA2_BLOG_PUBLISH listener.
    return await withTimeout(chrome.tabs.sendMessage(run.tabId, { type: "BA2_BLOG_PUBLISH_ONCE", runId: run.id, attemptId: run.publicationSubmission!.attemptId } satisfies ExtensionMessage, { frameId: 0 }), 5_000,
      { ok: false, error: "Publication response timed out. Inspect existing posts/public URL; no automatic retry." });
  } catch {
    return { ok: false, error: "Publication delivery is uncertain. Inspect existing posts/public URL; no automatic retry." };
  }
}

async function observePublicationOutcome(run: ListingRun, deliveryError?: string): Promise<void> {
  const current = await readListingRun();
  if (!current || current.id !== run.id || current.publicVerification || !current.submissionAttempted) return;
  // Short, bounded observation also covers same-document/AJAX confirmation. Only reads
  // repeat here; the persisted publication command is never dispatched again.
  for (let observation = 0; observation < 3; observation += 1) {
    const saved = await readListingRun();
    if (!saved || saved.id !== current.id || saved.publicVerification) return;
    try {
      const tab = await chrome.tabs.get(current.tabId);
      if (!tab.url || new URL(tab.url).origin !== new URL(current.sourceUrl).origin) break;
      const workflow = await readPublicationPage(current, { type: "BA2_BLOG_OBSERVE" }) as BlogWorkflowObservation | undefined;
      if (workflow?.stage === "CONFIRMATION") {
        await continueBlogWorkflow(current, { profileName: "", filled: [], skipped: [], manual: [], workflow }, tab.url || current.sourceUrl);
        return;
      }
    } catch { /* Missing response means observe again or stop uncertain, never republish. */ }
    if (observation < 2) await new Promise((resolve) => setTimeout(resolve, 300));
  }
  const latest = await readListingRun();
  if (!latest || latest.id !== run.id || latest.publicVerification) return;
  const reason = deliveryError || "Publication outcome is not confirmed. Inspect existing posts/public URL before further action; automatic retry is blocked.";
  await writeListingRun(updateListingRun(latest, { stage: "MANUAL_GATE", status: "needs-human", awaitingManualResume: true,
    publicationSubmission: latest.publicationSubmission ? { ...latest.publicationSubmission, outcome: "uncertain", reason } : undefined, manual: [reason], error: undefined,
    steps: [...latest.steps, "Publication outcome uncertain; observation only, no retry"] }));
}

// Missing MV3 receivers are restored with observation code only. Never load the
// full content entry here: its startup handlers may resume unrelated automation.
async function readPublicationPage(run: ListingRun, message: ExtensionMessage): Promise<unknown> {
  const tab = await chrome.tabs.get(run.tabId);
  if (!tab.url || new URL(tab.url).origin !== new URL(run.sourceUrl).origin
    && !(message.type === "BA2_VERIFY_PUBLIC_ARTICLE" && publicArticleUrl(tab.url, run.sourceUrl) === tab.url)) throw Error("Publisher changed");
  try {
    const timeout = Symbol('observer-timeout');
    const reply = await withTimeout(chrome.tabs.sendMessage(run.tabId, message, { frameId: 0 }), 5_000, timeout);
    traceTransport(`tab ${run.tabId}: ${reply === timeout ? 'observer timeout' : reply === undefined ? 'undefined acknowledgement' : 'observer reply received'}.`);
    const result = reply === timeout ? undefined : reply;
    if ((await chrome.tabs.get(run.tabId)).url !== tab.url) throw Error("Publisher page changed");
    return result;
  }
  catch (error) {
    if (!String(error).includes("Receiving end does not exist")) throw error;
    traceTransport(`tab ${run.tabId}: missing receiver; existing bounded read-only publication-reader restoration attempted.`);
    await chrome.scripting.executeScript({ target: { tabId: run.tabId, frameIds: [0] }, files: ["content/publication-reader.js"] });
    if ((await chrome.tabs.get(run.tabId)).url !== tab.url) throw Error("Publisher page changed");
    const timeout = Symbol('restored-observer-timeout');
    const reply = await withTimeout(chrome.tabs.sendMessage(run.tabId, message, { frameId: 0 }), 5_000, timeout);
    traceTransport(`tab ${run.tabId}: restored reader ${reply === timeout ? 'timed out' : reply === undefined ? 'returned undefined' : 'replied'}.`);
    return reply === timeout ? undefined : reply;
  }
}

export async function recoverPublishedArticle(runId: string, tabId: number, automatic = false): Promise<void> {
  const stopped = (reason: string) => { traceStep(4, 'skipped', `recoverPublishedArticle: ${reason}`); };
  const existing = listingResumeLocks.get(runId);
  if (existing) { await existing; return recoverPublishedArticle(runId, tabId, automatic); }
  const operation = (async () => {
    let run = await readListingRun();
    if (run && currentPageAutofillOnly(run.sourceUrl)) return;
    if (!run || run.id !== runId || !run.submissionAttempted || !run.publicationSubmission
      || !run.autoPublish || !run.publicationApproval || !run.expectedArticle || run.sheetSync?.status === "syncing") { stopped('Saved publication prerequisites changed or are missing.'); return; }
    if (automatic && run.publicVerification?.status === "verified") { stopped('Saved publication already verified.'); return; }
    if (automatic && (run.publicVerification?.status === "failed" || (run.automaticPublicationRecoveries || 0) >= 2)) {
      stopped(run.publicVerification?.status === 'failed' ? 'Saved public verification failed; automatic retry blocked.' : 'automatic recovery budget exhausted (>=2).'); return;
    }
    const receipt = await readPublicationGuard(run.sourceUrl, run.profileId);
    const payload = await getActiveProfilePayload();
    if (receipt?.runId !== run.id || payload?.profile.id !== run.profileId
      || await publicationProfileFingerprint(payload.profile) !== run.publicationApproval.profileFingerprint) { stopped('Receipt ownership or approved profile no longer matches.'); return; }
    const tab = await chrome.tabs.get(tabId);
    if (!tab.url || new URL(tab.url).origin !== new URL(run.sourceUrl).origin) { stopped('Candidate tab is outside saved publisher origin.'); return; }
    const observing = { ...run, tabId };
    const workflow = await readPublicationPage(observing, { type: "BA2_BLOG_OBSERVE" }) as BlogWorkflowObservation | undefined;
    // Recovery cannot reach autofill, validation, login or publish handlers.
    if (workflow?.stage !== "CONFIRMATION" || !workflow.publicationEvidence || !workflow.publicUrl) { stopped('Success marker changed or observer did not confirm publication.'); return; }
    if (run.publicVerification?.status === 'verified' && workflow.publicUrl !== (run.publicationConfirmation?.visitUrl || run.liveUrl)) {
      stopped('Current success link differs from the verified publication.'); return;
    }
    let expected = run.expectedArticle;
    if (!expected.bodyText) {
      const rebuilt = await readPublicationPage(observing, { type: "BA2_BUILD_ARTICLE_EXPECTATION", title: payload.profile.businessName, html: payload.profile.description }) as ArticleExpectation | undefined;
      if (!rebuilt?.bodyText || rebuilt.title !== expected.title || rebuilt.bodyExcerpt !== expected.bodyExcerpt) { stopped('Legacy article expectation cannot be reconstructed from the approved profile.'); return; }
      expected = { ...rebuilt, images: [...new Set([...(rebuilt.images || []), ...(payload.profile.imageUrl?.trim() ? [payload.profile.imageUrl.trim()] : [])])] };
    }
    // Same-run receipt alone does not authorize replacing its saved tab.
    // Verify the candidate anonymously first; failure leaves ALL saved state intact.
    const candidateResult = tabId !== run.tabId
      ? await verifyPublicBlogUrl({ ...observing, expectedArticle: expected }, workflow.publicUrl, expected) : undefined;
    if (candidateResult && candidateResult.status !== 'verified') { stopped(`Anonymous verification ${candidateResult.status}: ${candidateResult.reason}`); return; }
    if (candidateResult) {
      const currentPage = await readPublicationPage(observing, { type: 'BA2_BLOG_OBSERVE' }) as BlogWorkflowObservation | undefined;
      if (currentPage?.stage !== 'CONFIRMATION' || !currentPage.publicationEvidence || currentPage.publicUrl !== workflow.publicUrl) { stopped('Success marker or Visit URL changed during anonymous verification.'); return; }
    }
    const latest = await readListingRun();
    if (!latest || latest.id !== runId || latest.updatedAt !== run.updatedAt || (await chrome.tabs.get(tabId)).url !== tab.url) { stopped('Saved run or candidate tab changed during inspection.'); return; }
    const finalProfile = await getActiveProfilePayload();
    if ((await readPublicationGuard(run.sourceUrl, run.profileId))?.runId !== run.id || finalProfile?.profile.id !== run.profileId
      || await publicationProfileFingerprint(finalProfile.profile) !== run.publicationApproval.profileFingerprint) { stopped('Final receipt/profile identity check changed.'); return; }
    if (TRACE_READ_ONLY) {
      const check = candidateResult || await verifyPublicBlogUrl({ ...observing, expectedArticle: expected }, workflow.publicUrl, expected);
      stopped(check.status === 'verified' ? 'Anonymous approved-content verification passed. Read-only trace deliberately stops before saved-run updates and Visit navigation.' : `Anonymous verification ${check.status}: ${check.reason}`);
      return;
    }
    if (latest.publicVerification?.status === 'verified') {
      if (candidateResult && (candidateResult.verifiedUrl || workflow.publicUrl) !== latest.liveUrl) { stopped('Candidate canonical URL differs from the saved verified URL.'); return; }
      await writeListingRun(updateListingRun(latest, { tabId, tabUnavailable: undefined, stage: 'COMPLETE', status: 'success', manual: [], awaitingManualResume: false, error: undefined,
        publicVerification: { ...latest.publicVerification, confirmationUrl: tab.url },
        publicationConfirmation: { url: tab.url, visitUrl: workflow.publicUrl, observedAt: new Date().toISOString() } }));
      await continueVerifiedPublication(latest.id);
      return;
    }
    run = updateListingRun(latest, { tabId, expectedArticle: expected,
      ...(automatic ? { automaticPublicationRecoveries: (latest.automaticPublicationRecoveries || 0) + 1 } : {}),
      steps: [...latest.steps, `${automatic ? "Automatic" : "Explicit"} observation-only recovery of existing publication; no submission`,
        ...(candidateResult ? [`Public article independently verified before continuing from saved tab ${latest.tabId} in tab ${tabId}`] : [])],
      ...(candidateResult ? { stage: 'VERIFYING_SUCCESS' as const, status: 'in-progress' as const, tabUnavailable: undefined,
        publicationConfirmation: { url: tab.url, visitUrl: workflow.publicUrl, observedAt: new Date().toISOString() },
        publicVerification: { status: 'verifying' as const, candidateUrl: workflow.publicUrl, confirmationUrl: tab.url,
          attemptId: crypto.randomUUID(), reason: 'Existing public article verified; completing saved publication.' } } : {}) });
    await writeListingRun(run);
    if (candidateResult) { await finishPublicVerification(run, candidateResult); return; }
    await continueBlogWorkflow(run, { profileName: "", filled: [], skipped: [], manual: [], workflow }, tab.url, true);
  })().finally(() => listingResumeLocks.delete(runId));
  listingResumeLocks.set(runId, operation);
  await operation;
}

async function prepareAutoPublication(run: ListingRun): Promise<void> {
  const current = await readListingRun();
  if (!current || current.id !== run.id || current.publicVerification || current.submissionAttempted) return;
  const pause = async (reason: string) => {
    const latest = await readListingRun();
    if (latest?.id !== current.id || latest.submissionAttempted || latest.publicVerification) return;
    await writeListingRun(updateListingRun(latest, { stage: "MANUAL_GATE", status: "needs-human", awaitingManualResume: true, manual: [reason], error: undefined }));
  };
  const payload = await getActiveProfilePayload();
  if (current.autoPublish !== true || !current.publicationApproval || payload?.profile.id !== current.profileId
    || await publicationProfileFingerprint(payload.profile) !== current.publicationApproval.profileFingerprint) {
    await pause("Approved business profile changed or Auto Publish authorization is missing. Restore the approved profile or end this run; publication was not attempted.");
    return;
  }
  if (await readPublicationGuard(current.sourceUrl, current.profileId)) {
    await pause("A publication attempt or confirmation already exists for this business/publisher. Inspect existing posts/public URL; duplicate publication is blocked.");
    return;
  }
  const tab = await chrome.tabs.get(current.tabId);
  if (tab.url !== current.publicationEditorUrl) { await pause("Editor page changed; inspect manually before publication."); return; }
  let validation: { ok: boolean; error?: string };
  try {
    validation = await withTimeout(chrome.tabs.sendMessage(current.tabId, { type: "BA2_BLOG_VALIDATE", runId: current.id } satisfies ExtensionMessage, { frameId: 0 }), 5_000,
      { ok: false, error: "Editor validation timed out; no publication attempted. Review the page and continue this run." });
  } catch { validation = { ok: false, error: "Editor validation unavailable; no publication attempted. Review the page and continue this run." }; }
  if (!validation?.ok || !current.expectedArticle) {
    await pause(validation?.error || "Expected article evidence is missing; review editor autofill before publication.");
    if (current.continuous && /captcha|terms\/consent|human verification/i.test(validation?.error || ''))
      await chrome.tabs.sendMessage(current.tabId, { type: 'BA2_WATCH_PUBLICATION_READY', runId: current.id } satisfies ExtensionMessage, { frameId: 0 }).catch(() => undefined);
    return;
  }
  const latest = await readListingRun();
  if (!latest || latest.id !== current.id || latest.submissionAttempted || latest.publicVerification) return;
  const intent = updateListingRun(latest, { stage: "SUBMITTING", status: "in-progress", submissionAttempted: true, awaitingManualResume: true,
    publicationSubmission: { attemptId: crypto.randomUUID(), url: tab.url!, startedAt: new Date().toISOString(), outcome: "intent" },
    manual: [], steps: [...latest.steps, "Validated approved article; single publication intent persisted before dispatch"], error: undefined });
  await writeListingRun(intent);
  // Arm same-document success observation before the one permitted dispatch.
  // Missing observer delivery never grants or repeats a submission.
  await readPublicationPage(intent, { type: "BA2_WATCH_PUBLICATION", runId: intent.id, attemptId: intent.publicationSubmission!.attemptId }).catch(() => undefined);
  const result = await sendBlogPublishMessage(intent);
  await observePublicationOutcome(intent, result?.ok ? undefined : result?.error || "Publication delivery is uncertain; inspect the site without retrying.");
}

async function verifyPublicBlogUrl(run: ListingRun, url: string, expected: ArticleExpectation): Promise<PublicArticleCheck> {
  try {
    // Every hop is validated before GET. Opaque redirects (Chrome may hide Location)
    // stop safely; never use unrestricted redirect:follow or authenticated browsing as proof.
    const seen = new Set<string>();
    const signal = AbortSignal.timeout(10_000);
    for (let hop = 0; hop < 4; hop += 1) {
      if (seen.has(url) || publicArticleUrl(url, run.sourceUrl) !== url) return { status: "failed", reason: "Unsafe or cyclic public URL." };
      seen.add(url);
      const response = await fetch(url, { method: "GET", credentials: "omit", redirect: "manual", referrerPolicy: "no-referrer", cache: "no-store", signal });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const next = publicArticleUrl(response.headers.get("location") || "", url);
        if (!next || publicArticleUrl(next, run.sourceUrl) !== next) return { status: "failed", reason: "Public redirect is unsafe or missing." };
        url = next;
        continue;
      }
      if (response.redirected || response.url !== url || publicArticleUrl(response.url, run.sourceUrl) !== url) {
        return { status: "failed", reason: "Public response changed the expected article URL." };
      }
      if (!response.ok) return { status: "failed", reason: `Public article returned HTTP ${response.status}.` };
      if (!/^text\/html\b/i.test(response.headers.get("content-type") || "")) return { status: "unverified", reason: "Public response is not an HTML article." };
      if (Number(response.headers.get("content-length")) > 2_000_000) return { status: "unverified", reason: "Public response exceeds the verification size limit." };
      const reader = response.body?.getReader();
      if (!reader) return { status: "unverified", reason: "Public response body is unavailable." };
      const decoder = new TextDecoder();
      let body = "";
      let bytes = 0;
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          bytes += chunk.value.byteLength;
          if (bytes > 2_000_000) { await reader.cancel(); return { status: "unverified", reason: "Public response exceeds the verification size limit." }; }
          body += decoder.decode(chunk.value, { stream: true });
        }
        body += decoder.decode();
      } finally { reader.releaseLock(); }
      if (!body.trim() || body.length > 2_000_000) return { status: "unverified", reason: "Public response is empty or exceeds the verification size limit." };
      const result = await readPublicationPage(run, { type: "BA2_VERIFY_PUBLIC_ARTICLE", html: body, expected, responseUrl: url }) as PublicArticleCheck | undefined;
      if (!result || !["verified", "unverified", "failed"].includes(result.status)) return { status: "unverified", reason: "Article evidence inspection unavailable." };
      if (result.status !== "verified") return result;
      if (result.canonicalUrl && result.canonicalUrl !== url) {
        if (publicArticleUrl(result.canonicalUrl, run.sourceUrl) !== result.canonicalUrl) return { status: "failed", reason: "Canonical URL is outside the trusted publisher." };
        url = result.canonicalUrl;
        continue;
      }
      return { ...result, verifiedUrl: url };
    }
    return { status: "unverified", reason: "Public redirect/canonical verification hop limit reached." };
  } catch {
    return { status: "unverified", reason: "Anonymous article check could not finish (network, redirect, timeout, or content-script unavailable)." };
  }
}

async function finishPublicVerification(run: ListingRun, result: PublicArticleCheck): Promise<void> {
  const current = await readListingRun();
  if (!current || current.id !== run.id || current.publicVerification?.attemptId !== run.publicVerification?.attemptId || current.publicVerification?.status !== "verifying") return;
  await writeListingRun(updateListingRun(current, {
    stage: result.status === "verified" ? "COMPLETE" : result.status === "failed" ? "FAILED" : "MANUAL_GATE",
    status: result.status === "verified" ? "success" : result.status === "failed" ? "failed" : "needs-human",
    liveUrl: result.status === "verified" ? result.verifiedUrl || current.publicVerification.candidateUrl : undefined,
    publicVerification: { ...current.publicVerification, ...result, candidateUrl: result.status === "verified" ? result.verifiedUrl || current.publicVerification.candidateUrl : current.publicVerification.candidateUrl, checkedAt: new Date().toISOString() },
    awaitingManualResume: false,
    manual: result.status === "verified" ? [] : [result.reason],
    steps: [...current.steps, `Public article ${result.status}: ${result.reason}`],
    error: undefined,
  }));
  if (result.status === "verified") await continueVerifiedPublication(current.id);
}

async function continueVerifiedPublication(runId: string): Promise<void> {
  const run = await readListingRun();
  if (run && currentPageAutofillOnly(run.sourceUrl)) return;
  if (!run || run.id !== runId || run.publicVerification?.status !== "verified" || !run.liveUrl
    || publicArticleUrl(run.liveUrl, run.sourceUrl) !== run.liveUrl) return;
  const tab = await chrome.tabs.get(run.tabId).catch(() => undefined);
  if (tab?.url && tab.url === run.publicVerification.confirmationUrl) {
    if (run.domain === 'thezenweb.com') {
      const href = run.publicationConfirmation?.visitUrl || run.liveUrl;
      const latest = await readListingRun();
      if (latest?.id !== run.id || (await readPublicationGuard(run.sourceUrl, run.profileId))?.runId !== run.id
        || publicArticleUrl(href, run.sourceUrl) !== href) return;
      let clicked = false;
      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId: run.tabId, frameIds: [0] },
          func: (expectedHref: string, confirmationUrl: string) => {
            if (location.href !== confirmationUrl) return false;
            const links = document.querySelectorAll('a#successfully_posted');
            const link = links[0];
            if (links.length !== 1 || !(link instanceof HTMLAnchorElement) || link.href !== expectedHref
              || link.textContent?.trim().toLowerCase() !== 'visit' || link.hasAttribute('download')
              || !['', '_self'].includes(link.target || document.querySelector('base')?.target || '')
              || link.closest('article,[contenteditable=true]') || !link.getClientRects().length
              || getComputedStyle(link).visibility === 'hidden') return false;
            link.click();
            return true;
          },
          args: [href, tab.url],
        });
        clicked = results[0]?.result === true;
      } catch { /* Navigation is never retried after an uncertain acknowledgement. */ }
      if (!clicked) {
        const current = await readListingRun();
        if (current?.id === run.id) {
          const reason = 'Automatic Visit click was unavailable or unacknowledged. Verified publication and receipts are preserved; Publish will not be repeated.';
          await writeListingRun(updateListingRun(current, { manual: [reason], steps: [...current.steps, reason] }));
        }
        return;
      }
    } else await chrome.tabs.update(run.tabId, { url: run.liveUrl });
  }
  await synchronizeVerifiedListing(runId, run.sheetSync?.mode === "prepare" && run.sheetSync.code === "sync-interrupted", true);
}

export function synchronizeVerifiedListing(runId: string, retryBlocked = false, prepareOnly = false): Promise<void> {
  if (!prepareOnly && !SHEETS_WRITE_ENABLED) return Promise.resolve();
  const key = `${runId}:sheets`;
  const existing = listingResumeLocks.get(key);
  if (existing) return existing;
  const operation = syncVerifiedListing(runId, retryBlocked, prepareOnly).finally(() => listingResumeLocks.delete(key));
  listingResumeLocks.set(key, operation);
  return operation;
}

async function syncVerifiedListing(runId: string, retryBlocked: boolean, prepareOnly: boolean): Promise<void> {
  const run = await readListingRun();
  if (run && currentPageAutofillOnly(run.sourceUrl)) return;
  if (!run || run.id !== runId || run.publicVerification?.status !== "verified" || !run.liveUrl || run.stage !== "COMPLETE"
    || !run.autoPublish || !run.publicationApproval || !run.submissionAttempted || !run.publicationSubmission
    || run.sheetSync && !(retryBlocked && ["blocked", "ready"].includes(run.sheetSync.status))) return;
  if (prepareOnly && (run.sheetSync?.readAttempts || 0) >= 2) return;
  const attemptId = crypto.randomUUID();
  let dispatched = false;
  const save = async (result: Omit<NonNullable<ListingRun["sheetSync"]>, "attemptId" | "liveUrl">) => {
    const current = await readListingRun();
    if (!current || current.id !== runId || current.liveUrl !== run.liveUrl || current.publicVerification?.status !== "verified"
      || current.sheetSync && current.sheetSync.attemptId !== attemptId && current.sheetSync.attemptId !== run.sheetSync?.attemptId) return false;
    await writeListingRun(updateListingRun(current, { sheetSync: { ...result, mode: prepareOnly ? "prepare" : "write",
      ...(prepareOnly ? { readAttempts: (run.sheetSync?.readAttempts || 0) + 1 } : {}), attemptId, liveUrl: run.liveUrl!, checkedAt: new Date().toISOString() } }));
    return true;
  };
  try {
    // Session storage is restricted to trusted extension contexts by Chrome;
    // this is a local backend key, never a Google OAuth token.
    const secret = (await chrome.storage.session?.get("ba2.sheetsBackendKey"))?.["ba2.sheetsBackendKey"];
    if (typeof secret !== "string" || secret.length < 32) {
      await save({ status: "blocked", code: "backend-authorization-required", reason: "Configure the trusted backend connection after separately approving Sheets write access. No write attempted." }); return;
    }
    const payload = await getActiveProfilePayload();
    if (!payload || payload.profile.id !== run.profileId || await publicationProfileFingerprint(payload.profile) !== run.publicationApproval.profileFingerprint
      || publicArticleUrl(run.liveUrl, run.sourceUrl) !== run.liveUrl || run.publicVerification.candidateUrl !== run.liveUrl || !run.expectedArticle) {
      await save({ status: "blocked", code: "verification-required", reason: "Approved profile or verified article evidence no longer matches. No Sheets write attempted." }); return;
    }
    // Refresh accessibility/identity using the existing anonymous article verifier.
    const refreshed = await verifyPublicBlogUrl(run, run.liveUrl, run.expectedArticle);
    if (refreshed.status !== "verified" || refreshed.verifiedUrl !== run.liveUrl) {
      await save({ status: "blocked", code: "article-unavailable", reason: "The public article could not be reverified. No Sheets write attempted." }); return;
    }
    const current = await readListingRun();
    if (!current || current.id !== runId || current.liveUrl !== run.liveUrl || !current.autoPublish || current.publicVerification?.status !== "verified"
      || current.publicationApproval?.profileFingerprint !== run.publicationApproval.profileFingerprint) return;
    if (!await save({ status: "syncing", code: "write-back-started", reason: "Verified URL synchronization started; interrupted delivery will not retry automatically." })) return;
    const intent = await readListingRun();
    if (!intent || intent.id !== runId || intent.sheetSync?.attemptId !== attemptId || intent.sheetSync.status !== "syncing"
      || !intent.autoPublish || intent.liveUrl !== run.liveUrl || intent.publicVerification?.status !== "verified"
      || intent.publicationApproval?.profileFingerprint !== run.publicationApproval.profileFingerprint) return;
    dispatched = true;
    const response = await fetch(`http://localhost:3000/api/google-sheets/write-back${prepareOnly ? "?mode=prepare" : ""}`, {
      method: "POST", credentials: "omit", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(55_000),
      headers: { "content-type": "application/json", "x-ba2-sheets-key": secret },
      body: JSON.stringify({ runId, businessName: payload.profile.businessName, websiteUrl: new URL(run.sourceUrl).origin,
        publicationAuthorized: true, liveUrl: run.liveUrl, verification: { status: "verified", url: run.liveUrl, checkedAt: new Date().toISOString() } }),
    });
    const result = await response.json() as Partial<NonNullable<ListingRun["sheetSync"]>>;
    const statuses = ["recorded", "already-recorded", "blocked", "conflict", "failed", "uncertain", ...(prepareOnly ? ["ready"] : [])];
    if (!result.status || !statuses.includes(result.status) || typeof result.code !== "string" || prepareOnly && result.status === "recorded"
      || result.status === "ready" && (!response.ok || !Number.isInteger(result.rowNumber) || result.rowNumber! < 17 || result.range !== `Sheet1!B${result.rowNumber}`)
      || ["recorded", "already-recorded"].includes(result.status) && (!response.ok || result.readBackConfirmed !== true
        || !Number.isInteger(result.rowNumber) || result.rowNumber! < 17 || result.range !== `Sheet1!B${result.rowNumber}`)) throw new Error("Unconfirmed backend result");
    // Only fixed result fields; never persist a backend response body or token.
    await save({ status: result.status, code: result.code.slice(0, 80), reason: result.status === "recorded" || result.status === "already-recorded"
      ? "Exact URL confirmed in the matching publisher's column B cell." : result.status === "ready" ? "Exact column B update prepared by read-only lookup. Separate write approval required." : "Sheets synchronization needs operator review. Check backend authorization/scope, domain mapping, cell conflict, or uncertain delivery before retrying.",
      ...(Number.isInteger(result.rowNumber) && result.rowNumber! >= 17 ? { rowNumber: result.rowNumber, range: `Sheet1!B${result.rowNumber}` } : {}), readBackConfirmed: result.readBackConfirmed === true });
  } catch {
    await save(dispatched && !prepareOnly ? { status: "uncertain", code: "sync-interrupted", reason: "Sheets synchronization could not be confirmed. Inspect column B; no automatic retry." }
      : { status: "blocked", code: "sync-not-started", reason: "Sheets synchronization could not start. No backend write request was sent." });
  }
}

async function sendAmpBlogsObservation(tabId: number): Promise<AmpBlogsObservation> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, { type: "BA2_AMPBLOGS_OBSERVE" } satisfies ExtensionMessage, { frameId: 0 }) as AmpBlogsObservationResponse;
      if (!response?.ok) throw new Error(response?.error || "AmpBlogs observation returned no response.");
      return response.observation;
    } catch (error) {
      lastError = error;
    }
    try {
      await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, files: ["content/content.js"] });
      const response = await chrome.tabs.sendMessage(tabId, { type: "BA2_AMPBLOGS_OBSERVE" } satisfies ExtensionMessage, { frameId: 0 }) as AmpBlogsObservationResponse;
      if (!response?.ok) throw new Error(response?.error || "AmpBlogs observation returned no response.");
      return response.observation;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
  }
  throw new Error(`AmpBlogs content script unavailable after 3 attempts: ${lastError instanceof Error ? lastError.message : "unknown error"}`);
}

// Discover only existing success documents on this approved publisher. Neither
// Chrome's active tab nor the lost original tab identifies the publication.
// An ambiguous set is never guessed; the shared verifier owns any adoption.
async function recoverPublicationInOpenTabs(runId: string): Promise<void> {
  const run = await readListingRun();
  if (run && currentPageAutofillOnly(run.sourceUrl)) return;
  if (TRACE_READ_ONLY) {
    const reason = !run ? 'No saved ListingRun.' : run.id !== runId ? 'Saved run changed.'
      : !run.submissionAttempted ? 'Saved run has no publication submission.' : !run.publicationSubmission ? 'Saved publication intent absent.'
      : !run.autoPublish ? 'Saved Auto Publish authorization is off.' : !run.publicationApproval ? 'Saved publication approval absent.'
      : !run.expectedArticle ? 'Approved article expectation absent.' : run.publicVerification?.status === 'verified' ? 'Saved publication already verified.'
      : run.sheetSync?.status === 'syncing' ? 'Existing Sheets operation is in progress.' : null;
    if (reason) { traceBlocked(`recoverPublicationInOpenTabs: ${reason}`); return; }
  }
  if (!run || run.id !== runId || !run.submissionAttempted || !run.publicationSubmission
    || !run.autoPublish || !run.publicationApproval || !run.expectedArticle || run.publicVerification?.status === 'verified'
    || run.sheetSync?.status === 'syncing') return;
  const payload = await getActiveProfilePayload();
  if (TRACE_READ_ONLY) {
    const receipt = await readPublicationGuard(run.sourceUrl, run.profileId);
    const reason = !receipt ? 'Publication receipt absent.' : receipt.runId !== run.id ? 'Publication receipt belongs to another run.'
      : !payload ? 'Active profile unavailable.' : payload.profile.id !== run.profileId ? 'Active profile differs from saved run.'
      : await publicationProfileFingerprint(payload.profile) !== run.publicationApproval!.profileFingerprint ? 'Approved profile fingerprint differs.' : null;
    if (reason) { traceBlocked(`recoverPublicationInOpenTabs: ${reason}`); return; }
  }
  if ((await readPublicationGuard(run.sourceUrl, run.profileId))?.runId !== run.id || payload?.profile.id !== run.profileId
    || await publicationProfileFingerprint(payload.profile) !== run.publicationApproval.profileFingerprint) return;
  const origin = new URL(run.sourceUrl).origin;
  const tabs = (await chrome.tabs.query({})).filter(tab => tab.id && tab.url?.startsWith(origin + '/') && tab.status !== 'loading');
  if (tabs.length > 8) { traceBlocked('recoverPublicationInOpenTabs: more than 8 eligible publisher tabs; bounded discovery refused.'); return; }
  if (!tabs.length) traceBlocked('recoverPublicationInOpenTabs: no nonloading tab on the exact saved publisher origin.');
  const successes = new Map<string, number>();
  const observations: string[] = [];
  for (const tab of tabs) {
    try {
      // Use the real observer transport, including its existing bounded reader
      // restoration. The trace build's standalone reader cannot arm watchers.
      const page = await readPublicationPage({ ...run, tabId: tab.id! }, { type: 'BA2_BLOG_OBSERVE' }) as BlogWorkflowObservation | undefined;
      observations.push(`tab ${tab.id}: ${page === null ? 'null observer response' : !page ? 'undefined observer response (see transport for timeout)' : !['CONFIRMATION', 'EDITOR', 'LOGIN', 'SIGNUP', 'HOMEPAGE', 'DASHBOARD', 'UNSUPPORTED', 'ACCOUNT_CREATED'].includes(page.stage) ? 'invalid observer response' : `stage=${page.stage}; publicationEvidence=${page.publicationEvidence === true}; publicUrlPresent=${Boolean(page.publicUrl)}; safeUrl=${Boolean(page.publicUrl && publicArticleUrl(page.publicUrl, run.sourceUrl) === page.publicUrl)}`}`);
      if (page?.stage === 'CONFIRMATION' && page.publicationEvidence && page.publicUrl
        && publicArticleUrl(page.publicUrl, run.sourceUrl) === page.publicUrl) successes.set(page.publicUrl, tab.id!);
    } catch (error) {
      const message = String(error);
      observations.push(`tab ${tab.id}: ${message.includes('Receiving end does not exist') ? 'missing message receiver' : message.includes('No tab with id') ? 'tab closed or unavailable' : 'observer message rejected (raw error withheld)'}`);
    }
  }
  if (TRACE_READ_ONLY) {
    traceStep(2, successes.size ? 'observed' : 'failed', `recoverPublicationInOpenTabs: ${tabs.length} eligible tab(s), ${successes.size} distinct recognized success URL(s). ${observations.join('; ')}`);
    traceStep(3, successes.size === 1 ? 'observed' : 'failed', successes.size === 1 ? `Existing observer recognized one safe publication Visit URL in tab ${successes.values().next().value}; not proof of run attribution or public content.` : successes.size > 1 ? 'Multiple distinct success URLs; existing ambiguity guard refuses selection.' : 'No observer CONFIRMATION with publicationEvidence and a safe publicUrl. See per-tab observation above.');
    traceStep(4, 'skipped', 'No unique recognized success link; navigation was not attempted.');
    traceStep(5, 'skipped', 'No article opening performed by this diagnostic; previous browser navigation history is not inferred.');
    if (successes.size === 1) {
      try { await recoverPublishedArticle(run.id, successes.values().next().value!, true); }
      catch { traceStep(4, 'failed', 'recoverPublishedArticle threw during read-only inspection; transport evidence above identifies any message failure. No navigation attempted.'); }
    }
    return;
  }
  if (successes.size !== 1) return;
  await recoverPublishedArticle(run.id, successes.values().next().value!, true);
}

export async function recoverListingRun(): Promise<void> {
  traceStep(1, 'observed', 'recoverListingRun entered at worker startup; read-only mode suppresses all mutating continuation branches.');
  const run = await readListingRun();
  if (run && currentPageAutofillOnly(run.sourceUrl)) return;
  if (TRACE_READ_ONLY) {
    if (run) await recoverPublicationInOpenTabs(run.id);
    else traceBlocked('recoverListingRun: no saved ListingRun.');
    return;
  }
  if (run && isAutomationExcluded(run.sourceUrl)) return;
  if (run?.submissionAttempted && run.publicationSubmission && run.publicVerification?.status !== 'verified') {
    await recoverPublicationInOpenTabs(run.id);
    if ((await readListingRun())?.publicVerification?.status === 'verified') return;
  }
  if (run && isAutomationExcluded(run.sourceUrl)) return;
  if (run?.directory3) { await progressDirectory3(run.id).catch(() => undefined); return; }
  if (run?.nativeDirectory) { if (run.nativeDirectory.phase === "navigating") await resumeListingRun(run); return; }
  if (run?.tabUnavailable) return;
  if (run?.sheetSync?.status === "syncing") {
    const preparing = run.sheetSync.mode === "prepare";
    await writeListingRun(updateListingRun(run, { sheetSync: { ...run.sheetSync, status: preparing ? "blocked" : "uncertain", code: "sync-interrupted", reason: preparing ? "Read-only preparation was interrupted; no sheet write was attempted." : "Synchronization was interrupted; inspect the sheet. No automatic retry.", checkedAt: new Date().toISOString() } }));
    if (preparing) await continueVerifiedPublication(run.id);
    return;
  }
  if (run?.publicVerification?.status === "verified") { await continueVerifiedPublication(run.id); return; }
  if (run?.publicVerification?.status === "verifying") {
    await finishPublicVerification(run, { status: "unverified", reason: "Verification was interrupted; checking the saved success page read-only without resubmission." });
    await recoverPublishedArticle(run.id, run.tabId, true);
    return;
  }
  if (run?.submissionAttempted && run.publicVerification?.status === "unverified") {
    await recoverPublishedArticle(run.id, run.tabId, true);
    return;
  }
  if (run?.submissionAttempted && !run.publicVerification) {
    if (run.publicationSubmission) await readPublicationPage(run, { type: "BA2_WATCH_PUBLICATION", runId: run.id, attemptId: run.publicationSubmission.attemptId }).catch(() => undefined);
    await resumeListingRun(run);
    return;
  }
  if (run?.continuous && run.stage === 'ERROR' && !run.submissionAttempted && !run.login?.attemptId && !run.registration?.attemptId) return;
  if (run?.autoRegister && run.registration?.state !== 'confirmed') { await resumeListingRun(run); return; }
  if (run?.autoLogin && run.login && run.login.state !== "authenticated") { await resumeListingRun(run); return; }
  if (!run || (!isListingRunActive(run) && !run.awaitingManualResume)) return;
  try {
    const tab = await chrome.tabs.get(run.tabId);
    if (!tab.url || !/^https?:$/i.test(new URL(tab.url).protocol)) throw new Error("Listing tab is no longer available");
    if (run.awaitingManualResume) return;
    const target = run.navigationTarget;
    if (run.stage === "NAVIGATING" && target && new URL(tab.url).href === new URL(target).href) {
      const resumed = updateListingRun(run, { navigationVerified: true, resumed: true, retryCount: 0, steps: [...run.steps, "Service worker recovered persisted navigation", "Navigation verified", "Run resumed"] });
      await writeListingRun(resumed);
      void resumeListingRun(resumed);
      return;
    }
    const recovered = updateListingRun(run, { retryCount: (run.retryCount || 0) + 1, steps: [...run.steps, "Service worker recovered persisted run"] });
    await writeListingRun(recovered);
    void resumeListingRun(recovered);
  } catch (error) {
    if (isMissingTabError(error, run.tabId)) { await markListingTabUnavailable(run, "missing"); return; }
    await writeListingRun(updateListingRun(run, { stage: "ERROR", status: "failed", error: `Listing run recovery failed: ${error instanceof Error ? error.message : "tab unavailable"}`, steps: [...run.steps, "Listing run recovery failed"] }));
  }
}

function scheduleCategoryActionTimeout(run: ListingRun, action: string): void {
  const runId = run.id;
  const target = run.navigationTarget;
  setTimeout(() => {
    void readListingRun().then(async (current) => {
      if (!current || current.id !== runId || current.stage !== "NAVIGATING") return;
      const retries = current.retryCount || 0;
      if (retries < 1) {
        const retry = updateListingRun(current, { retryCount: retries + 1, steps: [...current.steps, `${action} navigation timed out; retrying once`] });
        await writeListingRun(retry);
        if (target) await chrome.tabs.update(retry.tabId, { url: target });
        else void resumeListingRun(retry);
        scheduleCategoryActionTimeout(retry, action);
        return;
      }
      await writeListingRun(updateListingRun(current, {
        stage: "MANUAL_GATE",
        status: "needs-human",
        manual: [...current.manual, `${action} navigation timed out after one retry`],
        error: `${action} navigation did not complete after one safe retry`,
        steps: [...current.steps, `${action} navigation failed: no navigation or same-page update verified`],
      }));
    }).catch(() => undefined);
  }, CATEGORY_ACTION_TIMEOUT_MS);
}

async function probeSameDocumentResume(run: ListingRun, expectedStage: "LOCATION" | "CATEGORY" | "SUBCATEGORY", currentUrl: string): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 300));
  const currentRun = await readListingRun();
  if (!currentRun || currentRun.id !== run.id || currentRun.stage !== "NAVIGATING") return;
  const tab = await chrome.tabs.get(run.tabId);
  if (tab.url !== currentUrl) return;
  const response = await sendListingMessage(run.tabId);
  if (!response.ok) throw new Error(`Resume classification failed: ${response.error}`);
  const actualStage = response.report.adaptive?.stage;
  if (actualStage === expectedStage) {
    await writeListingRun(updateListingRun(currentRun, {
      stage: "MANUAL_GATE",
      status: "needs-human",
      manual: [...currentRun.manual, `${currentRun.action || expectedStage} executed but navigation was not detected`],
      error: `Navigation detection failed after ${currentRun.action || expectedStage}`,
      steps: [...currentRun.steps, `Navigation detection failed: page remains ${expectedStage}`],
    }));
    return;
  }
  const resumed = updateListingRun(currentRun, {
    stage: "FORM",
    navigationCount: currentRun.navigationCount + 1,
    navigationVerified: true,
    resumed: true,
    steps: [...currentRun.steps, `Navigation verified: same-document stage ${actualStage || "UNKNOWN"}`, "Run resumed"],
  });
  await writeListingRun(resumed);
  void resumeListingRun(resumed);
}

async function sendAmpBlogsLoginAutofill(tabId: number): Promise<ListingAutofillResponse> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await chrome.tabs.sendMessage(tabId, { type: "BA2_AMPBLOGS_LOGIN_AUTOFILL" } satisfies ExtensionMessage, { frameId: 0 });
    } catch (error) {
      lastError = error;
    }
    try {
      await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, files: ["content/content.js"] });
      return await chrome.tabs.sendMessage(tabId, { type: "BA2_AMPBLOGS_LOGIN_AUTOFILL" } satisfies ExtensionMessage, { frameId: 0 });
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
  }
  return { ok: false, error: `AmpBlogs login form unavailable after 3 attempts: ${lastError instanceof Error ? lastError.message : "unknown error"}` };
}

async function sendAmpBlogsLoginSubmit(tabId: number): Promise<{ ok: boolean; error?: string }> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await chrome.tabs.sendMessage(tabId, { type: "BA2_AMPBLOGS_SUBMIT_LOGIN" } satisfies ExtensionMessage, { frameId: 0 }) as { ok: boolean; error?: string };
    } catch (error) {
      lastError = error;
    }
    try {
      await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, files: ["content/content.js"] });
      return await chrome.tabs.sendMessage(tabId, { type: "BA2_AMPBLOGS_SUBMIT_LOGIN" } satisfies ExtensionMessage, { frameId: 0 }) as { ok: boolean; error?: string };
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
  }
  return { ok: false, error: `AmpBlogs login submission path unavailable after 3 attempts: ${lastError instanceof Error ? lastError.message : "unknown error"}` };
}

function uniqueManual(items: string[]): string[] {
  return [...new Set(items.filter(Boolean))];
}

async function waitForGenericManualLogin(run: ListingRun, reason = "Complete any CAPTCHA on the website, then click the website's Sign In / Login. MAHID's CHECK LOGIN only rechecks; Auto Publish does not authorize login."): Promise<void> {
  const current = await readListingRun();
  if (!current || current.id !== run.id || current.submissionAttempted || current.publicVerification) return;
  await writeListingRun(updateListingRun(current, {
    stage: "MANUAL_GATE", status: "needs-human", awaitingManualLogin: true, awaitingManualResume: true,
    manual: [reason, "SIGN IN / LOGIN"], error: undefined,
    steps: [...current.steps, "Generic login is manual; no login submission or CAPTCHA-completion assertion made"],
  }));
}

async function continueBlogWorkflow(run: ListingRun, report: ListingAutofillReport, currentUrl: string, verificationRecovery = false): Promise<boolean> {
  const workflow = report.workflow;
  if (!workflow) return false;
  if (workflow.stage === "LOGIN" && report.manual.includes("SIGN IN / LOGIN")) {
    // Login is not a listing/media form, and article authorization is not login consent.
    await waitForGenericManualLogin(run);
    return true;
  }
  if (workflow.stage === "CONFIRMATION") {
    const current = await readListingRun();
    if (!current || current.id !== run.id || current.publicVerification && !verificationRecovery) return true;
    const candidateUrl = workflow.publicUrl && publicArticleUrl(workflow.publicUrl, run.sourceUrl);
    const checking = updateListingRun(current, {
      stage: "VERIFYING_SUCCESS",
      status: "in-progress",
      liveUrl: undefined,
      publicationConfirmation: workflow.publicationEvidence ? { url: currentUrl, visitUrl: candidateUrl, observedAt: new Date().toISOString() } : current.publicationConfirmation,
      awaitingManualResume: false,
      publicVerification: { status: "verifying", candidateUrl: candidateUrl || undefined, confirmationUrl: currentUrl, attemptId: crypto.randomUUID(), reason: "Checking publication evidence and anonymous article accessibility." },
      steps: [...current.steps, workflow.reason, "Read-only public article verification started"],
      error: undefined,
    });
    await writeListingRun(checking);
    const result: PublicArticleCheck = !workflow.publicationEvidence
      ? { status: "unverified", reason: "Explicit publication evidence is missing." }
      : !candidateUrl
        ? { status: "unverified", reason: "Public article link is missing, ambiguous, or outside the trusted publisher URL policy." }
        : !checking.expectedArticle
          ? { status: "unverified", reason: "Expected article evidence was not captured from editor autofill." }
          : await verifyPublicBlogUrl(checking, candidateUrl, checking.expectedArticle);
    await finishPublicVerification(checking, result);
    return true;
  }
  if (workflow.stage === "HOMEPAGE" || workflow.stage === "AUTHENTICATED_DASHBOARD" || workflow.stage === 'ACCOUNT_CREATED') {
    const selectedAction = workflow.stage === 'ACCOUNT_CREATED' ? workflow.loginAction : workflow.stage === "HOMEPAGE"
      ? run.accountStatus === "new" && run.registration?.state !== 'confirmed' ? workflow.signupAction : workflow.loginAction
      : workflow.action;
    const href = selectedAction?.href;
    if (!selectedAction || !href || new URL(href).origin !== new URL(currentUrl).origin) {
      await writeListingRun(updateListingRun(run, {
        stage: "MANUAL_GATE",
        status: "needs-human",
        manual: [workflow.stage === "HOMEPAGE" ? "No safe same-origin authentication action recognized" : "No safe same-origin New Post/Create Article action recognized"],
        steps: [...run.steps, workflow.reason],
        error: undefined,
      }));
      return true;
    }
    const next = updateListingRun(run, {
      stage: "NAVIGATING",
      status: "in-progress",
      navigationTarget: href,
      navigationVerified: false,
      expectedStage: "FORM",
      action: `Navigate to ${selectedAction.kind}: ${selectedAction.label}`,
      steps: [...run.steps, workflow.reason, `Safe same-tab navigation prepared: ${href}`],
      error: undefined,
    });
    await writeListingRun(next);
    try {
      await chrome.tabs.update(run.tabId, { url: href });
    } catch (error) {
      // A rejected request is not evidence that an independently completed
      // navigation failed. Recover only the exact target and expected page.
      const tab = await chrome.tabs.get(run.tabId);
      const saved = await readListingRun();
      if (!saved || saved.id !== run.id || saved.stage !== "NAVIGATING" || saved.navigationTarget !== href
        || saved.submissionAttempted || saved.publicVerification || !tab.url || new URL(tab.url).href !== new URL(href).href) throw error;
      const observed = await withTimeout(chrome.tabs.sendMessage(run.tabId, { type: "BA2_BLOG_OBSERVE" } satisfies ExtensionMessage, { frameId: 0 }) as Promise<BlogWorkflowObservation>, 3_000, undefined);
      const expected = selectedAction.kind === "new-post" ? "EDITOR" : selectedAction.kind === "login" ? "LOGIN" : "SIGNUP";
      if (observed?.stage !== expected) throw error;
      // Queue the same completion handler; never resend the navigation or a submit.
      void resumeCompletedListingNavigation(run.tabId).catch(() => undefined);
    }
    return true;
  }
  return false;
}

function authorizeAmpBlogsLogin(run: ListingRun): Promise<void> {
  const key = `${run.id}:ampblogs-authorize`;
  const existing = listingResumeLocks.get(key);
  if (existing) return existing;
  const operation = continueAmpBlogsLoginAuthorization(run).finally(() => listingResumeLocks.delete(key));
  listingResumeLocks.set(key, operation);
  return operation;
}

async function continueAmpBlogsLoginAuthorization(run: ListingRun): Promise<void> {
  const currentRun = await readListingRun();
  if (!currentRun || currentRun.id !== run.id || !currentRun.awaitingAmpBlogsLoginAuthorization) return;
  if (currentRun.ampBlogsSubmissionStarted) return;
  const tab = await chrome.tabs.get(currentRun.tabId);
  if (!tab.url || !isAmpBlogsUrl(tab.url)) throw new Error("AmpBlogs authorization stopped because the current tab changed sites.");
  const observation = await sendAmpBlogsObservation(currentRun.tabId);
  if (observation.pageState !== "LOGIN_FORM") {
    await continueAmpBlogsRun(currentRun, tab.url);
    return;
  }
  if (currentRun.ampBlogsCaptchaRequired && observation.captchaState === "present") {
    await writeListingRun(updateListingRun(currentRun, {
      error: "CAPTCHA is still present. Complete it before authorizing Sign In.",
      manual: uniqueManual([...currentRun.manual, "CAPTCHA is still present"]),
      steps: [...currentRun.steps, "Login authorization blocked because CAPTCHA remains present"],
    }));
    return;
  }
  const prepared = updateListingRun(currentRun, {
    stage: "NAVIGATING",
    status: "in-progress",
    awaitingAmpBlogsLoginAuthorization: false,
    awaitingManualResume: true,
    ampBlogsSubmissionStarted: true,
    navigationTarget: tab.url,
    expectedStage: "FORM",
    error: undefined,
    steps: [...currentRun.steps, "Login submission explicitly authorized", "CAPTCHA verification state accepted", "Submitting AmpBlogs Sign In"],
  });
  await writeListingRun(prepared);
  const response = await sendAmpBlogsLoginSubmit(currentRun.tabId);
  if (!response?.ok) {
    await writeListingRun(updateListingRun(prepared, {
      stage: "MANUAL_GATE",
      status: "needs-human",
      awaitingAmpBlogsLoginAuthorization: true,
      awaitingManualResume: true,
      ampBlogsSubmissionStarted: false,
      error: response?.error || "AmpBlogs Sign In could not be submitted safely.",
      manual: uniqueManual([...prepared.manual, response?.error || "Sign In submission failed; review manually"]),
      steps: [...prepared.steps, "AmpBlogs Sign In submission did not start"],
    }));
  }
}

async function continueAmpBlogsRun(run: ListingRun, currentUrl: string): Promise<void> {
  const observation = await sendAmpBlogsObservation(run.tabId);
  const observedStep = `AmpBlogs page observed: ${observation.pageState}`;

  if (!observation.supported || !isAmpBlogsUrl(currentUrl)) {
    await writeListingRun(updateListingRun(run, {
      stage: "MANUAL_GATE",
      status: "needs-human",
      awaitingManualResume: false,
      ampBlogsState: "UNSUPPORTED",
      manual: ["Unsupported or ambiguous AmpBlogs page; human review required"],
      steps: [...run.steps, observedStep],
      error: undefined,
    }));
    return;
  }

  if (observation.pageState === "HOMEPAGE") {
    const registrationRequested = run.ampBlogsAccountStatus === "new";
    const targetHref = registrationRequested ? observation.startNowHref || observation.signupHref : observation.loginHref;
    const targetLabel = registrationRequested ? "Start now / Sign Up" : "Login";
    if (!targetHref || !isAmpBlogsUrl(targetHref)) {
      await writeListingRun(updateListingRun(run, {
        stage: "MANUAL_GATE",
        status: "needs-human",
        awaitingManualResume: false,
        ampBlogsState: observation.pageState,
        manual: [`No safe same-origin AmpBlogs ${targetLabel} link was recognized`],
        steps: [...run.steps, observedStep],
        error: undefined,
      }));
      return;
    }
    const navigating = updateListingRun(run, {
      stage: "NAVIGATING",
      status: "in-progress",
      ampBlogsState: observation.pageState,
      navigationTarget: targetHref,
      expectedStage: "FORM",
      navigationCount: run.navigationCount + 1,
      steps: [...run.steps, observedStep, `Explicit ${registrationRequested ? "registration" : "existing-account login"} path selected`, `Safe same-tab navigation prepared: ${targetHref}`],
      error: undefined,
    });
    await writeListingRun(navigating);
    await chrome.tabs.update(run.tabId, { url: targetHref });
    return;
  }

  if (observation.pageState === "LOGIN_FORM") {
    if (run.ampBlogsSubmissionStarted) {
      await writeListingRun(updateListingRun(run, {
        stage: "MANUAL_GATE",
        status: "needs-human",
        awaitingManualResume: true,
        awaitingAmpBlogsLoginAuthorization: false,
        ampBlogsState: observation.pageState,
        manual: uniqueManual([...run.manual, "Login submission started; waiting for dashboard or login error"]),
        steps: [...run.steps, observedStep, "AmpBlogs login form remains after submission attempt"],
        error: undefined,
      }));
      return;
    }
    if (run.awaitingAmpBlogsLoginAuthorization) {
      await writeListingRun(updateListingRun(run, {
        stage: "MANUAL_GATE",
        status: "needs-human",
        awaitingManualResume: true,
        awaitingAmpBlogsLoginAuthorization: true,
        ampBlogsState: observation.pageState,
        manual: uniqueManual([
          ...run.manual,
          observation.captchaState === "present" ? "CAPTCHA must be completed before authorization" : "Click AUTOFILL again to authorize Sign In / Login",
        ]),
        steps: [...run.steps, observedStep, "AmpBlogs login is waiting for explicit submission authorization"],
        error: undefined,
      }));
      return;
    }
    if (run.awaitingManualResume) {
      await writeListingRun(updateListingRun(run, {
        stage: "MANUAL_GATE",
        status: "needs-human",
        awaitingManualResume: true,
        ampBlogsState: observation.pageState,
        manual: uniqueManual([...run.manual, "CAPTCHA and Sign In / Login remain manual"]),
        steps: [...run.steps, observedStep, "AmpBlogs login form is unchanged after manual review"],
        error: undefined,
      }));
      return;
    }

    const response = await sendAmpBlogsLoginAutofill(run.tabId);
    if (!response?.ok) throw new Error(response?.error || "AmpBlogs login autofill returned no response.");
    const manual = uniqueManual([
      ...response.report.manual,
      observation.captcha ? "CAPTCHA" : "",
      observation.terms ? "Terms/Agreement" : "",
      "SIGN IN / LOGIN",
    ]);
    const filledSteps = response.report.filled.map((field) => `${field.field} filled`);
    await writeListingRun(updateListingRun(run, {
      stage: "MANUAL_GATE",
      status: "needs-human",
      awaitingManualResume: true,
      awaitingAmpBlogsLoginAuthorization: true,
      ampBlogsCaptchaRequired: observation.captcha,
      ampBlogsSubmissionStarted: false,
      ampBlogsState: observation.pageState,
      manual: uniqueManual([...manual, "Complete CAPTCHA if present, then click AUTOFILL again to authorize Sign In / Login"]),
      steps: [...run.steps, observedStep, ...filledSteps, "Stopped before CAPTCHA and final Sign In / Login"],
      error: undefined,
    }));
    return;
  }

  if (observation.pageState === "SIGNUP_FORM" && run.ampBlogsAccountStatus === "new") {
    const response = await sendAmpBlogsLoginAutofill(run.tabId);
    if (!response?.ok) throw new Error(response?.error || "AmpBlogs signup autofill returned no response.");
    await writeListingRun(updateListingRun(run, {
      stage: "MANUAL_GATE",
      status: "needs-human",
      awaitingManualResume: false,
      ampBlogsState: observation.pageState,
      manual: uniqueManual([
        ...response.report.manual,
        observation.captcha ? "CAPTCHA" : "",
        observation.terms ? "Terms/Agreement" : "",
        "Registration submission remains manual; verify account status before proceeding",
      ]),
      steps: [...run.steps, observedStep, ...response.report.filled.map((field) => `${field.field} filled`), "Stopped before registration submission"],
      error: undefined,
    }));
    return;
  }

  if (observation.pageState === "AUTHENTICATED_DASHBOARD") {
    await writeListingRun(updateListingRun(run, {
      stage: "MANUAL_GATE",
      status: "needs-human",
      awaitingManualResume: false,
      ampBlogsState: observation.pageState,
      manual: ["Authenticated AmpBlogs dashboard detected; review before any later workflow"],
      steps: [...run.steps, observedStep],
      error: undefined,
    }));
    return;
  }

  const manual = observation.pageState === "AUTH_ERROR"
    ? ["AmpBlogs login error requires human review"]
    : observation.pageState === "ACCOUNT_CREATED"
      ? ["AmpBlogs account-created state detected; no login or account action was continued"]
      : ["Unsupported or ambiguous AmpBlogs page; human review required"];
  await writeListingRun(updateListingRun(run, {
    stage: "MANUAL_GATE",
    status: "needs-human",
    awaitingManualResume: false,
    ampBlogsState: observation.pageState,
    manual,
    steps: [...run.steps, observedStep],
    error: undefined,
  }));
}

async function sendDashboardAssetMessage(tabId: number, message: Extract<ExtensionMessage, { type: "BA2_GET_PROFILE_LOGO" | "BA2_GET_PROFILE_BROCHURE" }>): Promise<ProfileLogoResponse> {
  const tab = await chrome.tabs.get(tabId);
  const origin = tab.url && new URL(tab.url).origin;
  if (origin !== "http://localhost:3000" && origin !== "http://127.0.0.1:3000") throw new Error("Dashboard asset tab is no longer on an allowed origin.");
  const read = () => withTimeout(chrome.tabs.sendMessage(tabId, message, { frameId: 0 }) as Promise<ProfileLogoResponse>, 5_000,
    { ok: false, error: "Dashboard asset receiver timed out; no automatic retry." } as ProfileLogoResponse);
  try {
    return await read() || { ok: false, error: "Dashboard asset receiver returned no response." };
  } catch (error) {
    if (!(error instanceof Error) || !/Could not establish connection\. Receiving end does not exist\./i.test(error.message)) throw error;
    const before = await chrome.tabs.get(tabId);
    if (!before.url || new URL(before.url).origin !== origin) throw new Error("Dashboard tab navigated away before receiver repair.");
    await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, files: ["content/dashboard-assets.js"] });
    const after = await chrome.tabs.get(tabId);
    if (!after.url || new URL(after.url).origin !== origin) throw new Error("Dashboard tab navigated away during receiver repair.");
    const response = await read(); // One retry of a read only; never a form or publication message.
    return response?.ok ? { ...response, diagnostics: [...response.diagnostics, "Dashboard asset receiver restored"] }
      : response || { ok: false, error: "Dashboard asset receiver returned no response after repair." };
  }
}

export async function getActiveProfileLogo(profileId: string, assetId: string, fileName: string): Promise<ProfileLogoResponse> {
  const tabs = await chrome.tabs.query({ url: ["http://localhost:3000/*", "http://127.0.0.1:3000/*"] });
  let lastError = "No dashboard tab returned the Blob bytes";
  for (const tab of tabs) {
    if (!tab.id) continue;
    try {
      const response = await sendDashboardAssetMessage(tab.id, { type: "BA2_GET_PROFILE_LOGO", profileId, assetId, fileName });
      if (response.ok) return response;
      lastError = response.error;
    } catch (error) { lastError = error instanceof Error ? error.message : "Dashboard logo message failed"; }
  }
  return { ok: false, error: `Logo asset reference found, but Blob retrieval failed: ${lastError}` };
}

export async function getActiveProfileBrochure(profileId: string, assetId: string, fileName: string): Promise<ProfileLogoResponse> {
  const tabs = await chrome.tabs.query({ url: ["http://localhost:3000/*", "http://127.0.0.1:3000/*"] });
  let lastError = "No dashboard tab returned the brochure Blob bytes";
  for (const tab of tabs) {
    if (!tab.id) continue;
    try {
      const response = await sendDashboardAssetMessage(tab.id, { type: "BA2_GET_PROFILE_BROCHURE", profileId, assetId, fileName });
      if (response.ok) return response;
      lastError = response.error;
    } catch (error) { lastError = error instanceof Error ? error.message : "Dashboard brochure message failed"; }
  }
  return { ok: false, error: `Blob retrieval failed: ${lastError}` };
}

async function continueAutomaticLogin(run: ListingRun, url: string): Promise<boolean> {
  if (new URL(url).origin !== new URL(run.sourceUrl).origin) {
    if (run.login) await saveLoginState(run, run.login.attemptId ? "uncertain" : "manual", "Login left the authorized site. Inspect it manually; no automatic retry.");
    return true;
  }
  const workflow = await readPublicationPage(run, { type: "BA2_BLOG_OBSERVE" }) as BlogWorkflowObservation | undefined;
  if (run.login && (workflow?.stage === "AUTHENTICATED_DASHBOARD" || workflow?.stage === "EDITOR" && workflow.authenticationEvidence === true)) {
    await saveLoginState(run, "authenticated", "Authenticated page recognized; resuming the existing article workflow.");
    return false;
  }
  if (run.login?.attemptId) {
    if (workflow?.loginError) await saveLoginState(run, "failed", "Website reports a login error. Inspect the account manually; no automatic retry.");
    else if (run.login.state === "failed") return true;
    else if (run.login.state !== "intent" || Date.now() - Date.parse(run.login.startedAt || "") >= 10_000) {
      await saveLoginState(run, "uncertain", "Login outcome is unconfirmed or the login page is unchanged. Inspect the site manually; no automatic retry.");
    } else await chrome.tabs.sendMessage(run.tabId, { type: "BA2_LOGIN_WATCH", runId: run.id } satisfies ExtensionMessage, { frameId: 0 });
    return true;
  }
  if (workflow?.stage === "SIGNUP") {
    const href = workflow.loginAction?.href;
    if (run.continuous && run.accountStatus === 'existing' && href && new URL(href).origin === new URL(url).origin) {
      const current = await readListingRun();
      if (current?.id !== run.id || current.login?.attemptId) return true;
      await writeListingRun(updateListingRun(current, { stage: 'NAVIGATING', navigationTarget: href,
        steps: [...current.steps, 'Existing account: following observed Login link without registration'] }));
      await chrome.tabs.update(run.tabId, { url: href });
      return true;
    }
    await saveLoginState(run, "manual", "Auto Login does not authorize registration. Complete any registration and agreements manually."); return true;
  }
  if (workflow?.stage !== "LOGIN") {
    if (run.login) { await saveLoginState(run, "manual", "Login result is not recognized. Inspect the site manually."); return true; }
    return false;
  }
  if (!await registrationRecoveryValid(run, true)) return true;
  const payload = await getActiveProfilePayload();
  if (!run.loginApproval || payload?.profile.id !== run.profileId || payload.profile.updatedAt !== run.loginApproval.profileUpdatedAt
    || !Number.isFinite(Date.parse(run.loginApproval.authorizedAt)) || Date.now() - Date.parse(run.loginApproval.authorizedAt) > 15 * 60_000) {
    await saveLoginState(run, "manual", "Login approval expired or the selected profile changed. Sign In remains manual."); return true;
  }
  if (run.login?.state === "manual" && !run.continuous) return true;
  if (run.login && run.login.url !== url) { await saveLoginState(run, "manual", "Login form location changed. Inspect the site manually."); return true; }
  // A saved preparation is not evidence that the current document still has
  // its fields. After refresh, restore empty fields only; attempts above never
  // reach this path, and content revalidates authorization and form ownership.
  const check = await withTimeout(chrome.tabs.sendMessage(run.tabId, { type: "BA2_LOGIN_PREPARE", runId: run.id, fill: !run.login || Boolean(run.continuous) } satisfies ExtensionMessage, { frameId: 0 }) as Promise<LoginCheck>, 3_000, undefined);
  if (!check) { await saveLoginState(run, "manual", "Login validation is unavailable. Sign In remains manual."); return true; }
  if (!check.ok) {
    const state = check.captcha !== "ambiguous" ? "waiting-captcha" : "manual";
    if (run.login?.state !== state || run.login.reason !== check.reason) await saveLoginState(run, state, check.reason);
    if (state === "waiting-captcha") await chrome.tabs.sendMessage(run.tabId, { type: "BA2_LOGIN_WATCH", runId: run.id } satisfies ExtensionMessage, { frameId: 0 });
    return true;
  }
  const latest = await readListingRun();
  if (!latest || latest.id !== run.id || !latest.autoLogin || latest.login?.attemptId || latest.submissionAttempted || latest.publicVerification) return true;
  const intent = updateListingRun(latest, { stage: "SUBMITTING", status: "in-progress", awaitingManualResume: true, awaitingManualLogin: false, manual: [],
    login: { url, state: "intent", reason: "Login submission intent persisted; delivery will never be retried.", attemptId: crypto.randomUUID(), startedAt: new Date().toISOString() } });
  await writeListingRun(intent);
  try {
    // One dispatch only, with no reinjection or retry on timeout/disconnection.
    const result = await withTimeout(chrome.tabs.sendMessage(run.tabId, { type: "BA2_LOGIN_SUBMIT_ONCE", runId: run.id, attemptId: intent.login!.attemptId! } satisfies ExtensionMessage, { frameId: 0 }) as Promise<LoginCheck>, 5_000, undefined);
    const saved = await readListingRun();
    if (saved?.id !== run.id) return true;
    if (!result?.ok) await saveLoginState(saved, "uncertain", "Login delivery was not confirmed. Inspect the site manually; no automatic retry.");
    else await chrome.tabs.sendMessage(run.tabId, { type: "BA2_LOGIN_WATCH", runId: run.id } satisfies ExtensionMessage, { frameId: 0 });
  } catch {
    const saved = await readListingRun();
    if (saved?.id === run.id) await saveLoginState(saved, "uncertain", "Login delivery was interrupted. Inspect the site manually; no automatic retry.");
  }
  return true;
}

async function saveLoginState(run: ListingRun, state: NonNullable<ListingRun["login"]>["state"], reason: string): Promise<void> {
  const current = await readListingRun();
  if (!current || current.id !== run.id || current.submissionAttempted || current.publicVerification) return;
  const authenticated = state === "authenticated";
  await writeListingRun(updateListingRun(current, { stage: authenticated ? "FORM" : "MANUAL_GATE", status: authenticated ? "in-progress" : "needs-human",
    awaitingManualResume: !authenticated, awaitingManualLogin: !authenticated, manual: authenticated ? [] : [reason], error: undefined,
    login: { ...current.login, url: current.login?.url || (await chrome.tabs.get(run.tabId)).url || run.sourceUrl, state, reason } }));
}

async function continueRegistration(run: ListingRun, url: string): Promise<boolean> {
  if (!run.autoRegister) return false;
  const save = async (state: NonNullable<ListingRun['registration']>['state'], reason: string, watch = false) => {
    const current = await readListingRun();
    if (current?.id !== run.id || current.submissionAttempted || current.publicVerification) return;
    await writeListingRun(updateListingRun(current, { stage: state === 'confirmed' ? 'FORM' : 'MANUAL_GATE', status: state === 'confirmed' ? 'in-progress' : 'needs-human',
      awaitingManualResume: state !== 'confirmed', manual: state === 'confirmed' ? [] : [reason], error: undefined,
      registration: { ...current.registration, url: current.registration?.url || url, state, reason } }));
    if (watch) await chrome.tabs.sendMessage(run.tabId, { type: 'BA2_REGISTRATION_WATCH', runId: run.id } satisfies ExtensionMessage, { frameId: 0 });
  };
  if (run.registration?.attemptId) {
    const key = `ba2.registrationGuard:${new URL(run.sourceUrl).origin}:${run.profileId}`;
    if ((await chrome.storage.local.get(key))[key]?.runId !== run.id) {
      // Keep both records unchanged: writeListingRun would recreate/replace
      // a receipt, which is never valid recovery evidence.
      return true;
    }
  }
  if (run.registration?.state === 'confirmed') return false;
  if (new URL(url).origin !== new URL(run.sourceUrl).origin) { await save('manual', 'Registration left the authorized website. Inspect the real account-verification flow manually.'); return true; }
  const payload = await getActiveProfilePayload();
  if (!run.registrationApproval || payload?.profile.id !== run.profileId || payload.profile.updatedAt !== run.registrationApproval.profileUpdatedAt) {
    await save('manual', 'Approved registration profile changed or consent is missing. No registration attempted.'); return true;
  }
  const page = await withTimeout(chrome.tabs.sendMessage(run.tabId, { type: 'BA2_BLOG_OBSERVE' } satisfies ExtensionMessage, { frameId: 0 }) as Promise<BlogWorkflowObservation>, 3_000, undefined);
  if (!page) { await save('manual', 'Registration page observation unavailable. No action retried.'); return true; }
  if (page.stage === 'AUTHENTICATED_DASHBOARD' && page.authenticationEvidence || page.stage === 'EDITOR' && page.authenticationEvidence
    || run.registration?.attemptId && page.registrationEvidence && page.stage !== 'ACCOUNT_VERIFICATION') {
    if (run.registrationRecovery) {
      if (!run.registration?.attemptId) { await save('manual', 'Recovery requires confirmed creation after its own registration attempt.'); return true; }
      const latest = await readListingRun();
      if (latest?.id !== run.id || !await registrationRecoveryValid(latest)) return true;
      await writeListingRun(updateListingRun(latest, { registrationCompletion: { attemptId: run.registration.attemptId, url, observedAt: new Date().toISOString(), kind: page.registrationEvidence ? 'account-created' : 'authenticated' } }));
    }
    await save('confirmed', 'Account-created/authenticated evidence recognized; continuing the same ListingRun.'); return false;
  }
  if (page.stage === 'ACCOUNT_VERIFICATION') {
    await save('verification', 'Complete email/account verification manually. MAHID does not access your inbox or activate links.', true); return true;
  }
  if (run.registration?.attemptId) {
    if (page.registrationError) await save('failed', 'Website reports a registration/account error. Inspect it; registration will not be repeated.');
    else if (run.registration.state !== 'failed') await save('uncertain', 'Registration outcome is not independently confirmed. Observation only; never resubmit.', true);
    return true;
  }
  if (page.stage === 'HOMEPAGE') return false; // Existing branch selects Sign Up first.
  if (page.stage !== 'SIGNUP') { await save('manual', 'No reliable registration form or account-created evidence. Website structure needs review.'); return true; }
  if (run.registration?.url && run.registration.url !== url || !Number.isFinite(Date.parse(run.registrationApproval.authorizedAt))
    || Date.now() - Date.parse(run.registrationApproval.authorizedAt) > 15 * 60_000) {
    await save('manual', 'Registration form changed or registration approval expired. No submit attempted.'); return true;
  }
  const guardKey = `ba2.registrationGuard:${new URL(run.sourceUrl).origin}:${run.profileId}`;
  if ((await chrome.storage.local.get(guardKey))[guardKey]) { await save('manual', 'A registration receipt already exists. Inspect the account; duplicate registration blocked.'); return true; }
  const check = await withTimeout(chrome.tabs.sendMessage(run.tabId, { type: 'BA2_REGISTRATION_PREPARE', runId: run.id, fill: !run.registration || Boolean(run.continuous) } satisfies ExtensionMessage, { frameId: 0 }) as Promise<LoginCheck>, 3_000, undefined);
  if (!check?.ok) { await save(check?.captcha === 'ambiguous' ? 'manual' : 'waiting-human', check?.reason || 'Registration validation unavailable; no submit attempted.', Boolean(check && check.captcha !== 'ambiguous')); return true; }
  const latest = await readListingRun();
  if (!latest || latest.id !== run.id || !latest.autoRegister || latest.registration?.attemptId || latest.submissionAttempted || latest.publicVerification) return true;
  const intent = updateListingRun(latest, { stage: 'SUBMITTING', status: 'in-progress', awaitingManualResume: true, manual: [],
    registration: { url, state: 'intent', attemptId: crypto.randomUUID(), reason: 'Registration intent persisted; one dispatch only.' } });
  await writeListingRun(intent);
  try {
    // Never retry/inject a registration submission after timeout or lost reply.
    const result = await withTimeout(chrome.tabs.sendMessage(run.tabId, { type: 'BA2_REGISTRATION_SUBMIT_ONCE', runId: run.id, attemptId: intent.registration!.attemptId! } satisfies ExtensionMessage, { frameId: 0 }) as Promise<LoginCheck>, 5_000, undefined);
    if (!result?.ok) await save('uncertain', 'Registration delivery is uncertain. Inspect the account; no retry.', true);
    else await save('intent', 'Registration submitted once. Waiting for account-created/authenticated evidence.', true);
  } catch { await save('uncertain', 'Registration delivery was interrupted. Observation only; never retry.', true); }
  return true;
}

async function continueListingRun(run: ListingRun): Promise<void> {
  try {
    const persisted = await readListingRun();
    if (persisted?.id !== run.id || persisted.publicVerification) return;
    run = persisted;
    if (isAutomationExcluded(run.sourceUrl) || isAutomationExcluded((await chrome.tabs.get(run.tabId)).url)) return;
    if (run.directory3) { await progressDirectory3(run.id); return; }
    if (run.nativeDirectory) { await continueFamily3ListingRun(run); return; }
    if (run.tabUnavailable) return;
    if (!await registrationRecoveryValid(run, run.registration?.state === "confirmed")) return;
    if (run.submissionAttempted) { await observePublicationOutcome(run); return; }
    if (run.stage === "NAVIGATING") {
      const tab = await chrome.tabs.get(run.tabId);
      if (!tab.url || tab.status === "loading" || run.navigationTarget && new URL(tab.url).href !== new URL(run.navigationTarget).href) return;
      // Persist verification under the existing run lock, never from an event's
      // stale snapshot that could overwrite later autofill/submission intent.
      run = updateListingRun(run, { retryCount: 0, navigationVerified: true, resumed: true, steps: [...run.steps, "Navigation target verified", "Run resumed"] });
      await writeListingRun(run);
    }
    // A human-completion signal can arrive while the authorized next page is
    // still loading. Never probe a receiver in the document being replaced.
    if (run.continuous) await ensureListingReceiver(run.tabId);
    if (run.autoRegister) {
      const tab = await chrome.tabs.get(run.tabId);
      if (!tab.url || await continueRegistration(run, tab.url)) return;
      run = (await readListingRun())!;
    }
    if (run.autoPublish === true && run.publicationEditorUrl) { await prepareAutoPublication(run); return; }
    if (run.autoLogin && run.login?.state !== "authenticated") {
      const tab = await chrome.tabs.get(run.tabId);
      if (!tab.url || await continueAutomaticLogin(run, tab.url)) return;
      run = (await readListingRun())!;
    }
    if (run.continuous && !run.publicationEditorUrl) {
      const tab = await chrome.tabs.get(run.tabId);
      const workflow = await readPublicationPage(run, { type: 'BA2_BLOG_OBSERVE' }) as BlogWorkflowObservation | undefined;
      if (workflow && ['HOMEPAGE', 'AUTHENTICATED_DASHBOARD', 'ACCOUNT_CREATED'].includes(workflow.stage)
        && await continueBlogWorkflow(run, { profileName: '', filled: [], skipped: [], manual: [], workflow }, tab.url!)) return;
    }
    if (!run.autoLogin && isGenericManualLogin(run)) {
      const tab = await chrome.tabs.get(run.tabId);
      let workflow: BlogWorkflowObservation | undefined;
      if (tab.url && new URL(tab.url).origin === new URL(run.sourceUrl).origin) {
        try {
          workflow = await withTimeout(chrome.tabs.sendMessage(run.tabId, { type: "BA2_BLOG_OBSERVE" } satisfies ExtensionMessage, { frameId: 0 }) as Promise<BlogWorkflowObservation>, 3_000, undefined);
        } catch { /* Keep the manual checkpoint if the read-only observer is unavailable. */ }
      }
      if (!workflow || !["AUTHENTICATED_DASHBOARD", "EDITOR", "CONFIRMATION"].includes(workflow.stage)) {
        await waitForGenericManualLogin(run, workflow?.stage === "LOGIN" ? undefined : "Login result is not recognized. Inspect the website manually; CHECK LOGIN only rechecks and never submits Sign In.");
        return;
      }
      const latestLoginRun = await readListingRun();
      if (!latestLoginRun || latestLoginRun.id !== run.id || latestLoginRun.submissionAttempted || latestLoginRun.publicVerification) return;
      run = updateListingRun(latestLoginRun, { awaitingManualLogin: false, awaitingManualResume: false, manual: [], steps: [...latestLoginRun.steps, "Page transition observed after manual login; resuming the existing run"] });
      await writeListingRun(run);
    }
    const current = await chrome.tabs.get(run.tabId);
    if (!current.url || !/^https?:$/i.test(new URL(current.url).protocol)) throw new Error("Autofill is unavailable on this page.");
    if (run.autoPublish === true) {
      const approved = await getActiveProfilePayload();
      if (!run.publicationApproval || approved?.profile.id !== run.profileId || await publicationProfileFingerprint(approved.profile) !== run.publicationApproval.profileFingerprint) {
        await writeListingRun(updateListingRun(run, { stage: "MANUAL_GATE", status: "needs-human", awaitingManualResume: true, manual: ["Approved profile changed; workflow stopped before autofill or publication. Restore the approved profile or end this run."] }));
        return;
      }
    }
    if (run.domain === "ampblogs.com" && !run.autoLogin && !run.autoRegister) {
      await continueAmpBlogsRun(run, current.url);
      return;
    }
    const recipe = await getSiteFlowRecipe(run.sourceUrl);
    if (run.stage === "DISCOVER" && !run.homepageStart && recipe && new URL(recipe.entryUrl).origin === new URL(current.url).origin && recipe.entryUrl !== current.url) {
      run = updateListingRun(run, { stage: "NAVIGATING", entryUrl: recipe.entryUrl, expectedStage: "LOCATION", navigationCount: run.navigationCount + 1, steps: [...run.steps, "Known Site · learned flow available"] });
      await writeListingRun(run);
      await chrome.tabs.update(run.tabId, { url: recipe.entryUrl });
      return;
    }
    run = updateListingRun(run, { stage: "FORM" });
    await writeListingRun(run);
     const payload = await getActiveProfilePayload();
     const categoryMapping = await getSiteCategoryMapping(run.sourceUrl, payload?.profile.category || "");
      const response = await sendListingMessage(run.tabId, categoryMapping ? { profileKey: categoryMapping.profileKey, value: categoryMapping.value, label: categoryMapping.label } : undefined, run.autoPublish === true);
      if (!response.ok) throw new Error(response.error);
      if (response.report.workflow?.stage === "EDITOR" && response.report.expectedArticle && payload?.profile.id === run.profileId
        && response.report.filled.some((field) => field.field === "businessName") && response.report.filled.some((field) => field.field === "description")) {
        run = updateListingRun(run, { expectedArticle: response.report.expectedArticle });
        await writeListingRun(run);
      }
      const structuralEvidence = response.report.structural;
      const structuralMatch = structuralEvidence
        ? await getCrossDomainStructuralRecipe(run.sourceUrl, structuralEvidence)
        : null;
      if (structuralMatch) {
        const signature = structuralEvidence?.formSignature || "";
        run = updateListingRun(run, {
          visitedSignatures: [...new Set([...(run.visitedSignatures || []), signature])],
          steps: [...run.steps, `Structural workflow matched: ${structuralMatch.recipe.domain} (${structuralMatch.score.toFixed(2)})`, `Structural signals: ${structuralMatch.matchedSignals.join(", ")}`],
        });
        await writeListingRun(run);
      }
      if (await continueBlogWorkflow(run, response.report, current.url)) return;
      if (response.report.category) {
       const category = response.report.category;
       const detectedStep = category.level === "subcategory" ? "Subcategory page detected" : "Category page detected";
       if (category.status === "location-mismatch" || category.status === "no-match") {
          const candidateSteps = (category.recommendations || []).map((candidate, index) => `Candidate ${index + 1}: ${candidate.label} (${candidate.confidence.toFixed(2)})`);
         run = updateListingRun(run, { stage: "HUMAN_GATE", manual: [category.message || "Category requires manual selection"], steps: [...run.steps, detectedStep, ...(category.reason ? [`Reason: ${category.reason}`] : []), ...candidateSteps], error: undefined, status: "needs-human" });
         await writeListingRun(run);
         return;
       }
       run = updateListingRun(run, {
         stage: "NAVIGATING",
         navigationCount: run.navigationCount + 1,
         category: category.level === "category" ? category.label : run.category,
         subcategory: category.level === "subcategory" ? category.label : run.subcategory,
           candidate: category.label,
           action: `Action created: select ${category.level} option`,
           steps: [...run.steps, ...(response.report.adaptive?.diagnostics || []), detectedStep, ...(category.reason ? [`Reason: ${category.reason}`] : []), ...(category.recommendations || []).map((candidate, index) => `Candidate ${index + 1}: ${candidate.label} (${candidate.confidence.toFixed(2)})`), `${category.level === "subcategory" ? "Subcategory" : "Category"}: ${category.label}`],
         error: undefined,
          status: "in-progress",
          navigationTarget: category.href,
          expectedStage: category.level === "category" ? "SUBCATEGORY" : "FORM",
         });
         await writeListingRun(run);
         scheduleCategoryActionTimeout(run, category.level === "subcategory" ? "Subcategory" : "Category");
         let selected: { ok?: boolean; selected?: string; href?: string; error?: string };
        try {
          selected = await chrome.tabs.sendMessage(run.tabId, { type: "BA2_SELECT_CATEGORY", label: category.label || "", href: category.href } satisfies ExtensionMessage);
        } catch (error) {
          if (!category.href || new URL(category.href, current.url).origin !== new URL(current.url).origin) throw error;
          await chrome.tabs.update(run.tabId, { url: category.href });
          run = updateListingRun(run, { steps: [...run.steps, `Subcategory click response lost; safe href navigation executed: ${category.href}`] });
          await writeListingRun(run);
          return;
        }
         if (!selected?.ok || selected.selected !== category.label) {
          if (!category.href || new URL(category.href, current.url).origin !== new URL(current.url).origin) throw new Error(selected?.error || `Category action failed: ${category.label}`);
          await chrome.tabs.update(run.tabId, { url: category.href });
          run = updateListingRun(run, { steps: [...run.steps, `Subcategory click failed; safe href navigation executed: ${category.href}`] });
          await writeListingRun(run);
           return;
         }
         run = updateListingRun(run, { action: `Action executed: ${category.level} ${selected.selected}`, steps: [...run.steps, `Action executed: ${category.level} ${selected.selected}`] });
         await writeListingRun(run);
         const afterClick = await chrome.tabs.get(run.tabId);
         if (category.href && afterClick.url === current.url) {
          await chrome.tabs.update(run.tabId, { url: category.href });
          run = updateListingRun(run, { steps: [...run.steps, `Subcategory click did not navigate; safe href navigation executed: ${category.href}`] });
          await writeListingRun(run);
           return;
         }
          if (!category.href && afterClick.url === current.url) {
            if (run.navigationCount < 4) void probeSameDocumentResume(run, category.level === "subcategory" ? "SUBCATEGORY" : "CATEGORY", current.url).catch((error) => { void writeListingRun(updateListingRun(run, { stage: "ERROR", error: `Same-document resume failed: ${error instanceof Error ? error.message : "unknown error"}`, steps: [...run.steps, "Same-document resume failed"] })); });
            return;
          }
        return;
     }
     if (response.report.location) {
       const location = response.report.location;
       if (location.status === "no-match") {
         run = updateListingRun(run, { stage: "HUMAN_GATE", manual: [location.message || "No matching location found"], steps: [...run.steps, "Location page detected"], error: undefined, status: "needs-human" });
         await writeListingRun(run);
         return;
       }
         run = updateListingRun(run, { stage: "NAVIGATING", navigationCount: run.navigationCount + 1, candidate: location.label, action: "Action created: select location option", navigationTarget: location.href, expectedStage: "CATEGORY", steps: [...run.steps, ...(response.report.adaptive?.diagnostics || []), "Location page detected", `Candidate: ${location.label}`, "Action created: select location option"], error: undefined, status: "in-progress" });
        await writeListingRun(run);
        scheduleCategoryActionTimeout(run, "Location");
        const selected = await chrome.tabs.sendMessage(run.tabId, { type: "BA2_SELECT_LOCATION", label: location.label || "", href: location.href } satisfies ExtensionMessage) as { ok?: boolean; selected?: string; href?: string; error?: string };
        if (!selected?.ok) throw new Error(selected?.error || "Location action failed");
        run = updateListingRun(run, { action: `Action executed: location ${selected.selected || location.label}`, steps: [...run.steps, `Action executed: location ${selected.selected || location.label}`] });
        await writeListingRun(run);
        const afterLocation = await chrome.tabs.get(run.tabId);
        if (afterLocation.url === current.url && location.href) {
          const nextLocation = new URL(location.href, current.url);
          if (nextLocation.origin !== new URL(current.url).origin) throw new Error("Location href crossed site origin");
          run = updateListingRun(run, { navigationTarget: nextLocation.href, steps: [...run.steps, `Location href navigation executed: ${nextLocation.href}`] });
          await writeListingRun(run);
          await chrome.tabs.update(run.tabId, { url: nextLocation.href });
        } else if (afterLocation.url === current.url) void probeSameDocumentResume(run, "LOCATION", current.url).catch((error) => { void writeListingRun(updateListingRun(run, { stage: "ERROR", error: `Same-document location resume failed: ${error instanceof Error ? error.message : "unknown error"}`, steps: [...run.steps, "Same-document location resume failed"] })); });
        return;
     }
      if (response.report.navigationUrl) {
      const nextUrl = new URL(response.report.navigationUrl, current.url);
      if (nextUrl.origin !== new URL(current.url).origin || run.navigationCount >= 4) throw new Error("Safe navigation stopped at the listing entry point.");
       run = updateListingRun(run, { stage: "NAVIGATING", entryUrl: run.entryUrl || nextUrl.href, navigationCount: run.navigationCount + 1, expectedStage: "LOCATION", steps: [...run.steps, response.report.adaptive?.diagnostics?.join(" · ") || "Listing entry found"] });
       await writeListingRun(run);
        if (response.report.entryAction?.href) {
          const entryHref = new URL(response.report.entryAction.href, current.url);
          if (entryHref.origin !== new URL(current.url).origin) throw new Error("Entry href crossed site origin");
          await chrome.tabs.update(run.tabId, { url: entryHref.href });
        } else {
          const selected = await chrome.tabs.sendMessage(run.tabId, { type: "BA2_SELECT_ENTRY", label: response.report.entryAction?.label || "", href: response.report.entryAction?.href } satisfies ExtensionMessage) as { ok?: boolean; error?: string };
          if (!selected?.ok) throw new Error(selected?.error || "Entry action failed after run persistence");
          run = updateListingRun(run, { steps: [...run.steps, "Entry action executed after run persistence"] });
          await writeListingRun(run);
        }
        return;
     }
      if (response.report.filled.length === 0 && response.report.manual.length === 0 && !response.report.form && response.report.adaptive?.stage !== "FORM") {
       throw new Error(run.domain === "freewebads.biz" ? "Post Free Ad not found" : "Action execution failed: listing entry point not found");
     }
     const categoryManual = response.report.skipped.some((field) => field.reason.includes("Category requires manual selection"));
      let formSteps = [
       ...(response.report.adaptive?.diagnostics || []),
        payload?.profile.logoAsset ? "Logo asset reference found" : response.report.form ? "Logo unavailable in Active Profile" : undefined,
        response.report.form?.location?.verified ? `Location: ${response.report.form.location.value}` : undefined,
         response.report.form?.description?.verified ? "Post/Description filled" : undefined,
         response.report.form?.contactForm?.verified ? "Contact-form option selected" : undefined,
         response.report.form?.commercialInterests?.checked ? "Commercial interests enabled" : undefined,
         response.report.form?.terms?.checked ? "Terms of Use checked" : undefined,
       ].filter((step): step is string => Boolean(step));
         let logoMessage: string | undefined;
         let brochureMessage: string | undefined;
      const articleEditor = response.report.workflow?.stage === "EDITOR";
      const logoRequested = response.report.form?.logo?.requested;
      if (articleEditor && payload?.profile.logoAsset && logoRequested === undefined) {
        logoMessage = "Editor logo upload target evidence is unavailable. Review the page before publication.";
      }
        if (response.report.form && !payload?.profile.logoAsset) formSteps = [...formSteps, "Logo unavailable in Active Profile"];
      if (response.report.form && payload?.profile.logoAsset && (!articleEditor || logoRequested === true)) {
        const logo = await getActiveProfileLogo(payload.profile.id, payload.profile.logoAsset.id, payload.profile.logoAsset.fileName);
        if (logo.ok) {
          formSteps = [...formSteps, ...logo.diagnostics];
          try {
            const attached = await chrome.tabs.sendMessage(run.tabId, { type: "BA2_ATTACH_PROFILE_LOGO", fileName: logo.fileName, mimeType: logo.mimeType, data: logo.data } satisfies ExtensionMessage) as LogoAttachResponse | undefined;
            if (attached?.ok) { formSteps = [...formSteps, ...(attached.diagnostics || []), `Logo attached: ${attached.fileName || logo.fileName} (${attached.fileSize || logo.size} bytes ${attached.fileType || logo.mimeType})`]; logoMessage = undefined; }
            else { formSteps = [...formSteps, ...(attached?.diagnostics || [])]; logoMessage = attached?.error || "Logo upload returned no acknowledgement; inspect the upload input before publication."; }
          } catch {
            logoMessage = "Logo upload delivery failed; inspect the upload input before publication.";
          }
        } else {
          formSteps = [...formSteps, ...(logo.diagnostics || [])];
          logoMessage = logo.error;
        }
      }
      let brochureRequested = Boolean(response.report.form?.brochure?.requested);
      if (!brochureRequested && response.report.form && payload?.profile.brochureAsset) {
        try {
          brochureRequested = Boolean(await chrome.tabs.sendMessage(run.tabId, { type: "BA2_FIND_BROCHURE_INPUT" } satisfies ExtensionMessage));
        } catch {
          brochureRequested = false;
        }
      }
      if (brochureRequested && payload?.profile.brochureAsset) {
        const brochure = await getActiveProfileBrochure(payload.profile.id, payload.profile.brochureAsset.id, payload.profile.brochureAsset.fileName);
        if (brochure.ok) {
          formSteps = [...formSteps, ...brochure.diagnostics];
          try {
            const attached = await chrome.tabs.sendMessage(run.tabId, { type: "BA2_ATTACH_PROFILE_BROCHURE", fileName: brochure.fileName, mimeType: brochure.mimeType, data: brochure.data } satisfies ExtensionMessage) as LogoAttachResponse;
            if (attached?.ok) formSteps = [...formSteps, ...(attached.diagnostics || []), `Brochure attached: ${attached.fileName || brochure.fileName}`];
            else if (attached) brochureMessage = attached.error || "Brochure input assignment failed";
          } catch {
            // No explicit PDF/document input exists in the current form.
          }
        } else {
          brochureMessage = brochure.error;
          formSteps = [...formSteps, ...(brochure.diagnostics || [])];
        }
      } else if (brochureRequested && !payload?.profile.brochureAsset) {
        brochureMessage = "PDF/document attachment requested, but no Brochure is present in the Active Profile";
      }
      const manual = [...response.report.manual, ...(logoMessage ? [logoMessage] : []), ...(brochureMessage ? [brochureMessage] : []), ...(categoryManual ? ["Category requires manual selection"] : [])];
      if (run.autoPublish === true && response.report.workflow?.stage === "EDITOR") {
        run = updateListingRun(run, { publicationEditorUrl: current.url });
        await writeListingRun(run);
        const unresolved = manual.filter((item) => !/^(?:Final Submit|CAPTCHA|Terms\/Agreement|Required field requires manual input:)/.test(item));
        if (unresolved.length) {
          await writeListingRun(updateListingRun(run, { stage: "MANUAL_GATE", status: "needs-human", awaitingManualResume: true, manual: unresolved }));
        } else await prepareAutoPublication(run);
        return;
      }
     run = updateListingRun(run, {
       stage: manual.length ? "MANUAL_GATE" : "COMPLETE",
       awaitingManualResume: Boolean(manual.length && response.report.workflow?.stage === "EDITOR"),
       steps: [...run.steps, "Submission form opened", ...response.report.filled.map((field) => field.field === "businessName" ? "Title filled" : field.field === "email" ? "Submission Email filled" : field.field === "description" ? "Post/Description filled" : field.field === "category" ? `Category: ${field.value}` : `${field.field} filled`), ...formSteps],
      manual,
      category: response.report.filled.find((field) => field.field === "category")?.value,
      error: undefined,
    });
    await writeListingRun(run);
    const selectedCategory = response.report.filled.find((field) => field.field === "category");
    if (response.report.filled.length > 0 && run.entryUrl) {
      await recordSiteFlowSuccess(
        run.sourceUrl,
        run.entryUrl,
        selectedCategory ? { profileKey: normalizeCategoryKey(payload?.profile.category || ""), value: selectedCategory.value, label: selectedCategory.value } : undefined,
        {
          verificationStatus: run.domain === "directory3.org" ? "live-verified" : "learned",
          entryBehavior: run.domain === "directory3.org" ? "homepage-submit-links" : undefined,
          fieldMappings: { Title: "Business Name", URL: "Website", Description: "Description -> Short Description", "Your Name": "Contact Name", "Your Email": "Submission Email" },
          categoryBehavior: "profile-category-services-semantic",
           formSignature: response.report.structural?.formSignature || "listing-title-url-description-your-name-your-email-category",
           pageSignatures: response.report.structural?.pageSignatures,
          manualGates: ["Reciprocal Link URL", "CAPTCHA", "Final Continue / Submit"],
        },
      );
    }
  } catch (error) {
    const latest = await readListingRun();
    if (!latest || latest.id !== run.id) return;
    if (isMissingTabError(error, latest.tabId)) { await markListingTabUnavailable(latest, "missing"); return; }
    if (latest.submissionAttempted) {
      const reason = "Publication outcome is uncertain after interruption. Inspect existing posts/public URL; no automatic retry.";
      await writeListingRun(updateListingRun(latest, { stage: "MANUAL_GATE", status: "needs-human", awaitingManualResume: true, manual: [reason], error: undefined,
        publicationSubmission: latest.publicationSubmission ? { ...latest.publicationSubmission, outcome: "uncertain", reason } : undefined }));
      return;
    }
    const message = error instanceof Error ? error.message : "Autofill failed.";
    await writeListingRun(updateListingRun(latest, { stage: "ERROR", error: message, steps: [...latest.steps, message.includes("Content script") ? "Content script unavailable" : message.includes("Post Free Ad") ? "Post Free Ad not found" : "Action execution failed"] }));
  }
}

async function startCaptureJob(message: Extract<ExtensionMessage, { type: "BA2_CAPTURE_REQUEST" }>): Promise<CaptureRequestAck> {
  const job = createCaptureJob(message.jobId, message.sourceType, message.sourceUrl);
  try {
    await writeCaptureJob(job);
    void runCaptureJob(job);
    return { ok: true, jobId: job.id };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not persist capture request." };
  }
}

async function runCaptureJob(initial: CaptureJob): Promise<void> {
  let job = initial;
  try {
    job = await updateCaptureJob(job, "finding-tab", "1. Dashboard capture request created · 2. Dashboard bridge reached · 3. Extension background received request");
    if (!isAllowedCaptureUrl(job.sourceUrl, job.sourceType) || isDashboardUrl(job.sourceUrl)) {
      await updateCaptureJob(job, "error", "Capture rejected: dashboard or invalid source URL.");
      return;
    }
    const tabs = await withTimeout(chrome.tabs.query({}), 4_000, []);
    let tab = tabs.find((candidate) => candidate.id !== undefined && candidate.url && matchesSourceOrigin(candidate.url, job.sourceUrl));
    if (!tab) tab = await withTimeout(chrome.tabs.create({ url: job.sourceUrl, active: true }), 4_000, {} as chrome.tabs.Tab);
    if (!tab.id) { await updateCaptureJob(job, "error", "Source tab unavailable. Retry Capture."); return; }
    job = await updateCaptureJob(job, "waiting-for-page", `4. Matching source tab found · ${tab.id} · 5. Waiting for source tab to load`, undefined, tab.url);
    const ready = await withTimeout(waitForTabReady(tab.id).then(() => true), 9_000, false);
    if (!ready) { await updateCaptureJob(job, "error", "Source tab timed out while loading. Retry Capture."); return; }
    const refreshed = await chrome.tabs.get(tab.id);
    if (refreshed.status !== "complete") { await updateCaptureJob(job, "error", "Source tab is still loading. Retry Capture."); return; }
    if (!refreshed.url || !matchesSourceOrigin(refreshed.url, job.sourceUrl)) { await updateCaptureJob(job, "error", "Wrong source tab captured: URL did not match."); return; }
    job = await updateCaptureJob(job, "capturing", "6. Source tab loaded · 7. Content extractor reached · 8. Extracting rendered DOM");
    const response = await withTimeout(requestTabCapture(tab.id), 4_000, { ok: false, error: "Content script did not respond. Reload the source tab and Retry Capture.", code: "content_script" } satisfies SourceCaptureResponse);
    if (!response.ok) {
      await updateCaptureJob(job, response.code === "action_required" ? "action-required" : "error", response.error);
      return;
    }
    if (sourceOrigin(job.sourceUrl) !== sourceOrigin(response.snapshot.sourceUrl) || response.snapshot.sourceType !== job.sourceType) {
      await updateCaptureJob(job, "error", "Wrong source captured: SourceSnapshot URL/type did not match.");
      return;
    }
    if (!hasUsefulSnapshot(response.snapshot)) {
      await updateCaptureJob(job, "error", "Extraction produced no useful business data. Retry Capture.");
      return;
    }
    await updateCaptureJob(job, "success", "8. DOM snapshot extracted · 9. SourceSnapshot validated and stored · 10. Snapshot returned to dashboard", response.snapshot);
  } catch (error) {
    await updateCaptureJob(job, "error", `Capture failed: ${error instanceof Error ? error.message : "extension or tab error"}. Retry Capture.`).catch(() => undefined);
  }
}

async function waitForTabReady(tabId: number): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === "complete") return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Timed out waiting for source tab.");
}

function requestTabCapture(tabId: number): Promise<SourceCaptureResponse> {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, { type: "BA2_CAPTURE_SOURCE" } satisfies ExtensionMessage, (response) => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) { reject(new Error(runtimeError.message)); return; }
      resolve(response as SourceCaptureResponse || { ok: false, error: "Source capture returned no response; inspect the source tab before retrying.", code: "content_script" });
    });
  });
}

async function writeCaptureJob(job: CaptureJob): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.captureJob]: job });
}

async function updateCaptureJob(job: CaptureJob, status: CaptureJob["status"], message: string, snapshot?: CaptureJob["snapshot"], matchedTabUrl?: string): Promise<CaptureJob> {
  const next: CaptureJob = { ...job, status, message, snapshot, matchedTabUrl: matchedTabUrl ?? job.matchedTabUrl, updatedAt: new Date().toISOString() };
  await writeCaptureJob(next);
  return next;
}

function hasUsefulSnapshot(snapshot: { facts: Record<string, unknown>; internalLinks: unknown[] }): boolean {
  return Object.values(snapshot.facts).some((value) => Boolean(value && (!Array.isArray(value) || value.length))) || snapshot.internalLinks.length > 0;
}

async function recoverInterruptedCaptureJob(): Promise<void> {
  const data = await chrome.storage.local.get(STORAGE_KEYS.captureJob);
  const job = normalizeCaptureJob(data[STORAGE_KEYS.captureJob]);
  if (!job || job.status === "success" || job.status === "action-required" || job.status === "error") return;
  await updateCaptureJob(job, "error", "Extension service worker restarted during capture. Retry Capture.");
}
