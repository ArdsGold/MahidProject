import type { AmpBlogsPageState } from "./ampblogs";
import type { ArticleExpectation, PublicArticleCheck } from "./automation/verification";
import type { BusinessProfile } from "@backlink-autofill/shared";

export type ListingRunStage = "INITIALIZING" | "DISCOVER" | "NAVIGATING" | "LOCATION" | "CATEGORY" | "SUBCATEGORY" | "FORM_DISCOVERY" | "FORM" | "FILLING" | "UPLOAD" | "VALIDATING" | "HUMAN_GATE" | "MANUAL_GATE" | "READY_TO_SUBMIT" | "SUBMITTING" | "VERIFYING_SUCCESS" | "EXTRACTING_LIVE_URL" | "COMPLETE" | "FAILED" | "ERROR";

export interface ListingRun {
  directory3?: import("./automation/directory3-submission").Directory3Submission;
  nativeDirectory?: { profileUpdatedAt: string; phase: "entry" | "navigating" | "filling" | "manual" | "failed" };
  id: string;
  domain: string;
  sourceUrl: string;
  profileId: string;
  tabId: number;
  tabUnavailable?: { tabId: number; detectedAt: string; reason: "missing" | "closed" | "replaced"; replacementTabId?: number };
  stage: ListingRunStage;
  navigationCount: number;
  startedAt: string;
  updatedAt: string;
  entryUrl?: string;
  homepageStart?: boolean;
  steps: string[];
  manual: string[];
  category?: string;
  subcategory?: string;
  navigationTarget?: string;
  error?: string;
  status?: "success" | "pending" | "failed" | "needs-human" | "in-progress";
  liveUrl?: string;
  visitedSignatures?: string[];
  retryCount?: number;
  candidate?: string;
  action?: string;
  navigationVerified?: boolean;
  resumed?: boolean;
  expectedStage?: "LOCATION" | "CATEGORY" | "SUBCATEGORY" | "FORM";
  ampBlogsState?: AmpBlogsPageState;
  awaitingManualResume?: boolean;
  awaitingManualLogin?: boolean;
  awaitingAmpBlogsLoginAuthorization?: boolean;
  ampBlogsCaptchaRequired?: boolean;
  ampBlogsSubmissionStarted?: boolean;
  ampBlogsAccountStatus?: "existing" | "new";
  accountStatus?: "existing" | "new";
  autoPublish?: boolean;
  autoLogin?: boolean;
  continuous?: { loginReceiptsSnapshot: string; registrationReceiptSnapshot: string };
  autoRegister?: boolean;
  existingAccountRecovery?: { oldRunId: string; loginGuardSnapshot: string; registrationGuardSnapshot: string; authorizedAt: string };
  registrationRecovery?: { oldRunId: string; oldLoginAttemptId: string; guardSnapshot: string; authorizedAt: string; firstRegistrationConfirmed: true };
  registrationCompletion?: { attemptId: string; url: string; observedAt: string; kind: "account-created" | "authenticated" };
  registrationApproval?: { authorizedAt: string; profileUpdatedAt: string };
  registration?: { url: string; state: "waiting-human" | "manual" | "intent" | "uncertain" | "verification" | "confirmed" | "failed"; reason: string; attemptId?: string; claimed?: boolean };
  loginApproval?: { authorizedAt: string; profileUpdatedAt: string };
  login?: { url: string; state: "waiting-captcha" | "manual" | "intent" | "uncertain" | "failed" | "authenticated"; reason: string; attemptId?: string; startedAt?: string; claimed?: boolean };
  submissionAttempted?: boolean;
  publicationApproval?: { authorizedAt: string; profileFingerprint: string };
  publicationEditorUrl?: string;
  publicationSubmission?: { attemptId: string; url: string; startedAt: string; claimed?: boolean; outcome: "intent" | "uncertain"; reason?: string };
  expectedArticle?: ArticleExpectation;
  publicationConfirmation?: { url: string; visitUrl?: string; observedAt: string };
  automaticPublicationRecoveries?: number;
  sheetSync?: {
    status: "syncing" | "ready" | "recorded" | "already-recorded" | "blocked" | "conflict" | "failed" | "uncertain";
    mode?: "prepare" | "write";
    readAttempts?: number;
    attemptId: string;
    liveUrl: string;
    code: string;
    reason: string;
    rowNumber?: number;
    range?: string;
    readBackConfirmed?: boolean;
    checkedAt?: string;
  };
  publicVerification?: {
    status: PublicArticleCheck["status"] | "verifying";
    candidateUrl?: string;
    confirmationUrl?: string;
    attemptId: string;
    reason: string;
    checkedAt?: string;
  };
}

export const LISTING_RUN_KEY = "ba2.listingRun";

export function publicationGuardKey(url: string, profileId: string): string {
  let host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  if (/^[a-z0-9-]+\.blogocial\.com$/.test(host)) host = "blogocial.com";
  if (/^[a-z0-9-]+\.bloguetechno\.com$/.test(host)) host = "bloguetechno.com";
  if (/^[a-z0-9-]+\.thezenweb\.com$/.test(host)) host = "thezenweb.com";
  return `ba2.publicationGuard:${host}:${profileId}`;
}

export async function readPublicationGuard(url: string, profileId: string): Promise<{ runId: string; liveUrl?: string } | undefined> {
  const key = publicationGuardKey(url, profileId);
  return (await chrome.storage.local.get(key))[key];
}

// Only approved public article inputs participate; never submission credentials.
export function publicationProfileSnapshot(profile: BusinessProfile): string {
  return JSON.stringify([profile.id, profile.updatedAt, profile.businessName, profile.description, profile.imageUrl, profile.businessHours]);
}

export async function publicationProfileFingerprint(profile: BusinessProfile): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(publicationProfileSnapshot(profile)));
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function readListingRun(): Promise<ListingRun | null> {
  const data = await chrome.storage.local.get(LISTING_RUN_KEY);
  const run = data[LISTING_RUN_KEY] as ListingRun | undefined;
  return run && typeof run.id === "string" ? run : null;
}

export async function writeListingRun(run: ListingRun | null, archivedRun?: ListingRun): Promise<void> {
  if (!run && !archivedRun) throw new Error('Detaching a run requires its preserved archive.');
  const values: Record<string, unknown> = { [LISTING_RUN_KEY]: run };
  if (archivedRun && archivedRun.id !== run?.id) {
    const key = `ba2.listingRunArchive:${archivedRun.id}`;
    const existing = (await chrome.storage.local.get(key))[key];
    if (existing && JSON.stringify(existing) !== JSON.stringify(archivedRun)) {
      // Preserve both historical versions; switching websites cannot erase one.
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(archivedRun)));
      const revision = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
      values[`${key}:snapshot:${revision}`] = archivedRun;
    } else values[key] = archivedRun;
  }
  if (run?.login?.attemptId) values[loginGuardKey(run)] = { runId: run.id, state: run.login.state };
  if (run?.registration?.attemptId) values[`ba2.registrationGuard:${new URL(run.sourceUrl).origin}:${run.profileId}`] = { runId: run.id, state: run.registration.state };
  if (run && (run.submissionAttempted || run.publicVerification)) {
    values[publicationGuardKey(run.sourceUrl, run.profileId)] = { runId: run.id, liveUrl: run.liveUrl };
  }
  await chrome.storage.local.set(values);
}

export function canArchiveStoppedRun(run: ListingRun | null, currentUrl: string): boolean {
  try {
    const current = new URL(currentUrl), saved = new URL(run?.sourceUrl || '');
    return Boolean(run && ['MANUAL_GATE', 'ERROR', 'FAILED'].includes(run.stage) && run.sheetSync?.status !== 'syncing'
      && current.protocol === 'https:' && saved.protocol === 'https:' && current.pathname === '/' && !current.search && !current.hash
      && current.hostname.replace(/^www\./, '') !== saved.hostname.replace(/^www\./, ''));
  } catch { return false; }
}

export function createListingRun(sourceUrl: string, profileId: string, tabId: number, ampBlogsAccountStatus: "existing" | "new" = "existing", accountStatus: "existing" | "new" = "existing"): ListingRun {
  const now = new Date().toISOString();
  const domain = new URL(sourceUrl).hostname.toLowerCase().replace(/^www\./, "");
  return {
    id: crypto.randomUUID(),
    domain,
    sourceUrl,
    profileId,
    tabId,
    stage: "DISCOVER",
    navigationCount: 0,
    startedAt: now,
    updatedAt: now,
    steps: ["Active profile loaded", domain === "freewebads.biz" ? "FreeWebAds recognized" : domain === "directory3.org" ? "Directory3 recognized" : "Listing site recognized"],
    manual: [],
    ...(domain === "ampblogs.com" ? { ampBlogsAccountStatus } : {}),
    accountStatus,
    autoLogin: false,
  };
}

export function updateListingRun(run: ListingRun, patch: Partial<ListingRun>): ListingRun {
  return { ...run, ...patch, updatedAt: new Date().toISOString() };
}

export function isListingRunTerminal(run: ListingRun): boolean {
  return ["COMPLETE", "MANUAL_GATE", "HUMAN_GATE", "FAILED", "ERROR"].includes(run.stage);
}

export function isListingRunActive(run: ListingRun): boolean {
  return !isListingRunTerminal(run);
}

export function isGenericManualLogin(run: ListingRun): boolean {
  return run.domain !== "ampblogs.com" && !run.submissionAttempted && !run.publicVerification
    && (run.awaitingManualLogin === true || run.stage === "MANUAL_GATE" && run.manual.includes("SIGN IN / LOGIN"));
}

export function isListingRunStale(run: ListingRun, now = Date.now()): boolean {
  const updated = Date.parse(run.updatedAt);
  return !Number.isFinite(updated) || now - updated > 15 * 60 * 1000;
}

export function canStartFreshHomepageRun(run: ListingRun | null, href: string): boolean {
  if (!run || !(run.stage === "ERROR" || run.stage === "MANUAL_GATE" && run.awaitingManualResume) || run.submissionAttempted
    || run.publicVerification || run.liveUrl || run.sheetSync || run.registration || run.autoRegister || run.existingAccountRecovery || run.login?.attemptId && run.login.state !== "authenticated") return false;
  try {
    const url = new URL(href);
    return url.protocol === "https:" && !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash
      && url.origin === new URL(run.sourceUrl).origin;
  } catch { return false; }
}

// Page structure must additionally be observed as LOGIN by popup and worker.
export function canStartFreshLoginRun(run: ListingRun | null, href: string): boolean {
  if (!run || !['ERROR', 'MANUAL_GATE'].includes(run.stage) || run.tabUnavailable || run.login || run.registration
    || run.autoRegister || run.registrationRecovery || run.existingAccountRecovery || run.submissionAttempted
    || run.ampBlogsSubmissionStarted || run.publicationSubmission || run.publicationConfirmation
    || run.publicVerification || run.liveUrl || run.sheetSync) return false;
  try {
    const url = new URL(href);
    return url.protocol === 'https:' && !url.username && !url.password && !url.hash
      && url.origin === new URL(run.sourceUrl).origin;
  } catch { return false; }
}

export function canPrepareRegistrationRecovery(run: ListingRun | null, href: string): boolean {
  const stopped = run && (run.stage === "MANUAL_GATE" && run.awaitingManualResume || run.stage === "ERROR" && isMissingTabError(run.error, run.tabId) || run.tabUnavailable?.tabId === run.tabId);
  if (!run || !stopped || run.login?.state !== "uncertain" || !run.login.attemptId || !run.login.claimed
    || run.registration || run.autoRegister || run.registrationRecovery || run.existingAccountRecovery || run.submissionAttempted || run.publicationSubmission || run.publicVerification || run.liveUrl || run.sheetSync) return false;
  try {
    const url = new URL(href);
    return url.protocol === "https:" && !url.username && !url.password && url.origin === new URL(run.sourceUrl).origin;
  } catch { return false; }
}

export function canPrepareExistingAccountRecovery(run: ListingRun | null, href: string): boolean {
  if (!run || run.tabUnavailable?.tabId !== run.tabId || !['MANUAL_GATE', 'ERROR'].includes(run.stage)
    || run.autoRegister || run.autoLogin || run.autoPublish || run.registration || run.registrationRecovery || run.existingAccountRecovery
    || run.login || run.submissionAttempted || run.ampBlogsSubmissionStarted || run.publicationSubmission || run.publicationConfirmation || run.publicVerification || run.liveUrl || run.sheetSync) return false;
  try {
    const url = new URL(href);
    return url.protocol === 'https:' && !url.username && !url.password && url.origin === new URL(run.sourceUrl).origin;
  } catch { return false; }
}

export function isMissingTabError(error: unknown, tabId: number): boolean {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const match = /^No tab with id:\s*(\d+)\.?\s*$/i.exec(message);
  return Boolean(match && Number(match[1]) === tabId);
}

export function loginGuardKey(run: ListingRun): string {
  const base = `ba2.loginGuard:${new URL(run.sourceUrl).origin}:${run.profileId}`;
  if (run.continuous) return `${base}:continuous:${run.id}`;
  if (run.existingAccountRecovery) return `${base}:existing:${run.id}`;
  // A new account lifecycle gets its own receipt; the uncertain original is immutable.
  return run.registrationRecovery ? `${base}:registration:${run.id}` : base;
}

export async function registrationRecoveryValid(run: ListingRun, requireCompletion = false): Promise<boolean> {
  if (run.continuous) {
    const base = `ba2.loginGuard:${new URL(run.sourceUrl).origin}:${run.profileId}`;
    const data = await chrome.storage.local.get(null);
    const ownKey = loginGuardKey(run), own = data[ownKey];
    const prior = Object.fromEntries(Object.entries(data).filter(([key]) => key !== ownKey && (key === base || key.startsWith(base + ':'))).sort(([a], [b]) => a.localeCompare(b)));
    const registration = data[`ba2.registrationGuard:${new URL(run.sourceUrl).origin}:${run.profileId}`];
    return JSON.stringify(prior) === run.continuous.loginReceiptsSnapshot
      && Object.values(prior).every(receipt => !receipt || receipt.state === 'authenticated' && typeof receipt.runId === 'string')
      && (run.registration?.attemptId ? registration?.runId === run.id && registration.state === run.registration.state
        : JSON.stringify(registration ?? null) === run.continuous.registrationReceiptSnapshot)
      && (!(run.submissionAttempted || run.publicVerification) || data[publicationGuardKey(run.sourceUrl, run.profileId)]?.runId === run.id)
      && (run.login?.attemptId ? own?.runId === run.id && own.state === run.login.state : own == null);
  }
  if (run.existingAccountRecovery) {
    const recovery = run.existingAccountRecovery;
    const old = (await chrome.storage.local.get('ba2.listingRunArchive:' + recovery.oldRunId))['ba2.listingRunArchive:' + recovery.oldRunId] as ListingRun | undefined;
    const base = `ba2.loginGuard:${new URL(run.sourceUrl).origin}:${run.profileId}`;
    const registrationKey = `ba2.registrationGuard:${new URL(run.sourceUrl).origin}:${run.profileId}`;
    const priorLogin = (await chrome.storage.local.get(base))[base];
    const priorRegistration = (await chrome.storage.local.get(registrationKey))[registrationKey];
    const own = (await chrome.storage.local.get(loginGuardKey(run)))[loginGuardKey(run)];
    return Boolean(old && canPrepareExistingAccountRecovery(old, run.sourceUrl) && old.profileId === run.profileId
      && !run.registrationRecovery && !run.autoRegister && !run.autoPublish && run.autoLogin && run.accountStatus === 'existing'
      && run.loginApproval?.authorizedAt === recovery.authorizedAt
      && (priorLogin == null || priorLogin.state === 'authenticated') && (priorRegistration == null || priorRegistration.state === 'confirmed')
      && JSON.stringify(priorLogin ?? null) === recovery.loginGuardSnapshot
      && JSON.stringify(priorRegistration ?? null) === recovery.registrationGuardSnapshot
      && (run.login?.attemptId ? own?.runId === run.id && own.state === run.login.state : own == null));
  }
  const recovery = run.registrationRecovery;
  if (!recovery) return true;
  const archiveKey = `ba2.listingRunArchive:${recovery.oldRunId}`;
  const old = (await chrome.storage.local.get(archiveKey))[archiveKey] as ListingRun | undefined;
  const guardKey = `ba2.loginGuard:${new URL(run.sourceUrl).origin}:${run.profileId}`;
  const guard = (await chrome.storage.local.get(guardKey))[guardKey];
  if (!old || !canPrepareRegistrationRecovery(old, run.sourceUrl) || old.profileId !== run.profileId || old.login?.attemptId !== recovery.oldLoginAttemptId
    || guard?.runId !== old.id || guard?.state !== "uncertain" || JSON.stringify(guard) !== recovery.guardSnapshot
    || !run.autoRegister || !recovery.firstRegistrationConfirmed || !run.registrationApproval
    || recovery.authorizedAt !== run.registrationApproval.authorizedAt) return false;
  const ownKey = loginGuardKey(run);
  const own = (await chrome.storage.local.get(ownKey))[ownKey];
  if (run.login?.attemptId ? own?.runId !== run.id || own.state !== run.login.state : Boolean(own)) return false;
  if (!requireCompletion) return true;
  const completion = run.registrationCompletion;
  const registrationKey = `ba2.registrationGuard:${new URL(run.sourceUrl).origin}:${run.profileId}`;
  const receipt = (await chrome.storage.local.get(registrationKey))[registrationKey];
  return Boolean(run.registration?.attemptId && run.registration.state === "confirmed" && completion?.attemptId === run.registration.attemptId
    && receipt?.runId === run.id && receipt.state === "confirmed" && ["account-created", "authenticated"].includes(completion.kind)
    && Number.isFinite(Date.parse(completion.observedAt)) && new URL(completion.url).origin === new URL(run.sourceUrl).origin);
}
