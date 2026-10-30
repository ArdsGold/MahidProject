import { manualAutofillFamily } from "../manual-autofill-policy";
import { isAutomationExcluded, AUTOMATION_EXCLUDED_MESSAGE } from "@backlink-autofill/shared";
import { advancedSeoDirectoryAdapter, inspectAdvancedSeoDirectory, isAdvancedSeoDirectoryHost } from "../automation/advanced-seo-directory";
import { toptendirAdapter, inspectToptendir, isToptendirHost } from "../automation/toptendir";
import { smartdirAdapter, inspectSmartdir, isSmartdirHost } from "../automation/smartdir";
import { ifidirAdapter, inspectIfidir, isIfidirHost } from "../automation/ifidir";
import { efdirAdapter, inspectEfdir, isEfdirHost, applyAuthorizedEfdirTerms } from "../automation/efdir";
import { relevantDirectoriesAdapter, inspectRelevantDirectories, isRelevantDirectoriesHost } from "../automation/relevant-directories";
import { relevantDirectoryAdapter, inspectRelevantDirectory, isRelevantDirectoryHost } from "../automation/relevant-directory";
import { relatedDirectoryAdapter, inspectRelatedDirectory, isRelatedDirectoryHost } from "../automation/related-directory";
import { linkedinDirectoryAdapter, inspectLinkedinDirectory, isLinkedinDirectoryHost } from "../automation/linkedin-directory";
import { fireDirectoryAdapter, inspectFireDirectory, isFireDirectoryHost, selectFireRegularLink } from "../automation/fire-directory";
import { inspectUniqueListing, isUniqueListingHost, uniqueListingAdapter } from "../automation/unique-listing";
import { inspectDirectory3, isDirectory3Host, directory3Adapter } from "../automation/directory3";
import { groovyDirectoryAdapter, inspectGroovyDirectory, isGroovyDirectoryHost } from "../automation/groovy-directory";
import { redditDirectoryAdapter, inspectRedditDirectory, isRedditDirectoryHost } from "../automation/reddit-directory";
import { expansionDirectoryAdapter, inspectExpansionDirectory, isExpansionDirectoryHost } from "../automation/expansion-directory";
import { bizzDirectoryAdapter, inspectBizzDirectory, isBizzDirectoryHost } from "../automation/bizz-directory";
import { getF03Directory, F03_DIRECTORY_IDS } from "../automation/f03-directory";
import { jetLinksAdapter, inspectJetLinks, isJetLinksHost } from "../automation/jet-links";
import { adbriteDirectoryAdapter, inspectAdbriteDirectory, isAdbriteDirectoryHost, applyAuthorizedAdbriteTerms } from "../automation/adbrite-directory";
import { bluebookDirectoryAdapter, inspectBluebookDirectory, isBluebookDirectoryHost } from "../automation/bluebook-directory";
import { auroraDirectoryAdapter, inspectAuroraDirectory, isAuroraDirectoryHost } from "../automation/aurora-directory";
import { fruityDirectoryAdapter, inspectFruityDirectory, isFruityDirectoryHost } from "../automation/fruity-directory";
import { greenyDirectoryAdapter, inspectGreenyDirectory, isGreenyDirectoryHost } from "../automation/greeny-directory";
import { familydirAdapter, inspectFamilydir, isFamilydirHost, selectFamilydirFreeReview } from "../automation/familydir";
import { searchDomainHereAdapter, inspectSearchDomainHere, isSearchDomainHereHost } from "../automation/search-domain-here";
import { NATIVE_DIRECTORY_FIELDS, nativeDirectoryEntryLinks, isNativeDirectoryHumanControl } from "../automation/native-directory";
import type { SiteAdapter } from "../automation/site-adapter";
import type { BusinessProfile } from "@backlink-autofill/shared";
import type { ListingAutofillReport, ListingCategoryMapping, ListingField, SkippedFieldReport } from "../messages";
import { getSiteAdapter, getFamily3Adapter } from "../automation/adapters";
import { decideCategory, decideSubcategory } from "../automation/matching";
import { adaptiveHumanGateReasons, chooseAdaptiveEntry, classifyAdaptiveStage, type AdaptiveStage } from "../automation/adaptive-discovery";
import { classifyXZeroFamily, isXZeroEntryControl } from "../automation/xzero-family";
import { findBrochureInputs, findLogoInputs } from "./logo-upload";
import { inspectSelect, recordPlaywrightDiagnostic, verifyField } from "../playwright-client";
import { applyApprovedTerms, findTermsAgreementCandidates } from "../automation/terms-approval";
import { structuralEvidenceFromSignals } from "../automation/structural-signature";
import { CKEDITOR_FRAME_SELECTOR, findUniqueBlogPublishControl, observeBlogWorkflow, loginFields, validateLogin, registrationFields, validateRegistration, type LoginCheck, type RegistrationCheck } from "../automation/blog-workflow";
import { isGroup1Url } from "../automation/adapters";
import { articleExpectation } from "../automation/verification";
import { registrationRecoveryValid, publicationProfileFingerprint, publicationProfileSnapshot, readListingRun, writeListingRun, updateListingRun } from "../listing-run";
import { getActiveProfile } from "./transport";

type Editable = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

// Field preparation only: no run/receipt writes, watcher installation or submit.
export function fillLoginFields(profile: BusinessProfile, preserveInput = true): boolean {
  const fields = loginFields(document, location.href);
  if (!fields) return false;
  const email = fields.identifier.type === 'email' || /email/i.test(`${fields.identifier.name} ${fields.identifier.id} ${fields.identifier.placeholder}`);
  const identifier = email ? profile.email : profile.username;
  if (!identifier || !profile.password || preserveInput && (fields.identifier.value && fields.identifier.value !== identifier
    || fields.password.value && fields.password.value !== profile.password)) return false;
  return Boolean((preserveInput && fields.identifier.value || setVisibleValue(fields.identifier, identifier))
    && (preserveInput && fields.password.value || setVisibleValue(fields.password, profile.password)));
}

export async function handleAutomaticLogin(runId: string, fill = false, attemptId?: string): Promise<LoginCheck> {
  const stopped: LoginCheck = { ok: false, captcha: "ambiguous", reason: "Login authorization or saved attempt changed. Inspect the site; automatic retry is blocked." };
  const run = await readListingRun();
  const profile = await getActiveProfile();
  if (!run || run.id !== runId || !run.autoLogin || !run.loginApproval || !profile || profile.id !== run.profileId
    || profile.updatedAt !== run.loginApproval.profileUpdatedAt || run.submissionAttempted || run.publicVerification
    || new URL(location.href).origin !== new URL(run.sourceUrl).origin
    || !Number.isFinite(Date.parse(run.loginApproval.authorizedAt)) || Date.now() - Date.parse(run.loginApproval.authorizedAt) > 15 * 60_000) return stopped;
  if (attemptId ? run.login?.attemptId !== attemptId || run.login.state !== "intent" || run.login.claimed || run.login.url !== location.href : Boolean(run.login?.attemptId)) return stopped;
  if (!await registrationRecoveryValid(run, true)) return stopped;
  if (fill) {
    if (!fillLoginFields(profile, Boolean(run.login))) return validateLogin(document, location.href, profile);
  }
  const validation = validateLogin(document, location.href, profile);
  if (!attemptId || !validation.ok) return validation;
  const current = await readListingRun();
  if (!current || current.id !== runId || !current.autoLogin || current.login?.attemptId !== attemptId || current.login.claimed
    || current.login.state !== "intent" || current.loginApproval?.authorizedAt !== run.loginApproval.authorizedAt
    || current.loginApproval.profileUpdatedAt !== profile.updatedAt || current.profileId !== profile.id || current.login.url !== location.href
    || current.submissionAttempted || current.publicVerification) return stopped;
  const claims = globalThis as typeof globalThis & { __ba2LoginClaims?: Set<string> };
  const key = `${runId}:${attemptId}`;
  claims.__ba2LoginClaims ??= new Set();
  if (claims.__ba2LoginClaims.has(key)) return stopped;
  claims.__ba2LoginClaims.add(key);
  await writeListingRun(updateListingRun(current, { login: { ...current.login, claimed: true } }));
  const final = await readListingRun();
  const latestProfile = await getActiveProfile();
  if (!final || final.id !== runId || !final.autoLogin || final.login?.attemptId !== attemptId || !final.login.claimed || final.login.state !== "intent"
    || final.loginApproval?.authorizedAt !== run.loginApproval.authorizedAt || final.submissionAttempted || final.publicVerification
    || final.loginApproval.profileUpdatedAt !== profile.updatedAt || final.profileId !== profile.id
    || !latestProfile || latestProfile.id !== profile.id || latestProfile.updatedAt !== profile.updatedAt
    || latestProfile.username !== profile.username || latestProfile.email !== profile.email || latestProfile.password !== profile.password
    || location.href !== final.login.url || !validateLogin(document, location.href, latestProfile).ok) return stopped;
  if (!await registrationRecoveryValid(final, true)) return stopped;
  loginFields(document, location.href)!.submit.click();
  return validation;
}
type Candidate = { element: Editable; text: string; descriptor: string; index: number };

export async function handleAutomaticRegistration(runId: string, fill = false, attemptId?: string): Promise<RegistrationCheck> {
  const stopped: LoginCheck = { ok: false, captcha: 'ambiguous', reason: 'Registration authorization, saved intent or approved account changed. No registration retry.' };
  const run = await readListingRun(), profile = await getActiveProfile();
  if (run && !await registrationRecoveryValid(run)) return stopped;
  const authorized = (r: typeof run, p: typeof profile) => Boolean(r && p && r.id === runId && r.profileId === p.id && r.autoRegister
    && r.accountStatus === 'new' && r.registrationApproval?.profileUpdatedAt === p.updatedAt
    && Number.isFinite(Date.parse(r.registrationApproval.authorizedAt)) && Date.now() - Date.parse(r.registrationApproval.authorizedAt) < 15 * 60_000
    && !r.submissionAttempted && !r.publicVerification && new URL(r.sourceUrl).origin === location.origin);
  if (!authorized(run, profile) || !run || !profile) return stopped;
  if (attemptId ? run.registration?.attemptId !== attemptId || run.registration.claimed || run.registration.state !== 'intent' || run.registration.url !== location.href : Boolean(run.registration?.attemptId)) return stopped;
  if (fill) {
    if (!registrationFields(document, location.href)) return stopped;
    runListingAutofill(profile, undefined, true); // Refill missing registration fields, preserving human input.
  }
  const validation = validateRegistration(document, location.href, profile);
  if (!attemptId || !validation.ok) return validation;
  const current = await readListingRun();
  const guardKey = `ba2.registrationGuard:${location.origin}:${run.profileId}`;
  const guard = (await chrome.storage.local.get(guardKey))[guardKey];
  if (!authorized(current, profile) || !current || guard?.runId !== run.id || current.registration?.attemptId !== attemptId
    || current.registration.claimed || current.registration.state !== 'intent' || current.registration.url !== location.href
    || current.registrationApproval?.authorizedAt !== run.registrationApproval?.authorizedAt) return stopped;
  const scope = globalThis as typeof globalThis & { __ba2RegistrationClaims?: Set<string> };
  scope.__ba2RegistrationClaims ??= new Set();
  const claim = `${runId}:${attemptId}`;
  if (scope.__ba2RegistrationClaims.has(claim)) return stopped;
  scope.__ba2RegistrationClaims.add(claim);
  await writeListingRun(updateListingRun(current, { registration: { ...current.registration, claimed: true } }));
  const final = await readListingRun(), latestProfile = await getActiveProfile();
  if (final && !await registrationRecoveryValid(final)) return stopped;
  const finalGuard = (await chrome.storage.local.get(guardKey))[guardKey];
  if (!authorized(final, latestProfile) || !final || !latestProfile || !final.registration?.claimed || final.registration.attemptId !== attemptId
    || finalGuard?.runId !== run.id
    || final.registration.state !== 'intent' || final.registration.url !== location.href
    || latestProfile.username !== profile.username || latestProfile.email !== profile.email || latestProfile.password !== profile.password
    || final.registrationApproval?.authorizedAt !== run.registrationApproval?.authorizedAt || !validateRegistration(document, location.href, latestProfile).ok) return stopped;
  registrationFields(document, location.href)!.submit.click();
  return validation;
}

const BLOCKED = /captcha|recaptcha|hcaptcha|turnstile|terms|conditions|agree|privacy|payment|checkout|credit card|search|newsletter|reciprocal|submit|publish|register\b|finish/i;
const NAVIGATION = /submit links|submit listing|submit site|add listing|add business|add website|list your business|create listing|post listing|post free ad|post an ad|free listing|add url/i;
const FINAL = /\bsubmit\b|submit listing|create listing|publish|post|register|finish|continue|update profile/i;

function normalize(value: string): string { return value.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").trim(); }
function tokens(value: string): Set<string> {
  return new Set(normalize(value).split(" ").filter((token) => token.length > 2 && !["the", "and", "for", "your", "site", "top"].includes(token)).map((token) => token.replace(/(ing|ers|es|s)$/, "")));
}
function candidateText(element: Editable): string {
  const labels = element.labels ? Array.from(element.labels).map((label) => label.textContent || "") : [];
  const labelledBy = (element.getAttribute("aria-labelledby") || "").split(/\s+/).map((id) => id ? document.getElementById(id)?.textContent || "" : "");
  const cell = element.closest("label, fieldset, td, th, .field, .form-group")?.textContent || "";
  const nearby = [element.previousElementSibling, element.nextElementSibling]
    .filter((sibling) => sibling && !["input", "textarea", "select", "button", "label", "fieldset"].includes(sibling.tagName.toLowerCase()))
    .map((sibling) => sibling?.textContent || "")
    .filter((text) => text.trim().length <= 80);
  return normalize([...labels, labelledBy, element.getAttribute("aria-label") || "", element.getAttribute("name") || "", element.id, element.getAttribute("placeholder") || "", element.getAttribute("autocomplete") || "", element.getAttribute("type") || "", labels.length ? "" : cell, nearby].flat().join(" "));
}
function descriptor(element: Editable): string { return `${element.tagName.toLowerCase()}${element.getAttribute("name") ? ` name="${element.getAttribute("name")}"` : ""}${element.id ? ` id="${element.id}"` : ""}`; }
function localFieldText(element: Editable): string {
  const labels = element.labels ? Array.from(element.labels).map((label) => label.textContent || "") : [];
  const labelledBy = (element.getAttribute("aria-labelledby") || "").split(/\s+/).map((id) => (id ? element.ownerDocument.getElementById(id)?.textContent || "" : ""));
  return normalize([...labels, ...labelledBy, element.getAttribute("aria-label") || "", element.getAttribute("title") || "", element.getAttribute("name") || "", element.id, element.getAttribute("placeholder") || "", element.getAttribute("autocomplete") || ""].join(" "));
}
function isPlainDescriptionField(element: Element): boolean {
  const labels = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement ? Array.from(element.labels || []).map((label) => label.textContent || "") : [];
  const labelledBy = (element.getAttribute("aria-labelledby") || "").split(/\s+/).map((id) => id ? element.ownerDocument?.getElementById(id)?.textContent || "" : "");
  const ownLabel = normalize([...labels, ...labelledBy, element.getAttribute("aria-label") || "", element.getAttribute("title") || "", element.getAttribute("placeholder") || ""].join(" "));
  return /\bdescription\b/.test(ownLabel) && !/\b(?:post|article|editor)\b/.test(ownLabel);
}
function editable(element: Element): element is Editable {
  if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement)) return false;
  if (element.disabled || (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement ? element.readOnly : false)) return false;
  if (element instanceof HTMLInputElement && ["hidden", "submit", "button", "reset", "image", "file", "checkbox", "radio"].includes(element.type)) return false;
  return true;
}
function safeValue(text: string): boolean { return !BLOCKED.test(text); }
function isPasswordField(candidate: Candidate): boolean { return candidate.element instanceof HTMLInputElement && candidate.element.type === "password" || /\bpassword\b|passcode/.test(candidate.text); }
function score(text: string, phrases: string[]): number {
  return phrases.reduce((best, phrase) => {
    const wanted = normalize(phrase);
    const specificity = wanted.split(" ").filter(Boolean).length * 0.2;
    return Math.max(best, text === wanted ? 5 + specificity : text.includes(wanted) ? 2 + specificity : 0);
  }, 0);
}
function isReciprocal(text: string): boolean { return /reciprocal|return link|link back|backlink|recip/.test(text); }
function isCategorySelect(candidate: Candidate): boolean {
  if (!(candidate.element instanceof HTMLSelectElement)) return false;
  const attributes = ["name", "id", "class", "aria-label", "placeholder"].map((name) => candidate.element.getAttribute(name) || "").join(" ");
  const semanticText = normalize(`${attributes} ${candidate.text}`);
  return /\bcategory(?:\s+id)?\b|\bcategories\b|\bcat(?:egory)?\s*id\b|\bcatid\b|business\s+type|listing\s+type/.test(semanticText) && !isReciprocal(candidate.text);
}

function explicitIdentityField(text: string): ListingField | undefined {
  if (/\b(?:first|given|forename)\s+name\b/.test(text)) return "firstName";
  if (/\b(?:last|sur|family)\s+name\b/.test(text)) return "lastName";
  if (/\b(?:username|user\s+name|login\s+name|account\s+name|member\s+name|user\s+id)\b/.test(text)) return "username";
  if (/\be[- ]?mail(?:\s+address)?\b/.test(text)) return "email";
  return undefined;
}

const REFERRAL_PREFERENCES = ["google", "search engine", "web search", "internet search", "search"];

function referralSelectText(select: HTMLSelectElement): string {
  const label = select.closest("label")?.textContent || select.previousElementSibling?.textContent || "";
  return normalize(`${label} ${select.name} ${select.id} ${select.getAttribute("aria-label") || ""}`);
}

function isReferralSelect(select: HTMLSelectElement): boolean {
  return /how did you (?:hear|find)|referral|heard about us|source/.test(referralSelectText(select));
}

function chooseReferralSource(select: HTMLSelectElement): { value: string; label: string } | null {
  const options = Array.from(select.options).filter((option) => option.value && !option.disabled);
  for (const preference of REFERRAL_PREFERENCES) {
    const option = options.find((candidate) => normalize(`${candidate.textContent || ""} ${candidate.value}`).includes(preference));
    if (option) return { value: option.value, label: option.textContent?.trim() || option.value };
  }
  return null;
}

function checkboxText(checkbox: HTMLInputElement): string {
  return normalize(`${checkbox.closest("label")?.textContent || checkbox.parentElement?.textContent || ""} ${checkbox.name} ${checkbox.id} ${checkbox.getAttribute("aria-label") || ""}`);
}

function checkExactCheckbox(pattern: RegExp): boolean {
  const checkbox = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')).find((candidate) => pattern.test(checkboxText(candidate)));
  if (!checkbox) return false;
  if (!checkbox.checked && !checkbox.disabled && !checkbox.readOnly) {
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event("input", { bubbles: true }));
    checkbox.dispatchEvent(new Event("change", { bubbles: true }));
  }
  return checkbox.checked;
}

function isSafeEntryText(text: string): boolean {
  const adapter = getSiteAdapter(location.href);
  const hints = adapter?.config.entryLabels || [];
  return NAVIGATION.test(text) || hints.some((hint) => normalize(text).includes(normalize(hint)));
}

function clickEntryControl(): { navigationUrl?: string; manual?: string[]; diagnostic?: string; entryAction?: { label: string; href?: string } } | null {
  const adapter = getSiteAdapter(location.href);
  const controls = Array.from(document.querySelectorAll<HTMLElement>("a[href], button, input[type=button], input[type=submit], [role=button]"));
  const candidates = controls.map((element) => ({
    element,
    text: normalize(element.textContent || element.getAttribute("aria-label") || element.getAttribute("value") || ""),
    href: element.tagName.toLowerCase() === "a" ? (element as HTMLAnchorElement).href : location.href,
  })).filter(({ text }) => Boolean(text) && (adapter ? isSafeEntryText(text) : true));
  const family = classifyXZeroFamily(location.href, `${document.body?.innerText || ""} ${candidates.map(({ href }) => href || "").join(" ")}`, Boolean(document.querySelector("form")));
  const familyCandidate = !adapter && family?.stage === "ENTRY" ? candidates.find(({ text, href }) => isXZeroEntryControl(text, href)) : undefined;
  const discoveredAction = adapter?.discoverEntry(document.body?.innerText || "", candidates.map(({ text, href }) => ({ text, href })));
  const adaptive = adapter ? null : chooseAdaptiveEntry(candidates.map(({ text, href }) => ({ text, href, confidence: 0 })));
  if (!discoveredAction && !adaptive?.candidate && !familyCandidate) {
    return adapter ? null : { manual: ["Unknown page structure", "Human input required"], diagnostic: "Adaptive discovery started · no safe listing-start candidate" };
  }
  if (adaptive?.action === "ASK_HUMAN" && !familyCandidate) return { manual: ["Human input required", `Candidate: ${adaptive.candidate?.text} (${adaptive.candidate?.confidence.toFixed(2)})`], diagnostic: "Adaptive discovery started · medium-confidence entry candidate" };
  const targetHref = familyCandidate?.href || discoveredAction?.target || adaptive?.candidate?.href;
  const targetText = familyCandidate?.text || (discoveredAction ? discoveredAction.reason.toLowerCase() : adaptive?.candidate?.text.toLowerCase() || "");
  const control = candidates.find(({ href, text }) => href === targetHref || targetText.includes(text));
  if (!control) return { manual: ["Unknown page structure", "Human input required"], diagnostic: "Adaptive discovery started · candidate control disappeared" };
  const form = control.element.closest("form");
  const formAction = form?.getAttribute("action");
  const navigationUrl = control.element.tagName.toLowerCase() === "a" ? (control.element as HTMLAnchorElement).href : formAction ? new URL(formAction, location.href).href : undefined;
  return { navigationUrl, entryAction: { label: control.text, href: control.element.tagName.toLowerCase() === "a" ? control.href : undefined }, diagnostic: familyCandidate ? `XZero/Classifieds family · Entry action selected: ${control.text}` : adapter ? undefined : `Adaptive discovery started · Entry page detected · Candidate: ${control.text} (0.94)` };
}

function normalizeLocation(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").trim();
}

function locationAliases(value: string): string[] {
  const normalized = normalizeLocation(value);
  if (["usa", "us", "united states", "united states of america"].includes(normalized)) return ["united states", "usa", "us"];
  return normalized ? [normalized] : [];
}

type LocationCandidate = { element: HTMLElement; label: string; href?: string; kind: "link" | "option" };

function locationCandidates(): LocationCandidate[] {
  const candidates: LocationCandidate[] = Array.from(document.querySelectorAll<HTMLElement>("a[href], button, [role=button], [role=option], [role=link], [data-href], [data-category], [onclick]"))
    .map((element) => ({
      element,
      label: (element.textContent || element.getAttribute("aria-label") || element.getAttribute("value") || "").trim(),
      href: element.tagName.toLowerCase() === "a" ? (element as HTMLAnchorElement).href : element.getAttribute("data-href") || undefined,
      kind: "link" as const,
    }));
  for (const select of Array.from(document.querySelectorAll<HTMLSelectElement>("select"))) {
    for (const option of Array.from(select.options)) {
      if (!option.value || !option.textContent?.trim()) continue;
      candidates.push({ element: option, label: option.textContent.trim(), kind: "option" });
    }
  }
  for (const radio of Array.from(document.querySelectorAll<HTMLInputElement>('input[type="radio"]'))) {
    const label = radio.closest("label")?.textContent?.trim() || radio.getAttribute("value") || "";
    if (label) candidates.push({ element: radio, label, kind: "link" });
  }
  return candidates.filter((candidate) => candidate.label);
}

function locationMatch(profile: BusinessProfile): ListingAutofillReport["location"] {
  const bodyText = normalizeLocation(document.body?.innerText || "");
  const candidates = locationCandidates();
  const hasForm = Boolean(document.querySelector("form"));
  const detected = !hasForm && (/please select a city|select a city|choose a city|select (?:a )?(?:location|country|state|province)|choose (?:a )?(?:location|country|state|province)/.test(bodyText)
    || /location|country|state|province|city/.test(bodyText) && candidates.length > 0);
  if (!detected) return undefined;
  const city = locationAliases(profile.city || "");
  const state = locationAliases(profile.state || profile.stateCode || "");
  const country = locationAliases(profile.country || "");
  const match = (wanted: string[]) => {
    const normalizedWanted = wanted.filter(Boolean);
    return candidates
      .map((candidate) => {
        const label = normalizeLocation(candidate.label);
        const exact = normalizedWanted.some((value) => value === label);
        const contained = normalizedWanted.some((value) => value.length > 2 && new RegExp(`(?:^|\\s)${value.replace(/[-/\\^$*+?.()|[\\]{}]/g, "\\$&")}(?:$|\\s|,)`, "i").test(label));
        return { candidate, score: exact ? 2 : contained ? 1 : 0 };
      })
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)[0]?.candidate;
  };
  // Prefer the deepest profile location and only fall back when that level is not offered.
  const selected = match(city) || match(state) || match(country);
  if (selected) return { status: "selected", label: selected.label, href: selected.href };
  const location = [profile.city, profile.state || profile.stateCode, profile.country].filter(Boolean).join(", ");
  return { status: "no-match", message: `No matching FreeWebAds location found for ${location}` };
}

export function clickSelectedLocation(label: string, href?: string): { label: string; href?: string } | null {
  if (getFamily3Adapter(location.href)) return null; // Native directory navigation never uses generic clicks.
  const target = locationCandidates().find((candidate) => (href && candidate.href === href) || normalizeLocation(candidate.label) === normalizeLocation(label));
  if (!target) return null;
  if (target.kind === "option") {
    const select = target.element.parentElement;
    if (!(select instanceof HTMLSelectElement)) return null;
    const option = target.element as HTMLOptionElement;
    select.value = option.value;
    select.dispatchEvent(new Event("input", { bubbles: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));
    return select.value === option.value ? { label: target.label } : null;
  }
  target.element.click();
  return { label: target.label, href: target.href };
}

export function clickSelectedCategory(label: string, href?: string): { label: string; href?: string } | null {
  if (getFamily3Adapter(location.href)) return null;
  const target = locationCandidates().find((candidate) => (href && candidate.href === href) || normalizeLocation(candidate.label) === normalizeLocation(label));
  if (!target) return null;
  if (target.kind === "option") {
    const select = target.element.parentElement;
    if (!(select instanceof HTMLSelectElement)) return null;
    const option = target.element as HTMLOptionElement;
    select.value = option.value;
    select.dispatchEvent(new Event("input", { bubbles: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));
    return select.value === option.value ? { label: target.label } : null;
  }
  target.element.click();
  return target.href ? { label: target.label, href: target.href } : null;
}

const STATE_NAMES: Record<string, string> = {
  al: "alabama", ak: "alaska", az: "arizona", ar: "arkansas", ca: "california", co: "colorado", ct: "connecticut", de: "delaware", fl: "florida", ga: "georgia", hi: "hawaii", id: "idaho", il: "illinois", in: "indiana", ia: "iowa", ks: "kansas", ky: "kentucky", la: "louisiana", me: "maine", md: "maryland", ma: "massachusetts", mi: "michigan", mn: "minnesota", ms: "mississippi", mo: "missouri", mt: "montana", ne: "nebraska", nv: "nevada", nh: "new hampshire", nj: "new jersey", nm: "new mexico", ny: "new york", nc: "north carolina", nd: "north dakota", oh: "ohio", ok: "oklahoma", or: "oregon", pa: "pennsylvania", ri: "rhode island", sc: "south carolina", sd: "south dakota", tn: "tennessee", tx: "texas", ut: "utah", vt: "vermont", va: "virginia", wa: "washington", wv: "west virginia", wi: "wisconsin", wy: "wyoming",
};

function selectedLocationMismatch(profile: BusinessProfile): boolean {
  const raw = document.body?.innerText || "";
  const normalized = normalizeLocation(raw);
  const profileCountry = normalizeLocation(profile.country || "");
  const profileState = normalizeLocation(profile.state || profile.stateCode || "");
  const expectedState = STATE_NAMES[profileState] || profileState;
  const displayedState = Object.values(STATE_NAMES).find((state) => new RegExp(`\\b${state.replace(/ /g, "\\s+")}\\b`, "i").test(raw));
  const displayedUs = /\b(?:usa|u\.?s\.?a?\.?|united states(?: of america)?)\b/i.test(raw);
  const profileUs = ["usa", "us", "united states", "united states of america"].includes(profileCountry);
  return Boolean((displayedState && expectedState && displayedState !== expectedState) || (displayedUs && profileCountry && !profileUs) || (normalized.includes("selected location") && profileState && !normalized.includes(expectedState)));
}

function categoryPageLevel(): "category" | "subcategory" | null {
  const text = normalizeLocation(document.body?.innerText || "");
  if (/please select a subcategory|select a subcategory|choose a subcategory/.test(text)) return "subcategory";
  if (/please select a category|select (?:a )?category|choose (?:a )?category|category to post to|business type|listing type|industry/.test(text)) return "category";
  return null;
}

function categoryMatch(profile: BusinessProfile): ListingAutofillReport["category"] {
  const level = categoryPageLevel();
  if (!level) return undefined;
  if (level === "category" && selectedLocationMismatch(profile)) return { status: "location-mismatch", level, message: "Selected location does not match Active Profile" };
  const candidates = locationCandidates();
  const decision = level === "subcategory" ? decideSubcategory(candidates.map((candidate) => candidate.label), profile) : decideCategory(candidates.map((candidate) => candidate.label), profile, level);
  const ranked = "recommendations" in decision && Array.isArray(decision.recommendations)
    ? decision.recommendations.map((option) => ({ label: option.label, confidence: Math.min(1, 0.65 + option.score * 0.35), href: candidates.find((candidate) => normalizeLocation(candidate.label) === normalizeLocation(option.label))?.href }))
    : [];
  if (decision.decision !== "continue" || !decision.action.value) {
    const recommendations = ranked.length ? ` (top: ${ranked.map((option) => option.label).join(", ")})` : "";
    return { status: "no-match", level, confidence: decision.confidence, recommendations: ranked, reason: decision.reason, message: `${level === "subcategory" ? "Subcategory requires approval" : "Category requires manual selection"}${recommendations}` };
  }
  const selected = candidates.find((candidate) => normalizeLocation(candidate.label) === normalizeLocation(decision.action.value || ""));
  if (!selected) return { status: "no-match", level, confidence: decision.confidence, reason: decision.reason, message: `${level === "subcategory" ? "Subcategory requires approval" : "Category requires manual selection"}` };
  return { status: "selected", level, label: selected.label, href: selected.href, confidence: decision.confidence, reason: decision.reason, recommendations: ranked };
}

const CATEGORY_GROUPS = [
  ["junk", "waste", "trash", "garbage", "debris", "rubbish"],
  ["removal", "haul", "hauling", "cleanout", "clearance", "management"],
  ["home", "house", "residential"],
  ["service", "services", "cleaning"],
  ["roof", "roofing", "roofer", "repair"],
  ["hvac", "heating", "cooling", "air", "conditioning"],
  ["plumb", "plumber", "plumbing"],
  ["survey", "surveying", "surveyor"],
];

function categoryScore(label: string, profile: BusinessProfile): number {
  const labelTokens = tokens(label);
  const desired = [profile.category, ...profile.services];
  const desiredTokens = desired.flatMap((value) => [...tokens(value)]);
  const conceptIndex = CATEGORY_GROUPS.findIndex((group) => group.some((token) => desiredTokens.includes(token)));
  const normalizedLabel = normalize(label);
  const normalizedCategory = normalize(profile.category);
  const categoryTokens = tokens(profile.category);
  if (normalizedCategory && normalizedLabel === normalizedCategory) return 100;
  if (categoryTokens.size > 0 && [...categoryTokens].every((token) => labelTokens.has(token))) return 80 + categoryTokens.size;
  const primaryNicheSignals = normalize(`${profile.category} ${profile.services.join(" ")}`);
  const descriptionSignals = normalize(profile.description);
  const wasteSource = /junk\s+(?:removal|hauling)|\bhauling\b|\bdumpster\b|debris\s+removal|\bcleanout\b|trash\s+removal|waste\s+removal/;
  const competingNiche = /\broof(?:ing|er)?\b|\bhvac\b|\bheating\b|\bplumb(?:ing|er)?\b|\bsurvey(?:ing|or)?\b/;
  if (/waste\s+management/.test(normalizedLabel) && (wasteSource.test(primaryNicheSignals) || !competingNiche.test(primaryNicheSignals) && wasteSource.test(descriptionSignals))) return 70;
  let best = 0;
  for (const [index, value] of desired.filter(Boolean).entries()) {
    const desiredTokens = tokens(value);
    const overlap = [...desiredTokens].filter((token) => labelTokens.has(token)).length;
    const suffixOnly = [...desiredTokens].every((token) => ["service", "servic"].includes(token) || labelTokens.has(token));
    let scoreValue = overlap * (index === 0 ? 6 : 3) + (suffixOnly && overlap > 0 ? 12 : 0);
    for (const group of CATEGORY_GROUPS) {
      if (group.some((token) => desiredTokens.has(token)) && group.some((token) => labelTokens.has(token))) scoreValue += index === 0 ? 9 : 5;
    }
    best = Math.max(best, scoreValue);
  }
  const businessTokens = tokens(profile.businessName);
  const fallbackTokens = [...tokens(`${profile.shortDescription} ${profile.description}`)];
  best += [...businessTokens].filter((token) => labelTokens.has(token)).length * 0.5;
  best += fallbackTokens.filter((token) => labelTokens.has(token)).length * 0.25;
  let parentScore = 0;
  if (conceptIndex === 0) {
    if (/waste|trash|garbage|rubbish|removal|haul|cleanout/.test(normalizedLabel)) parentScore = 6;
    else if (/home\s+services?/.test(normalizedLabel)) parentScore = 9;
    else if (normalizedLabel === "home") parentScore = 8;
    else if (/business\s+services?/.test(normalizedLabel)) parentScore = 4;
    else if (normalizedLabel === "business") parentScore = 3;
  } else if ([1, 2, 3].includes(conceptIndex)) {
    if (/home\s+improvement|home\s+services?|contractors?|home/.test(normalizedLabel)) parentScore = 8;
  } else if (conceptIndex === 7) {
    if (/survey|engineering|professional\s+services?|business/.test(normalizedLabel)) parentScore = 8;
  }
  return best + [...businessTokens].filter((token) => labelTokens.has(token)).length * 0.5 + parentScore;
}

// Ponytail: ceiling is one exact hostname/control/label; upgrade to adapter config if overrides multiply.
function siteSpecificCategoryOption(select: HTMLSelectElement): HTMLOptionElement | undefined {
  if (location.hostname.toLowerCase() !== "apeopledirectory.com" || select.getAttribute("name") !== "CATEGORY_ID") return undefined;
  const target = normalizeLocation("Commercial Contractors");
  return Array.from(select.options).find((option) => !option.disabled && normalizeLocation(option.textContent || "") === target);
}

const PHRASES: Record<ListingField, string[]> = {
  businessName: ["business name", "company", "company name", "organization", "listing title", "title", "personal quote", "motto", "tagline", "slogan"],
  firstName: ["first name", "given name", "forename"],
  lastName: ["last name", "surname", "family name"],
  username: ["username", "user name", "login name", "account name", "user id", "member name"],
  website: ["website", "website url", "url", "homepage", "web address"],
  description: ["description", "business description", "details", "about", "profile", "bio", "post", "writer", "write"],
  businessHours: ["hours", "business hours", "opening hours", "operating hours"],
  contactName: ["your name", "name", "contact name", "contact person"],
  email: ["email", "email address", "your email", "contact email"],
  password: ["password", "passcode"],
  phone: ["phone", "telephone", "business phone", "contact number"],
  address: ["address", "street address", "address line 1"],
  city: ["city", "town"],
  state: ["state", "province", "region"],
  postalCode: ["zip", "zip code", "postal code", "postcode"],
  country: ["country"],
  category: ["category", "business category"],
  services: ["services", "service area", "what we do", "offerings"],
  facebook: ["facebook", "fb"],
  instagram: ["instagram", "ig"],
  linkedin: ["linkedin"],
  twitter: ["twitter", "x profile"],
  youtube: ["youtube"],
  tiktok: ["tiktok"],
  pinterest: ["pinterest"],
  imageUrl: ["image url", "image link", "photo url", "photo link"],
};

function profileValue(profile: BusinessProfile, field: ListingField): string {
  if (field === "description") return descriptionPlainText(profile.description);
  if (field === "imageUrl") return profile.imageUrl;
  if (field === "businessHours") return profile.businessHours.join("\n");
  if (field === "contactName") return profile.contactName || [profile.firstName, profile.lastName].filter(Boolean).join(" ") || profile.businessName;
  if (field === "username") return profile.username;
  if (field === "password") return profile.password;
  if (field === "category") return profile.category;
  if (field === "services") return profile.services.join(", ");
  const address = profileAddressParts(profile);
  if (field === "address") return address.full;
  if (field === "city") return profile.city || address.city;
  if (field === "state") return profile.state || profile.stateCode || address.state;
  if (field === "postalCode") return profile.postalCode || address.postalCode;
  if (field === "country") return profile.country || address.country;
  if (["facebook", "instagram", "linkedin", "twitter", "youtube", "tiktok", "pinterest"].includes(field)) {
    const stored = profile.socialLinks.find((link) => link.platform === field)?.url;
    return stored || profile[field] as string;
  }
  return profile[field] as string;
}

export function fieldValue(profile: BusinessProfile, field: ListingField, text: string, splitAddress = false, element?: Editable): string {
  if (field === "description" && /short\s+description|summary|profile|bio|about/.test(text)) return descriptionPlainText(profile.shortDescription || profile.description).slice(0, 160);
  if (field !== "address") return profileValue(profile, field);
  const address = profileAddressParts(profile);
  const fieldOwnedText = element ? localFieldText(element) : text;
  return /complete\s+address|full\s+address/.test(fieldOwnedText) ? address.full : splitAddress || isStreetAddressField(fieldOwnedText) ? address.street : address.full;
}

function isShortDescriptionField(text: string): boolean {
  return /short\s+description|summary|profile|bio|about/.test(text);
}

function isLongDescriptionField(text: string): boolean {
  return !isShortDescriptionField(text) && (/\bdescription\b|listing\s+description|10\s+000\s+characters|more\s+detailed\s+description/.test(text));
}

function isSecondaryAddressField(text: string): boolean {
  return /address(?:\s|[_-])*(?:line\s*)?2\b|addr(?:ess)?\s*2\b|second\s+address|\bapt(?:artment)?\.?\b|\bsuite\b|\bunit\b|\bfloor\b/.test(text);
}

function isStreetAddressField(text: string): boolean {
  return /\bstreet(?:\s+address)?\b|address(?:\s|[_-])*(?:line\s*)?1\b|addr(?:ess)?\s*1\b|primary\s+address|autocomplete\s+street\s+address/.test(text);
}

function isPostalCodeField(text: string): boolean {
  return /postal(?:\s*code)?|zip(?:\s*code)?|postcode/.test(text);
}

/**
 * True when the page exposes separate locality fields. Split targets outrank the
 * combined address, so Address Line 1 must receive street only.
 * ponytail: any separate locality target is the split signal; add a new locality
 * alias here if a real form uses one outside City/State/Country/Postal.
 */
function hasSplitAddressTargets(fields: Candidate[]): boolean {
  return fields.some((field) => /\b(?:city|town|state|province|region|country)\b/.test(field.text) || isPostalCodeField(field.text));
}

/**
 * Resolves the live split-address shape before generic semantic scoring.
 * ponytail: this relies on address controls being between State and City; if a site interleaves
 * unrelated controls there, replace this with an explicit site schema or field-group marker.
 */
function splitAddressControls(fields: Candidate[]): { primary?: Candidate; secondary: Candidate[] } {
  const state = fields.find((field) => field.element instanceof HTMLSelectElement && /\b(?:state|province|region)\b/.test(field.text));
  const city = fields.find((field) => field.element instanceof HTMLSelectElement && /\b(?:city|town)\b/.test(field.text));
  if (!state || !city || state.index >= city.index) return { secondary: [] };
  const between = fields.filter((field) => field.index > state.index && field.index < city.index && !(field.element instanceof HTMLSelectElement));
  const primary = between.find((field) => !isSecondaryAddressField(field.text) && isStreetAddressField(field.text))
    || between.find((field) => !isSecondaryAddressField(field.text));
  return { primary, secondary: between.filter((field) => field !== primary) };
}

function isRegistrationContext(text: string): boolean {
  return /your\s+email|register|sign\s*up|create\s+account|registration/i.test(text);
}

function isRegistrationBlogName(text: string, registrationContext: boolean): boolean {
  return registrationContext && /blog(?:[_ -]+)name/.test(text);
}

function isAccountFormContext(text: string): boolean {
  const spaced = text.replace(/([a-z])([A-Z])/g, "$1 $2");
  return /\b(?:sign\s*in|sign\s*up|log\s*in(?!\s+(?:name|id))|login(?!\s+(?:name|id)))\b|\b(?:register|registration)\b|\bcreate\s+(?:an?\s+)?account\b/i.test(spaced)
    && /\bpassword\b|passcode/i.test(spaced)
    && /\b(?:username|user\s+name|login\s+name|account\s+name|user\s+id|member\s+name|forgot\s+password|remember\s+me)\b|\be[- ]?mail\b/i.test(spaced);
}

/** Social platforms whose field must receive the exact saved URL, never a handle. */
const SOCIAL_PLATFORM_PATTERNS: Array<[ListingField, RegExp]> = [
  ["facebook", /\bfacebook\b|\bfb\b/],
  ["instagram", /\binstagram\b|\big\b/],
  ["linkedin", /\blinkedin\b/],
  ["youtube", /\byoutube\b|\byt\b/],
  ["tiktok", /\btiktok\b|\btik\s*tok\b/],
  ["pinterest", /\bpinterest\b/],
  ["twitter", /\btwitter\b|\bx\b\s*(?:url|profile|handle|account|link|com|twitter)/],
];

function platformsInText(text: string): ListingField[] {
  return SOCIAL_PLATFORM_PATTERNS.filter(([, pattern]) => pattern.test(text)).map(([platform]) => platform);
}

/**
 * Platforms the Active Profile does not store. A field that names one of these
 * must stay blank rather than falling through to username/description inference.
 * ponytail: extend with a real profile field + SOCIAL_PLATFORM_PATTERNS entry
 * when Snapchat/WhatsApp support is added.
 */
const UNSUPPORTED_SOCIAL_PATTERNS: RegExp[] = [/\bsnapchat\b/, /\bwhatsapp\b|\bwa\s*me\b/];

function isUnsupportedSocialField(local: string): boolean {
  return UNSUPPORTED_SOCIAL_PATTERNS.some((pattern) => pattern.test(local));
}

/** Exact saved URL for a platform (socialLinks first, legacy field fallback). */
function profileSocialUrl(profile: BusinessProfile, platform: ListingField): string {
  const stored = profile.socialLinks.find((link) => link.platform === platform)?.url;
  return (stored || (profile[platform] as string) || "").trim();
}

/**
 * Position/Role semantics are never satisfied by description or business-name
 * inference.
 * ponytail: no dedicated Position field exists in BusinessProfile, so these stay
 * unmapped; map from a real profile value here if one is ever added.
 */
function isPositionField(text: string): boolean {
  return /\b(?:position|occupation|job\s*title|job\s*role)\b|\b(?:your\s+)?role\b/.test(text);
}

function explicitGenericField(text: string, registrationContext: boolean): ListingField | undefined {
  if (/\b(?:post|listing|blog)?\s*title\b|post[_ -]?title/.test(text)) return "businessName";
  if (/image\s*url|image\s*link|photo\s*url|photo\s*link/.test(text)) return "imageUrl";
  if (/\bpersonal\s+quote\b|\bmotto\b|\btagline\b|\bslogan\b/.test(text)) return "businessName";
  if (isRegistrationBlogName(text, registrationContext)) return "username";
  if (/\b(?:city|town)\b/.test(text)) return "city";
  if (/\b(?:state|province|region)\b/.test(text)) return "state";
  if (isPostalCodeField(text)) return "postalCode";
  if (/\bcountry\b/.test(text)) return "country";
  if (isStreetAddressField(text) || /(?:^|\s)address(?:$|\s)/.test(text)) return "address";
  if (/username|user\s+name|login\s+name|account\s+name|user\s+id|member\s+name/.test(text) && !/e[- ]?mail/.test(text)) return "username";
  if (/pagecontent.*listing.*title|listing\s+title/.test(text)) return "businessName";
  if (/pagecontent.*listing.*shortdescription|short\s+description/.test(text)) return "description";
  if (isLongDescriptionField(text)) return "description";
  if (/organization|organisation|company/.test(text)) return "businessName";
  if (/attachment\s+title/.test(text)) return "businessName";
  if (/\b(?:website|url|homepage)\b|web\s+address/.test(text)) return "website";
  if (/mobile|cell/.test(text)) return undefined;
  if (/phone|telephone/.test(text)) return "phone";
  return undefined;
}

/**
 * Map/geolocation lookup fields must stay blank. These are address-search inputs
 * (e.g. "Add Map", "Map this address", "Find on map") that trigger a map lookup
 * when filled — they must never receive Street Address, Complete Address, City,
 * or Postal Code. Latitude/Longitude also stay blank unless dedicated coordinates
 * exist in the Active Profile.
 */
function isMapLookupField(text: string): boolean {
  return /\bmap\b|map\s+this\s+address|add\s+map|find\s+on\s+(?:the\s+)?map|map\s+lookup|geocod|geoloc|address\s+lookup|map\s+search|search\s+map|locate\s+address|address\s+search|map\s+address|address\s+map|map\s+location|location\s+map/i.test(text);
}

function hasMeaningfulGenericFormControls(fields: Candidate[]): boolean {
  if (fields.some((field) => /\bwriter\b/.test(field.text))) return true;
  if (fields.length >= 3) return true;
  if (fields.length >= 2 && fields.some((field) => /organization|company|business|email|password|phone|telephone|website|homepage|address|postal|zip|profile|bio|facebook|linkedin|twitter|instagram|logo|photo|attachment|file|writer|write/.test(field.text))) return true;
  return false;
}

function structuralFieldRole(field: Candidate): string {
  const text = field.text;
  if (/title|business|company|organization/.test(text)) return "title";
  if (/website|homepage|url|domain/.test(text)) return "website";
  if (/description|details|about|profile|bio/.test(text)) return "description";
  if (/email|e mail/.test(text)) return "email";
  if (/phone|telephone/.test(text)) return "phone";
  if (/address|street|city|state|province|country|postal|zip|location/.test(text)) return "location";
  if (/category|business type|industry|listing type/.test(text)) return "category";
  if (/facebook|instagram|linkedin|twitter|youtube|tiktok|pinterest/.test(text)) return "social";
  if (field.element instanceof HTMLSelectElement) return "select";
  if (field.element instanceof HTMLInputElement && field.element.type === "file") return "file";
  return field.element.tagName.toLowerCase();
}

function structuralFormSignature(fields: Candidate[]): string {
  return [...new Set(fields.map(structuralFieldRole))].sort().join("|");
}
export function setVisibleValue(element: Editable, value: string, expectedText?: string, dispatchBlur = true): boolean {
  if (element instanceof HTMLSelectElement) {
    element.value = value;
  } else {
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(element, value);
  }
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
  if (dispatchBlur) element.dispatchEvent(new Event("blur", { bubbles: true }));
  if (element instanceof HTMLSelectElement) {
    const selected = element.options[element.selectedIndex];
    return element.value === value && element.selectedIndex >= 0 && Boolean(selected?.value) && !/^select|choose|--|\[top\]|top$/i.test(selected?.textContent?.trim() || "")
      && (!expectedText || normalizeLocation(selected?.textContent || "") === normalizeLocation(expectedText));
  }
  return element.value === value;
}

function usStateAbbreviation(state: string, stateCode?: string): string {
  const normalized = normalizeLocation(stateCode || state);
  if (normalized.length === 2) return normalized.toUpperCase();
  const entry = Object.entries(STATE_NAMES).find(([, name]) => name === normalized);
  return entry?.[0].toUpperCase() || state.trim();
}

function formFieldText(element: Element): string {
  return normalizeLocation([element.getAttribute("name"), element.id, element.getAttribute("aria-label"), element.getAttribute("placeholder"), element.closest("label")?.textContent, element.parentElement?.textContent].filter(Boolean).join(" "));
}

function customerFormValidationDiagnostics(): string[] {
  const validators = Array.from(document.querySelectorAll<HTMLElement>("[validationgroup], [data-validationgroup], [data-val-validationgroup]"))
    .filter((validator) => ["validationgroup", "data-validationgroup", "data-val-validationgroup"].some((name) => validator.getAttribute(name)?.toLowerCase() === "customerform"));
  const blocked = new Set<string>();
  for (const validator of validators) {
    const controlId = validator.getAttribute("controltovalidate") || validator.getAttribute("controlToValidate") || validator.getAttribute("data-controltovalidate");
    const target = controlId ? document.getElementById(controlId) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null : null;
    const value = target && "value" in target ? target.value.trim() : "";
    const visible = validator.getAttribute("aria-hidden") !== "true" && validator.hidden !== true && validator.style.display !== "none" && validator.style.visibility !== "hidden";
    if (!target || !visible || value) continue;
    blocked.add((target.closest("label")?.textContent || target.getAttribute("aria-label") || target.getAttribute("name") || target.id || "Unknown field").replace(/\s+/g, " ").trim());
  }
  return [...blocked];
}

function profileAddressParts(profile: BusinessProfile): { street: string; city: string; state: string; postalCode: string; country: string; full: string } {
  const address = profile.address.trim();
  const full = (profile.completeAddress || address).trim();
  const parsed = full.match(/^(.+?),\s*([^,]+),\s*([A-Za-z]{2}|[A-Za-z][A-Za-z .'-]+?)\s+(\d{5}(?:-\d{4})?),\s*(.+)$/);
  const postalCode = profile.postalCode.trim() || parsed?.[4]?.trim() || full.match(/\b\d{5}(?:-\d{4})?\b/)?.[0] || "";
  return {
    street: address || parsed?.[1]?.trim() || (full.includes(",") ? full.split(",", 1)[0].trim() : ""),
    city: profile.city || parsed?.[2]?.trim() || "",
    state: profile.state || profile.stateCode || parsed?.[3]?.trim() || "",
    postalCode,
    country: profile.country || parsed?.[5]?.trim() || "",
    full,
  };
}

function setContentEditable(element: HTMLElement, value: string): boolean {
  element.textContent = value;
  element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
  element.dispatchEvent(new Event("blur", { bubbles: true }));
  return (element.textContent || "").trim() === value.trim();
}

function setContentEditableHtml(element: HTMLElement, value: string): boolean {
  element.innerHTML = value;
  element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertHTML", data: value }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
  element.dispatchEvent(new Event("blur", { bubbles: true }));
  const normalizeVoidTags = (html: string): string => html.replace(/\s*\/>/g, ">");
  return element.innerHTML === value || normalizeVoidTags(element.innerHTML) === normalizeVoidTags(value);
}

/** Explicit writer textarea: always a plain-text Long Description, never an image-composing post editor. */
function isWriterField(element: Element): boolean {
  const id = (element.id || "").toLowerCase();
  const name = (element.getAttribute("name") || "").toLowerCase();
  const placeholder = (element.getAttribute("placeholder") || "").trim().toLowerCase();
  return id === "writer" || name === "writer" || placeholder === "write" || placeholder.startsWith("write.");
}

function findPostEditor(): HTMLTextAreaElement | HTMLElement | null {
  const textarea = Array.from(document.querySelectorAll<HTMLTextAreaElement>("textarea")).find((element) => !isWriterField(element) && !isPlainDescriptionField(element) && /post|article|content|editor/.test(formFieldText(element)) && !/short\s+description|profile|bio|about/.test(formFieldText(element)));
  if (textarea) return textarea;
  const contenteditable = Array.from(document.querySelectorAll<HTMLElement>('[contenteditable="true"]')).find((element) => !isWriterField(element) && !isPlainDescriptionField(element) && /post|article|content|editor/.test(formFieldText(element)) && !/short\s+description|profile|bio|about/.test(formFieldText(element)) || element === document.body);
  if (contenteditable) return contenteditable;
  return document.body?.isContentEditable ? document.body : null;
}

function postEditorValue(profile: BusinessProfile): string {
  return [profile.imageUrl.trim(), descriptionPlainText(profile.description)].filter(Boolean).join("\n\n");
}

function finalMappingDiagnostics(filled: ListingAutofillReport["filled"], skipped: SkippedFieldReport[]): string[] {
  const sourceFor = (field: ListingField): string => filled.find((entry) => entry.field === field)?.descriptor || "not mapped";
  const website = filled.find((entry) => entry.field === "website");
  const category = filled.find((entry) => entry.field === "category");
  const failureFor = (descriptorPart: string): string => skipped.find((entry) => entry.descriptor.includes(descriptorPart))?.reason || "not selected";
  const secondary = skipped.find((entry) => entry.reason === "secondary address line left blank")?.descriptor || "not present";
  return [
    `URL → website → ${website ? `filled/verified (${website.descriptor})` : `failed (${failureFor("URL")})`}`,
    `CATEGORY_ID → ${category?.value || "not selected"} → ${category ? `filled/verified (${category.descriptor})` : `failed (${failureFor("CATEGORY_ID")})`}`,
    `Description → description (${sourceFor("description")})`,
    `Address1 → streetAddress (${sourceFor("address")})`,
    `Address2 → skipped (${secondary})`,
    `City → city (${sourceFor("city")})`,
    `State → state (${sourceFor("state")})`,
    `Country → country (${sourceFor("country")})`,
    `PostalCode → postalCode (${sourceFor("postalCode")})`,
  ];
}

function descriptionPlainText(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed
    .replace(/<a\s+[^>]*href="[^"]*"[^>]*>([\s\S]*?)<\/a>/gi, "$1")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|blockquote|pre|tr)>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

const URL_PATTERN = /\bhttps?:\/\/[^\s<>"]*[^\s<>".,;:!?)\]]/g;

function linkifyTextNode(node: Text): void {
  const text = node.nodeValue || "";
  URL_PATTERN.lastIndex = 0;
  if (!URL_PATTERN.test(text)) return;
  URL_PATTERN.lastIndex = 0;
  const fragment = document.createDocumentFragment();
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = URL_PATTERN.exec(text)) !== null) {
    if (match.index > lastIndex) fragment.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
    const anchor = document.createElement("a");
    anchor.setAttribute("href", match[0]);
    anchor.textContent = match[0];
    fragment.appendChild(anchor);
    lastIndex = URL_PATTERN.lastIndex;
  }
  if (lastIndex < text.length) fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
  node.parentNode?.replaceChild(fragment, node);
}

function richTextNodes(root: Node): Text[] {
  const nodes: Text[] = [];
  for (const child of Array.from(root.childNodes)) {
    if (child.nodeType === 3) nodes.push(child as Text);
    else if (child.nodeType === 1 && (child as Element).tagName.toLowerCase() !== "a") nodes.push(...richTextNodes(child));
  }
  return nodes;
}

function linkifyRichTextHtml(html: string): string {
  if (!html) return html;
  const template = document.createElement("template");
  template.innerHTML = html;
  for (const node of richTextNodes(template.content)) linkifyTextNode(node);
  return template.innerHTML;
}

function postDescriptionHtml(value: string): string {
  const normalized = value.replace(/\r\n?/g, "\n").trim();
  if (!normalized) return "";
  if (!/<[a-z][\s\S]*>/i.test(normalized)) {
    const html = normalized.split(/\n{2,}/).filter(Boolean).map((paragraph) => `<p>${escapeHtml(paragraph).replaceAll("\n", "<br>")}</p>`).join("");
    return linkifyRichTextHtml(html);
  }
  const template = document.createElement("template");
  template.innerHTML = normalized;
  let result = "";
  for (const child of Array.from(template.content.childNodes)) {
    if (child.nodeType === 3) {
      const text = (child.nodeValue || "").trim();
      if (text) {
        const paragraphs = text.split(/\n{2,}/).filter(Boolean);
        result += paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph).replaceAll("\n", "<br>")}</p>`).join("");
      }
    } else if (child.nodeType === 1) {
      result += (child as Element).outerHTML;
    }
  }
  return linkifyRichTextHtml(result);
}

type BusinessHoursRow = { day: string; hours: string };

function parseBusinessHoursRow(value: string): BusinessHoursRow | null {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  const dayPattern = "(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Mon|Tue|Wed|Thu|Fri|Sat|Sun)";
  const named = normalized.match(new RegExp(`^(${dayPattern}(?:\\s*[-–—]\\s*${dayPattern})?)\\s*(?::|[-–—])?\\s*(.+)$`, "i"));
  if (named) return { day: named[1].trim(), hours: named[2].trim() };
  return null;
}

function businessHoursRows(hours: string[]): BusinessHoursRow[] {
  return hours.map(parseBusinessHoursRow).filter((row): row is BusinessHoursRow => Boolean(row));
}

function businessHoursTableHtml(hours: string[]): string {
  const rows = businessHoursRows(hours);
  if (!rows.length) return "";
  return `<table><tbody>${rows.map((row) => `<tr><th scope="row" style="font-weight:normal;text-align:left">${escapeHtml(row.day)}</th><td style="text-align:left">${escapeHtml(row.hours)}</td></tr>`).join("")}</tbody></table>`;
}

function replaceBusinessHoursSection(html: string, hours: string[]): string {
  const tableHtml = businessHoursTableHtml(hours);
  if (!tableHtml) return html;
  const template = document.createElement("template");
  template.innerHTML = html;
  const replace = (elements: Element[]): boolean => {
    const rows = elements.map((element) => parseBusinessHoursRow(element.textContent || "")).filter((row): row is BusinessHoursRow => Boolean(row));
    if (rows.length < 2) return false;
    const table = document.createElement("template");
    table.innerHTML = tableHtml;
    elements[0].replaceWith(table.content.firstElementChild!);
    for (const element of elements.slice(1)) element.remove();
    return true;
  };
  const pre = Array.from(template.content.querySelectorAll("pre")).find((element) => {
    const lines = (element.textContent || "").split(/\r?\n/).filter((line) => line.trim());
    return lines.length >= 2 && businessHoursRows(lines).length >= 2;
  });
  if (pre) {
    const table = document.createElement("template");
    table.innerHTML = tableHtml;
    pre.replaceWith(table.content.firstElementChild!);
    return template.innerHTML;
  }
  const paragraphs = Array.from(template.content.children).filter((element) => element.tagName.toLowerCase() === "p");
  for (let index = 0; index < paragraphs.length; index += 1) {
    const run: Element[] = [];
    for (let cursor = index; cursor < paragraphs.length; cursor += 1) {
      const row = parseBusinessHoursRow(paragraphs[cursor].textContent || "");
      if (!row) break;
      run.push(paragraphs[cursor]);
    }
    if (replace(run)) return template.innerHTML;
  }
  return html;
}

function tinyMceHtmlValue(profile: BusinessProfile): string {
  if (isGroup1Url(location.href) || manualAutofillFamily(location.href) === 1) {
    // Approved Long Description is the source, not a template to regenerate.
    // Keep existing HTML/links/spacing verbatim; plain text keeps its line breaks.
    const description = /<[a-z][\s\S]*>/i.test(profile.description) ? profile.description
      : `<div style="white-space:pre-wrap">${escapeHtml(profile.description)}</div>`;
    return (profile.imageUrl.trim() ? `<img src="${escapeHtml(profile.imageUrl.trim())}" alt="">` : '') + description;
  }
  const description = replaceBusinessHoursSection(postDescriptionHtml(profile.description), profile.businessHours);
  return profile.imageUrl.trim()
    ? `<img src="${escapeHtml(profile.imageUrl.trim())}" alt="" /><p><br></p>${description}`
    : description;
}

function publicationElementVisible(element: Element): boolean {
  for (let node: Element | null = element; node; node = node.parentElement) {
    if (node.hasAttribute("hidden") || node.getAttribute("aria-hidden") === "true") return false;
    const style = node.ownerDocument.defaultView?.getComputedStyle(node);
    if (style?.display === "none" || style?.visibility === "hidden") return false;
  }
  return true;
}

function canonicalArticleHtml(html: string): string {
  const template = document.createElement("template");
  template.innerHTML = html;
  function nodeValue(node: Node): unknown {
    if (node.nodeType === 3) return isGroup1Url(location.href) ? node.textContent || '' : (node.textContent || "").replace(/\s+/g, " ").trim();
    if (node.nodeType !== 1) return "";
    const element = node as Element;
    const attributes = Array.from(element.attributes).filter((attribute) => !/^data-(?:cke|mce)-/.test(attribute.name))
      .map((attribute) => [attribute.name, attribute.value]).sort((a, b) => a[0].localeCompare(b[0]));
    return [element.tagName.toLowerCase(), attributes, Array.from(element.childNodes).map(nodeValue).filter(Boolean)];
  }
  return JSON.stringify(Array.from(template.content.childNodes).map(nodeValue).filter(Boolean));
}

function currentRichArticleHtml(scope: Element): string | null {
  const frames = document.querySelectorAll(`${CKEDITOR_FRAME_SELECTOR}, iframe#content_ifr, iframe[id$="_ifr"][data-id="content"]`);
  if (frames.length > 1) return null;
  if (frames.length === 1 && !scope.contains(frames[0])) return null;
  if (frames.length === 1 && !publicationElementVisible(frames[0])) return null;
  const ckInstances = ckEditorInstances() as Array<CkEditorInstance & { getData?: () => string }>;
  if (ckInstances.length > 1) return null;
  const ckBody = ckEditorBody();
  if (ckBody && !publicationElementVisible(ckBody)) return null;
  if (ckBody && !frames.length && !scope.contains(ckBody)) return null;
  if (ckBody) return ckBody.innerHTML;
  if (ckInstances.length === 1 && ckInstances[0].getData && scope.contains(ckEditorTextarea())) return ckInstances[0].getData();
  const tiny = (globalThis as typeof globalThis & { tinymce?: { get?: (id: string) => { getContent?: () => string } | null } }).tinymce?.get?.("content");
  if (tiny?.getContent && scope.contains(document.querySelector('textarea#content, textarea[name="content"]'))) return tiny.getContent();
  if (frames.length === 1) {
    try { return (frames[0] as HTMLIFrameElement).contentDocument?.body?.innerHTML ?? null; } catch { return null; }
  }
  const editors = Array.from(scope.querySelectorAll<HTMLElement>('[contenteditable="true"]')).filter(publicationElementVisible);
  return editors.length === 1 ? editors[0].innerHTML : null;
}

export function validateBlogPublication(profile: BusinessProfile): { ok: boolean; error?: string } {
  const fail = (error: string) => ({ ok: false, error });
  if (isGroup1Url(location.href) && !profile.imageUrl.trim()) return fail('The saved business image is missing. Publication requires the approved image above the exact Long Description.');
  if (observeBlogWorkflow(document, location.href).stage !== "EDITOR") return fail("Current page is not a supported article editor.");
  const publish = findUniqueBlogPublishControl(document);
  if (!publish) return fail("Publish control is missing, disabled, or ambiguous.");
  const form = publish.form || publish.closest("form");
  const scope = form || document.body;
  if (form?.action && new URL(form.action, location.href).origin !== location.origin) return fail("Publication form targets another origin; manual review required.");
  if (publish.hasAttribute("formaction") && new URL(publish.formAction, location.href).origin !== location.origin) return fail("Publish control targets another origin; manual review required.");
  const target = publish.getAttribute("formtarget") || form?.getAttribute("target") || "_self";
  if (target !== "_self") return fail("Publication must remain in the existing Chrome tab.");
  if (scope.querySelector('input[type="password"]')) return fail("Authentication controls are present; publication is blocked.");
  const titleSelector = getSiteAdapter(location.href)?.config.editor?.titleSelector || 'input#title, input[name="title"], input[name="post_title"], input[placeholder*="title" i], input[aria-label="Title" i]';
  const titles = Array.from(scope.querySelectorAll<HTMLInputElement>(titleSelector)).filter(publicationElementVisible);
  if (titles.length !== 1 || !profile.businessName.trim() || titles[0].value.trim() !== profile.businessName.trim()) return fail("Article title does not match the approved business profile.");
  const html = currentRichArticleHtml(scope);
  if (!profile.description.trim() || html === null || canonicalArticleHtml(html) !== canonicalArticleHtml(tinyMceHtmlValue(profile))) return fail("Rich article body does not match the approved profile content; review the editor.");
  const expected = articleExpectation(profile.businessName, tinyMceHtmlValue(profile), document);
  if (expected.bodyExcerpt.length < 40 || expected.bodyExcerpt.split(" ").length < 8) return fail("Article body is insufficient for subsequent public verification.");
  const fields = form ? Array.from(form.elements) : Array.from(scope.querySelectorAll("input,select,textarea"));
  if (fields.some((element) => "willValidate" in element && (element as HTMLInputElement).willValidate && !(element as HTMLInputElement).validity.valid)) return fail("Required or invalid form fields need manual review.");
  if (Array.from(scope.querySelectorAll<HTMLElement>('[aria-required="true"]')).some((element) => publicationElementVisible(element) && !("value" in element ? String(element.value).trim() : element.textContent?.trim()))) return fail("A required custom field needs manual input.");
  if (findTermsAgreementCandidates(document).some((candidate) => !candidate.checkbox.checked)
    || Array.from(scope.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')).some((field) => !field.checked && /agree|consent|accept.*(?:terms|conditions)/i.test(field.labels?.[0]?.textContent || field.getAttribute("aria-label") || ""))) return fail("Complete the required Terms/consent checkpoint manually.");
  const gates = adaptiveHumanGateReasons(document.body?.innerText || document.body?.textContent || "").filter((gate) => gate !== "Terms/Agreement" && gate !== "CAPTCHA");
  if (gates.length) return fail("Payment or human verification checkpoint requires manual completion.");
  if (Array.from(document.querySelectorAll('[autocomplete^="cc-"], [data-payment-required="true"], iframe[title*="payment" i]')).some(publicationElementVisible)) return fail("Payment controls require manual completion.");
  const challenges = Array.from(document.querySelectorAll('[id*="captcha" i], [class*="captcha" i], [class*="puzzle" i], [class*="turnstile" i], [data-sitekey], iframe[src*="captcha" i]')).filter(publicationElementVisible);
  const providers = [
    { widget: '.g-recaptcha, iframe[src*="recaptcha" i]', response: "g-recaptcha-response" },
    { widget: '.h-captcha, iframe[src*="hcaptcha" i]', response: "h-captcha-response" },
    { widget: '.cf-turnstile, iframe[src*="challenges.cloudflare" i]', response: "cf-turnstile-response" },
  ];
  const knownWidget = providers.map((provider) => provider.widget).join(", ");
  const unknownChallenge = challenges.some((element) => !element.matches(knownWidget) && !element.closest(knownWidget) && !element.querySelector(knownWidget));
  const activeProviders = providers.map((provider) => ({ ...provider, widgets: Array.from(document.querySelectorAll(provider.widget))
    .filter(publicationElementVisible).filter((widget) => !widget.parentElement?.closest(provider.widget)) })).filter((provider) => provider.widgets.length);
  const incompleteCaptcha = activeProviders.some((provider) => {
    const responses = Array.from(scope.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(`[name="${provider.response}"]`));
    return provider.widgets.length !== 1 || !scope.contains(provider.widgets[0]) || responses.length !== 1 || !responses[0].value.trim();
  });
  if (challenges.length && (unknownChallenge || !activeProviders.length || incompleteCaptcha)) return fail("Complete CAPTCHA manually before publication; unsupported or ambiguous challenges remain blocked.");
  if (Array.from(scope.querySelectorAll('[role="alert"], .error, .invalid-feedback')).some((element) => publicationElementVisible(element) && element.textContent?.trim())) return fail("The page reports a validation error; review it manually.");
  return { ok: true };
}

// Shared by validation and the existing publish message. All post-intent failures burn the
// attempt: the coordinator observes outcomes, never redispatches a publication command.
export async function handleBlogPublication(runId: string, attemptId?: string): Promise<{ ok: boolean; error?: string }> {
  const fail = (error: string) => ({ ok: false, error });
  const run = await readListingRun();
  const profile = await getActiveProfile();
  if (!run || run.id !== runId || run.autoPublish !== true || !run.publicationApproval || !profile || profile.id !== run.profileId
    || !Number.isFinite(Date.parse(run.publicationApproval.authorizedAt)) || run.publicationEditorUrl !== location.href
    || await publicationProfileFingerprint(profile) !== run.publicationApproval.profileFingerprint) return fail("Auto Publish authorization, approved page, or business profile is missing or changed.");
  if (!await registrationRecoveryValid(run, true)) return fail("Recovery account evidence changed; publication blocked.");
  if (run.publicVerification || run.liveUrl || run.autoRegister && run.registration?.state !== 'confirmed') return fail("An article outcome exists or registration is not confirmed; publication is blocked.");
  const snapshot = publicationProfileSnapshot(profile);
  const valid = validateBlogPublication(profile);
  if (!valid.ok || !attemptId) return valid;
  const intent = run.publicationSubmission;
  if (!run.submissionAttempted || run.stage !== "SUBMITTING" || !intent || intent.attemptId !== attemptId || intent.url !== location.href || intent.claimed) return fail("Publication intent is absent, changed, or already consumed. Inspect the existing outcome; do not retry.");
  // Fingerprinting/profile reads above yield. Never revive that older run snapshot
  // if another workflow, revocation, or outcome arrived while validation was pending.
  const claimRun = await readListingRun();
  const claimIntent = claimRun?.publicationSubmission;
  if (!claimRun || claimRun.id !== runId || claimRun.stage !== "SUBMITTING" || claimRun.autoPublish !== true || claimRun.submissionAttempted !== true
    || claimRun.profileId !== run.profileId || claimRun.publicVerification || claimRun.liveUrl || claimRun.autoRegister && claimRun.registration?.state !== 'confirmed'
    || claimRun.publicationApproval?.profileFingerprint !== run.publicationApproval.profileFingerprint
    || claimRun.publicationApproval.authorizedAt !== run.publicationApproval.authorizedAt
    || !claimIntent || claimIntent.attemptId !== attemptId || claimIntent.url !== location.href || claimIntent.claimed || claimIntent.outcome !== "intent") return fail("Publication run or intent changed during validation; inspect the current outcome without retrying.");
  const globals = globalThis as typeof globalThis & { __ba2PublicationClaims?: Set<string> };
  const claims = globals.__ba2PublicationClaims ||= new Set<string>();
  if (claims.has(attemptId)) return fail("Publication command already consumed; do not retry.");
  claims.add(attemptId);
  await writeListingRun(updateListingRun(claimRun, { publicationSubmission: { ...claimIntent, claimed: true } }));
  const latest = await readListingRun();
  const currentProfile = await getActiveProfile();
  if (!latest || latest.id !== runId || latest.publicationSubmission?.attemptId !== attemptId || latest.publicationSubmission.claimed !== true
    || latest.publicationSubmission.outcome !== "intent" || latest.submissionAttempted !== true || latest.stage !== "SUBMITTING" || latest.autoPublish !== true
    || latest.publicationApproval?.profileFingerprint !== run.publicationApproval.profileFingerprint || latest.profileId !== run.profileId
    || latest.publicVerification || latest.liveUrl || latest.autoRegister && latest.registration?.state !== 'confirmed'
    || !currentProfile || publicationProfileSnapshot(currentProfile) !== snapshot || location.href !== intent.url) return fail("Run, page, or profile changed after submission intent; inspect manually without retrying.");
  const finalCheck = validateBlogPublication(currentProfile);
  if (!finalCheck.ok) return finalCheck;
  if (!await registrationRecoveryValid(latest, true)) return fail("Recovery evidence changed before publication; no submit.");
  const publish = findUniqueBlogPublishControl(document);
  if (!publish?.isConnected) return fail("Publish control changed after validation; inspect manually without retrying.");
  publish.click();
  return { ok: true };
}

function syncTinyMceEditor(profile: BusinessProfile): string | null {
  const value = tinyMceHtmlValue(profile);
  let handled = false;
  const tinyMce = (globalThis as typeof globalThis & { tinymce?: { get?: (id: string) => { setContent: (content: string) => void; save?: () => void; fire?: (event: string) => void } | null } }).tinymce;
  const editor = tinyMce?.get?.("content");
  if (editor) {
    editor.setContent(value);
    editor.save?.();
    editor.fire?.("change");
    handled = true;
  }
  const textarea = document.querySelector<HTMLTextAreaElement>('textarea#content, textarea[name="content"]');
  const iframe = document.querySelector<HTMLIFrameElement>('iframe#content_ifr, iframe[id$="_ifr"][data-id="content"]');
  if (textarea && (editor || iframe) && setVisibleValue(textarea, value)) handled = true;
  try {
    const body = iframe?.contentDocument?.body;
    if (body && (body.isContentEditable || body.getAttribute("contenteditable") === "true") && setContentEditableHtml(body, value)) handled = true;
  } catch {
    // Cross-document access can be unavailable; TinyMCE or the frame content script handles it.
  }
  return handled ? value : null;
}

type CkEditorInstance = { setData?: (content: string) => void; updateElement?: () => void; fire?: (event: string) => void };

function ckEditorInstances(): CkEditorInstance[] {
  const ckeditor = (globalThis as typeof globalThis & { CKEDITOR?: { instances?: Record<string, CkEditorInstance> } }).CKEDITOR;
  const instanceName = getSiteAdapter(location.href)?.config.editor?.instanceName;
  return ckeditor?.instances ? (instanceName ? [ckeditor.instances[instanceName]] : Object.values(ckeditor.instances)).filter(Boolean) : [];
}

/** CKEditor 4 exposes its editable body through a `.cke_wysiwyg_frame` iframe or an inline `.cke_editable`. */
function ckEditorBody(): HTMLElement | null {
  const iframe = document.querySelector<HTMLIFrameElement>(getSiteAdapter(location.href)?.config.editor?.frameSelector || CKEDITOR_FRAME_SELECTOR);
  try {
    const body = iframe?.contentDocument?.body;
    if (body && (body.isContentEditable || body.getAttribute("contenteditable") === "true" || body.classList.contains("cke_editable"))) return body;
  } catch {
    // Cross-document access can be unavailable; the frame content script handles it.
  }
  return document.querySelector<HTMLElement>('[contenteditable="true"].cke_editable, .cke_editable[contenteditable="true"]');
}

function isCkEditorPage(): boolean {
  return ckEditorInstances().length > 0 || Boolean(document.querySelector(`${CKEDITOR_FRAME_SELECTOR}, .cke_editable, .cke_contents, [class*="cke_editable"]`));
}

function ckEditorTextarea(): HTMLTextAreaElement | null {
  return document.querySelector<HTMLTextAreaElement>('textarea.cke_source, textarea[name="content"], textarea#content, textarea[name="editor"], textarea#editor, textarea[name="body"], textarea#body');
}

function syncCkEditor(profile: BusinessProfile): { value: string; descriptor: string } | null {
  const value = tinyMceHtmlValue(profile);
  for (const editor of ckEditorInstances()) {
    if (typeof editor.setData !== "function") continue;
    try {
      editor.setData(value);
      editor.updateElement?.();
      editor.fire?.("change");
      const textarea = ckEditorTextarea();
      textarea?.dispatchEvent(new Event("input", { bubbles: true }));
      textarea?.dispatchEvent(new Event("change", { bubbles: true }));
      return { value, descriptor: "CKEditor content" };
    } catch {
      // Fall through to the iframe body path.
    }
  }
  const body = ckEditorBody();
  if (body && setContentEditableHtml(body, value)) {
    const textarea = ckEditorTextarea();
    if (textarea) setVisibleValue(textarea, value);
    return { value, descriptor: "CKEditor content" };
  }
  return null;
}

function syncRichEditor(profile: BusinessProfile): { value: string; descriptor: string } | null {
  const ckEditor = syncCkEditor(profile);
  if (ckEditor) return ckEditor;
  // A CKEditor page whose editor is not reachable yet must not be written through the hidden backing textarea.
  if (isCkEditorPage()) return null;
  const tinyMce = syncTinyMceEditor(profile);
  return tinyMce !== null ? { value: tinyMce, descriptor: "TinyMCE content" } : null;
}

function prepareFreeWebAdsForm(profile: BusinessProfile): { form: NonNullable<ListingAutofillReport["form"]>; manual: string[] } {
  const form: NonNullable<ListingAutofillReport["form"]> = {};
  const manual: string[] = [];
  const locationValue = `${profile.city.trim()}, ${usStateAbbreviation(profile.state, profile.stateCode)}`;
  const locationFormatValid = /^[^,]+,\s[A-Z]{2}$/.test(locationValue);
  const locationInput = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="text"], input:not([type])')).find((element) => /or specify|specify location|other location/.test(formFieldText(element)));
  const locationSelect = Array.from(document.querySelectorAll<HTMLSelectElement>("select")).find((select) => Array.from(select.options).some((option) => /^\(other\)$/i.test(option.textContent?.trim() || "")) && /location|city|state|country|other/.test(formFieldText(select)));
  let locationVerified = false;
  if (locationInput && locationSelect) {
    const other = Array.from(locationSelect.options).find((option) => /^\(other\)$/i.test(option.textContent?.trim() || ""));
    if (other) {
      locationSelect.value = other.value;
      locationSelect.dispatchEvent(new Event("input", { bubbles: true }));
      locationSelect.dispatchEvent(new Event("change", { bubbles: true }));
      locationVerified = locationFormatValid && setVisibleValue(locationInput, locationValue);
    }
  }
  if (!locationVerified) manual.push("Location could not be verified");
  form.location = { value: locationValue, verified: locationVerified };

  const description = profile.description || profile.shortDescription;
  const editor = Array.from(document.querySelectorAll<HTMLTextAreaElement>("textarea")).find((element) => /post|description|details|about/.test(formFieldText(element)))
    || Array.from(document.querySelectorAll<HTMLElement>('[contenteditable="true"]')).find((element) => /post|description|details|about|editor/.test(formFieldText(element)));
  const descriptionVerified = editor instanceof HTMLTextAreaElement ? setVisibleValue(editor, descriptionPlainText(description)) : Boolean(editor && setContentEditableHtml(editor, postDescriptionHtml(description)));
  form.description = { verified: descriptionVerified };
  if (!descriptionVerified) manual.push("Post/Description could not be verified");

  const contactRadio = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="radio"]')).find((radio) => /do not display my email but allow users to contact me through the contact form/i.test(radio.closest("label")?.textContent || radio.parentElement?.textContent || ""));
  if (contactRadio) {
    contactRadio.checked = true;
    contactRadio.dispatchEvent(new Event("input", { bubbles: true }));
    contactRadio.dispatchEvent(new Event("change", { bubbles: true }));
  }
  form.contactForm = { verified: Boolean(contactRadio?.checked) };
  if (!contactRadio?.checked) manual.push("Contact-form option could not be verified");

  const commercialInterests = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')).find((checkbox) => /people can contact me with commercial interests/i.test(checkbox.closest("label")?.textContent || checkbox.parentElement?.textContent || ""));
  if (commercialInterests && !commercialInterests.checked) {
    commercialInterests.checked = true;
    commercialInterests.dispatchEvent(new Event("input", { bubbles: true }));
    commercialInterests.dispatchEvent(new Event("change", { bubbles: true }));
  }
  form.commercialInterests = { checked: Boolean(commercialInterests?.checked) };
  if (!commercialInterests?.checked) manual.push("Commercial interests checkbox could not be verified");

  return { form, manual };
}

function prepareFamilyForm(profile: BusinessProfile): { form: NonNullable<ListingAutofillReport["form"]>; manual: string[] } {
  const form: NonNullable<ListingAutofillReport["form"]> = {};
  const manual: string[] = [];
  const locationValue = `${profile.city.trim()}, ${usStateAbbreviation(profile.state, profile.stateCode)}`;
  const locationInputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="text"], input:not([type]), textarea'));
  const directLocationInput = locationInputs.find((element) => {
    const ownText = normalizeLocation([element.getAttribute("name"), element.id, element.getAttribute("aria-label"), element.getAttribute("placeholder"), element.closest("label")?.textContent].filter(Boolean).join(" "));
    const rowText = normalizeLocation(element.closest("tr, td, th, .field, .form-group, label")?.textContent || "");
    const locationText = `${ownText} ${rowText}`;
    return /\blocation\b/.test(locationText) && !/or specify|other location|location other|complete address|street address|postal code/.test(locationText);
  });
  const locationInput = directLocationInput || locationInputs.find((element) => /or specify|specify location|other location|location[_ -]?other/.test(formFieldText(element)));
  const locationSelect = Array.from(document.querySelectorAll<HTMLSelectElement>("select")).find((select) => /location|city|state|country|other/.test(formFieldText(select)) && Array.from(select.options).some((option) => /^\(?(?:other|specify)\)?$/i.test(option.textContent?.trim() || "")));
  const hasProfileLocation = Boolean(profile.city.trim() && (profile.state.trim() || profile.stateCode?.trim()));
  if (locationInput && hasProfileLocation) {
    const other = locationSelect && Array.from(locationSelect.options).find((option) => /^\(?(?:other|specify)\)?$/i.test(option.textContent?.trim() || ""));
    if (!directLocationInput && locationSelect && other) {
      locationSelect.value = other.value;
      locationSelect.dispatchEvent(new Event("input", { bubbles: true }));
      locationSelect.dispatchEvent(new Event("change", { bubbles: true }));
    }
    const verified = setVisibleValue(locationInput, locationValue);
    form.location = { value: locationValue, verified };
    if (!verified) manual.push("Location specify could not be verified");
  }
  const commercialInterests = checkExactCheckbox(/people\s+can\s+contact\s+me\s+with\s+commercial\s+interests?/i);
  form.commercialInterests = { checked: commercialInterests };
  if (!commercialInterests) manual.push("Commercial interests checkbox could not be verified");
  return { form, manual };
}
function plumbingCategoryMatcher(profile: BusinessProfile, family3 = false): ((label: string) => number) | null {
  const category = normalize(profile.category), name = normalize(profile.businessName), services = normalize(profile.services.join(' '));
  const plumbing = /\b(?:plumb(?:ing|ers?)|(?:drains?|sewers?) (?:cleaning|repairs?|unblocking|unclogging))\b/;
  // Explicit business identity can correct a misclassified saved category.
  // Incidental service/description mentions must not hijack another industry.
  if (!plumbing.test(category) && !plumbing.test(name)
    && !(/^(?:|services?|home services?|trade services?|building and construction)$/.test(category) && plumbing.test(services))) return null;
  const drains = /\b(?:drains?|sewers?) (?:cleaning|repairs?|unblocking|unclogging)\b/.test(`${category} ${name} ${services}`);
  return label => {
    const text = normalize(label);
    if (/^(?:plumbing|plumbers?|plumbing and plumbers?|plumbing contractors?)$/.test(text)) return 100;
    if (/^plumbing services?$/.test(text)) return 90;
    if (drains && /^(?:drain|sewer|drain and sewer) cleaning$/.test(text)) return 80;
    if (/^trade services?$/.test(text)) return 70;
    if (family3 && text === 'home improvement') return 65;
    if (/^(?:building and construction|building construction)$/.test(text)) return 60;
    if (family3 && text === 'construction and maintenance') return 55;
    return 0;
  };
}

function limousineCategoryMatcher(profile: BusinessProfile, family: 2 | 3): ((label: string) => number) | null {
  const category = normalize(profile.category);
  const specialist = /\b(?:limousines?|limos?|chauffeurs?|luxury transport(?:ation)?|executive car services?|private passenger transport(?:ation)?)\b/;
  const generic = /^(?:|services?|(?:business|transportation|transport|travel|automotive|car|taxi|passenger transportation) services?|transportation|transport|travel|automotive|travel and tourism|transportation and logistics)$/;
  if (!specialist.test(category) && !(generic.test(category) && specialist.test(normalize(`${profile.businessName} ${profile.services.join(' ')}`)))) return null;
  return label => {
    const text = normalize(label);
    if (/^(?:limousines?|limos?|chauffeurs?)(?: services?)?$/.test(text)) {
      if (text === category) return 110;
      if (/\bchauffeur/.test(category) && /^chauffeur/.test(text)) return 105;
      return /^limousine/.test(text) ? 100 : /^limo/.test(text) ? 95 : 90;
    }
    if (/^(?:luxury transportation|executive car services?|private passenger transportation)$/.test(text)) return 85;
    if (family === 2) {
      if (/^(?:taxis?|taxicabs?)(?: services?)?$/.test(text)) return 70;
      if (/^travel(?: and tourism)?$/.test(text)) return 60;
      if (text === 'automotive') return 50;
    } else {
      if (/^(?:automotive )?transport$/.test(text)) return 70;
      if (/^(?:travel and tourism )?transportation$/.test(text)) return 65;
      if (/^(?:business )?transportation and logistics$/.test(text)) return 60;
    }
    return 0;
  };
}

function junkRemovalCategoryMatcher(profile: BusinessProfile, family: 2 | 3): ((label: string) => number) | null {
  const category = normalize(profile.category);
  const specialist = /\b(?:junk (?:removal|hauling)|(?:trash|waste|rubbish|garbage|construction debris) (?:removal|hauling)|waste management)\b/;
  const generic = /^(?:|services?|business services?|home services?|removal services?|cleaning services?)$/;
  const evidence = normalize(`${profile.businessName} ${profile.services.join(' ')} ${profile.shortDescription} ${profile.description}`);
  // Descriptions may establish a generic profile's industry, never replace an explicit different industry.
  if (!specialist.test(category) && !(generic.test(category) && specialist.test(evidence))) return null;
  const construction = /\b(?:construction|demolition|renovation) (?:debris|waste|rubbish)\b/.test(`${category} ${evidence}`);
  return label => {
    const text = normalize(label);
    if (/^junk hauling(?: services?)?$/.test(text)) return 110;
    if (/^junk removal(?: services?)?$/.test(text)) return 105;
    if (/^(?:trash|rubbish|garbage) removal(?: services?)?$/.test(text)) return 100;
    if (/^waste removal(?: services?)?$/.test(text)) return 95;
    if (text === 'waste management') return 90;
    if (family === 2) {
      if (text === 'haulers') return 70;
      if (text === 'garbage services') return 65;
      if (text === 'disposal') return 60;
      if (text === 'removal services') return 50;
    } else {
      if (/^(?:home )?domestic services$/.test(text)) return 70;
      if (/^(?:business )?business services$/.test(text)) return 60;
      if (construction && /^(?:business )?construction and maintenance$/.test(text)) return 55;
      if (/^(?:home )?home improvement$/.test(text)) return 50;
    }
    return 0;
  };
}

export function family2CategoryChoice(select: HTMLSelectElement, profile: BusinessProfile, broaderPlumbing = false): { choice?: { value: string; label: string }; reason: string } {
  const industry = plumbingCategoryMatcher(profile, broaderPlumbing)
    || (manualAutofillFamily(location.href) === 2 ? limousineCategoryMatcher(profile, 2) || junkRemovalCategoryMatcher(profile, 2) : null);
  if (!profile.category.trim() && !industry) return { reason: 'No business category is saved in the active MAHID profile; left unchanged.' };
  if (select.disabled) return { reason: 'Category dropdown is disabled; left unchanged.' };
  const options = Array.from(select.options).filter(option => option.value && !option.disabled
    && !(option.parentElement instanceof HTMLOptGroupElement && option.parentElement.disabled)
    && !/^(?:[-\s]*)(?:select|choose)\b|^[-\s]+$|^none$/i.test(option.textContent?.trim() || ''));
  // Outside specialized industries, Family2 uses only the active category. Generic words and the shared
  // subcategory matcher's broad moving/removal or plumbing/pool groups are not industry evidence.
  const categoryWords = (value: string): Set<string> => new Set(normalize(value)
    .replace(/\b(?:junk(?: removal| hauling)?|waste management|(?:trash|rubbish|garbage|debris) removal)\b/g, 'junk')
    .replace(/\b(?:roof|roofer|roofing)\b/g, 'roofing')
    .replace(/\b(?:plumber|plumbing)\b/g, 'plumbing')
    .replace(/\b(?:hvac|heating|cooling|air conditioning)\b/g, 'hvac')
    .replace(/\b(?:medical|clinics?|physicians?|doctors?)\b/g, 'medical')
    .replace(/\b(?:health|fitness|wellness|therapy|nutrition|rehabilitation)\b/g, 'health')
    .replace(/\b(?:hair|beauty|cosmetic|aesthetic|spa)\b/g, 'beauty')
    .replace(/\b(?:cleaning|chores|housekeeping|maid)\b/g, 'cleaning')
    .replace(/\b(?:services?|contractors?|business|company|professional|and|care)\b/g, ' ')
    .split(/\s+/).filter(Boolean));
  const wanted = categoryWords(profile.category);
  const ranked = options.map(option => {
    const label = option.textContent?.trim() || '';
    if (industry) return { option, score: industry(label) };
    const available = categoryWords(label);
    const overlap = [...wanted].filter(word => available.has(word)).length;
    let matchScore = overlap && overlap === wanted.size && overlap === available.size ? 2
      : Math.max(overlap / Math.max(available.size, 1), overlap / Math.max(wanted.size, 1) * 0.85);
    if (normalize(label) === normalize(profile.category)) matchScore = 3;
    else if (/\b(?:medical|clinic|clinics|physician|doctor|vein|dermatology|surgery|skin|health|healthcare|wellness|beauty|cosmetic|aesthetic)\b/.test(normalize(profile.category))
      && /\b(?:health|healthcare)\b/.test(normalize(label))) matchScore = Math.max(matchScore, 0.7);
    return { option, score: matchScore };
  }).sort((a, b) => b.score - a.score);
  const best = ranked[0];
  if (!best || best.score < 0.7) return { reason: `No suitable available category matches "${profile.category}"; left unchanged.` };
  if (ranked[1]?.score === best.score) return { reason: `Available categories are ambiguous for "${profile.category}"; left unchanged.` };
  return { choice: { value: best.option.value, label: best.option.textContent?.trim() || '' }, reason: '' };
}

function chooseOption(select: HTMLSelectElement, profile: BusinessProfile, field: ListingField, learned?: ListingCategoryMapping): { value: string; label: string } | null {
  if (field === 'category' && manualAutofillFamily(location.href) === 2) return family2CategoryChoice(select, profile).choice || null;
  const desired = field === "category" ? [profile.category, ...profile.services] : field === "state"
    ? [profile.state, profile.stateCode || "", STATE_NAMES[normalizeLocation(profile.stateCode || "")] || ""]
    : field === "country"
      ? [profile.country, ...locationAliases(profile.country)]
      : [profile[field] as string];
  const options = Array.from(select.options).filter((item) => {
    if (!item.value || item.disabled) return false;
    const text = normalizeLocation(item.textContent || "");
    if (/^select(?:\s+category)?$|^choose(?:\s+category)?$|^--+$/.test(text)) return false;
    if (field === "category" && ((item.value === "0" && /\b(?:top|root)\b|root\s+categor(?:y|ies)/.test(text)) || /^\[?top\]?$/.test(text))) return false;
    return true;
  });
  if (field === "category") {
    const siteSpecific = siteSpecificCategoryOption(select);
    if (siteSpecific) return { value: siteSpecific.value, label: siteSpecific.textContent?.trim() || siteSpecific.value };
    if (learned) {
      const remembered = options.find((item) => item.value === learned.value);
      if (remembered) return { value: remembered.value, label: remembered.textContent?.trim() || remembered.value };
    }
    const ranked = options.map((item) => ({ item, score: categoryScore(`${item.parentElement?.tagName === "OPTGROUP" ? (item.parentElement as HTMLOptGroupElement).label : ""} ${item.textContent || item.value}`, profile) })).sort((a, b) => b.score - a.score);
    const best = ranked[0];
    const margin = best && ranked[1] ? best.score - ranked[1].score : best?.score || 0;
    if (!best || best.score <= 0 || (ranked[1] && margin <= 0)) return null;
    return { value: best.item.value, label: best.item.textContent?.trim() || best.item.value };
  }
  for (const want of desired.filter(Boolean)) {
    const wanted = normalize(want);
    const exact = options.find((item) => normalize(item.textContent || item.value) === wanted || normalize(item.value) === wanted);
    if (exact) return { value: exact.value, label: exact.textContent?.trim() || exact.value };
  }
  const ranked = options.map((item) => ({ item, score: Math.max(...desired.filter(Boolean).map((want) => score(normalize(item.textContent || item.value), [want]))) })).sort((a, b) => b.score - a.score)[0];
  return ranked && ranked.score > 0 ? { value: ranked.item.value, label: ranked.item.textContent?.trim() || ranked.item.value } : null;
}

type LocationSelectField = "country" | "state" | "city";

function locationSelect(field: LocationSelectField): HTMLSelectElement | undefined {
  const pattern = field === "country" ? /country/ : field === "state" ? /state|province|region/ : /city|town/;
  return Array.from(document.querySelectorAll<HTMLSelectElement>("select")).find((select) => {
    if (manualAutofillFamily(location.href) === 2) {
      const labels = Array.from(select.labels || []).map(label => {
        const clone = label.cloneNode(true) as HTMLElement;
        clone.querySelectorAll('select, option').forEach(node => node.remove());
        return clone.textContent || '';
      });
      return pattern.test([select.name, select.id, select.getAttribute('aria-label'), ...labels].join(' ').toLowerCase());
    }
    const label = select.closest("label");
    const labelClone = label?.cloneNode(true) as HTMLElement | undefined;
    labelClone?.querySelectorAll("select, option").forEach((element) => element.remove());
    const text = [select.name, select.id, select.getAttribute("aria-label"), labelClone?.textContent, select.previousElementSibling?.textContent].filter(Boolean).join(" ").toLowerCase();
    return pattern.test(text);
  });
}

function optionSignature(select: HTMLSelectElement): string {
  return Array.from(select.options).map((option) => `${option.value}:${option.textContent || ""}:${option.disabled ? "1" : "0"}`).join("|");
}

async function waitForLocationOptions(profile: BusinessProfile, field: LocationSelectField, previousSignature: string, waitForChange = false): Promise<HTMLSelectElement | undefined> {
  for (let attempt = 0; attempt < (waitForChange ? 100 : 50); attempt += 1) {
    const select = locationSelect(field);
    if (select && !select.disabled && chooseOption(select, profile, field)) {
      if (optionSignature(select) !== previousSignature || !waitForChange && attempt >= 4) return select;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
  }
  return locationSelect(field);
}

async function prepareCascadingLocation(profile: BusinessProfile): Promise<void> {
  const country = locationSelect("country");
  if (!country) return;
  const countryChoice = chooseOption(country, profile, "country");
  if (!countryChoice || !setVisibleValue(country, countryChoice.value)) return;

  const stateBefore = locationSelect("state");
  const state = await waitForLocationOptions(profile, "state", stateBefore ? optionSignature(stateBefore) : "");
  if (!state) return;
  const stateChoice = chooseOption(state, profile, "state");
  const stateSet = stateChoice ? setVisibleValue(state, stateChoice.value) : false;
  if (!stateChoice || !stateSet) return;

  const cityBefore = locationSelect("city");
  const city = await waitForLocationOptions(profile, "city", cityBefore ? optionSignature(cityBefore) : "");
  if (!city) return;
  const cityChoice = chooseOption(city, profile, "city");
  if (cityChoice) setVisibleValue(city, cityChoice.value);
}

async function prepareFamily2Location(profile: BusinessProfile): Promise<void> {
  let parentChanged: boolean = false;
  for (const field of ['country', 'state', 'city'] as const) {
    const before = locationSelect(field);
    const select: HTMLSelectElement | undefined = parentChanged
      ? await waitForLocationOptions(profile, field, before ? optionSignature(before) : '', true)
      : before;
    if (!select) continue;
    const choice = chooseOption(select, profile, field);
    if (select.disabled || !choice) return;
    // A replaced parent may already have the correct value but still needs its change event.
    const childField = field === 'country' ? 'state' : field === 'state' ? 'city' : undefined;
    const child = childField && locationSelect(childField);
    const childNeedsOptions = child && !chooseOption(child, profile, childField!);
    const changed: boolean = parentChanged || select.value !== choice.value || Boolean(childNeedsOptions);
    if (changed && !setVisibleValue(select, choice.value)) return;
    parentChanged = changed;
  }
}

function selectFamily2IncludeProfile(): void {
  const candidates = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="radio"]')).filter(radio => {
    if (radio.matches(':disabled')) return false;
    const container = radio.closest('fieldset, tr, .form-group, .field')
      || (radio.parentElement?.tagName === 'LABEL' ? radio.parentElement.parentElement : radio.parentElement);
    if (container && Array.from(container.querySelectorAll<HTMLInputElement>('input[type="radio"]')).some(other => other.name !== radio.name || other.form !== radio.form)) return false;
    const labelledBy = (radio.getAttribute('aria-labelledby') || '').split(/\s+/).map(id => document.getElementById(id)?.textContent || '').join(' ');
    const question = normalize(`${(container as HTMLElement | null)?.innerText || container?.textContent || ''} ${labelledBy} ${radio.name} ${radio.getAttribute('aria-label') || ''}`);
    if (!/\binclude profile with listing\b/.test(question)) return false;
    const ownLabel = normalize(`${Array.from(radio.labels || []).map(label => label.textContent || '').join(' ')} ${radio.getAttribute('aria-label') || ''} ${radio.nextSibling?.nodeType === Node.TEXT_NODE ? radio.nextSibling.textContent || '' : ''}`);
    return /\byes\b/.test(ownLabel) && !/\bno\b/.test(ownLabel);
  });
  if (candidates.length !== 1 || candidates[0].checked) return;
  candidates[0].checked = true;
  candidates[0].dispatchEvent(new Event('input', { bubbles: true }));
  candidates[0].dispatchEvent(new Event('change', { bubbles: true }));
}

export async function runListingAutofillAsync(profile: BusinessProfile, learnedCategory?: ListingCategoryMapping): Promise<ListingAutofillReport> {
  if (manualAutofillFamily(location.href) === 2) {
    await prepareFamily2Location(profile);
    const report = runListingAutofill(profile, learnedCategory, false, true);
    selectFamily2IncludeProfile();
    const category = Array.from(document.querySelectorAll('select')).find((element, index) => isCategorySelect({ element, index, text: candidateText(element), descriptor: descriptor(element) }));
    if (category && !report.filled.some(entry => entry.field === 'category')) {
      const match = family2CategoryChoice(category, profile);
      report.manual.push(`Category: ${match.reason || 'Matched option could not be retained by the website; select it manually.'}`);
    }
    for (const field of ['country', 'state', 'city'] as const) {
      const select = locationSelect(field);
      if (!select) continue;
      const choice = chooseOption(select, profile, field);
      if (choice && select.value === choice.value) report.filled.push({ field, descriptor: descriptor(select), value: choice.label });
      else report.manual.push(`Select ${field} manually: no matching ready option for the active profile`);
    }
    return report;
  }
  if (isAutomationExcluded(location.href) || manualAutofillFamily(location.href)) return runListingAutofill(profile, learnedCategory);
  if (isUniqueListingHost(location.href) || isDirectory3Host(location.href) || isGroovyDirectoryHost(location.href) || isRedditDirectoryHost(location.href) || isExpansionDirectoryHost(location.href) || isBizzDirectoryHost(location.href) || getF03Directory(location.href) || isJetLinksHost(location.href) || isAdbriteDirectoryHost(location.href) || isBluebookDirectoryHost(location.href) || isAuroraDirectoryHost(location.href) || isFruityDirectoryHost(location.href) || isGreenyDirectoryHost(location.href) || isFamilydirHost(location.href) || isSearchDomainHereHost(location.href) || isFireDirectoryHost(location.href) || isLinkedinDirectoryHost(location.href) || isRelatedDirectoryHost(location.href) || isRelevantDirectoryHost(location.href) || isRelevantDirectoriesHost(location.href) || isEfdirHost(location.href) || isIfidirHost(location.href) || isSmartdirHost(location.href) || isToptendirHost(location.href) || isAdvancedSeoDirectoryHost(location.href)) return runListingAutofill(profile, learnedCategory);

  const workflow = observeBlogWorkflow(document, location.href);
  if (workflow.stage === "CONFIRMATION") {
    return { profileName: profile.businessName, filled: [], skipped: [], manual: [], workflow };
  }
  await prepareCascadingLocation(profile);
  const report = runListingAutofill(profile, learnedCategory);
  const termsResults = await applyApprovedTerms();
  const checkedTerms = termsResults.some((result) => result.status === "checked");
  const termsNeedReview = termsResults.some((result) => result.status === "human-review");
  if (checkedTerms && !termsNeedReview) {
    report.form = { ...report.form, terms: { checked: true } };
    report.manual = report.manual.filter((item) => item !== "Terms/Agreement");
    report.adaptive?.diagnostics.push("Terms/Agreement checked from approved fingerprint");
  } else if (termsNeedReview) {
    report.form = { ...report.form, terms: { checked: false } };
    if (!report.manual.includes("Terms/Agreement")) report.manual.push("Terms/Agreement");
    report.adaptive?.diagnostics.push("Terms/Agreement requires human review");
  }
  await recoverApeopleCategoryWithPlaywright(report);
  return report;
}

const APEOPLE_CATEGORY_SELECTOR = 'select[name="CATEGORY_ID"]';
const APEOPLE_CATEGORY_TARGET = "Commercial Contractors";

function logApeoplePhase2(stage: string, details: Record<string, unknown>): void {
  console.info(`[Backlink Autofill Phase 2] ${stage}`, details);
}

function categoryReadback(select: HTMLSelectElement): { value: string; selectedIndex: number; text: string } {
  return {
    value: select.value,
    selectedIndex: select.selectedIndex,
    text: select.options[select.selectedIndex]?.textContent?.trim() || "",
  };
}

let categoryTelemetrySelect: HTMLSelectElement | undefined;
let categoryTelemetryStop: (() => void) | undefined;

function categoryTelemetry(select: HTMLSelectElement): void {
  categoryTelemetryStop?.();
  categoryTelemetrySelect = select;
  const emit = (stage: string, details: Record<string, unknown>): void => recordPlaywrightDiagnostic(stage, details);
  emit("CATEGORY_DETECTED", { selector: APEOPLE_CATEGORY_SELECTOR, detected: true, currentValue: select.value, currentText: select.options[select.selectedIndex]?.textContent?.trim() || "" });
  const onInput = (): void => emit("CATEGORY_EVENT", { event: "input" });
  const onChange = (): void => emit("CATEGORY_EVENT", { event: "change" });
  const onBlur = (): void => emit("CATEGORY_EVENT", { event: "blur" });
  select.addEventListener("input", onInput);
  select.addEventListener("change", onChange);
  select.addEventListener("blur", onBlur);
  const observer = typeof MutationObserver === "function" ? new MutationObserver(() => {
    if (document.contains(select)) return;
    emit("CATEGORY_MUTATION", { mutation: "original select removed or replaced" });
    observer?.disconnect();
  }) : undefined;
  observer?.observe(document.documentElement, { childList: true, subtree: true });
  categoryTelemetryStop = () => {
    select.removeEventListener("input", onInput);
    select.removeEventListener("change", onChange);
    select.removeEventListener("blur", onBlur);
    observer?.disconnect();
    if (categoryTelemetrySelect === select) categoryTelemetrySelect = undefined;
    categoryTelemetryStop = undefined;
  };
  window.setTimeout(() => categoryTelemetryStop?.(), 1500);
}

function setCategoryWithTelemetry(select: HTMLSelectElement, value: string, expectedText?: string): boolean {
  recordPlaywrightDiagnostic("CATEGORY_WRITE_ATTEMPT", { selector: APEOPLE_CATEGORY_SELECTOR, targetText: expectedText || "", targetValue: value });
  const written = setVisibleValue(select, value, expectedText);
  recordPlaywrightDiagnostic("CATEGORY_WRITE_IMMEDIATE", { value: select.value, selectedIndex: select.selectedIndex, selectedText: select.options[select.selectedIndex]?.textContent?.trim() || "" });
  window.setTimeout(() => recordPlaywrightDiagnostic("CATEGORY_WRITE_100MS", { value: select.value, selectedIndex: select.selectedIndex, selectedText: select.options[select.selectedIndex]?.textContent?.trim() || "" }), 100);
  window.setTimeout(() => recordPlaywrightDiagnostic("CATEGORY_WRITE_500MS", { value: select.value, selectedIndex: select.selectedIndex, selectedText: select.options[select.selectedIndex]?.textContent?.trim() || "" }), 500);
  return written;
}

function isUnselectedCategory(select: HTMLSelectElement): boolean {
  const option = select.options[select.selectedIndex];
  const text = normalizeLocation(option?.textContent || "");
  return text === "top" || text === "select category" || text === "choose category" || select.value === "0" && text === "top";
}

function replaceCategoryDiagnostic(report: ListingAutofillReport, descriptorText: string, label: string): void {
  const diagnostics = report.adaptive?.diagnostics;
  if (!diagnostics) return;
  const index = diagnostics.findIndex((entry) => entry.startsWith("CATEGORY_ID →"));
  const replacement = `CATEGORY_ID → ${label} → filled/verified (${descriptorText})`;
  if (index >= 0) diagnostics[index] = replacement;
  else diagnostics.push(replacement);
}

export async function recoverApeopleCategoryWithPlaywright(report: ListingAutofillReport): Promise<void> {
  if (location.hostname.toLowerCase() !== "apeopledirectory.com") return;
  const category = document.querySelector<HTMLSelectElement>(APEOPLE_CATEGORY_SELECTOR);
  const startReadback = category ? categoryReadback(category) : { value: "", selectedIndex: -1, text: "" };
  logApeoplePhase2("PHASE2_START", { hostname: location.hostname, currentValue: startReadback.value, currentText: startReadback.text });
  const placeholder = category ? isUnselectedCategory(category) : false;
  logApeoplePhase2("PHASE2_PLACEHOLDER_CHECK", { isPlaceholder: placeholder });
  if (!category || !placeholder) return;
  const before = startReadback.text || startReadback.value || "(empty)";
  let verified = false;
  let stage = "PHASE2_INSPECT_REQUEST";
  try {
    logApeoplePhase2("PHASE2_INSPECT_REQUEST", { request: "starting" });
    const inspection = await inspectSelect(APEOPLE_CATEGORY_SELECTOR);
    const inspectedTarget = inspection.options?.find((option) => normalizeLocation(option.text) === normalizeLocation(APEOPLE_CATEGORY_TARGET));
    const localTarget = Array.from(category.options).find((option) => !option.disabled && normalizeLocation(option.textContent || "") === normalizeLocation(APEOPLE_CATEGORY_TARGET));
    logApeoplePhase2("PHASE2_INSPECT_RESULT", {
      found: inspection.found,
      currentValue: inspection.currentValue || "",
      currentText: inspection.currentText || "",
      optionCount: inspection.optionCount || 0,
      commercialContractorsExists: Boolean(inspectedTarget),
      matchedOptionText: inspectedTarget?.text || "",
      matchedOptionValue: inspectedTarget?.value || "",
    });
    if (!inspectedTarget || !localTarget) throw new Error("Commercial Contractors option was not found in both Playwright inspection and the live select.");
    stage = "PHASE2_WRITE_START";
    logApeoplePhase2("PHASE2_WRITE_START", { selector: APEOPLE_CATEGORY_SELECTOR, targetVisibleText: APEOPLE_CATEGORY_TARGET, targetValue: localTarget.value });
    const written = setVisibleValue(category, localTarget.value, localTarget.textContent?.trim() || APEOPLE_CATEGORY_TARGET);
    stage = "PHASE2_WRITE_IMMEDIATE";
    logApeoplePhase2("PHASE2_WRITE_IMMEDIATE", categoryReadback(category));
    await new Promise<void>((resolve) => setTimeout(resolve, 500));
    stage = "PHASE2_WRITE_DELAYED";
    logApeoplePhase2("PHASE2_WRITE_DELAYED", categoryReadback(category));
    if (!written || category.value === "0" || !normalizeLocation(category.selectedOptions[0]?.textContent || "").includes(normalizeLocation(APEOPLE_CATEGORY_TARGET))) throw new Error("Local category write was not retained.");
    stage = "PHASE2_VERIFY_REQUEST";
    logApeoplePhase2("PHASE2_VERIFY_REQUEST", { request: "starting" });
    const remote = await verifyField(APEOPLE_CATEGORY_SELECTOR, localTarget.value, APEOPLE_CATEGORY_TARGET);
    logApeoplePhase2("PHASE2_VERIFY_RESULT", { found: remote.found, verified: remote.verified, currentValue: remote.currentValue || "", currentText: remote.currentText || "" });
    verified = remote.verified && category.value !== "0" && normalizeLocation(category.selectedOptions[0]?.textContent || "") === normalizeLocation(APEOPLE_CATEGORY_TARGET);
    if (verified) {
      const descriptorText = descriptor(category);
      const existing = report.filled.find((entry) => entry.field === "category" && entry.descriptor === descriptorText);
      if (existing) existing.value = APEOPLE_CATEGORY_TARGET;
      else report.filled.push({ field: "category", descriptor: descriptorText, value: APEOPLE_CATEGORY_TARGET });
      report.skipped = report.skipped.filter((entry) => entry.descriptor !== descriptorText || !entry.reason.toLowerCase().includes("category"));
      replaceCategoryDiagnostic(report, descriptorText, APEOPLE_CATEGORY_TARGET);
    }
  } catch (error) {
    recordPlaywrightDiagnostic("CATEGORY_ERROR", {
      stage,
      errorName: error instanceof Error ? error.name : "UnknownError",
      errorMessage: error instanceof Error ? error.message : "Unknown Phase 2 recovery error.",
    });
    logApeoplePhase2("PHASE2_ERROR", {
      stage,
      errorName: error instanceof Error ? error.name : "UnknownError",
      errorMessage: error instanceof Error ? error.message : "Unknown Phase 2 recovery error.",
      stack: error instanceof Error ? error.stack || "" : "",
    });
  }
  report.adaptive?.diagnostics.push(`Category: before = ${before}; recovery = Playwright-assisted; target = ${APEOPLE_CATEGORY_TARGET}; verified = ${verified}`);
}

export function validateDirectory3Submission(profile: BusinessProfile): { ok: false; reason: string } | { ok: true; form: HTMLFormElement; submit: HTMLInputElement; description: string } {
  const inspection = inspectDirectory3(document, location.href);
  if (inspection.state !== "form") return { ok: false, reason: "Verified Directory3 submission form is required" };
  const { form, submit } = inspection;
  for (const spec of NATIVE_DIRECTORY_FIELDS) {
    const element = [...form.elements].find(el => el.getAttribute("name") === spec.name) as Editable;
    if (isNativeDirectoryHumanControl(element)) return { ok: false, reason: 'Human verification is manual' };
    const choice = element instanceof HTMLSelectElement ? chooseOption(element, { ...profile, businessName: "", description: "", shortDescription: "" }, "category") : null;
    const expected = element instanceof HTMLSelectElement ? choice?.value || "" : profileValue(profile, spec.field);
    if (!expected.trim() || element.value !== expected || !element.validity.valid) return { ok: false, reason: `Review required profile field: ${spec.name}` };
    if (!(element instanceof HTMLSelectElement) && element.maxLength >= 0 && expected.length > element.maxLength) return { ok: false, reason: `Native limit exceeded: ${spec.name}` };
    if (spec.field === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(expected)) return { ok: false, reason: "Submission Email is invalid" };
    if (spec.field === "website") {
      try { const url = new URL(expected); if (!/^https?:$/.test(url.protocol) || url.username || url.password || !url.hostname.includes(".")) return { ok: false, reason: "Website is invalid" }; }
      catch { return { ok: false, reason: "Website is invalid" }; }
    }
  }
  if ([...form.elements].some(control => 'validity' in control && !(control as Editable).validity.valid)) return { ok: false, reason: "Website required fields need human input" };
  for (const checkbox of form.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) {
    if (/terms|agree|accept/i.test(checkboxText(checkbox)) && !checkbox.checked) return { ok: false, reason: "Human acceptance of website Terms is required" };
  }
  return { ok: true, form, submit, description: profileValue(profile, "description") };
}

function nativeDirectoryCategoryChoice(select: HTMLSelectElement, profile: BusinessProfile): { choice?: { value: string; label: string }; reason: string } {
  // Outside plumbing, saved category wins over incidental services. Keep the services-only
  // fallback for older profiles, but never accept a remembered ID or selection.
  const savedCategory = profile.category.trim();
  const industry = plumbingCategoryMatcher(profile, true) || limousineCategoryMatcher(profile, 3) || junkRemovalCategoryMatcher(profile, 3);
  const category = savedCategory || profile.services.join(' ');
  const evidence = { ...profile, category: savedCategory.replace(/\b(?:services?|contractors?|business|company|professional)\b/gi, ' ').trim(), services: savedCategory ? [] : profile.services, businessName: '', description: '', shortDescription: '' };
  if (!industry && !evidence.category && !evidence.services.some(value => value.trim())) return { reason: 'Category: no business category evidence in the active profile; placeholder retained.' };
  const ranked = [...select.options].filter(option => option.value && !option.disabled
    && !(option.parentElement?.tagName === 'OPTGROUP' && (option.parentElement as HTMLOptGroupElement).disabled)
    && !/^(?:top|root|select\b|choose\b|none$)/i.test(normalize(option.textContent || '')))
    .map(option => ({ option, score: industry ? industry(option.textContent || '') : categoryScore(option.textContent || '', evidence) })).sort((a, b) => b.score - a.score);
  const best = ranked[0];
  if (!best || best.score < 6) return { reason: `Category: no suitable available option for "${category}"; placeholder retained.` };
  if (ranked[1]?.score === best.score) return { reason: `Category: available options are ambiguous for "${category}"; placeholder retained.` };
  return { choice: { value: best.option.value, label: best.option.textContent?.trim() || '' }, reason: '' };
}

function runNativeDirectoryAutofill(profile: BusinessProfile, adapter: SiteAdapter, inspect: typeof inspectUniqueListing, name: string, entryScope?: string): ListingAutofillReport {
  const report: ListingAutofillReport = { profileName: profile.businessName || "Untitled", filled: [], skipped: [], manual: [] };
  const inspection = inspect(document, location.href);
  if (inspection.state === "unsupported") {
    report.manual.push(inspection.reason, `${name} structure requires manual review; no autofill performed`);
    return report;
  }
  if (inspection.state === "entry") {
    // Aurora's recorded #navigation scope is mandatory. Other adapters retain
    // their existing whole-document entry discovery; no fallback on missing scope.
    const roots = entryScope ? document.querySelectorAll(entryScope) : [document];
    const links = roots.length === 1 ? nativeDirectoryEntryLinks(roots[0]) : [];
    const entry = adapter.discoverEntry("", links);
    if (entry?.target) {
      const label = links.find(link => link.href === entry.target && adapter.config.entryLabels.some(label => label.toLowerCase() === link.text.trim().toLowerCase()))!.text.trim();
      return { ...report, navigationUrl: entry.target, learnedEntryUrl: entry.target, entryClick: false, entryAction: { label, href: entry.target }, manual: ["Listing form navigation required"] };
    }
    report.manual.push(`No unambiguous verified ${adapter.config.entryLabels.join("/")} navigation`);
    return report;
  }
  const { form } = inspection;
  report.manual.push(...(inspection.manual || []));
  const verified: Array<{ element: Editable; value: string; field: ListingField }> = [];
  for (const spec of NATIVE_DIRECTORY_FIELDS) {
    const current = inspect(document, location.href);
    if (current.state !== "form" || current.form !== form) { report.manual.push("Listing form changed during autofill; review required"); break; }
    const element = [...form.elements].find(el => el.getAttribute("name") === spec.name) as Editable;
    if (isNativeDirectoryHumanControl(element)) {
      report.manual.push(`Human verification control ${spec.name} left untouched`); continue;
    }
    // Keep confirmed field mappings; category evidence is active-profile-only.
    const categoryMatch = element instanceof HTMLSelectElement ? nativeDirectoryCategoryChoice(element, profile) : undefined;
    const selected = categoryMatch?.choice;
    if (element instanceof HTMLSelectElement && !selected) {
      const placeholder = [...element.options].find(option => !option.disabled && /^(?:top$|root$|select\b|choose\b)/i.test(normalize(option.textContent || '')));
      if (placeholder && element.value !== placeholder.value) {
        element.value = placeholder.value;
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
      }
      const reason = categoryMatch!.reason + (placeholder ? '' : ' No enabled placeholder exists; select manually.');
      report.skipped.push({ descriptor: descriptor(element), reason });
      report.manual.push(reason, `Missing profile value or matching option: ${spec.name}`); continue;
    }
    const value = element instanceof HTMLSelectElement ? selected?.value || "" : profileValue(profile, spec.field);
    let reason = !value.trim() ? `Missing profile value or matching option: ${spec.name}` : "";
    if (spec.field === "website" && value) {
      try { const url = new URL(value); if (!/^https?:$/.test(url.protocol) || url.username || url.password || !url.hostname.includes(".")) reason = "Website must be an absolute public HTTP(S) URL"; }
      catch { reason = "Website must be an absolute public HTTP(S) URL"; }
    }
    if (spec.field === "email" && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) reason = "Submission Email is invalid";
    if (!(element instanceof HTMLSelectElement) && element.maxLength >= 0 && value.length > element.maxLength) reason = `${spec.name} exceeds the native maximum length`;
    if (reason) {
      report.skipped.push({ descriptor: descriptor(element), reason });
      report.manual.push(reason);
      continue;
    }
    if ((element.value === value || setVisibleValue(element, value, selected?.label, false)) && element.validity.valid) {
      report.filled.push({ field: spec.field, descriptor: descriptor(element), value: selected?.label || value });
      verified.push({ element, value, field: spec.field });
    }
    else { report.skipped.push({ descriptor: descriptor(element), reason: "Value did not remain valid after native events" }); report.manual.push(`Review ${spec.name}: value validation failed`); }
  }
  for (const item of verified) {
    if (!item.element.isConnected || item.element.form !== form || item.element.value !== item.value || !item.element.validity.valid) {
      report.filled = report.filled.filter(entry => entry.field !== item.field);
      report.manual.push(`Review ${item.field}: value changed after autofill`);
    }
  }
  const finalInspection = inspect(document, location.href);
  if (finalInspection.state !== "form" || finalInspection.form !== form) {
    report.filled = [];
    report.manual.push("Listing structure changed after autofill; manual review required");
  }
  // No form media report: the verified native form has no upload/image field.
  // This also prevents the existing coordinator from requesting dashboard assets.
  const finalAction = inspection.submit.value;
  report.manual.push("CAPTCHA", "Reciprocal Link URL/code requires manual review", "Terms/Agreement", `Final ${finalAction} (manual only)`, "Submission success indicators are unverified");
  if (adapter.config.id === "directory3") report.manual.push("Final Submit");
  report.adaptive = { stage: "FORM", diagnostics: [`${name} native form recognized`, "Confirmed fields only; native validation checked", "No verified image/upload target; Image URL and logo not inserted", `${finalAction} identified; never clicked`] };
  report.learnedEntryUrl = location.href;
  return report;
}

export function runListingAutofill(profile: BusinessProfile, learnedCategory?: ListingCategoryMapping, fillEmptyOnly = false, locationPrepared = false): ListingAutofillReport {
  if (manualAutofillFamily(location.href) === 2) profile = { ...profile, imageUrl: "" };
  if (isAutomationExcluded(location.href)) return { profileName: profile.businessName || "Untitled", filled: [], skipped: [{ descriptor: "page", reason: AUTOMATION_EXCLUDED_MESSAGE }], manual: [AUTOMATION_EXCLUDED_MESSAGE] };
  if (isEfdirHost(location.href)) {
    const before = inspectEfdir(document, location.href);
    const report = runNativeDirectoryAutofill(profile, efdirAdapter, inspectEfdir, "Efdir");
    applyAuthorizedEfdirTerms(document, location.href, before.state === "form" ? before.form : undefined, report);
    return report;
  }
  if (isRelevantDirectoriesHost(location.href)) return runNativeDirectoryAutofill(profile, relevantDirectoriesAdapter, inspectRelevantDirectories, "Relevant Directories");
  if (isRelevantDirectoryHost(location.href)) return runNativeDirectoryAutofill(profile, relevantDirectoryAdapter, inspectRelevantDirectory, "Relevant Directory");
  if (isAdvancedSeoDirectoryHost(location.href)) return runNativeDirectoryAutofill(profile, advancedSeoDirectoryAdapter, inspectAdvancedSeoDirectory, "Advanced SEO Directory");
  if (isToptendirHost(location.href)) return runNativeDirectoryAutofill(profile, toptendirAdapter, inspectToptendir, "Toptendir");
  if (isSmartdirHost(location.href)) return runNativeDirectoryAutofill(profile, smartdirAdapter, inspectSmartdir, "Smartdir");
  if (isIfidirHost(location.href)) return runNativeDirectoryAutofill(profile, ifidirAdapter, inspectIfidir, "Ifidir");
  if (isRelatedDirectoryHost(location.href)) return runNativeDirectoryAutofill(profile, relatedDirectoryAdapter, inspectRelatedDirectory, "Related Directory");
  if (isLinkedinDirectoryHost(location.href)) return runNativeDirectoryAutofill(profile, linkedinDirectoryAdapter, inspectLinkedinDirectory, "LinkedIn Directory");
  if (isFireDirectoryHost(location.href)) {
    const before = inspectFireDirectory(document, location.href);
    const report = runNativeDirectoryAutofill(profile, fireDirectoryAdapter, inspectFireDirectory, "Fire Directory");
    selectFireRegularLink(document, location.href, before.state === "form" ? before.form : undefined, report);
    return report;
  }
  if (isSearchDomainHereHost(location.href)) return runNativeDirectoryAutofill(profile, searchDomainHereAdapter, inspectSearchDomainHere, "Search Domain Here");
  if (isFamilydirHost(location.href)) {
    const before = inspectFamilydir(document, location.href);
    const report = runNativeDirectoryAutofill(profile, familydirAdapter, inspectFamilydir, "Familydir");
    selectFamilydirFreeReview(document, location.href, before.state === 'form' ? before.form : undefined, report);
    return report;
  }
  if (isGreenyDirectoryHost(location.href)) return runNativeDirectoryAutofill(profile, greenyDirectoryAdapter, inspectGreenyDirectory, "Greeny Directory");
  if (isFruityDirectoryHost(location.href)) return runNativeDirectoryAutofill(profile, fruityDirectoryAdapter, inspectFruityDirectory, "Fruity Directory");
  if (isAuroraDirectoryHost(location.href)) return runNativeDirectoryAutofill(profile, auroraDirectoryAdapter, inspectAuroraDirectory, "Aurora Directory", "#navigation");
  if (isBluebookDirectoryHost(location.href)) return runNativeDirectoryAutofill(profile, bluebookDirectoryAdapter, inspectBluebookDirectory, "Bluebook Directory");
  if (isAdbriteDirectoryHost(location.href)) {
    const before = inspectAdbriteDirectory(document, location.href);
    const report = runNativeDirectoryAutofill(profile, adbriteDirectoryAdapter, inspectAdbriteDirectory, "Adbrite Directory");
    applyAuthorizedAdbriteTerms(document, location.href, before.state === "form" ? before.form : undefined, report);
    return report;
  }
  const f03 = getF03Directory(location.href);
  if (f03) return runNativeDirectoryAutofill(profile, f03.adapter, f03.inspect, f03.site.name);
  if (isJetLinksHost(location.href)) return runNativeDirectoryAutofill(profile, jetLinksAdapter, inspectJetLinks, "Jet Links");
  if (isUniqueListingHost(location.href)) return runNativeDirectoryAutofill(profile, uniqueListingAdapter, inspectUniqueListing, "Unique Listing");
  if (isDirectory3Host(location.href)) return runNativeDirectoryAutofill(profile, directory3Adapter, inspectDirectory3, "Directory3");
  if (isGroovyDirectoryHost(location.href)) return runNativeDirectoryAutofill(profile, groovyDirectoryAdapter, inspectGroovyDirectory, "Groovy Directory");
  if (isRedditDirectoryHost(location.href)) return runNativeDirectoryAutofill(profile, redditDirectoryAdapter, inspectRedditDirectory, "Reddit Directory");
  if (isExpansionDirectoryHost(location.href)) return runNativeDirectoryAutofill(profile, expansionDirectoryAdapter, inspectExpansionDirectory, "Expansion Directory");
  if (isBizzDirectoryHost(location.href)) return runNativeDirectoryAutofill(profile, bizzDirectoryAdapter, inspectBizzDirectory, "Bizz Directory");

  if (manualAutofillFamily(location.href) && observeBlogWorkflow(document, location.href).stage === 'CONFIRMATION')
    return { profileName: profile.businessName, filled: [], skipped: [], manual: ['Open Visit manually'], workflow: observeBlogWorkflow(document, location.href) };
  const fields = Array.from(document.querySelectorAll("input, textarea, select")).filter(editable)
    .filter(element => !fillEmptyOnly || !('value' in element) || !String(element.value).trim())
    .map((element, index) => ({ element, text: candidateText(element), descriptor: descriptor(element), index }));
  const detectedCategory = fields.find(isCategorySelect)?.element;
  if (location.hostname.toLowerCase() === "apeopledirectory.com") {
    const directCategory = document.querySelector<HTMLSelectElement>(APEOPLE_CATEGORY_SELECTOR);
    if (detectedCategory instanceof HTMLSelectElement) categoryTelemetry(detectedCategory);
    else if (directCategory) recordPlaywrightDiagnostic("CATEGORY_DETECTED", { selector: APEOPLE_CATEGORY_SELECTOR, detected: false, currentValue: directCategory.value, currentText: directCategory.options[directCategory.selectedIndex]?.textContent?.trim() || "" });
  }
  const filled: ListingAutofillReport["filled"] = [];
  const skipped: SkippedFieldReport[] = [];
  const used = new Set<ListingField>();
  const pageOptions = locationCandidates();
  const pageText = document.body?.innerText || "";
  const registrationContext = isRegistrationContext(pageText);
  const splitAddress = hasSplitAddressTargets(fields);
  const splitControls = splitAddress ? splitAddressControls(fields) : { secondary: [] };
  const detectedHumanGates = adaptiveHumanGateReasons(pageText);
  const family = classifyXZeroFamily(location.href, pageText, Boolean(document.querySelector("form")));
  const adaptiveStage = family?.stage || classifyAdaptiveStage(pageText, Boolean(document.querySelector("form")), document.querySelectorAll<HTMLInputElement>('input[type="file"]').length > 0, {
    hasLocationOptions: pageOptions.length > 0,
    hasCategoryOptions: pageOptions.length > 0,
    hasMeaningfulFormControls: hasMeaningfulGenericFormControls(fields),
  });
  const fileInputs = document.querySelectorAll<HTMLInputElement>('input[type="file"]');
  const logoInputs = findLogoInputs(document);
  const brochureInputs = findBrochureInputs(document);
  const adaptive = { stage: adaptiveStage, diagnostics: [`Stage: ${adaptiveStage}`, ...(adaptiveStage === "FORM" ? ["Generic form autofill started"] : []), ...(detectedHumanGates.length ? [`Human input required: ${detectedHumanGates.join(", ")}`] : []), `Options collected: ${pageOptions.length}`, ...(adaptiveStage === "FORM" ? [`Logo target found: ${logoInputs.length > 0}`, `Brochure target found: ${brochureInputs.length > 0}`] : []), ...(family ? [`Family: XZero/Classifieds (${family.signature})`] : [])] };
  const structural = structuralEvidenceFromSignals({
    stage: adaptiveStage,
    familySignature: family?.signature,
    url: location.href,
    formSignature: structuralFormSignature(fields),
    editableCount: fields.length,
    selectCount: fields.filter((field) => field.element instanceof HTMLSelectElement).length,
    fileCount: fileInputs.length,
  });
  const workflow = observeBlogWorkflow(document, location.href);
  const withStructural = (report: ListingAutofillReport): ListingAutofillReport => ({ ...report, structural, workflow, ...(workflow.stage === "EDITOR" ? { expectedArticle: articleExpectation(profile.businessName, tinyMceHtmlValue(profile), document) } : {}) });
  const knownFreeWebAds = getSiteAdapter(globalThis.location.href)?.config.id === "freewebads";
  const categoryResult = manualAutofillFamily(location.href) ? undefined : knownFreeWebAds || adaptiveStage === "CATEGORY" || adaptiveStage === "SUBCATEGORY" ? categoryMatch(profile) : undefined;
   if (categoryResult?.status === "location-mismatch" || categoryResult?.status === "no-match") return withStructural({ profileName: profile.businessName || "Untitled", filled: [], skipped: [], manual: [categoryResult.message || "Category requires manual selection"], category: categoryResult, adaptive });
  if (categoryResult?.status === "selected") {
    const nativeCategory = fields.find(isCategorySelect)?.element;
    if (nativeCategory instanceof HTMLSelectElement) {
      const selected = chooseOption(nativeCategory, profile, "category", learnedCategory);
      if (location.hostname.toLowerCase() === "apeopledirectory.com") recordPlaywrightDiagnostic("CATEGORY_MATCH_RESULT", selected
        ? { chosenText: selected.label, chosenValue: selected.value, score: null, reason: "category page option selection" }
        : { chosenText: "", chosenValue: "", score: null, reason: "category page no option match" });
      if (selected && (location.hostname.toLowerCase() === "apeopledirectory.com" ? setCategoryWithTelemetry(nativeCategory, selected.value, selected.label) : setVisibleValue(nativeCategory, selected.value))) {
         return withStructural({ profileName: profile.businessName || "Untitled", filled: [{ field: "category", descriptor: descriptor(nativeCategory), value: selected.label }], skipped: [], manual: [], category: categoryResult, adaptive });
      }
    }
     return withStructural({ profileName: profile.businessName || "Untitled", filled: [], skipped: [], manual: [], category: categoryResult, adaptive });
  }
  const locationResult = manualAutofillFamily(location.href) ? undefined : knownFreeWebAds || adaptiveStage === "LOCATION" ? locationMatch(profile) : undefined;
   if (locationResult?.status === "selected") return withStructural({ profileName: profile.businessName || "Untitled", filled: [], skipped: [], manual: [], location: locationResult, adaptive });
   if (locationResult?.status === "no-match") return withStructural({ profileName: profile.businessName || "Untitled", filled: [], skipped: [], manual: [locationResult.message || "No matching location found"], location: locationResult, adaptive });
  const authForm = Boolean(document.querySelector("form")) && isAccountFormContext(document.querySelector("form")?.textContent || pageText);
  const isFormStage = adaptiveStage === "FORM";
  const likelyForm = authForm || isFormStage || fields.some((field) => /title|listing|business|category|business type|industry|website|description|your name|email|phone|address|city|state|country|zip|postal|writer|write/.test(field.text)) || Boolean(document.querySelector("form")) && (isFormStage || fileInputs.length > 0);
  if (!likelyForm) {
    if (adaptiveStage !== "ENTRY") {
       return withStructural({ profileName: profile.businessName || "Untitled", filled: [], skipped: [{ descriptor: "page", reason: "Current page requires workflow continuation" }], manual: ["Human input required"], adaptive });
    }
    if (manualAutofillFamily(location.href)) return withStructural({ profileName: profile.businessName, filled: [], skipped: [], manual: ["Navigate to the form manually"], adaptive });
    const entry = clickEntryControl();
     if (entry?.manual) return withStructural({ profileName: profile.businessName || "Untitled", filled: [], skipped: [], manual: entry.manual, adaptive: { ...adaptive, diagnostics: ["Adaptive discovery started", ...(entry.diagnostic ? [entry.diagnostic] : [])] } });
     if (entry) return withStructural({ profileName: profile.businessName || "Untitled", filled: [], skipped: [], navigationUrl: entry.navigationUrl || location.href, entryClick: false, entryAction: entry.entryAction, learnedEntryUrl: entry.navigationUrl || location.href, manual: ["Listing form navigation required"], adaptive: { ...adaptive, diagnostics: [entry.diagnostic || "Adaptive discovery started", "Entry action ready for background execution"] } });
     return withStructural({ profileName: profile.businessName || "Untitled", filled: [], skipped: [{ descriptor: "page", reason: "Unknown page structure" }], manual: ["Human input required"], adaptive });
  }
  const preparedForm = manualAutofillFamily(location.href) ? { form: {}, manual: [] } : knownFreeWebAds ? prepareFreeWebAdsForm(profile) : family ? prepareFamilyForm(profile) : { form: { brochure: { requested: findBrochureInputs(document).length > 0 } }, manual: [] };
  const richEditor = knownFreeWebAds || family ? null : syncRichEditor(profile);
  const postEditor = richEditor === null && !knownFreeWebAds && !family ? findPostEditor() : null;
  const splitAddressHandled = new Set<Editable>();
  if (splitControls.primary) {
    splitAddressHandled.add(splitControls.primary.element);
    const street = fieldValue(profile, "address", splitControls.primary.text, true, splitControls.primary.element);
    if (street && setVisibleValue(splitControls.primary.element, street)) {
      used.add("address");
      filled.push({ field: "address", descriptor: splitControls.primary.descriptor, value: street });
    } else {
      skipped.push({ descriptor: splitControls.primary.descriptor, reason: street ? "street value did not remain visible after setting" : "no data for address in active profile" });
    }
  }
  for (const secondary of splitControls.secondary) {
    splitAddressHandled.add(secondary.element);
    skipped.push({ descriptor: secondary.descriptor, reason: "secondary address line left blank" });
  }
  const preserveUpdatePasswords = /(^|\.)usafeatured\.com$/i.test(location.hostname) && location.pathname.toLowerCase() === '/directory/profileupdate.aspx';
  for (const field of fields) {
    if (preserveUpdatePasswords && isPasswordField(field)) {
      skipped.push({ descriptor: field.descriptor, reason: 'Profile Update password left unchanged' });
      continue;
    }
    if (locationPrepared && ['country', 'state', 'city'].some(slot => locationSelect(slot as LocationSelectField) === field.element)) continue;
    if (postEditor === field.element) continue;
    if (splitAddressHandled.has(field.element)) continue;
    if ((knownFreeWebAds || family) && /or specify|specify location|other location|location[_ -]?other/.test(formFieldText(field.element))) continue;
    if (family && /\blocation\b/.test(field.text) && !/or specify|specify location|other location|location[_ -]?other/.test(formFieldText(field.element))) continue;
    if (isSecondaryAddressField(field.text)) {
      skipped.push({ descriptor: field.descriptor, reason: "secondary address line left blank" });
      continue;
    }
    const fieldText = field.text;
    const localText = localFieldText(field.element);
    if (field.element instanceof HTMLSelectElement && isReferralSelect(field.element)) {
      const referral = chooseReferralSource(field.element);
      if (referral && setVisibleValue(field.element, referral.value)) continue;
      skipped.push({ descriptor: field.descriptor, reason: "unmapped: no supported referral source option" });
      continue;
    }
    if (!(field.element instanceof HTMLSelectElement)) {
      let platforms = platformsInText(localText);
      let unsupported = isUnsupportedSocialField(localText);
      if (!platforms.length && !unsupported) {
        const wrapper = field.element.closest("td, th, .field, .form-group, label")?.textContent || "";
        const contextual = normalize(`${localText} ${wrapper}`);
        platforms = platformsInText(contextual);
        unsupported = isUnsupportedSocialField(contextual);
      }
      if (platforms.length === 1) {
        const platform = platforms[0];
        const url = profileSocialUrl(profile, platform);
        if (!url) {
          skipped.push({ descriptor: field.descriptor, reason: `no ${platform} URL in active profile` });
        } else if (setVisibleValue(field.element, url)) {
          used.add(platform);
          filled.push({ field: platform, descriptor: field.descriptor, value: url });
        } else {
          skipped.push({ descriptor: field.descriptor, reason: `${platform} URL did not remain visible after setting` });
        }
        continue;
      }
      if (platforms.length > 1 || unsupported) {
        skipped.push({ descriptor: field.descriptor, reason: "social platform not stored in active profile" });
        continue;
      }
    }
    if (isPositionField(fieldText)) {
      skipped.push({ descriptor: field.descriptor, reason: "no dedicated position value in active profile" });
      continue;
    }
    const fieldContext = field.element.closest("form")?.textContent || pageText;
    const registrationBlogName = isRegistrationBlogName(`${field.descriptor} ${field.text}`, isRegistrationContext(fieldContext));
    const emailSemantic = field.element instanceof HTMLInputElement && field.element.type === "email" || /\be[- ]?mail\b/.test(fieldText);
    const passwordSemantic = isPasswordField(field) || /\bpassword\b|passcode/.test(fieldText);
    const family2Phone = manualAutofillFamily(location.href) === 2 && (field.element instanceof HTMLInputElement && field.element.type === 'tel' || /\b(?:phone|telephone|contact number)\b/.test(localText));
    const localExplicit = family2Phone ? 'phone' : explicitIdentityField(localText) || explicitGenericField(localText, registrationContext);
    const explicitGeneric = field.element instanceof HTMLSelectElement && isCategorySelect(field)
      ? "category"
      : localExplicit || explicitIdentityField(fieldText) || (registrationBlogName
      ? "username"
      : isAccountFormContext(fieldContext) && !emailSemantic && !passwordSemantic
        ? "username"
        : explicitGenericField(fieldText, registrationContext));
    if (isMapLookupField(field.text)) { skipped.push({ descriptor: field.descriptor, reason: "map lookup field left blank" }); continue; }
    if (!safeValue(field.text) && !isPasswordField(field) && !explicitGeneric) { skipped.push({ descriptor: field.descriptor, reason: "manual safety gate or unrelated field" }); continue; }
    const ranked = (isPasswordField(field) ? ["password"] : Object.keys(PHRASES).filter((slot) => !SOCIAL_PLATFORM_PATTERNS.some(([platform]) => platform === slot))) as ListingField[];
    const scored = ranked.map((slot) => ({
      slot,
      score: slot === "website"
        ? isReciprocal(field.text) ? 0 : Math.max(score(field.text, PHRASES.website), field.element instanceof HTMLInputElement && field.element.type === "url" ? 4 : 0)
        : slot === "description" && isLongDescriptionField(field.text) ? Math.max(score(field.text, PHRASES.description), 8)
        : score(field.text, PHRASES[slot]),
    })).sort((a, b) => b.score - a.score);
    let best = scored[0];
    let selectHasExplicitMapping = false;
    const explicitGenericScore = explicitGeneric ? scored.find((entry) => entry.slot === explicitGeneric) : undefined;
    if (explicitGenericScore) { best = family2Phone || explicitGeneric === "username" || explicitGeneric === "postalCode" ? { ...explicitGenericScore, score: Math.max(explicitGenericScore.score, 8) } : explicitGenericScore; selectHasExplicitMapping = true; }
    if (field.element instanceof HTMLSelectElement) {
      const explicit = /country/.test(field.text) ? "country" : /state|province|region/.test(field.text) ? "state" : /city|town/.test(field.text) ? "city" : isPostalCodeField(field.text) ? "postalCode" : /facebook/.test(field.text) ? "facebook" : /linkedin/.test(field.text) ? "linkedin" : /twitter|x profile/.test(field.text) ? "twitter" : /instagram/.test(field.text) ? "instagram" : undefined;
      const explicitScore = explicit ? scored.find((entry) => entry.slot === explicit) : undefined;
      if (explicitScore) { best = explicitScore; selectHasExplicitMapping = true; }
    }
    if (best?.slot === "phone" && /mobile|cell/.test(field.text) && !(profile as BusinessProfile & { mobilePhone?: string }).mobilePhone) {
      skipped.push({ descriptor: field.descriptor, reason: "no distinct mobile phone in active profile" });
      continue;
    }
    if (!best || best.score <= 0 || (!selectHasExplicitMapping && scored[1] && best.score === scored[1].score) || used.has(best.slot) && !["password", "businessName", "description"].includes(best.slot)) { skipped.push({ descriptor: field.descriptor, reason: best?.score === 0 ? "unmapped: no profile field evidence" : "unmapped: tied semantic matches" }); continue; }
    const selected = field.element instanceof HTMLSelectElement ? chooseOption(field.element, profile, best.slot, learnedCategory) : null;
    if (field.element instanceof HTMLSelectElement && best.slot === "category" && location.hostname.toLowerCase() === "apeopledirectory.com") {
      recordPlaywrightDiagnostic("CATEGORY_MATCH_RESULT", selected
        ? { chosenText: selected.label, chosenValue: selected.value, score: null, reason: "option-driven category selection" }
        : { chosenText: "", chosenValue: "", score: null, reason: "no category option match" });
    }
    const value = selected?.value || (field.element instanceof HTMLSelectElement ? "" : fieldValue(profile, best.slot, field.text, splitAddress, field.element));
    if (!value) { skipped.push({ descriptor: field.descriptor, reason: best.slot === "category" ? "Category requires manual selection" : `no data for ${best.slot} in active profile` }); continue; }
    if (field.element instanceof HTMLSelectElement && best.slot === "category" && location.hostname.toLowerCase() === "apeopledirectory.com"
      ? setCategoryWithTelemetry(field.element, value, selected?.label)
      : setVisibleValue(field.element, value, selected?.label)) { used.add(best.slot); filled.push({ field: best.slot, descriptor: field.descriptor, value: best.slot === "password" ? "[masked]" : selected?.label || value }); } else skipped.push({ descriptor: field.descriptor, reason: best.slot === "username" ? "Username value did not remain visible after setting" : "value did not remain visible after setting" });
  }
  if (richEditor) {
    used.add("description");
    filled.push({ field: "description", descriptor: richEditor.descriptor, value: richEditor.value });
  } else if (postEditor) {
    const isTextarea = postEditor instanceof HTMLTextAreaElement;
    const value = isTextarea ? postEditorValue(profile) : tinyMceHtmlValue(profile);
    const verified = isTextarea ? setVisibleValue(postEditor, value) : setContentEditableHtml(postEditor, value);
    if (verified && value) {
      used.add("description");
      filled.push({ field: "description", descriptor: `${postEditor.tagName.toLowerCase()} post editor`, value });
    } else if (value) {
      skipped.push({ descriptor: `${postEditor.tagName.toLowerCase()} post editor`, reason: "post editor value did not remain visible after setting" });
    }
  }
  for (const element of Array.from(document.querySelectorAll<HTMLElement>('[contenteditable="true"]'))) {
    if (element === postEditor || used.has("description")) continue;
    const text = formFieldText(element);
    if (!isShortDescriptionField(text) && !isLongDescriptionField(text)) continue;
    const value = isShortDescriptionField(text) ? (profile.shortDescription || profile.description).slice(0, 160) : profile.description;
    const html = value ? postDescriptionHtml(value) : "";
    if (html && setContentEditableHtml(element, html)) {
      used.add("description");
      filled.push({ field: "description", descriptor: `${element.tagName.toLowerCase()} contenteditable`, value: html });
    }
  }
  if (!used.has("category")) {
    const categoryField = fields.find(isCategorySelect);
    if (categoryField) {
      const selected = chooseOption(categoryField.element as HTMLSelectElement, profile, "category", learnedCategory);
       if (selected && (location.hostname.toLowerCase() === "apeopledirectory.com" ? setCategoryWithTelemetry(categoryField.element as HTMLSelectElement, selected.value, selected.label) : setVisibleValue(categoryField.element, selected.value, selected.label))) {
        used.add("category");
        filled.push({ field: "category", descriptor: categoryField.descriptor, value: selected.label });
      } else if (!skipped.some((entry) => entry.descriptor === categoryField.descriptor && entry.reason.includes("Category"))) {
        skipped.push({ descriptor: categoryField.descriptor, reason: "Category requires manual selection" });
      }
    }
  }
  const authLoginAction = authForm && Array.from(document.querySelectorAll("button, input[type=submit]")).some((element) => /\b(?:sign\s*in|log\s*in|login)\b/i.test(element.textContent || element.getAttribute("value") || ""));
  const finalGate = Array.from(document.querySelectorAll("button, input[type=submit]")).some((element) => FINAL.test(element.textContent || element.getAttribute("value") || "") || authLoginAction && /\b(?:sign\s*in|log\s*in|login)\b/i.test(element.textContent || element.getAttribute("value") || ""));
  const requiredManual = knownFreeWebAds ? [] : fields
    .filter(({ element }) => element.required && !(element instanceof HTMLInputElement && ["checkbox", "radio", "file"].includes(element.type)) && !(element instanceof HTMLSelectElement && element.value))
    .filter(({ descriptor }) => !filled.some((entry) => entry.descriptor === descriptor))
    .map(({ descriptor }) => `Required field requires manual input: ${descriptor}`);
  const captchaDetected = Boolean(document.querySelector('iframe[src*="captcha"], [id*="captcha" i], [class*="captcha" i]'));
  const humanGateManual = [...detectedHumanGates, ...(captchaDetected && !detectedHumanGates.includes("CAPTCHA") ? ["CAPTCHA"] : [])];
  const finalManual = finalGate ? [knownFreeWebAds ? "Post Now" : authLoginAction ? "SIGN IN / LOGIN" : "Final Submit"] : [];
  const manual = [...preparedForm.manual, ...requiredManual, ...humanGateManual, ...finalManual];
  if (filled.length) adaptive.diagnostics.push("Safe autofill completed");
  const remainingHumanActions = [...humanGateManual, ...finalManual];
  if (remainingHumanActions.length && !adaptive.diagnostics.some((entry) => entry.startsWith("Human input required:"))) adaptive.diagnostics.push(`Human input required: ${remainingHumanActions.join(", ")}`);
  const customerFormBlocked = customerFormValidationDiagnostics();
  if (customerFormBlocked.length) manual.push(`CustomerForm blocked by: ${customerFormBlocked.join(", ")}`);
  adaptive.diagnostics.push(...finalMappingDiagnostics(filled, skipped));
  return withStructural({ profileName: profile.businessName || "Untitled", filled, skipped, learnedEntryUrl: location.href, manual,
    form: { ...preparedForm.form, logo: { ...preparedForm.form.logo, attached: preparedForm.form.logo?.attached || false, requested: logoInputs.length > 0 } }, adaptive });
}

// Lives only in the existing page's content script. Durable authorization and
// intent stay in ListingRun; mutations and a property-change fallback only wake it.
export function watchAuthorizedPublication(runId: string): void {
  if (manualAutofillFamily(location.href)) return;
  const scope = globalThis as typeof globalThis & { __ba2StopPublicationGateWatch?: () => void };
  scope.__ba2StopPublicationGateWatch?.();
  let busy = false, stopped = false;
  const deadline = Date.now() + 15 * 60_000;
  const stop = () => { stopped = true; observer.disconnect(); clearInterval(timer); };
  const tick = async () => {
    if (busy || stopped) return;
    busy = true;
    try {
      const run = await readListingRun();
      if (!run?.continuous || run.id !== runId || run.submissionAttempted || run.publicVerification
        || run.publicationEditorUrl !== location.href || Date.now() > deadline) { stop(); return; }
      if (!(await handleBlogPublication(runId)).ok) return;
      stop();
      await chrome.runtime.sendMessage({ type: 'BA2_PUBLICATION_READY', runId });
    } catch { stop(); } finally { busy = false; }
  };
  const observer = new MutationObserver(() => { void tick(); });
  const timer = setInterval(() => { void tick(); }, 1000);
  observer.observe(document.documentElement, { subtree: true, attributes: true, childList: true });
  window.addEventListener('pagehide', stop, { once: true });
  scope.__ba2StopPublicationGateWatch = stop;
  void tick();
}

export function watchAuthorizedLogin(runId: string, registration = false): void {
  if (manualAutofillFamily(location.href)) return;
  const scope = globalThis as typeof globalThis & { __ba2StopLoginWatch?: () => void };
  scope.__ba2StopLoginWatch?.();
  let busy = false;
  let stopped = false;
  const observer = new MutationObserver(() => { void tick(); });
  const stop = () => { stopped = true; observer.disconnect(); clearInterval(timer); };
  const tick = async () => {
    if (busy || stopped) return;
    busy = true;
    try {
      const run = await readListingRun();
      const watching = registration ? run?.autoRegister && run.registration && ['waiting-human', 'intent', 'uncertain', 'verification'].includes(run.registration.state)
        : run?.autoLogin && run.login && ["waiting-captcha", "intent"].includes(run.login.state);
      if (!run || run.id !== runId || !watching || run.submissionAttempted || run.publicVerification) { stop(); return; }
      await chrome.runtime.sendMessage({ type: registration ? "BA2_REGISTRATION_CHANGED" : "BA2_LOGIN_CHANGED", runId });
    } catch { stop(); } finally { busy = false; }
  };
  const timer = setInterval(() => { void tick(); }, 1000);
  observer.observe(document.documentElement, { subtree: true, attributes: true, childList: true });
  scope.__ba2StopLoginWatch = stop;
  window.addEventListener("pagehide", stop, { once: true });
}
