import { getF03Directory } from "../src/automation/f03-directory";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Window } from "happy-dom";
import type { BusinessProfile } from "@backlink-autofill/shared";
import { runAutofill } from "../src/content/autofill";
import { handleBlogPublication, validateBlogPublication, handleAutomaticRegistration, watchAuthorizedPublication, recoverApeopleCategoryWithPlaywright, runListingAutofill, runListingAutofillAsync } from "../src/content/listing-autofill";
import { captureCurrentSource, isLikelyChallengeContent } from "../src/content/source-capture";
import { withTimeout } from "../src/capture-lifecycle";
import { isAllowedCaptureUrl, isDashboardUrl, matchesSourceOrigin } from "../src/source-target";
import { createListingRun, loginGuardKey, publicationGuardKey, isListingRunActive, publicationProfileFingerprint, updateListingRun, writeListingRun } from "../src/listing-run";
import { getSiteCategoryMapping, normalizeCategoryKey, recordSiteFlowSuccess } from "../src/site-flow";
import { ACTIONS, CONFIDENCE_POLICY, isControlledAction } from "../src/automation/action-system";
import { freeWebAdsAdapter } from "../src/automation/adapters";
import { decideCategory, decideLocation, normalizeChoice } from "../src/automation/matching";
import { chooseAdaptiveEntry, classifyAdaptiveStage } from "../src/automation/adaptive-discovery";
import { classifyXZeroFamily } from "../src/automation/xzero-family";
import { assetBufferFromMessage, attachBrochureFile, attachBrochureToLiveInput, attachLogoFile, attachLogoToLiveInput, detectUploadLimit, findBrochureInputs, findLogoInputs } from "../src/content/logo-upload";
import { articleExpectation, publicArticleUrl, verifyPublicArticleHtml, detectSubmissionResult, extractLiveUrl } from "../src/automation/verification";
import { clampFloatingButtonPosition, FLOATING_BUTTON_ID, FLOATING_BUTTON_POSITION_KEY, installFloatingAutofillButton } from "../src/content/floating-button";
import { applyApprovedTerms, findTermsAgreementCandidates, fingerprintTermsAgreement, type TermsApprovalRecord } from "../src/automation/terms-approval";
import { findAmpBlogsLoginSubmit, observeAmpBlogsPage } from "../src/ampblogs";
import { chooseStructuralRecipe, structuralEvidenceFromSignals } from "../src/automation/structural-signature";
import { observeBlogWorkflow, validateRegistration } from "../src/automation/blog-workflow";
import { GROUP_1_DOMAINS } from "../src/automation/adapters";

const TEST_DIR = path.resolve(process.cwd(), "../test");

const assetWireBytes = JSON.parse(JSON.stringify([0, 128, 255]));
assert.deepEqual(Array.from(new Uint8Array(assetBufferFromMessage(assetWireBytes)!)), [0, 128, 255]);
assert.equal(assetBufferFromMessage(JSON.parse(JSON.stringify(new ArrayBuffer(3)))), null, "old non-JSON-safe buffer must fail closed");
for (const invalid of [[-1], [256], [1.5], ['1'], {}, null]) assert.equal(assetBufferFromMessage(invalid), null);
const legacyAssetBuffer = new ArrayBuffer(3);
assert.equal(assetBufferFromMessage(legacyAssetBuffer), legacyAssetBuffer, "direct in-memory callers remain supported");

const profile: BusinessProfile = {
  id: "smoke-profile",
  businessName: "Mahid Test Business",
  firstName: "Mahid",
  lastName: "Business",
  contactName: "Amina Mahid",
  username: "mahid-user",
  email: "hello@mahid.test",
  password: "",
  phone: "+1 555 0100",
  website: "https://mahid.test",
  imageUrl: "https://images.mahid.test/business.jpg",
  address: "1 Test Street",
  completeAddress: "1 Test Street, Testville, TS 12345, Testland",
  city: "Testville",
  state: "TS",
  postalCode: "12345",
  country: "Testland",
  description: "A test business.",
  shortDescription: "Test.",
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
  businessHours: ["Mon-Fri: 9-5"],
  logoUrl: "",
  brochureUrl: "",
  internalLinks: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

assert.equal(isDashboardUrl("http://localhost:3000/"), true, "dashboard origin must be recognized");
assert.equal(isAllowedCaptureUrl("http://localhost:3000/", "website"), false, "dashboard cannot be captured as website");
assert.equal(matchesSourceOrigin("https://www.example.com/services", "https://example.com/"), true, "www/apex source origins should match");
assert.equal(matchesSourceOrigin("http://localhost:3000/", "https://example.com/"), false, "dashboard must not match a source");
assert.equal(isLikelyChallengeContent("SiteGround Challenge", "sgcaptcha"), true, "challenge content must be actionable");
assert.equal(ACTIONS.includes("SUBMIT"), true, "controlled vocabulary should include distinct submit action");
assert.equal(isControlledAction({ action: "TYPE", target: "email", value: "x@y.test", confidence: 0.9, reason: "label match" }), true);
assert.equal(isControlledAction({ action: "RUN_SCRIPT", confidence: 1, reason: "unsafe" }), false, "arbitrary actions must be rejected");
assert.equal(CONFIDENCE_POLICY.auto, 0.85, "confidence policy must be centralized");
assert.equal(freeWebAdsAdapter.matches("https://www.freewebads.biz/"), true, "FreeWebAds adapter should match apex and www domains");
assert.equal(chooseAdaptiveEntry([{ text: "Submit Listing", href: "/submit", confidence: 0 }]).action, "AUTO", "unknown-site entry should auto-select a strong candidate");
assert.equal(chooseAdaptiveEntry([{ text: "Listings", href: "/listings", confidence: 0 }]).action, "ASK_HUMAN", "unknown-site medium entry should require a human");
assert.equal(classifyAdaptiveStage("Choose a subcategory", false, false), "SUBCATEGORY", "adaptive classifier should detect subcategory pages");
assert.equal(classifyAdaptiveStage("Business title Description Website", true, false), "FORM", "adaptive classifier should detect forms");
assert.equal(classifyAdaptiveStage("Description CAPTCHA Submit", true, false, { hasMeaningfulFormControls: true }), "FORM", "meaningful forms must outrank HUMAN_GATE signals");
assert.equal(classifyAdaptiveStage("Post Free Ad Please select a city", false, false), "LOCATION", "workflow location must outrank persistent entry navigation");
assert.equal(classifyAdaptiveStage("Post Free Ad Please select a category to post to", false, false), "CATEGORY", "workflow category must outrank persistent entry navigation");
assert.equal(classifyXZeroFamily("https://clone.example/index.php?view=selectcity", "Please select a city", false)?.stage, "LOCATION", "XZero family should use selectcity query state");
assert.equal(classifyXZeroFamily("https://clone.example/index.php?cityid=1", "", false)?.stage, "CATEGORY", "XZero family should use cityid query state");
assert.equal(classifyXZeroFamily("https://clone.example/index.php?catid=2", "", false)?.stage, "SUBCATEGORY", "XZero family should use catid query state");
const xzeroStructuralEvidence = structuralEvidenceFromSignals({
  stage: "FORM",
  familySignature: "XZero form state",
  url: "https://new-clone.example/index.php?subcatid=2",
  formSignature: "category|description|select|title|website",
  editableCount: 5,
  selectCount: 1,
  fileCount: 0,
});
const structuralMatch = chooseStructuralRecipe([
  { domain: "directory3.org", formSignature: "category|description|select|title|website", pageSignatures: ["stage:FORM", "family:XZero form state", "query:subcatid", "controls:editable-5", "controls:select-1"], entryUrl: "https://directory3.org/submit.php" },
  { domain: "visual-clone.example", formSignature: "category|description|select|title|website", pageSignatures: ["stage:FORM", "controls:editable-5", "controls:select-1"] },
], "new-clone.example", xzeroStructuralEvidence);
assert.equal(structuralMatch?.recipe.domain, "directory3.org", "multiple independent structural signals should select the matching recipe across domains");
assert.ok(structuralMatch?.matchedSignals.includes("formSignature"), "structural match should report corroborating form evidence");
const ambiguousStructuralMatch = chooseStructuralRecipe([
  { domain: "clone-a.example", formSignature: "category|description|select|title|website", pageSignatures: ["stage:FORM", "family:XZero form state", "controls:editable-5", "controls:select-1"] },
  { domain: "clone-b.example", formSignature: "category|description|select|title|website", pageSignatures: ["stage:FORM", "family:XZero form state", "controls:editable-5", "controls:select-1"] },
], "new-clone.example", xzeroStructuralEvidence);
assert.equal(ambiguousStructuralMatch, null, "competing equal structural recipes must stop rather than auto-match");
const visualOnlyMatch = chooseStructuralRecipe([
  { domain: "visual-only.example", formSignature: "category|description|select|title|website", pageSignatures: ["stage:FORM", "controls:editable-5", "controls:select-1"] },
], "new-clone.example", xzeroStructuralEvidence);
assert.equal(visualOnlyMatch, null, "visual/form overlap without independent workflow evidence must not match");
assert.equal(normalizeChoice("U.S.A."), "united states", "country aliases should normalize consistently");
assert.equal(decideLocation(["United States", "Canada"], "USA").action.value, "United States", "country alias should select the real option");
assert.equal(decideLocation(["California", "Texas"], "Fairfield").action.action, "ASK_HUMAN", "unsupported city must not fall back randomly");
const categoryDecision = decideCategory(["Junk Removal", "Automotive"], { ...profile, category: "Junk removal services", services: ["Hauling", "Cleanouts"] });
assert.equal(categoryDecision.action.action, "SELECT", "category decision should use actual available options");
assert.equal(detectSubmissionResult({ url: "https://freewebads.biz/thanks", text: "Ad posted successfully" }, { successIndicators: ["ad posted"], failureIndicators: ["error"] }), "success");
assert.equal(detectSubmissionResult({ url: "https://freewebads.biz/thanks", text: "Submit clicked" }, { successIndicators: ["ad posted"], failureIndicators: ["error"] }), "in-progress", "submit click alone is not success");
assert.equal(extractLiveUrl({ url: "https://freewebads.biz/thanks", links: [{ text: "View Listing", href: "https://freewebads.biz/ad/123" }] }, { liveUrlHints: ["view listing"] }), "https://freewebads.biz/ad/123");

const win = new Window();
const g = globalThis as Record<string, unknown>;
g.window = win;
g.document = win.document;
g.location = win.location;
g.HTMLInputElement = win.HTMLInputElement;
g.HTMLTextAreaElement = win.HTMLTextAreaElement;
g.HTMLSelectElement = win.HTMLSelectElement;
g.Element = win.Element;
g.Event = win.Event;
g.InputEvent = win.InputEvent;
g.File = win.File;

class TestDataTransfer {
  files: File[] = [];
  items = { add: (file: File) => this.files.push(file) };
}
g.DataTransfer = TestDataTransfer;

let savedFloatingPosition: { left: number; top: number } | undefined;
let savedFloatingRun: ReturnType<typeof createListingRun> | undefined;
let floatingMessages = 0;
let floatingStartResponse: { ok: boolean; error?: string; message?: string } = { ok: true };
g.chrome = {
  storage: { local: {
    get: async (key: string) => ({ [key]: key === "ba2.listingRun" ? savedFloatingRun : savedFloatingPosition }),
    set: async (value: Record<string, { left: number; top: number }>) => { savedFloatingPosition = value[FLOATING_BUTTON_POSITION_KEY]; },
  } },
  runtime: { sendMessage: async () => { floatingMessages += 1; return floatingStartResponse; } },
} as unknown as typeof chrome;

function loadPage(file: string): void {
  const html = readFileSync(path.join(TEST_DIR, file), "utf-8");
  win.document.open();
  win.document.write(html);
  win.document.close();
}

function value(name: string): string {
  const el = win.document.querySelector(`[name="${name}"]`);
  assert.ok(el, `element [name="${name}"] should exist`);
  return (el as unknown as HTMLInputElement).value;
}

win.happyDOM.setURL("https://blogocial.com/posts");
win.document.open();
win.document.write(`<nav><a href="/logout">Log out</a><a href="/new">New post</a></nav><h1>Posts</h1>`);
win.document.close();
const blogDashboard = observeBlogWorkflow(win.document as unknown as Document, win.location.href);
assert.equal(blogDashboard.stage, "AUTHENTICATED_DASHBOARD", "Blogocial-shaped dashboard should be recognized structurally");
assert.equal(blogDashboard.action?.href, "https://blogocial.com/new", "dashboard New post action should resolve same-origin");

win.happyDOM.setURL("https://blogocial.com/new");
win.document.open();
win.document.write(`<form><label>Title<input name="title"></label><textarea id="content" name="content"></textarea><iframe class="cke_wysiwyg_frame"></iframe><button type="submit">Publish</button></form><h1>New Post</h1><button type="button">Source</button>`);
win.document.close();
const blogEditor = observeBlogWorkflow(win.document as unknown as Document, win.location.href);
assert.equal(blogEditor.stage, "EDITOR", "Blogocial-shaped CKEditor editor should be recognized structurally");

win.happyDOM.setURL("https://hotmesscleanupjunkremoval.blogocial.com/article-1");
win.document.open();
win.document.write(`<h1>The Article was successfully published</h1><a href="https://hotmesscleanupjunkremoval.blogocial.com/article-1">Visit</a>`);
win.document.close();
const blogConfirmation = observeBlogWorkflow(win.document as unknown as Document, win.location.href);
assert.equal(blogConfirmation.stage, "CONFIRMATION", "publication confirmation and Visit link should be recognized");
assert.equal(blogConfirmation.publicUrl, "https://hotmesscleanupjunkremoval.blogocial.com/article-1", "Visit link should be preserved as the public URL");

const verifiedBlogocialUrl = "https://hotmesscleanupjunkremoval.blogocial.com/hot-mess-cleanup-junk-removal-79619470";
win.happyDOM.setURL("https://blogocial.com/new");
function confirmationFixture(message: string, links: string): ReturnType<typeof observeBlogWorkflow> {
  win.document.open();
  win.document.write(`<h1>${message}</h1>${links}`);
  win.document.close();
  return observeBlogWorkflow(win.document as unknown as Document, win.location.href);
}
assert.equal(confirmationFixture("The Article was successfully published", `<a href="${verifiedBlogocialUrl}">Visit</a>`).publicUrl, verifiedBlogocialUrl, "publisher dashboard must accept its generated public subdomain");
for (const href of ["https://unrelated.test/article-1", "https://blogocial.com.evil.test/article-1", "https://evilblogocial.com/article-1", "https://a.b.blogocial.com/article-1", "https://blogocial.com/login", "https://blogocial.com/posts", "https://smoke.blogocial.com/", `${verifiedBlogocialUrl}?token=secret`, "https://user:password@smoke.blogocial.com/article-1"]) {
  assert.equal(publicArticleUrl(href, "https://blogocial.com/new"), undefined, href);
  assert.equal(confirmationFixture("The Article was successfully published", `<a href="${href}">Visit</a>`).publicUrl, undefined, "rejected targets must not be exposed as verified candidates");
}
assert.equal(publicArticleUrl("https://child.example.co.uk/article-1", "https://example.co.uk/new"), undefined, "unknown publishers get no inferred subdomain permission");
assert.equal(publicArticleUrl("/article-1", "https://other.test/new"), "https://other.test/article-1", "generic same-origin articles remain supported");
assert.equal(publicArticleUrl("/posts/article-1", "https://other.test/new"), "https://other.test/posts/article-1", "article paths under posts remain supported");
for (const message of ["Success", "Login successful", "Article was not published", "Article publication failed", "Article pending review"]) {
  assert.notEqual(confirmationFixture(message, `<a href="${verifiedBlogocialUrl}">Visit</a>`).stage, "CONFIRMATION", message);
}
assert.equal(confirmationFixture("Article published", `<a href="${verifiedBlogocialUrl}">Visit</a><a href="https://other.blogocial.com/article-2">View post</a>`).publicUrl, undefined, "competing public URLs require human review");
const bloguetechnoVisit = 'https://hotmesscleanupjunkremoval.bloguetechno.com/hot-mess-cleanup-junk-removal-80348003';
assert.equal(publicationGuardKey(bloguetechnoVisit, 'same-profile'), publicationGuardKey('https://bloguetechno.com/new', 'same-profile'), 'Visit subdomain shares original publication guard');
assert.notEqual(publicationGuardKey('https://bloguetechno.com.evil.test/article-12345', 'same-profile'), publicationGuardKey(bloguetechnoVisit, 'same-profile'));
win.happyDOM.setURL('https://bloguetechno.com/new');
assert.equal(confirmationFixture('', `<a id="successfully_posted" href="${bloguetechnoVisit}">Visit</a><a href="/edit/80348003">Edit</a>`).publicUrl, bloguetechnoVisit);
const retainedEditor = '<input name="title"><textarea id="content"></textarea>';
const zenVisit = 'https://novanestdemo26.thezenweb.com/hot-mess-cleanup-junk-removal-82418102';
assert.equal(publicArticleUrl(zenVisit, 'https://thezenweb.com/new'), zenVisit, 'operator-confirmed TheZENweb public hosting must be accepted');
assert.equal(publicationGuardKey(zenVisit, 'same-profile'), publicationGuardKey('https://thezenweb.com/new', 'same-profile'), 'public article keeps original publication guard');
win.happyDOM.setURL('https://thezenweb.com/new');
assert.equal(confirmationFixture('', `<form>${retainedEditor}<a id="successfully_posted" href="${zenVisit}">Visit</a><a href="/edit/82418102">Edit</a></form>`).publicUrl, zenVisit, 'exact marker wins over retained editor without extra click');
for (const href of ['https://thezenweb.com.evil.test/article-82418102', 'https://a.b.thezenweb.com/article-82418102', 'https://unrelated.test/article-82418102', zenVisit + '?token=secret', 'http://novanestdemo26.thezenweb.com/article-82418102', 'https://novanestdemo26.thezenweb.com/edit/82418102']) {
  assert.equal(publicArticleUrl(href, 'https://thezenweb.com/new'), undefined);
}
assert.notEqual(confirmationFixture('', `<form>${retainedEditor}<a id="successfully_posted" href="${zenVisit}">Edit</a></form>`).stage, 'CONFIRMATION');
assert.notEqual(confirmationFixture('', `<form>${retainedEditor}<a hidden id="successfully_posted" href="${zenVisit}">Visit</a></form>`).stage, 'CONFIRMATION');
win.happyDOM.setURL('https://bloguetechno.com/new');
const currentVisit = 'https://fixture.bloguetechno.com/current-publication-80348278';
assert.equal(confirmationFixture('', `${retainedEditor}<a id="successfully_posted" href="${currentVisit}">Visit</a>`).publicUrl, currentVisit, 'current success href wins despite retained editor; no historical URL comparison');
const inFormSuccess = `<form method="post">${retainedEditor}<a id="successfully_posted" href="${currentVisit}">Visit</a></form>`;
assert.equal(confirmationFixture('', inFormSuccess).stage, 'CONFIRMATION', 'actual Bloguetechno marker may remain inside the publisher form');
assert.equal(confirmationFixture('', inFormSuccess).publicUrl, currentVisit);
assert.equal(confirmationFixture('Article was successfully published', `<form>${retainedEditor}<a href="${currentVisit}">Visit</a></form>`).stage, 'EDITOR', 'generic form prose/link does not gain configured-marker trust');
for (const marker of [
  '<a id="successfully_posted" href="" hidden></a>',
  `<a id="successfully_posted" href="${currentVisit}" style="display:none">Visit</a>`,
  `<a id="successfully_posted" href="${currentVisit}">Edit</a>`,
  `<a id="successfully_posted" href="https://unrelated.test/article-12345">Visit</a>`,
  `<article><a id="successfully_posted" href="${currentVisit}">Visit</a></article>`,
  `<div contenteditable="true"><a id="successfully_posted" href="${currentVisit}">Visit</a></div>`
]) {
  assert.equal(confirmationFixture('', retainedEditor + marker).stage, 'EDITOR', 'invalid/stale/hidden markers must not override the editor');
  assert.equal(confirmationFixture('', `<form>${retainedEditor}${marker}</form>`).stage, 'EDITOR', 'form exception never trusts invalid or article/editor-embedded markers');
}
assert.equal(confirmationFixture('Article was successfully published', retainedEditor + `<a href="${currentVisit}">Visit</a>`).stage, 'EDITOR', 'generic notice alone still cannot override an editor');
assert.notEqual(confirmationFixture('', `${retainedEditor}<input type="password"><a id="successfully_posted" href="${currentVisit}">Visit</a>`).stage, 'CONFIRMATION', 'visible credential form remains blocked');
assert.equal(confirmationFixture('The Article was successfully published', `<a href="${bloguetechnoVisit}">Visit</a>`).publicUrl, bloguetechnoVisit, 'existing text confirmation still works');
for (const href of ['https://bloguetechno.com.evil.test/article-12345', 'https://a.b.bloguetechno.com/article-12345',
  verifiedBlogocialUrl, `${bloguetechnoVisit}?token=hidden`, 'https://smoke.bloguetechno.com/edit/12345',
  'https://user:password@smoke.bloguetechno.com/article-12345', 'http://smoke.bloguetechno.com/article-12345']) {
  assert.equal(publicArticleUrl(href, win.location.href), undefined, href);
  assert.notEqual(confirmationFixture('', `<a id="successfully_posted" href="${href}">Visit</a>`).stage, 'CONFIRMATION');
}
assert.notEqual(confirmationFixture('', `<a id="successfully_posted" href="${bloguetechnoVisit}">Edit</a>`).stage, 'CONFIRMATION');
assert.notEqual(confirmationFixture('', `<article><a id="successfully_posted" href="${bloguetechnoVisit}">Visit</a></article>`).stage, 'CONFIRMATION');
assert.notEqual(confirmationFixture('', `<a id="successfully_posted" href="${bloguetechnoVisit}">Visit</a><a id="successfully_posted" href="https://other.bloguetechno.com/article-12345">Visit</a>`).stage, 'CONFIRMATION');
win.happyDOM.setURL('https://other.test/new');
assert.notEqual(confirmationFixture('', `<a id="successfully_posted" href="/article-12345">Visit</a>`).stage, 'CONFIRMATION', 'success ID evidence is site-specific');
win.happyDOM.setURL('https://blogocial.com/new');
const articleBody = "We provide careful local junk removal with reliable scheduling and respectful service for homes and businesses throughout our community.";
const expectation = articleExpectation("Hot Mess Cleanup Junk Removal", `<p>${articleBody}</p>`, win.document as unknown as Document);
assert.equal(verifyPublicArticleHtml(`<article><h1>Hot Mess Cleanup Junk Removal</h1><p>${articleBody}</p></article>`, expectation, win.document as unknown as Document).status, "verified");
for (const html of [
  `<article><h1>Wrong Article</h1><p>${articleBody}</p></article>`,
  `<article><h1>Hot Mess Cleanup Junk Removal</h1><p>Wrong body</p></article>`,
  `<nav>Hot Mess Cleanup Junk Removal ${articleBody}</nav><article><h1>Unrelated</h1></article>`,
  `<article><h1>Hot Mess Cleanup Junk Removal</h1><script>${articleBody}</script></article>`,
  `<article hidden><h1>Hot Mess Cleanup Junk Removal</h1><p>${articleBody}</p></article>`,
  `<article style="display: none"><h1>Hot Mess Cleanup Junk Removal</h1><p>${articleBody}</p></article>`,
  '<form action="/login"><input type="password"></form>',
  '<meta http-equiv="refresh" content="0;url=/login">',
]) assert.equal(verifyPublicArticleHtml(html, expectation, win.document as unknown as Document).status, "failed", "HTTP 200 or hidden/chrome evidence is insufficient");
assert.equal(verifyPublicArticleHtml("<article></article>", { title: "test", bodyExcerpt: "short" }, win.document as unknown as Document).status, "unverified");

// Onesmablog's success notice can be a plain container, not a heading/alert.
win.happyDOM.setURL('https://onesmablog.com/new');
win.document.open();
win.document.write('<div>The Article was successfully published. <a href="/approved-article-12345">Visit</a> / <a href="/edit/12345">Edit</a></div>');
win.document.close();
assert.equal(observeBlogWorkflow(win.document as unknown as Document, win.location.href).publicUrl, 'https://onesmablog.com/approved-article-12345');
win.document.querySelector('a')!.textContent = 'Edit';
assert.equal(observeBlogWorkflow(win.document as unknown as Document, win.location.href).publicUrl, undefined, 'Edit can never stand in for Visit');
const completeHtml = `<p>${articleBody} This final approved paragraph must also be visible.</p><a href="https://example.test/services">Services</a><img src="https://example.test/logo.png">`;
const fullExpectation = articleExpectation('Approved title', completeHtml, win.document as unknown as Document);
const articleHtml = `<article><h1>Approved title</h1>${completeHtml}</article>`;
const articleUrl = 'https://onesmablog.com/approved-article-12345';
assert.equal(verifyPublicArticleHtml(`<link rel="canonical" href="/canonical-article-12345">${articleHtml}`, fullExpectation, win.document as unknown as Document, articleUrl).canonicalUrl, 'https://onesmablog.com/canonical-article-12345');
for (const html of [
  articleHtml.replace('This final approved paragraph must also be visible.', ''),
  articleHtml.replace('https://example.test/services', 'https://evil.test/'),
  articleHtml.replace('https://example.test/logo.png', 'https://example.test/other.png'),
  `<link rel="canonical" href="/edit/12345">${articleHtml}`,
  `<link rel="canonical" href="https://evil.test/article-12345">${articleHtml}`,
  `<link rel="canonical" href="/canonical-article-12345"><link rel="canonical" href="/other-article-12345">${articleHtml}`,
]) assert.equal(verifyPublicArticleHtml(html, fullExpectation, win.document as unknown as Document, articleUrl).status, 'failed');

// --- current-tab AmpBlogs recognition and safe login mapping ------------------
win.happyDOM.setURL("https://ampblogs.com/");
win.document.open();
win.document.write(`<a href="/signup">Sign Up</a><a id="create-website-button" href="/signup">Start now</a><a href="/login">Sign In</a><a href="#" class="google-oauth">Sign In with Google</a>`);
win.document.close();
const ampBlogsHome = observeAmpBlogsPage(win.document as unknown as Document, win.location.href);
assert.equal(ampBlogsHome.pageState, "HOMEPAGE", "AmpBlogs homepage should be recognized in the current tab");
assert.equal(ampBlogsHome.loginHref, "https://ampblogs.com/login", "AmpBlogs login navigation must stay same-origin");
assert.equal(ampBlogsHome.signupHref, "https://ampblogs.com/signup", "AmpBlogs Sign Up/Start now controls must be recognized without being selected for an existing account");
assert.equal(ampBlogsHome.startNowHref, "https://ampblogs.com/signup", "AmpBlogs Start now control should resolve to the existing signup href");

win.happyDOM.setURL("https://ampblogs.com/login");
win.document.open();
win.document.write(`<form><h1>Sign In</h1><label>Username<input name="username"></label><label>Password<input name="password" type="password"></label><div id="captcha">CAPTCHA</div><label><input name="terms" type="checkbox"> Terms and Conditions</label><button type="submit">SIGN IN</button></form>`);
win.document.close();
const ampBlogsLogin = observeAmpBlogsPage(win.document as unknown as Document, win.location.href);
assert.equal(ampBlogsLogin.pageState, "LOGIN_FORM", "AmpBlogs login form should be recognized in the current tab");
assert.equal(ampBlogsLogin.captcha, true, "AmpBlogs CAPTCHA must be reported as a manual gate");
assert.equal(ampBlogsLogin.captchaState, "present", "AmpBlogs CAPTCHA should start in the present state");
assert.equal(ampBlogsLogin.terms, true, "AmpBlogs Terms must be reported as a manual gate");
assert.ok(findAmpBlogsLoginSubmit(win.document as unknown as Document), "AmpBlogs should expose one unambiguous login submit control");
const ampBlogsProfile = { ...profile, username: "ampblogs-user", password: "local-profile-password" };
const ampBlogsLoginReport = runListingAutofill(ampBlogsProfile);
assert.equal(value("username"), ampBlogsProfile.username, "AmpBlogs login should fill the saved Username");
assert.equal(value("password"), ampBlogsProfile.password, "AmpBlogs login should fill the saved Password");
assert.ok(ampBlogsLoginReport.manual.some((entry) => /sign in/i.test(entry)), "AmpBlogs Sign In must remain manual");
assert.equal((win.document.querySelector('[name="terms"]') as unknown as HTMLInputElement).checked, false, "AmpBlogs Terms must remain unchanged");
const validPuzzle = win.document.createElement("div");
validPuzzle.id = "validPuzzle";
validPuzzle.style.display = "block";
win.document.querySelector("form")?.append(validPuzzle);
assert.equal(observeAmpBlogsPage(win.document as unknown as Document, win.location.href).captchaState, "verified", "AmpBlogs validPuzzle state should prove CAPTCHA verification");
validPuzzle.remove();
win.document.querySelector("#captcha")?.remove();
const ampBlogsAfterCaptcha = observeAmpBlogsPage(win.document as unknown as Document, win.location.href);
assert.equal(ampBlogsAfterCaptcha.captchaState, "absent", "AmpBlogs CAPTCHA state should change when the challenge DOM disappears");
const duplicateLoginButton = win.document.createElement("button");
duplicateLoginButton.type = "submit";
duplicateLoginButton.textContent = "LOGIN";
win.document.querySelector("form")?.append(duplicateLoginButton);
assert.equal(findAmpBlogsLoginSubmit(win.document as unknown as Document), null, "ambiguous login submits must block automatic submission");

win.happyDOM.setURL("https://ampblogs.com/dashboard");
win.document.open();
win.document.write(`<h1>Dashboard</h1><nav>Log Out · New Article · Account Settings</nav>`);
win.document.close();
assert.equal(observeAmpBlogsPage(win.document as unknown as Document, win.location.href).pageState, "AUTHENTICATED_DASHBOARD", "AmpBlogs dashboard should be recognized after manual login");

win.happyDOM.setURL("https://ampblogs.com/login");
win.document.open();
win.document.write(`<h1>Login Error</h1><p>Invalid username or password. Please try again.</p>`);
win.document.close();
assert.equal(observeAmpBlogsPage(win.document as unknown as Document, win.location.href).pageState, "AUTH_ERROR", "AmpBlogs login errors should stop for human review");

// --- Terms approval guard -----------------------------------------------------
win.happyDOM.setURL("https://terms-approval.example/submit.php");
win.document.open();
win.document.write(`<form>
  <label><input id="terms" name="terms" type="checkbox"> I agree to the Terms and Conditions</label>
  <label><input id="marketing-terms" name="marketing_terms" type="checkbox"> I agree to Terms and marketing updates</label>
  <label><input id="payment" name="payment" type="checkbox"> Authorize payment for featured placement</label>
</form>`);
win.document.close();
const termsCheckbox = win.document.querySelector("#terms") as unknown as HTMLInputElement;
const marketingTermsCheckbox = win.document.querySelector("#marketing-terms") as unknown as HTMLInputElement;
const paymentCheckbox = win.document.querySelector("#payment") as unknown as HTMLInputElement;
const termsLabel = termsCheckbox.closest("label")!;
const termsCandidates = findTermsAgreementCandidates(win.document as unknown as Document);
const termsCandidate = termsCandidates.find((candidate) => candidate.checkbox === termsCheckbox);
assert.ok(termsCandidate?.clearlyIdentified, "a standalone Terms and Conditions checkbox should be clearly identified");
assert.equal(termsCandidates.find((candidate) => candidate.checkbox === marketingTermsCheckbox)?.clearlyIdentified, false, "Terms combined with marketing must remain ambiguous");
assert.equal(termsCandidates.some((candidate) => candidate.checkbox === paymentCheckbox), false, "payment authorization must not be treated as Terms consent");
assert.equal((await applyApprovedTerms(win.document as unknown as Document, [])).every((result) => result.status === "human-review"), true, "missing Terms approval must require human review");
assert.equal(termsCheckbox.checked, false, "missing Terms approval must not check the checkbox");

assert.ok(termsCandidate, "approved Terms candidate should be available for fingerprinting");
const termsFingerprint = await fingerprintTermsAgreement(termsCandidate!);
const termsApproval: TermsApprovalRecord = {
  siteKey: termsCandidate!.siteKey,
  agreementKey: termsCandidate!.agreementKey,
  contentFingerprint: termsFingerprint,
  approvedBy: "authorized-test-operator",
  approvedAt: "2026-10-14T00:00:00.000Z",
  approvedByAuthorizedOperator: true,
};
let termsChangeEvents = 0;
termsCheckbox.addEventListener("change", () => { termsChangeEvents += 1; });
const approvedTerms = await applyApprovedTerms(win.document as unknown as Document, [termsApproval]);
assert.equal(approvedTerms.find((result) => result.candidate.checkbox === termsCheckbox)?.status, "checked", "matching authorized Terms approval should permit checking");
assert.equal(termsCheckbox.checked, true, "approved Terms checkbox should be checked");
assert.equal(termsChangeEvents, 1, "approved Terms checking should dispatch change");

termsCheckbox.checked = false;
termsLabel.lastChild!.textContent = " I agree to the changed Terms and Conditions";
const changedTerms = await applyApprovedTerms(win.document as unknown as Document, [termsApproval]);
assert.equal(changedTerms.find((result) => result.candidate.checkbox === termsCheckbox)?.status, "human-review", "changed agreement content must invalidate the approval");
assert.equal(termsCheckbox.checked, false, "changed agreement content must remain unchecked");

termsLabel.lastChild!.textContent = " I agree to the Terms and Conditions";
const restoredCandidate = findTermsAgreementCandidates(win.document as unknown as Document).find((candidate) => candidate.checkbox === termsCheckbox)!;
const restoredFingerprint = await fingerprintTermsAgreement(restoredCandidate);
const unauthorizedApproval = { ...termsApproval, contentFingerprint: restoredFingerprint, approvedByAuthorizedOperator: false };
const unauthorizedTerms = await applyApprovedTerms(win.document as unknown as Document, [unauthorizedApproval]);
assert.equal(unauthorizedTerms.find((result) => result.candidate.checkbox === termsCheckbox)?.status, "human-review", "unverified operator approval must not permit checking");
assert.equal(termsCheckbox.checked, false, "unverified operator approval must leave Terms unchecked");

let resetAfterChange = false;
const resetTermsOnChange = (): void => { resetAfterChange = true; termsCheckbox.checked = false; };
termsCheckbox.addEventListener("change", resetTermsOnChange);
const nonRetainedTerms = await applyApprovedTerms(win.document as unknown as Document, [{ ...termsApproval, contentFingerprint: restoredFingerprint, approvedByAuthorizedOperator: true }]);
assert.equal(resetAfterChange, true, "approved Terms action should dispatch the page change event");
assert.equal(nonRetainedTerms.find((result) => result.candidate.checkbox === termsCheckbox)?.status, "human-review", "Terms action must be verified after the change event");
assert.equal(termsCheckbox.checked, false, "Terms checkbox reset by the page must remain unchecked");
termsCheckbox.removeEventListener("change", resetTermsOnChange);

// --- reusable Active Profile logo Blob -> File -> input.files -----------------
win.document.open();
win.document.write(`<div>Your Logo<br>Maximum filesize: 200KB<input id="FileToUpload" name="FileToUpload" type="file" accept="image/*"></div>`);
win.document.close();
const logoInput = findLogoInputs(win.document as unknown as Document)[0];
assert.ok(logoInput, "adaptive logo upload should detect an image input");
assert.equal(logoInput.id, "FileToUpload", "confirmed FileToUpload control should be preferred");
assert.equal(detectUploadLimit(logoInput), 200000, "adaptive logo upload should read visible 200KB limit");
let assignedFiles: File[] = [];
Object.defineProperty(logoInput, "files", { configurable: true, get: () => assignedFiles, set: (files: File[]) => { assignedFiles = files; } });
const logoResult = await attachLogoFile(logoInput, new TextEncoder().encode("png-bytes").buffer, "logo.png", "image/png");
assert.equal(logoResult.ok, true, `logo Blob -> File -> input.files should pass: ${JSON.stringify(logoResult)}`);
assert.equal(assignedFiles.length, 1, "logo upload should assign exactly one file");
assert.equal(assignedFiles[0].name, "logo.png", "assigned logo filename should be preserved");
assert.equal(assignedFiles[0].type, "image/png", "assigned logo MIME should be preserved");

const originalCreateElement = win.document.createElement.bind(win.document);
const originalCreateImageBitmap = g.createImageBitmap;
win.document.createElement = ((tagName: string) => tagName === "canvas" ? {
  width: 0,
  height: 0,
  getContext: () => ({ clearRect: () => undefined, drawImage: () => undefined }),
  toBlob: (callback: (blob: Blob) => void, type: string) => callback(new Blob([new Uint8Array(120000)], { type })),
} : originalCreateElement(tagName)) as typeof win.document.createElement;
g.createImageBitmap = async () => ({ width: 1000, height: 800, close: () => undefined });
assignedFiles = [];
const optimizedLogo = await attachLogoFile(logoInput, new Uint8Array(250000).buffer, "large-logo.png", "image/png");
assert.equal(optimizedLogo.ok, true, `oversized logo should be optimized in memory: ${JSON.stringify(optimizedLogo)}`);
assert.ok((optimizedLogo.fileSize || 0) <= 200000, "optimized logo should stay under the detected limit");
assert.equal(optimizedLogo.fileType, "image/jpeg", "optimized logo should use a broadly supported image type");
assert.equal(assignedFiles.length, 1, "optimized logo should assign one derived file");
win.document.createElement = originalCreateElement;
g.createImageBitmap = originalCreateImageBitmap;
assert.equal((await attachLogoFile(logoInput, new ArrayBuffer(0), "logo.png", "image/png")).error, "Blob unavailable", "missing logo Blob should remain untouched");
assert.match((await attachLogoFile(logoInput, new TextEncoder().encode("bytes").buffer, "logo.pdf", "application/pdf")).error || "", /Unsupported MIME/, "unsupported logo MIME should be rejected");

win.document.open();
win.document.write(`<form><label>Resume<input name="resume" type="file" accept="application/pdf"></label><div>Upload Pictures<input name="picture-one" type="file" accept="image/*"><input name="picture-two" type="file" accept="image/*"></div></form>`);
win.document.close();
const pictureInputs = findLogoInputs(win.document as unknown as Document);
assert.equal(pictureInputs.length, 2, "generic logo detection should exclude resume/document inputs");
assert.equal(pictureInputs[0].getAttribute("name"), "picture-one", "generic logo detection should choose the first appropriate image slot");
let liveFiles: File[] = [];
let resetOnce = true;
Object.defineProperty(pictureInputs[0], "files", { configurable: true, get: () => liveFiles, set: (files: File[]) => { liveFiles = files; } });
pictureInputs[0].addEventListener("input", () => { if (resetOnce) { resetOnce = false; liveFiles = []; } });
const persistenceResult = await attachLogoToLiveInput(win.document as unknown as Document, new TextEncoder().encode("live-logo").buffer, "live-logo.png", "image/png", 0);
assert.equal(persistenceResult.ok, true, `logo should be reattached after a site reset: ${JSON.stringify(persistenceResult)}`);
assert.ok(persistenceResult.steps.some((step) => step.includes("re-finding live input")), "logo diagnostics should expose input reset and re-find");
assert.ok(persistenceResult.steps.some((step) => step.includes("File still present after 0ms")), "logo diagnostics should verify delayed persistence");

win.document.open();
win.document.write(`<div>Brochure Document<input id="brochure-file" name="brochure_file" type="file" accept="application/pdf"><div>Your Photo<input name="photo" type="file" accept="image/*"></div><div>Your Logo<input name="logo" type="file" accept="image/*"></div></div>`);
win.document.close();
const brochureInputs = findBrochureInputs(win.document as unknown as Document);
assert.equal(brochureInputs[0]?.getAttribute("name"), "brochure_file", "PDF attachment detection should exclude image/photo inputs");
let brochureFiles: File[] = [];
Object.defineProperty(brochureInputs[0], "files", { configurable: true, get: () => brochureFiles, set: (files: File[]) => { brochureFiles = files; } });
const brochureResult = await attachBrochureFile(brochureInputs[0], new TextEncoder().encode("pdf-bytes").buffer, "brochure.pdf", "application/pdf");
assert.equal(brochureResult.ok, true, "PDF attachment should use the Active Profile Brochure");
assert.equal(brochureFiles.length, 1, "PDF attachment input should contain one file");
assert.equal(brochureFiles[0].type, "application/pdf", "PDF attachment should not use the Business Logo MIME");

// --- contextual file mapping with identical id/name ---------------------------
win.document.open();
win.document.write(`<div>Your Photo<input id="FileToUpload" name="FileToUpload" type="file" accept="image/*"></div><div>Your Logo<input id="FileToUpload" name="FileToUpload" type="file" accept="image/*"></div><div>Attachment<span>Choose PDF file to attach to your listing.</span><input id="FileToUpload" name="FileToUpload" type="file"></div>`);
win.document.close();
const allFileInputs = Array.from(win.document.querySelectorAll('input[type="file"]')) as unknown as HTMLInputElement[];
assert.equal(allFileInputs.length, 3, "three file inputs should exist");
const contextualLogoInputs = findLogoInputs(win.document as unknown as Document);
assert.equal(contextualLogoInputs.length, 1, "only Your Logo should be a logo candidate");
assert.equal(contextualLogoInputs[0]?.parentElement?.textContent?.includes("Your Logo"), true, "logo candidate should be the Your Logo input");
const contextualBrochureInputs = findBrochureInputs(win.document as unknown as Document);
assert.equal(contextualBrochureInputs.length, 1, "only Attachment should be a brochure candidate");
assert.equal(contextualBrochureInputs[0]?.parentElement?.textContent?.includes("Attachment"), true, "brochure candidate should be the Attachment input");
const photoInput = allFileInputs.find((input) => input.parentElement?.textContent?.includes("Your Photo"));
assert.ok(photoInput, "Your Photo input should exist");
assert.equal(contextualLogoInputs.includes(photoInput!), false, "Your Photo must not be a logo candidate");
assert.equal(contextualBrochureInputs.includes(photoInput!), false, "Your Photo must not be a brochure candidate");

let contextualLogoFiles: File[] = [];
const logoTarget = contextualLogoInputs[0] as HTMLInputElement;
Object.defineProperty(logoTarget, "files", { configurable: true, get: () => contextualLogoFiles, set: (files: File[]) => { contextualLogoFiles = files; } });
const contextualLogoResult = await attachLogoFile(logoTarget, new TextEncoder().encode("logo-bytes").buffer, "business-logo.png", "image/png");
assert.equal(contextualLogoResult.ok, true, "Your Logo should receive Business Logo");
assert.equal(contextualLogoFiles.length, 1, "Your Logo should retain one file");
assert.equal(contextualLogoFiles[0].name, "business-logo.png", "Your Logo should retain the logo filename");

let contextualBrochureFiles: File[] = [];
const brochureTarget = contextualBrochureInputs[0] as HTMLInputElement;
Object.defineProperty(brochureTarget, "files", { configurable: true, get: () => contextualBrochureFiles, set: (files: File[]) => { contextualBrochureFiles = files; } });
const contextualBrochureResult = await attachBrochureFile(brochureTarget, new TextEncoder().encode("pdf-bytes").buffer, "business-brochure.pdf", "application/pdf");
assert.equal(contextualBrochureResult.ok, true, "Attachment should receive Brochure");
assert.equal(contextualBrochureFiles.length, 1, "Attachment should retain one file");
assert.equal(contextualBrochureFiles[0].name, "business-brochure.pdf", "Attachment should retain the brochure filename");
assert.equal((photoInput as HTMLInputElement).files?.length || 0, 0, "Your Photo must remain empty");

// --- FORM stage detection with file inputs but no <form> element --------------
win.happyDOM.setURL("https://unknown-form.example/");
win.document.open();
win.document.write(`<div><label>Title<input name="title" type="text"></label><label>Description<textarea name="description"></textarea></label><label>Your Logo<input name="logo" type="file" accept="image/*"></label><label>Attachment<input name="attachment" type="file"></label><button type="submit">Submit</button></div>`);
win.document.close();
const formNoFormReport = runListingAutofill(profile);
assert.equal(formNoFormReport.adaptive?.stage, "FORM", "page with meaningful controls and file inputs must classify as FORM");
assert.ok(formNoFormReport.adaptive?.diagnostics.some((d) => d.includes("Logo target found")), "FORM diagnostics should report Logo target");
assert.ok(formNoFormReport.adaptive?.diagnostics.some((d) => d.includes("Brochure target found")), "FORM diagnostics should report Brochure target");

// --- unknown-site adaptive discovery ------------------------------------------
win.happyDOM.setURL("https://adaptive-listing.example/");
win.document.open();
win.document.write(`<a href="/submit">Submit Listing</a>`);
win.document.close();
const adaptiveEntryReport = runListingAutofill(profile);
assert.equal(adaptiveEntryReport.entryClick, false, "href entry should be deferred to background navigation");
assert.ok(adaptiveEntryReport.entryAction?.label.includes("submit"), "entry action should persist the candidate for background execution");
assert.equal(adaptiveEntryReport.adaptive?.stage, "ENTRY", "unknown-site entry should be classified");

win.happyDOM.setURL("https://unknown-profile-form.example/account");
win.document.open();
win.document.write(`<div class="profile-editor">
  <label>Organization / Company<input name="organization"></label>
  <label>Email<input name="email" type="email"></label>
  <label>Phone<input name="phone"></label>
  <label>Website<input name="website"></label>
  <label>Your Profile / Bio<textarea name="profile"></textarea></label>
  <label>Facebook<input name="facebook"></label>
  <label>Your Logo<input name="FileToUpload" type="file" accept="image/*"></label>
</div>`);
win.document.close();
const unknownFormReport = runListingAutofill(profile);
assert.equal(unknownFormReport.adaptive?.stage, "FORM", "unknown domain with meaningful editable controls should classify as FORM");
assert.ok(unknownFormReport.adaptive?.diagnostics.includes("Generic form autofill started"), "generic FORM diagnostics should show autofill started");
assert.equal(unknownFormReport.manual.includes("Human input required"), false, "recognizable generic form must not fall back to Human input");

win.happyDOM.setURL("https://adaptive-listing.example/location");
win.document.open();
win.document.write(`<h1>Select a City</h1><a href="/chicago">Chicago</a><a href="/denver">Denver</a>`);
win.document.close();
const adaptiveLocationReport = runListingAutofill({ ...profile, city: "Chicago" });
assert.equal(adaptiveLocationReport.location?.status, "selected", "unknown-site location should use an actual matching option");

// Persistent global entry navigation must not restart discovery on later workflow pages.
win.happyDOM.setURL("https://persistent-nav.example/");
const persistentNav = `<nav><a href="/post">Post Free Ad</a><a href="/submit">Submit Listing</a><a href="/add">Add Listing</a></nav>`;
win.document.open();
win.document.write(`${persistentNav}<h1>Please select a city</h1><a href="/chicago">Chicago, Illinois</a><a href="/denver">Denver, Colorado</a>`);
win.document.close();
const persistentLocationReport = runListingAutofill({ ...profile, city: "Chicago", state: "Illinois", country: "United States" });
assert.equal(persistentLocationReport.adaptive?.stage, "LOCATION", "persistent entry navigation must not classify a city page as entry");
assert.equal(persistentLocationReport.location?.label, "Chicago, Illinois", "location should choose the deepest offered city match");
assert.equal(persistentLocationReport.entryClick, undefined, "location page must not rediscover the entry link");

win.document.open();
win.document.write(`${persistentNav}<h1>Please select a category to post to</h1><a href="/services">Services</a><a href="/automotive">Automotive</a>`);
win.document.close();
const persistentCategoryReport = runListingAutofill({ ...profile, category: "Services", services: ["Testing"] });
assert.equal(persistentCategoryReport.adaptive?.stage, "CATEGORY", "persistent entry navigation must not classify a category page as entry");
assert.equal(persistentCategoryReport.category?.status, "selected", "category should select an actual current-page option");
assert.equal(persistentCategoryReport.entryClick, undefined, "category page must not rediscover the entry link");

win.document.open();
win.document.write(`${persistentNav}<h1>Please select a subcategory</h1><a href="/testing">Testing</a><a href="/other">Other</a>`);
win.document.close();
const persistentSubcategoryReport = runListingAutofill({ ...profile, category: "Services", services: ["Testing"] });
assert.equal(persistentSubcategoryReport.adaptive?.stage, "SUBCATEGORY", "persistent entry navigation must not classify a subcategory page as entry");
assert.equal(persistentSubcategoryReport.category?.status, "selected", "subcategory should select an actual current-page option");

win.document.open();
win.document.write(`${persistentNav}<form><label>Title<input name="title"></label><label>Description<textarea name="description"></textarea></label></form>`);
win.document.close();
const persistentFormReport = runListingAutofill(profile);
assert.equal(persistentFormReport.adaptive?.stage, "FORM", "persistent entry navigation must not classify the listing form as entry");
assert.equal(persistentFormReport.entryClick, undefined, "form page must not rediscover the entry link");

for (const domain of ["mypetads.example", "another-clone.example"]) {
  const nav = `<nav><a href="/post">Post Free Ad</a><a href="/submit">Submit Listing</a></nav>`;
  win.happyDOM.setURL(`https://${domain}/post`);
  win.document.open();
  win.document.write(`${nav}<h1>Please select a city</h1><a href="/city">Chicago, Illinois</a>`);
  win.document.close();
  const location = runListingAutofill({ ...profile, city: "Chicago", state: "Illinois", country: "United States" });
  assert.equal(location.adaptive?.stage, "LOCATION", `${domain} should classify the location stage`);
  assert.equal(location.location?.label, "Chicago, Illinois", `${domain} should choose the offered city`);
  assert.ok(location.adaptive?.diagnostics.some((step) => step.startsWith("Options collected: ")), `${domain} should report collected location options`);

  win.document.open();
  win.document.write(`${nav}<h1>Please select a category to post to</h1><a href="/services">Services</a><a href="/other">Other</a>`);
  win.document.close();
  const category = runListingAutofill({ ...profile, category: "Services", services: ["Testing"] });
  assert.equal(category.adaptive?.stage, "CATEGORY", `${domain} should classify the category stage`);
  assert.equal(category.category?.label, "Services", `${domain} should choose the best category option`);
  assert.ok(category.adaptive?.diagnostics.some((step) => step.startsWith("Options collected: ")), `${domain} should report collected category options`);

  win.document.open();
  win.document.write(`${nav}<h1>Please select a subcategory</h1><a href="/testing">Testing</a><a href="/other">Other</a>`);
  win.document.close();
  const subcategory = runListingAutofill({ ...profile, category: "Services", services: ["Testing"] });
  assert.equal(subcategory.adaptive?.stage, "SUBCATEGORY", `${domain} should classify the subcategory stage`);

  win.document.open();
  win.document.write(`${nav}<form><label>Title<input name="title"></label><label>Description<textarea name="description"></textarea></label></form>`);
  win.document.close();
  const form = runListingAutofill(profile);
  assert.equal(form.adaptive?.stage, "FORM", `${domain} should classify the form stage`);
  assert.equal(form.entryClick, undefined, `${domain} form should not restart entry discovery`);
}

// XZero/Classifieds-family signatures use query transitions on any hostname.
for (const domain of ["xzero-one.example", "xzero-two.example", "xzero-three.example"]) {
  win.happyDOM.setURL(`https://${domain}/index.php`);
  win.document.open();
  win.document.write(`<nav><a href="/index.php?targetview=post&view=selectcity">Post Free Ad</a></nav>`);
  win.document.close();
  const entry = runListingAutofill(profile);
  assert.equal(entry.entryClick, false, `${domain} family entry href should be deferred to background navigation`);
  assert.ok(entry.entryAction?.href && /targetview=post.*view=selectcity/.test(entry.entryAction.href), `${domain} family entry action should preserve the real href`);
  assert.match(entry.navigationUrl || "", /targetview=post.*view=selectcity/, `${domain} family entry should preserve query transition`);

  win.happyDOM.setURL(`https://${domain}/index.php?view=selectcity&targetview=post`);
  win.document.open();
  win.document.write(`<nav><a href="/index.php?targetview=post&view=selectcity">Post Free Ad</a></nav><h1>Please select a city</h1><a href="/index.php?cityid=illinois">Illinois</a><a href="/index.php?cityid=texas">Texas</a>`);
  win.document.close();
  const locationFallback = runListingAutofill({ ...profile, city: "Chicago", state: "Illinois", country: "United States" });
  assert.equal(locationFallback.adaptive?.stage, "LOCATION", `${domain} family location stage should use URL and heading`);
  assert.equal(locationFallback.location?.label, "Illinois", `${domain} should fall back from unavailable city to offered state`);

  win.happyDOM.setURL(`https://${domain}/index.php?view=post&cityid=illinois`);
  win.document.open();
  win.document.write(`<nav><a href="/index.php?targetview=post&view=selectcity">Post Free Ad</a></nav><h1>Please select a category to post to</h1><a href="/index.php?catid=services">Services</a><a href="/index.php?catid=automotive">Automotive</a>`);
  win.document.close();
  const familyCategory = runListingAutofill({ ...profile, category: "Services", services: ["Testing"] });
  assert.equal(familyCategory.adaptive?.stage, "CATEGORY", `${domain} family category stage should use the heading`);
  assert.equal(familyCategory.category?.label, "Services", `${domain} should select the best actual category href option`);
  assert.match(familyCategory.category?.href || "", /catid=services/, `${domain} category should preserve the real href`);

  win.happyDOM.setURL(`https://${domain}/index.php?view=post&cityid=illinois&catid=services`);
  win.document.open();
  win.document.write(`<nav><a href="/index.php?targetview=post&view=selectcity">Post Free Ad</a></nav><h1>Please select a subcategory to post to</h1><a href="/index.php?subcatid=testing">Testing</a><a href="/index.php?subcatid=other">Other</a>`);
  win.document.close();
  const familySubcategory = runListingAutofill({ ...profile, category: "Services", services: ["Testing"] });
  assert.equal(familySubcategory.adaptive?.stage, "SUBCATEGORY", `${domain} family subcategory stage should use the heading`);
  assert.equal(familySubcategory.category?.label, "Testing", `${domain} should select the best actual subcategory href option`);
  assert.match(familySubcategory.category?.href || "", /subcatid=testing/, `${domain} subcategory should preserve the real href`);

  win.happyDOM.setURL(`https://${domain}/index.php?view=post&cityid=illinois&catid=services&subcatid=testing`);
  win.document.open();
  win.document.write(`<nav><a href="/index.php?targetview=post&view=selectcity">Post Free Ad</a></nav><h1>Make a Post</h1><form><label>Title<input name="title"></label><label>or specify location<input name="location_other"></label><label>Post<textarea name="post"></textarea></label><label>Description<textarea name="description"></textarea></label><label>Website<input name="website"></label><label>Phone<input name="phone"></label><button type="submit">Post Now</button></form>`);
  win.document.close();
  const familyForm = runListingAutofill({ ...profile, city: "Chicago", state: "Illinois", country: "United States" });
  assert.equal(familyForm.adaptive?.stage, "FORM", `${domain} family form stage should use subcatid/form state`);
  assert.equal(familyForm.entryClick, undefined, `${domain} family form must not rediscover global entry navigation`);
  assert.equal((win.document.querySelector('[name="title"]') as unknown as HTMLInputElement).value, profile.businessName, `${domain} family form should map title to Business Name`);
  assert.equal((win.document.querySelector('[name="location_other"]') as unknown as HTMLInputElement).value, "Chicago, IL", `${domain} family form should prepare City, State Abbreviation`);
  assert.equal((win.document.querySelector('[name="website"]') as unknown as HTMLInputElement).value, profile.website, `${domain} family form should map Website`);
  assert.equal((win.document.querySelector('[name="phone"]') as unknown as HTMLInputElement).value, profile.phone, `${domain} family form should map Phone`);
  assert.equal((win.document.querySelector('[name="post"]') as unknown as HTMLTextAreaElement).value, profile.description, `${domain} family form should map Post to the Active Profile description`);
  assert.ok(familyForm.manual.includes("Final Submit"), `${domain} family form should stop before final submission`);
}

// Generic current-form account/listing mapping (Listingzz-style semantics).
win.happyDOM.setURL("https://generic-account-form.example/profile");
win.document.open();
win.document.write(`<form>
  <label>First Name<input name="first_name"></label>
  <label>Last Name<input name="surname"></label>
  <label>Contact Name<input name="contact_name"></label>
  <label>Login Name<input name="login_name"></label>
  <label>Organization<input name="organization"></label>
  <label>Title<input name="title"></label>
  <label>Attachment Title<input name="attachment_title"></label>
  <label>Email<input name="email" type="email"></label>
  <label>Country<select name="country"><option value="">Select Country</option><option value="us">United States</option><option value="ca">Canada</option></select></label>
  <label>State / Province<select name="state"><option value="">Select State</option><option value="il">Illinois</option><option value="ny">New York</option></select></label>
  <label>City<select name="city"><option value="">Select City</option><option value="chi">Chicago</option><option value="den">Denver</option></select></label>
  <label>Street Address<input name="address"></label>
  <label>Address Line 2<input name="address2"></label>
  <label>Postal Code<input name="postal"></label>
  <label>Phone<input name="phone"></label>
  <label>Mobile Phone<input name="mobile"></label>
  <label>Website<input name="website"></label>
  <label>Facebook<input name="facebook"></label>
  <label>LinkedIn<input name="linkedin"></label>
  <label>X / Twitter<input name="twitter"></label>
  <label>Instagram<input name="instagram"></label>
  <label>Business Hours<textarea name="hours"></textarea></label>
  <label>Brochure Document<input name="brochure_file" type="file" accept="application/pdf"></label>
  <label>Your Profile / About<textarea name="profile_about"></textarea></label>
  <label>Your Photo<input name="photo" type="file" accept="image/*"></label>
  <label>Your Logo<input name="logo" type="file" accept="image/*"></label>
  <label>Password<input name="password" type="password"></label>
  <label>Re-enter Password<input name="password_confirmation"></label>
  <label><input name="marketing" type="checkbox"> Okay to email me</label>
  <button type="submit">Update Profile</button>
</form>`);
win.document.close();
const accountProfile = { ...profile, businessName: "Charming Skin Vein Clinics", firstName: "Charming", lastName: "Clinics", contactName: "", email: "submission@example.test", password: "ListingPassword-Only-Test", address: "1 Main Street", completeAddress: "1 Main Street, Chicago, IL 60601, United States", city: "Chicago", state: "Illinois", postalCode: "60601", country: "United States", shortDescription: "Short business profile summary.", facebook: "https://facebook.com/charming", linkedin: "https://linkedin.com/company/charming", twitter: "https://x.com/charming", instagram: "https://instagram.com/charming", description: "Medical vein and skin clinic services." };
const accountReport = runListingAutofill(accountProfile);
assert.equal(accountReport.adaptive?.stage, "FORM", "generic account form should be detected");
assert.equal(value("first_name"), "Charming", "First Name should map from profile");
assert.equal(value("surname"), "Clinics", "Last Name should map from profile");
assert.equal(value("contact_name"), "Charming Clinics", "single Contact Name should fall back to First + Last");
assert.equal(value("login_name"), accountProfile.username, "Login Name should receive Username");
assert.equal(value("organization"), accountProfile.businessName, "Organization should receive the full Business Name");
assert.equal(value("title"), accountProfile.businessName, "Title should receive the Business Name");
assert.equal(value("attachment_title"), accountProfile.businessName, "Attachment Title should receive the Business Name");
assert.equal(value("email"), accountProfile.email, "Email should receive Submission Email");
assert.equal(value("country"), "us", "Country select should choose the closest actual option");
assert.equal(value("state"), "il", "State select should choose the closest actual option");
assert.equal(value("city"), "chi", "City select should choose the closest actual option");
assert.equal(value("address"), accountProfile.address, "Address Line 1 should receive street only when split fields exist");
assert.equal(value("address2"), "", "Second Address field should remain blank");
assert.equal(value("postal"), accountProfile.postalCode, "Postal Code should map structurally");
assert.equal(value("phone"), accountProfile.phone, "Phone should map Business Phone");
assert.equal(value("mobile"), "", "Mobile Phone should remain blank without a distinct mobile profile value");
assert.equal(value("website"), accountProfile.website, "Website should map");
assert.equal(value("facebook"), accountProfile.facebook, "Facebook URL should map");
assert.equal(value("linkedin"), accountProfile.linkedin, "LinkedIn URL should map");
assert.equal(value("twitter"), accountProfile.twitter, "Twitter/X URL should map");
assert.equal(value("instagram"), accountProfile.instagram, "Instagram URL should map");
assert.equal(value("profile_about"), accountProfile.shortDescription, "Profile/About should map Short Description");
assert.equal(value("hours"), accountProfile.businessHours.join("\n"), "Business Hours should map from the Active Profile");
assert.equal(value("password") === accountProfile.password, true, "Password should map from saved Submission Fields data");
assert.equal(value("password_confirmation") === accountProfile.password, true, "Password confirmation should reuse saved Submission Fields data");
assert.equal((win.document.querySelector('[name="marketing"]') as unknown as HTMLInputElement).checked, false, "marketing opt-in must remain unchanged");
assert.equal((win.document.querySelector('[name="photo"]') as unknown as HTMLInputElement).files?.length || 0, 0, "Your Photo must remain untouched");
assert.equal(findLogoInputs(win.document as unknown as Document)[0]?.getAttribute("name"), "logo", "Your Logo should be the only image upload candidate");
const accountLogo = findLogoInputs(win.document as unknown as Document)[0];
let accountLogoFiles: File[] = [];
Object.defineProperty(accountLogo, "files", { configurable: true, get: () => accountLogoFiles, set: (files: File[]) => { accountLogoFiles = files; } });
const accountLogoResult = await attachLogoFile(accountLogo, new TextEncoder().encode("account-logo").buffer, "business-logo.png", "image/png");
assert.equal(accountLogoResult.ok, true, "Business Logo should attach during generic form preparation");
assert.equal(accountLogoFiles.length, 1, "Business Logo input.files should contain exactly one file");
assert.ok(accountReport.manual.includes("Final Submit"), "Update Profile must remain manual");

// --- social links use the exact saved URL; never cross-map or reduce to a handle ---
const socialUrls = { facebook: "https://facebook.com/acme", instagram: "https://instagram.com/acme", linkedin: "https://linkedin.com/company/acme", twitter: "https://x.com/acme", youtube: "https://youtube.com/@acme", tiktok: "https://tiktok.com/@acme", pinterest: "https://pinterest.com/acme" };
const socialProfile = { ...profile,
  username: "handle-only",
  description: "Long business description.",
  socialLinks: [
    { url: socialUrls.facebook, platform: "facebook" as const },
    { url: socialUrls.instagram, platform: "instagram" as const },
    { url: socialUrls.linkedin, platform: "linkedin" as const },
    { url: socialUrls.twitter, platform: "twitter" as const },
    { url: socialUrls.youtube, platform: "youtube" as const },
    { url: socialUrls.tiktok, platform: "tiktok" as const },
    { url: socialUrls.pinterest, platform: "pinterest" as const },
  ],
  facebook: "", instagram: "", linkedin: "https://legacy.example/linkedin", twitter: "", youtube: "", tiktok: "@legacyhandle", pinterest: "",
};
win.happyDOM.setURL("https://social-form.example/profile");
win.document.open();
win.document.write(`<form>
  <label>Facebook<input name="facebook" type="url"></label>
  <label>Instagram<input name="instagram" type="url"></label>
  <label>LinkedIn<input name="linkedin" type="url"></label>
  <label>X / Twitter<input name="twitter" type="url"></label>
  <label>YouTube<input name="youtube" type="url"></label>
  <label>TikTok<input name="tiktok" type="url"></label>
  <label>TikTok Username<input name="tiktok_username"></label>
  <label>Pinterest<input name="pinterest" type="url"></label>
</form>`);
win.document.close();
runListingAutofill(socialProfile);
assert.equal(value("linkedin"), socialUrls.linkedin, "LinkedIn must fill the exact saved URL");
assert.equal(value("youtube"), socialUrls.youtube, "YouTube must fill the exact saved URL");
assert.equal(value("tiktok"), socialUrls.tiktok, "TikTok must stay the full saved URL, not a handle");
assert.equal(value("tiktok_username"), socialUrls.tiktok, "a TikTok username field must receive the full URL, never the handle");
assert.equal(value("facebook"), socialUrls.facebook, "Facebook must fill its own saved URL");
assert.equal(value("instagram"), socialUrls.instagram, "Instagram must fill its own saved URL");
assert.equal(value("twitter"), socialUrls.twitter, "X/Twitter must fill its own saved URL");
assert.equal(value("pinterest"), socialUrls.pinterest, "Pinterest must fill its own saved URL");
assert.notEqual(value("linkedin"), socialUrls.facebook, "social platforms must not cross-map");
assert.notEqual(value("linkedin"), socialProfile.username, "LinkedIn must not receive the username handle");

// Ambiguous social context (several platforms named in one shared container) must stay unmapped.
win.happyDOM.setURL("https://ambiguous-social.example/profile");
win.document.open();
win.document.write(`<div class="social-block">Facebook LinkedIn YouTube<input name="social_one"><input name="social_two"><input name="social_three"></div>`);
win.document.close();
runListingAutofill(socialProfile);
assert.equal(value("social_one"), "", "ambiguous social context must not cross-map platform one");
assert.equal(value("social_two"), "", "ambiguous social context must not cross-map platform two");
assert.equal(value("social_three"), "", "ambiguous social context must not cross-map platform three");

// Adjacent platform fields must map strictly from their own evidence; unsupported platforms stay blank.
win.happyDOM.setURL("https://adjacent-social.example/profile");
win.document.open();
win.document.write(`<form>
  <label>TikTok<input name="tiktok_field" placeholder="https://www.tiktok.com/@username"></label>
  <label>Snapchat<input name="snapchat_field" placeholder="https://www.snapchat.com/add/username"></label>
  <label>WhatsApp<input name="whatsapp_field" placeholder="https://wa.me/15550100"></label>
</form>`);
win.document.close();
runListingAutofill(socialProfile);
assert.equal(value("tiktok_field"), socialUrls.tiktok, "TikTok must receive the exact saved TikTok URL");
assert.equal(value("snapchat_field"), "", "Snapchat must stay blank when the profile has no Snapchat value");
assert.equal(value("whatsapp_field"), "", "WhatsApp must stay blank when the profile has no WhatsApp value");
assert.notEqual(value("snapchat_field"), socialUrls.tiktok, "TikTok data must not leak into Snapchat");
assert.notEqual(value("snapchat_field"), socialProfile.username, "username must not leak into Snapchat");
assert.notEqual(value("whatsapp_field"), socialProfile.username, "username must not leak into WhatsApp");

// Full adjacent social sequence: each supported platform gets only its own URL; missing platforms stay blank.
win.happyDOM.setURL("https://social-sequence.example/profile");
win.document.open();
win.document.write(`<form>
  <label>Facebook<input name="seq_facebook" placeholder="https://www.facebook.com/username"></label>
  <label>X<input name="seq_twitter" placeholder="https://x.com/username"></label>
  <label>LinkedIn<input name="seq_linkedin" placeholder="https://www.linkedin.com/in/username"></label>
  <label>YouTube<input name="seq_youtube" placeholder="https://www.youtube.com/@username"></label>
  <label>Instagram<input name="seq_instagram" placeholder="https://www.instagram.com/username"></label>
  <label>Pinterest<input name="seq_pinterest" placeholder="https://www.pinterest.com/username"></label>
  <label>TikTok<input name="seq_tiktok" placeholder="https://www.tiktok.com/@username"></label>
  <label>Snapchat<input name="seq_snapchat" placeholder="https://www.snapchat.com/add/username"></label>
  <label>WhatsApp<input name="seq_whatsapp" placeholder="https://wa.me/15550100"></label>
</form>`);
win.document.close();
runListingAutofill(socialProfile);
assert.equal(value("seq_facebook"), socialUrls.facebook, "sequence Facebook must get its own URL");
assert.equal(value("seq_twitter"), socialUrls.twitter, "sequence X must get its own URL");
assert.equal(value("seq_linkedin"), socialUrls.linkedin, "sequence LinkedIn must get the exact saved LinkedIn URL");
assert.equal(value("seq_youtube"), socialUrls.youtube, "sequence YouTube must get its own URL");
assert.equal(value("seq_instagram"), socialUrls.instagram, "sequence Instagram must get its own URL");
assert.equal(value("seq_pinterest"), socialUrls.pinterest, "sequence Pinterest must get its own URL");
assert.equal(value("seq_tiktok"), socialUrls.tiktok, "sequence TikTok must get its own URL");
assert.equal(value("seq_snapchat"), "", "sequence Snapchat must stay blank with no saved value");
assert.equal(value("seq_whatsapp"), "", "sequence WhatsApp must stay blank with no saved value");
assert.equal(new Set([value("seq_facebook"), value("seq_twitter"), value("seq_linkedin"), value("seq_youtube"), value("seq_instagram"), value("seq_pinterest"), value("seq_tiktok")]).size, 7, "no supported platform may share another platform's value");

// Platform evidence via aria-labelledby and a per-field wrapper (not a <label> element) must resolve.
win.happyDOM.setURL("https://labelledby-social.example/profile");
win.document.open();
win.document.write(`<form>
  <span id="li-label">LinkedIn</span>
  <input name="field_one" aria-labelledby="li-label">
  <div class="form-group">YouTube<input name="field_two"></div>
</form>`);
win.document.close();
runListingAutofill(socialProfile);
assert.equal(value("field_one"), socialUrls.linkedin, "LinkedIn must resolve from aria-labelledby");
assert.equal(value("field_two"), socialUrls.youtube, "YouTube must resolve from its per-field wrapper");

// --- Position / Job Title never receives Description, Short Description, Business Name, or Services ---
win.happyDOM.setURL("https://position-form.example/profile");
win.document.open();
win.document.write(`<form>
  <label>Your Position<input name="position"></label>
  <label>Job Title<input name="job_title"></label>
  <label>Business Name<input name="business_name"></label>
  <label>Description<textarea name="description"></textarea></label>
</form>`);
win.document.close();
const positionReport = runListingAutofill(socialProfile);
assert.equal(value("position"), "", "Position must stay blank with no dedicated position value");
assert.equal(value("job_title"), "", "Job Title must stay blank with no dedicated position value");
assert.equal(value("business_name"), socialProfile.businessName, "Business Name must still map");
assert.equal(value("description"), socialProfile.description, "Description must still map to Long Description");
assert.ok(positionReport.skipped.some((entry) => entry.descriptor.includes('name="position"') && entry.reason.includes("position")), "Position must be reported as unmapped");

// --- split-address forms: street only in Line 1, city/state/country/postal filled ---
win.happyDOM.setURL("https://split-address.example/profile");
win.document.open();
win.document.write(`<form>
  <label>Address Line 1<input name="address1"></label>
  <label>Address Line 2<input name="address2"></label>
  <label>City<input name="city"></label>
  <label>State<input name="state"></label>
  <label>Country<input name="country"></label>
  <label>Enter Postal Code<input name="postal_code"></label>
</form>`);
win.document.close();
runListingAutofill(accountProfile);
assert.equal(value("address1"), accountProfile.address, "Address Line 1 must receive street only on split-address forms");
assert.notEqual(value("address1"), accountProfile.completeAddress, "Address Line 1 must never receive Complete Address when split fields exist");
assert.equal(value("address2"), "", "Address Line 2 must remain blank");
assert.equal(value("city"), accountProfile.city, "City must fill the Active Profile City");
assert.equal(value("state"), accountProfile.state, "State must fill the Active Profile State");
assert.equal(value("country"), accountProfile.country, "Country must fill the Active Profile Country");
assert.equal(value("postal_code"), accountProfile.postalCode, "Postal Code must fill the Active Profile Postal Code");

// --- live directory order: Country, State, Address, Address, City, Postal Code ---
win.happyDOM.setURL("https://directory-profile-update.example/profile");
win.document.open();
win.document.write(`<form><table>
  <tr><td>Country</td><td><select name="country"><option value="">Select Country</option><option value="us">United States</option></select></td></tr>
  <tr><td>State</td><td><select name="state"><option value="">Select State</option><option value="il">Illinois</option></select></td></tr>
  <tr><td>Address</td><td><input name="city"></td></tr>
  <tr><td>Address</td><td><input name="address2"></td></tr>
  <tr><td>City</td><td><select name="city_select"><option value="">Select City</option><option value="chi">Chicago</option></select></td></tr>
  <tr><td>Postal Code</td><td><input name="postal_code"></td></tr>
</table></form>`);
win.document.close();
const orderedAddressReport = runListingAutofill(accountProfile);
assert.equal((win.document.querySelector('[name="city"]') as unknown as HTMLInputElement).value, accountProfile.address, "first live-order Address input must receive Street Address only");
assert.equal((win.document.querySelector('[name="address2"]') as unknown as HTMLInputElement).value, "", "second live-order Address input must remain blank");
assert.equal((win.document.querySelector('[name="city_select"]') as unknown as HTMLSelectElement).value, "chi", "City select must receive the Active Profile City");
assert.equal((win.document.querySelector('[name="postal_code"]') as unknown as HTMLInputElement).value, accountProfile.postalCode, "live-order Postal Code must receive profile postalCode");
assert.notEqual((win.document.querySelector('[name="city"]') as unknown as HTMLInputElement).value, accountProfile.city, "City must not leak into the first Address input");
assert.notEqual((win.document.querySelector('[name="city"]') as unknown as HTMLInputElement).value, accountProfile.completeAddress, "Complete Address must not leak into the first Address input");
assert.equal(orderedAddressReport.filled.find((entry) => entry.descriptor.includes('name="city"'))?.field, "address", "live-order first Address input must report the address slot");

// --- HUMAN_GATE signals must not block safe autofill on a normal directory form ---
win.happyDOM.setURL("https://directory-human-gate.example/profile");
win.document.open();
win.document.write(`<form>
  <div>Include Profile With Listing <label><input name="include_profile" type="radio" value="yes">Yes</label><label><input name="include_profile" type="radio" value="no">No</label></div>
  <div>Features <label><input name="feature_one" type="checkbox">Featured</label></div>
  <div>Plan / Free Trial</div>
  <label>Description<textarea name="description"></textarea></label>
  <label>Country<select name="country"><option value="">Select Country</option><option value="testland">Testland</option></select></label>
  <label>State<select name="state"><option value="">Select State</option><option value="ts">TS</option></select></label>
  <label>Address<input name="city"></label>
  <label>Address<input name="address2"></label>
  <label>City<select name="city_select"><option value="">Select City</option><option value="testville">Testville</option></select></label>
  <label>Postal Code<input name="postal_code"></label>
  <label>CAPTCHA<input name="captcha" placeholder="Complete CAPTCHA"></label>
  <button id="final-submit" type="submit">Submit Listing</button>
</form>`);
win.document.close();
let humanGateSubmitted = false;
win.document.querySelector("form")?.addEventListener("submit", (event) => { event.preventDefault(); humanGateSubmitted = true; });
const humanGateReport = runListingAutofill({ ...profile, description: "Long directory description.\n\nSecond paragraph." });
assert.equal(humanGateReport.adaptive?.stage, "FORM", "a normal form with CAPTCHA must remain FORM");
assert.equal(value("description"), "Long directory description.\n\nSecond paragraph.", "Description must receive plain Long Description only");
assert.equal(value("description").includes(profile.imageUrl), false, "Description must exclude Image URL when a human gate exists");
assert.equal(value("description").includes("<img"), false, "Description must exclude img HTML when a human gate exists");
assert.equal((win.document.querySelector('[name="city"]') as unknown as HTMLInputElement).value, profile.address, "first Address must receive Street Address only despite misleading city name");
assert.equal((win.document.querySelector('[name="address2"]') as unknown as HTMLInputElement).value, "", "second Address must remain blank");
assert.equal((win.document.querySelector('[name="city_select"]') as unknown as HTMLSelectElement).value, "testville", "City select must receive Active Profile City");
assert.equal((win.document.querySelector('[name="postal_code"]') as unknown as HTMLInputElement).value, profile.postalCode, "Postal Code must receive Active Profile Postal Code");
assert.equal((win.document.querySelector('[name="captcha"]') as unknown as HTMLInputElement).value, "", "CAPTCHA must remain untouched");
assert.equal((win.document.querySelector('[name="include_profile"]:checked') as unknown as HTMLInputElement | null), null, "Include Profile radios must remain untouched");
assert.equal((win.document.querySelector('[name="feature_one"]') as unknown as HTMLInputElement).checked, false, "Features checkbox must remain untouched");
assert.equal(humanGateSubmitted, false, "final Submit must remain manual");
assert.ok(humanGateReport.manual.includes("CAPTCHA"), "CAPTCHA must remain a human gate");
assert.ok(humanGateReport.manual.includes("Final Submit"), "final Submit must remain a human gate");
assert.ok(humanGateReport.adaptive?.diagnostics.some((entry) => entry === "Safe autofill completed"), "diagnostics must report safe autofill completion");
assert.ok(humanGateReport.adaptive?.diagnostics.some((entry) => entry.includes("Human input required: CAPTCHA")), "diagnostics must report the remaining CAPTCHA gate");

// --- exact live directory structure: later passes must not overwrite resolved semantics ---
win.happyDOM.setURL("https://directory-live-shape.example/profile");
win.document.open();
win.document.write(`<form>
  <label>Description<textarea id="content" name="content"></textarea></label>
  <table>
    <tr><td>Country</td><td><select name="country"><option value="">Select Country</option><option value="us">United States</option></select></td></tr>
    <tr><td>State</td><td><select name="state"><option value="">Select State</option><option value="ca">California</option></select></td></tr>
    <tr><td>Address</td><td><input name="city"></td></tr>
    <tr><td>Address</td><td><input name="address2"></td></tr>
    <tr><td>City</td><td><select name="city_select"><option value="">Select City</option><option value="sjc">San Juan Capistrano</option></select></td></tr>
    <tr><td><span>State</span><span>Postal Code</span></td><td><input id="PageContent_Listing_ListingEditAddress__PostalCode" name="ctl00$PageContent$Listing$ListingEditAddress$_PostalCode" placeholder="Postal Code"></td></tr>
  </table>
</form>`);
win.document.close();
const liveShapeProfile = { ...profile, address: "123 Main Street", completeAddress: "123 Main Street, San Juan Capistrano, CA 92675, United States", city: "San Juan Capistrano", state: "California", stateCode: "CA", postalCode: "92675", country: "United States", description: "Long paragraph one.\n\nLong paragraph two." };
const liveShapeReport = runListingAutofill(liveShapeProfile);
assert.equal((win.document.querySelector('[name="content"]') as unknown as HTMLTextAreaElement).value, liveShapeProfile.description, "plain Description must remain Long Description only after every pass");
assert.equal((win.document.querySelector('[name="content"]') as unknown as HTMLTextAreaElement).value.includes(liveShapeProfile.imageUrl), false, "plain Description must exclude Image URL after every pass");
assert.equal((win.document.querySelector('[name="content"]') as unknown as HTMLTextAreaElement).value.includes("<img"), false, "plain Description must exclude img HTML after every pass");
assert.equal((win.document.querySelector('[name="city"]') as unknown as HTMLInputElement).value, liveShapeProfile.address, "final Address1 value must be streetAddress");
assert.equal((win.document.querySelector('[name="address2"]') as unknown as HTMLInputElement).value, "", "final Address2 value must remain blank");
assert.equal((win.document.querySelector('[name="city_select"]') as unknown as HTMLSelectElement).value, "sjc", "final City value must be city");
assert.equal((win.document.querySelector('[name="state"]') as unknown as HTMLSelectElement).value, "ca", "final State value must be state");
assert.equal((win.document.querySelector('[name="country"]') as unknown as HTMLSelectElement).value, "us", "final Country value must be country");
assert.equal((win.document.querySelector('#PageContent_Listing_ListingEditAddress__PostalCode') as unknown as HTMLInputElement).value, liveShapeProfile.postalCode, "final known Postal Code field must be postalCode");
assert.ok(liveShapeReport.adaptive?.diagnostics.some((entry) => entry.startsWith("Description → description") && entry.includes('name="content"')), "final diagnostics must identify the Description source field");
assert.ok(liveShapeReport.adaptive?.diagnostics.some((entry) => entry.startsWith("Address1 → streetAddress") && entry.includes('name="city"')), "final diagnostics must identify the Address1 source field");
assert.ok(liveShapeReport.adaptive?.diagnostics.some((entry) => entry.startsWith("Address2 → skipped") && entry.includes('name="address2"')), "final diagnostics must identify skipped Address2");
assert.ok(liveShapeReport.adaptive?.diagnostics.some((entry) => entry.startsWith("City → city") && entry.includes('name="city_select"')), "final diagnostics must identify the City source field");
assert.ok(liveShapeReport.adaptive?.diagnostics.some((entry) => entry.startsWith("PostalCode → postalCode") && entry.includes("ListingEditAddress$_PostalCode")), "final diagnostics must identify the known Postal Code source field");

// Native autocomplete hints and a legacy complete-address-only payload must still map split fields.
win.happyDOM.setURL("https://profile-update.example/profile");
win.document.open();
win.document.write(`<form>
  <label>Street Address<input name="line1" autocomplete="street-address"></label>
  <label>Address Line 2<input name="line2" autocomplete="address-line2"></label>
  <label>City<input name="locality"></label>
  <label>State / Province<input name="region"></label>
  <label>Country<input name="nation"></label>
  <label>Postal Code<input name="code" autocomplete="postal-code"></label>
</form>`);
win.document.close();
const legacyAddressProfile = { ...accountProfile, address: "", completeAddress: "1 Main Street, Chicago, Illinois, 60601, United States", postalCode: "" };
runListingAutofill(legacyAddressProfile);
assert.equal(value("line1"), "1 Main Street", "Street Address must receive only the parsed street from Complete Address");
assert.equal(value("line2"), "", "Address Line 2 must remain blank without dedicated data");
assert.equal(value("code"), "60601", "Postal Code must receive the parsed postal code");
assert.notEqual(value("line1"), legacyAddressProfile.completeAddress, "Complete Address must not be written into Street Address");

// A structured Profile Update group may put "Complete Address" in the field wrapper; field-owned semantics must still send street only.
win.happyDOM.setURL("https://profile-update-structured.example/profile");
win.document.open();
win.document.write(`<form>
  <label>Country<input name="country"></label>
  <label>State/Province<input name="state"></label>
  <div class="form-group"><span>Complete Address</span><input name="address"></div>
  <div class="form-group"><span>Address Line 2</span><input name="address2"></div>
  <label>City<input name="city"></label>
  <label>Postal Code<input name="postal_code"></label>
</form>`);
win.document.close();
const structuredAddressProfile = { ...accountProfile, address: "1714 Gilbertsville Rd", completeAddress: "1714 Gilbertsville Rd, Pottstown, PA 19464, United States", city: "Pottstown", state: "Pennsylvania", stateCode: "PA", postalCode: "19464", country: "United States" };
runListingAutofill(structuredAddressProfile);
assert.equal(value("address"), "1714 Gilbertsville Rd", "structured Profile Update Address must receive Street Address only");
assert.equal(value("country"), "United States", "structured Profile Update Country must remain separate");
assert.equal(value("state"), "Pennsylvania", "structured Profile Update State must remain separate");
assert.equal(value("city"), "Pottstown", "structured Profile Update City must remain separate");
assert.equal(value("postal_code"), "19464", "structured Profile Update Postal Code must remain separate");
assert.equal(value("address2"), "", "structured Profile Update Address Line 2 must remain blank");
for (const leaked of ["Pottstown", "PA", "19464", "United States"]) assert.equal(value("address").includes(leaked), false, `Street Address must not contain ${leaked}`);

// --- a single combined Address field still receives Complete Address ---
win.happyDOM.setURL("https://combined-address.example/profile");
win.document.open();
win.document.write(`<form>
  <label>Business Name<input name="business_name"></label>
  <label>Address<input name="address"></label>
</form>`);
win.document.close();
runListingAutofill(accountProfile);
assert.equal(value("address"), accountProfile.completeAddress, "a single combined Address field must still receive Complete Address");

// --- "Share More Details": brochure upload, motto -> Business Name, hours with line breaks ---
const detailsProfile = { ...profile,
  businessName: "Haul Bros Junk Removal",
  description: "Long description that must not reach the motto.",
  shortDescription: "Short summary that must not reach the motto.",
  username: "details-handle",
  contactName: "Details Contact",
  businessHours: ["Monday 8AM-5PM", "Tuesday 8AM-5PM", "Wednesday 8AM-5PM"],
};
win.happyDOM.setURL("https://share-more-details.example/profile");
win.document.open();
win.document.write(`<form>
  <div class="upload"><button type="button">Upload CV or Brochure</button><input id="cv_brochure" name="cv_brochure" type="file"><span id="brochure-status">No file chosen</span></div>
  <label>Personal Quote/motto<input name="motto"></label>
  <label>Hours of Operation<textarea name="hours_of_operation"></textarea></label>
  <label>Year Established<input name="year_established"></label>
  <label>Accepted Forms of Payments<input name="payments"></label>
  <label>Credentials<input name="credentials"></label>
  <label>Honors &amp; Awards<input name="awards"></label>
  <label>Business Name<input name="business_name"></label>
  <label>Your Logo<input name="logo" type="file" accept="image/*"></label>
  <label>Your Photo<input name="photo" type="file" accept="image/*"></label>
</form>`);
win.document.close();
const detailsReport = runListingAutofill(detailsProfile);
assert.equal(detailsReport.adaptive?.stage, "FORM", "Share More Details section should be a generic FORM");
assert.equal(value("motto"), detailsProfile.businessName, "Personal Quote/motto must receive the Business Name");
assert.notEqual(value("motto"), detailsProfile.description, "motto must not receive Description");
assert.notEqual(value("motto"), detailsProfile.shortDescription, "motto must not receive Short Description");
assert.notEqual(value("motto"), detailsProfile.username, "motto must not receive Username");
assert.notEqual(value("motto"), detailsProfile.contactName, "motto must not receive Contact Name");
assert.equal(value("hours_of_operation"), detailsProfile.businessHours.join("\n"), "Hours of Operation must receive Business Hours on separate lines");
assert.ok(value("hours_of_operation").includes("\n"), "Hours of Operation must keep line breaks");
assert.equal(value("year_established"), "", "Year Established must stay unchanged");
assert.equal(value("payments"), "", "Accepted Forms of Payments must stay unchanged");
assert.equal(value("credentials"), "", "Credentials must stay unchanged");
assert.equal(value("awards"), "", "Honors & Awards must stay unchanged");
assert.equal(detailsReport.form?.brochure?.requested, true, "Upload CV or Brochure must be classified as a brochure request");
const detailsBrochureInputs = findBrochureInputs(win.document as unknown as Document);
assert.equal(detailsBrochureInputs.length, 1, "exactly one brochure input should be detected");
assert.equal(detailsBrochureInputs[0]?.getAttribute("name"), "cv_brochure", "styled Upload CV or Brochure must resolve to the underlying file input");
assert.equal(findLogoInputs(win.document as unknown as Document)[0]?.getAttribute("name"), "logo", "Business Logo must remain the only logo upload target");
const detailsBrochure = detailsBrochureInputs[0];
let detailsBrochureFiles: File[] = [];
Object.defineProperty(detailsBrochure, "files", { configurable: true, get: () => detailsBrochureFiles, set: (files: File[]) => { detailsBrochureFiles = files; } });
detailsBrochure.addEventListener("change", () => { win.document.getElementById("brochure-status")!.textContent = "active-brochure.pdf"; });
const detailsBrochureResult = await attachBrochureToLiveInput(win.document as unknown as Document, new TextEncoder().encode("details-pdf").buffer, "active-brochure.pdf", "application/pdf", 0);
assert.equal(detailsBrochureResult.ok, true, `Upload CV or Brochure should receive the saved Brochure PDF: ${JSON.stringify(detailsBrochureResult)}`);
assert.equal(detailsBrochureFiles.length, 1, "brochure input.files should contain exactly one PDF");
assert.equal(detailsBrochureFiles[0].name, "active-brochure.pdf", "brochure filename must be retained");
assert.equal(detailsBrochureFiles[0].type, "application/pdf", "brochure input must contain the PDF, never an image");
assert.equal((win.document.querySelector('[name="photo"]') as unknown as HTMLInputElement).files?.length || 0, 0, "Your Photo must remain untouched");

win.happyDOM.setURL("https://generic-directory.example/listing");
win.document.open();
win.document.write(`<div>
  <label for="PageContent_Listing_Title">Title</label><input id="PageContent_Listing_Title" name="ctl00$PageContent$Listing$Title" placeholder="The title will appear in search results on the site.">
  <label for="PageContent_Listing_ShortDescription">Short Description</label><textarea id="PageContent_Listing_ShortDescription" name="ctl00$PageContent$Listing$ShortDescription" placeholder="Up to 160 characters"></textarea>
  <label for="PageContent_Listing_Description">Description</label><textarea id="PageContent_Listing_Description" name="ctl00$PageContent$Listing$Description" placeholder="Up to 10,000 characters. A more detailed description..."></textarea>
  <label>Phone<input name="phone"></label>
  <label>Attachment <span>Choose PDF file to attach to your listing.</span><span id="brochure-status">No file chosen</span><input id="FileToUpload" name="FileToUpload" type="file"></label>
</div>`);
win.document.close();
const exactFormReport = runListingAutofill(accountProfile);
assert.equal((win.document.getElementById("PageContent_Listing_Title") as unknown as HTMLInputElement).value, accountProfile.businessName, "ASP.NET listing Title should map Business Name");
assert.equal((win.document.getElementById("PageContent_Listing_ShortDescription") as unknown as HTMLTextAreaElement).value, accountProfile.shortDescription, "ASP.NET Short Description should map short content");
assert.equal((win.document.getElementById("PageContent_Listing_Description") as unknown as HTMLTextAreaElement).value, accountProfile.description, "ASP.NET Description should map long content");
assert.equal(exactFormReport.adaptive?.stage, "FORM", "ASP.NET controls should remain a generic FORM");
const exactBrochure = findBrochureInputs(win.document as unknown as Document)[0];
let exactBrochureFiles: File[] = [];
Object.defineProperty(exactBrochure, "files", { configurable: true, get: () => exactBrochureFiles, set: (files: File[]) => { exactBrochureFiles = files; } });
exactBrochure.addEventListener("change", () => { win.document.getElementById("brochure-status")!.textContent = "active-brochure.pdf"; });
const exactBrochureResult = await attachBrochureToLiveInput(win.document as unknown as Document, new TextEncoder().encode("exact-pdf").buffer, "active-brochure.pdf", "application/pdf", 0);
assert.equal(exactBrochureResult.ok, true, "ASP.NET FileToUpload should receive the Brochure PDF");
assert.equal(exactBrochureFiles.length, 1, "ASP.NET FileToUpload should retain one Brochure PDF");
assert.equal(exactBrochureFiles[0].name, "active-brochure.pdf", "ASP.NET FileToUpload should retain the Brochure filename");

// ASP.NET Postal Code field must map to Active Profile Postal Code (not Address).
win.happyDOM.setURL("https://directory.example/listing");
win.document.open();
win.document.write(`<div>
  <label for="PageContent_Listing_ListingEditAddress__PostalCode">Postal Code</label>
  <input name="ctl00$PageContent$Listing$ListingEditAddress$_PostalCode" type="text" maxlength="19" id="PageContent_Listing_ListingEditAddress__PostalCode" class="form-control" placeholder="Postal Code">
  <label for="PageContent_Listing_ListingEditAddress__Street">Street Address</label>
  <input name="ctl00$PageContent$Listing$ListingEditAddress$_Street" type="text" id="PageContent_Listing_ListingEditAddress__Street" placeholder="Street Address">
  <label for="PageContent_Listing_ListingEditAddress__MapAddress">Add Map</label>
  <input name="ctl00$PageContent$Listing$ListingEditAddress$_MapAddress" type="text" id="PageContent_Listing_ListingEditAddress__MapAddress" placeholder="Enter address to find on map">
  <button type="button" id="map-button">Map this address</button>
</div>`);
win.document.close();
const postalMapReport = runListingAutofill(accountProfile);
const postalField = win.document.getElementById("PageContent_Listing_ListingEditAddress__PostalCode") as unknown as HTMLInputElement;
const streetField = win.document.getElementById("PageContent_Listing_ListingEditAddress__Street") as unknown as HTMLInputElement;
const mapField = win.document.getElementById("PageContent_Listing_ListingEditAddress__MapAddress") as unknown as HTMLInputElement;
assert.equal(postalField.value, accountProfile.postalCode, "ASP.NET Postal Code field should map to Active Profile Postal Code");
assert.equal(streetField.value, accountProfile.address, "ASP.NET Street Address should map to street only");
assert.equal(mapField.value, "", "Add Map lookup field must stay blank");
assert.ok(postalMapReport.skipped.some((entry) => entry.descriptor.includes("MapAddress") && entry.reason.includes("map lookup")), "Add Map field should be reported as skipped");
assert.ok(!postalMapReport.filled.some((entry) => entry.descriptor.includes("MapAddress")), "Add Map field must not be filled");

// Live-style cascading country -> state -> city selects must settle before mapping.
win.document.open();
win.document.write(`<form>
  <label>Country<select name="country"><option value="">Select Country</option><option value="us">United States</option><option value="ca">Canada</option></select></label>
  <label>State / Province<select name="state"><option value="">Loading states...</option></select></label>
  <label>City<select name="city"><option value="">Loading cities...</option></select></label>
  <label>Organization / Company<input name="organization"></label>
  <label>Address<input name="address"></label>
  <label>Address Line 2<input name="address2"></label>
  <label>Postal Code<input name="postal"></label>
  <label>Your Profile / Bio<textarea name="profile"></textarea></label>
</form>`);
win.document.close();
const cascadingCountry = win.document.querySelector('[name="country"]') as unknown as HTMLSelectElement;
const cascadingState = win.document.querySelector('[name="state"]') as unknown as HTMLSelectElement;
const cascadingCity = win.document.querySelector('[name="city"]') as unknown as HTMLSelectElement;
cascadingCountry.addEventListener("change", () => setTimeout(() => { cascadingState.innerHTML = `<option value="">Select State</option><option value="il">Illinois</option><option value="ny">New York</option>`; }, 0));
cascadingState.addEventListener("change", () => setTimeout(() => { cascadingCity.innerHTML = `<option value="">Select City</option><option value="chi">Chicago</option><option value="den">Denver</option>`; }, 0));
const cascadingReport = await runListingAutofillAsync(accountProfile);
assert.equal(cascadingCountry.value, "us", "cascading Country should be selected first");
assert.equal(cascadingState.value, "il", "cascading State should be selected after options refresh");
assert.equal(cascadingCity.value, "chi", "cascading City should be selected after options refresh");
assert.equal(value("organization"), accountProfile.businessName, "cascading form Organization should map");
assert.equal(value("address"), accountProfile.address, "cascading form Address Line 1 should receive street only");
assert.equal(value("address2"), "", "cascading form Address Line 2 should remain blank");
assert.equal(value("postal"), accountProfile.postalCode, "cascading form Postal Code should map");
assert.equal(value("profile"), accountProfile.shortDescription, "cascading form Profile/Bio should use Short Description");
assert.equal(cascadingReport.manual.some((item) => item.includes("Human input required")), false, "normal cascading mappings should not ask for human input");

win.happyDOM.setURL("https://adaptive-listing.example/category");
win.document.open();
win.document.write(`<h1>Select Category</h1><a href="/testing">Testing</a><a href="/finance">Finance</a>`);
win.document.close();
const adaptiveCategoryReport = runListingAutofill(profile);
assert.equal(adaptiveCategoryReport.category?.status, "selected", "unknown-site category should use actual options");

win.happyDOM.setURL("https://fdlclassifieds.com/post");
win.document.open();
win.document.write(`<h1>Please select a category to post to</h1><a href="/digital">Digital Items</a><a href="/community">Community</a><a href="/services">Services</a><a href="/entertainment">Entertainment</a><a href="/sale">For Sale</a><a href="/property">Property</a><a href="/jobs">Jobs</a>`);
win.document.close();
const charmingProfile = { ...profile, businessName: "Charming Skin Vein Clinics", category: "Medical Clinic", services: ["Vein Clinics", "Skin Care"], description: "Medical vein and skin clinic services." };
const fdlCategoryReport = runListingAutofill(charmingProfile);
assert.equal(fdlCategoryReport.category?.level, "category", "fdl-style prompt should be detected as category");
assert.equal(fdlCategoryReport.category?.status, "selected", "fdl-style category should select a real option");
assert.equal(fdlCategoryReport.category?.label, "Services", "Charming Skin Vein Clinics should choose the strongest real category option");

win.document.open();
win.document.write(`<h1>Please select a subcategory</h1><a href="/medical">Medical Clinics</a><a href="/beauty">Beauty</a><a href="/restaurants">Restaurants</a>`);
win.document.close();
const fdlSubcategoryReport = runListingAutofill(charmingProfile);
assert.equal(fdlSubcategoryReport.category?.level, "subcategory", "fdl-style next page should be detected as subcategory");
assert.equal(fdlSubcategoryReport.category?.status, "selected", "fdl-style subcategory should select a real option");
assert.equal(fdlSubcategoryReport.category?.label, "Medical Clinics", "subcategory should use the profile medical evidence");

win.document.open();
win.document.write(`<form><label>Business Name<input name="company"></label><label>Public Business Email<input name="public_email"></label><label>Services<input name="services"></label><label>Description<div aria-label="Description" contenteditable="true"></div></label><label>Fax<input name="fax" required></label><button type="submit">Submit</button></form>`);
win.document.close();
const adaptiveFormReport = runListingAutofill({ ...profile, email: "public@example.test", services: ["Surveying"] });
assert.equal(adaptiveFormReport.adaptive?.stage, "FORM", "unknown current forms should use generic form discovery");
assert.equal(value("company"), profile.businessName, `unknown current forms should fill business name without an adapter: ${JSON.stringify(adaptiveFormReport)}`);
assert.equal(value("public_email"), "public@example.test", "unknown current forms should fill available profile email");
assert.ok((win.document.querySelector('[contenteditable="true"]')?.textContent || "").includes(profile.description), "unknown current forms should verify rich-text description content");
assert.ok(adaptiveFormReport.skipped.some((entry) => entry.descriptor.includes('name="fax"') && entry.reason.includes("unmapped")), "truly unmappable fields should remain blank and be reported");
assert.ok(adaptiveFormReport.manual.some((entry) => entry.includes("Final Submit")), "unknown current form final submit should remain manual");

function attachSubmitFlag(): () => boolean {
  let submitted = false;
  const form = win.document.querySelector("form");
  assert.ok(form, "form should exist");
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    submitted = true;
  });
  return () => submitted;
}

// --- test-form.html: standard labels -----------------------------------------
loadPage("test-form.html");
const submittedStandard = attachSubmitFlag();
const report1 = runAutofill(profile);

const filledFields1 = report1.filled.map((entry) => entry.field).sort();
assert.deepEqual(
  filledFields1,
  ["businessName", "contactName", "email", "phone", "website"],
  `standard form should fill all five slots, got: ${JSON.stringify(report1.filled)}`,
);

assert.equal(value("business_name"), profile.businessName);
assert.equal(value("contact_name"), profile.contactName);
assert.equal(value("email"), profile.email);
assert.equal(value("phone"), profile.phone);
assert.equal(value("website"), profile.website);

assert.equal(value("fax"), "", "fax must not be filled");
assert.equal(value("captcha"), "", "captcha must not be filled");
assert.equal(value("search"), "", "search must not be filled");
assert.equal(submittedStandard(), false, "autofill must never submit the form");

const terms = win.document.querySelector('[name="terms"]') as unknown as HTMLInputElement;
const newsletter = win.document.querySelector('[name="newsletter"]') as unknown as HTMLInputElement;
assert.equal(terms.checked, false, "terms checkbox must not be checked");
assert.equal(newsletter.checked, false, "newsletter checkbox must not be checked");

// --- test-form-variants.html: name/placeholder-only signals -------------------
loadPage("test-form-variants.html");
const submittedVariants = attachSubmitFlag();
const report2 = runAutofill(profile);

assert.equal(value("company"), profile.businessName, "placeholder Company -> businessName");
assert.equal(value("contact_person"), profile.contactName, "contact person -> contactName");
assert.equal(value("user_email"), profile.email, "user_email -> email");
assert.equal(value("telephone_number"), profile.phone, "telephone_number -> phone");
assert.equal(value("company_email"), "", "ambiguous company_email must not be filled");

const websiteInput = win.document.querySelector(
  'input[placeholder="Website URL"]',
) as unknown as HTMLInputElement;
assert.equal(websiteInput.value, profile.website, "placeholder Website URL -> website");

const nameSkip = report2.skipped.find((entry) => entry.descriptor.includes('name="name"'));
assert.ok(nameSkip, 'bare "name" field should be reported as skipped (slot already filled)');

const ambiguousSkip = report2.skipped.find((entry) =>
  entry.descriptor.includes('name="company_email"'),
);
assert.ok(ambiguousSkip?.reason.includes("slot \"email\" already filled"), `company_email should remain unmapped after the profile email slot is used: ${JSON.stringify(ambiguousSkip)}`);

win.document.open();
win.document.write(`<form><label>User Name<input name="user_name"></label><label>Submission Email<input name="submission_email" type="email"></label></form>`);
win.document.close();
const usernameReport = runAutofill(profile);
assert.equal(value("user_name"), profile.username, "User Name should receive Username");
assert.equal(value("submission_email"), profile.email, "explicit email field should receive Submission Email");
assert.equal(usernameReport.filled.some((entry) => entry.field === "username"), true, "Username should be reported as filled");

win.document.open();
win.document.write(`<form><label>Blog Name<input id="field-user" name="username" type="email"></label><label>Email<input id="field-email" name="email" type="email"></label></form>`);
win.document.close();
const usernameEmailPrecedenceReport = runAutofill(profile);
assert.equal(value("username"), profile.username, "explicit username semantics must outrank email input type");
assert.equal(value("email"), profile.email, "explicit email field must receive Submission Email");
assert.equal(usernameEmailPrecedenceReport.filled.find((entry) => entry.descriptor.includes('name="username"'))?.field, "username", "username field must be reported as Username");

win.document.open();
win.document.write(`<form><label>Title<input name="title"></label><label>Post<textarea name="post"></textarea></label><button type="submit">Publish</button></form>`);
win.document.close();
const postReport = runListingAutofill(profile);
assert.equal(value("title"), profile.businessName, "post title should receive Business Name");
assert.equal(value("post"), `${profile.imageUrl}\n\n${profile.description}`, "post editor should receive Image URL, blank line, and Long Description");
assert.ok(postReport.manual.includes("Final Submit"), "Publish must remain manual");

win.document.open();
win.document.write(`<form><label>Article<textarea name="article"></textarea></label></form>`);
win.document.close();
const noImageProfile = { ...profile, imageUrl: "" };
runListingAutofill(noImageProfile);
assert.equal(value("article"), profile.description, "post editor without Image URL should receive only Long Description");

win.document.open();
win.document.write(`<form><label>Article<div id="rich-editor" contenteditable="true" aria-label="Article editor"></div></label></form>`);
win.document.close();
runListingAutofill(profile);
const richEditor = win.document.querySelector("#rich-editor") as unknown as HTMLElement;
assert.equal(richEditor.querySelector("img")?.getAttribute("src"), profile.imageUrl, "contenteditable post editor image should render from the Image URL");
assert.equal(richEditor.textContent?.includes(profile.description), true, "contenteditable post editor should receive the composed description");
assert.equal((richEditor.textContent || "").includes(profile.imageUrl), false, "contenteditable post editor must not show the raw Image URL as text");

// Plain-text URLs in a contenteditable rich editor become clickable links; ordinary words stay plain.
win.document.open();
win.document.write(`<form><label>Article<div id="rich-editor" contenteditable="true" aria-label="Article editor"></div></label></form>`);
win.document.close();
runListingAutofill({ ...profile, description: "See https://example.com/services for details. Roofing services available." });
const linkedEditor = win.document.querySelector("#rich-editor") as unknown as HTMLElement;
assert.equal(linkedEditor.querySelector("a[href]")?.getAttribute("href"), "https://example.com/services", "plain https URL in a rich editor should become a clickable link with the exact href");
assert.equal(linkedEditor.querySelector("a[href]")?.textContent, "https://example.com/services", "visible URL text must stay unchanged");
assert.equal(linkedEditor.textContent?.includes("Roofing services available."), true, "ordinary keywords must stay plain text");
assert.equal(linkedEditor.querySelectorAll("a[href]").length, 1, "ordinary keywords must not be turned into links");

win.document.open();
win.document.write(`<form><label>Description<textarea name="description"></textarea></label></form>`);
win.document.close();
const hybridProfile = { ...profile, description: `<p>Morgan Hill Junk Removal</p><p><a href="https://example.com/morgan-hill-junk-removal/">Morgan Hill Junk Removal</a></p>` };
runListingAutofill(hybridProfile);
assert.equal(value("description"), "Morgan Hill Junk Removal\n\nMorgan Hill Junk Removal", "textarea must receive plain text with HTML tags stripped");
assert.equal(value("description").includes(hybridProfile.imageUrl), false, "plain Description must never include the Image URL");
assert.equal(value("description").includes("<"), false, "plain Description must never include raw HTML tags");

win.document.open();
win.document.write(`<form><label>Article<div id="rich-editor" contenteditable="true" aria-label="Article editor"></div></label></form>`);
win.document.close();
runListingAutofill(hybridProfile);
const hybridEditor = win.document.querySelector("#rich-editor") as unknown as HTMLElement;
assert.equal(hybridEditor.querySelector('a[href="https://example.com/morgan-hill-junk-removal/"]')?.textContent, "Morgan Hill Junk Removal", "contenteditable must preserve anchor href and visible text");
assert.equal(hybridEditor.querySelectorAll("a[href]").length, 1, "contenteditable must not double-wrap existing anchors");

win.document.open();
win.document.write(`<form><label>Title<input type="text" name="post_title" id="title"></label><textarea id="content" name="content"></textarea><iframe id="content_ifr" data-id="content"></iframe><button type="submit">Publish</button></form>`);
win.document.close();
const tinyMceContent = { value: "", saved: false, events: [] as string[], setContent(value: string) { this.value = value; }, save() { this.saved = true; }, fire(event: string) { this.events.push(event); } };
g.tinymce = { get: (id: string) => id === "content" ? tinyMceContent : null };
const tinyMceReport = runListingAutofill(profile);
const expectedTinyMceHtml = `<img src="${profile.imageUrl}" alt="" /><p><br></p><p>${profile.description}</p>`;
assert.equal(value("post_title"), profile.businessName, "post_title should map to Business Name");
assert.equal(tinyMceContent.value, expectedTinyMceHtml, "TinyMCE runtime should receive HTML image content");
assert.equal((win.document.querySelector("#content") as unknown as HTMLTextAreaElement).value, expectedTinyMceHtml, "TinyMCE textarea model should stay synchronized with HTML");
assert.match(tinyMceContent.value, /<img src="https:\/\/images\.mahid\.test\/business\.jpg" alt="" \/>/, "Image URL must become an img element");
assert.equal(tinyMceContent.value.includes(profile.imageUrl), true, "TinyMCE HTML should retain the image source attribute");
assert.equal(tinyMceContent.value.includes(`>${profile.imageUrl}<`), false, "Image URL must not be visible as text");
assert.equal(tinyMceContent.saved, true, "TinyMCE model should be saved to its textarea");
assert.ok(tinyMceContent.events.includes("change"), "TinyMCE change event should be fired");
assert.ok(tinyMceReport.filled.some((entry) => entry.descriptor === "TinyMCE content"), "TinyMCE mapping should be reported");

const htmlDescription = `<p>Description paragraph</p><p>Address: 1 Test Street<br>Phone: +1 555 0100<br>Primary site: <a href="https://mahid.test">mahid.test</a></p><p><br></p><p>Recommended Profiles:</p><p><a href="https://facebook.com/mahid">Facebook</a> <a href="https://linkedin.com/company/mahid">LinkedIn</a></p><p>Monday<br>Tuesday</p><p><a href="https://example.com/keyword">hyperlinked keyword</a> with existing spacing</p>`;
win.document.open();
win.document.write(`<form><label>Title<input type="text" name="post_title" id="title"></label><textarea id="content" name="content"></textarea><button type="submit">Publish</button></form>`);
win.document.close();
const htmlProfile = { ...profile, description: htmlDescription };
tinyMceContent.value = "";
tinyMceContent.saved = false;
tinyMceContent.events = [];
runListingAutofill(htmlProfile);
const htmlParsed = win.document.createElement("div");
htmlParsed.innerHTML = tinyMceContent.value;
assert.equal(htmlParsed.querySelector("img")?.getAttribute("src"), profile.imageUrl, "TinyMCE should render the image");
assert.equal(htmlParsed.querySelector('a[href="https://mahid.test"]')?.textContent, "mahid.test", "description hyperlink should remain clickable");
assert.equal(htmlParsed.querySelector('a[href="https://example.com/keyword"]')?.textContent, "hyperlinked keyword", "hyperlinked keyword should remain an anchor");
assert.equal(htmlParsed.querySelectorAll("a[href]").length, 4, "all description anchors should remain real anchors");
assert.equal((tinyMceContent.value.match(/<p><br><\/p>/g) || []).length, 2, "composed and existing blank paragraph spacing should be preserved");

// Plain-text Long Description must keep paragraph breaks and line breaks (no collapse).
const plainTextDescription = "First paragraph line one.\nSecond line of the first paragraph.\n\nSecond paragraph.\n\n\nThird paragraph.";
win.document.open();
win.document.write(`<form><label>Title<input type="text" name="post_title" id="title"></label><textarea id="content" name="content"></textarea><button type="submit">Publish</button></form>`);
win.document.close();
tinyMceContent.value = "";
tinyMceContent.saved = false;
tinyMceContent.events = [];
runListingAutofill({ ...profile, description: plainTextDescription });
const expectedPlainHtml = `<img src="${profile.imageUrl}" alt="" /><p><br></p><p>First paragraph line one.<br>Second line of the first paragraph.</p><p>Second paragraph.</p><p>Third paragraph.</p>`;
assert.equal(tinyMceContent.value, expectedPlainHtml, "plain-text Long Description should preserve paragraph and line-break spacing");
assert.equal((tinyMceContent.value.match(/<p>/g) || []).length, 4, "plain-text Long Description must not collapse into one paragraph");

// Windows/CRLF Long Description must not collapse paragraph spacing.
win.document.open();
win.document.write(`<form><label>Title<input type="text" name="post_title" id="title"></label><textarea id="content" name="content"></textarea><button type="submit">Publish</button></form>`);
win.document.close();
tinyMceContent.value = "";
runListingAutofill({ ...profile, description: "Windows line one.\r\nWindows line two.\r\n\r\nWindows second paragraph." });
assert.equal(tinyMceContent.value, `<img src="${profile.imageUrl}" alt="" /><p><br></p><p>Windows line one.<br>Windows line two.</p><p>Windows second paragraph.</p>`, "CRLF Long Description should preserve paragraph and line-break spacing");

// Existing HTML anchors, href values, and spacing must be preserved and stay clickable.
const linkedHtmlDescription = `<p>Primary site: <a href="https://mahid.test/a?x=1&y=2">mahid.test</a></p><p><br></p><p>Recommended Profiles:</p><p><a href="https://facebook.com/mahid">Facebook</a> <a href="https://linkedin.com/company/mahid">LinkedIn</a></p><p>Keyword: <a href="https://example.com/keyword">hyperlinked keyword</a> with spacing</p>`;
win.document.open();
win.document.write(`<form><label>Title<input type="text" name="post_title" id="title"></label><textarea id="content" name="content"></textarea><button type="submit">Publish</button></form>`);
win.document.close();
tinyMceContent.value = "";
runListingAutofill({ ...profile, description: linkedHtmlDescription });
const linkedParsed = win.document.createElement("div");
linkedParsed.innerHTML = tinyMceContent.value;
assert.equal(linkedParsed.querySelector('a[href="https://mahid.test/a?x=1&y=2"]')?.getAttribute("href"), "https://mahid.test/a?x=1&y=2", "primary href must stay exactly intact");
assert.equal(linkedParsed.querySelector('a[href="https://mahid.test/a?x=1&y=2"]')?.textContent, "mahid.test", "primary link must stay clickable");
assert.equal(linkedParsed.querySelector('a[href="https://facebook.com/mahid"]')?.textContent, "Facebook", "social link must stay an anchor");
assert.equal(linkedParsed.querySelector('a[href="https://example.com/keyword"]')?.textContent, "hyperlinked keyword", "keyword link must stay clickable");
assert.equal(linkedParsed.querySelectorAll("a[href]").length, 4, "existing anchors must not be double-wrapped");
assert.equal((tinyMceContent.value.match(/<p><br><\/p>/g) || []).length, 2, "HTML blank-line spacing must be preserved");

// Exact post-body structure: image, paragraphs, address, phone, clickable primary site,
// separated social links, separated hours, and clickable keyword links.
const structuredDescription = `<p>Long description paragraph one.</p><p>Long description paragraph two.</p><p><br></p><p>Address: 1 Test Street, Testville, TS 12345, Testland</p><p>Phone: +1 555 0100</p><p>Primary site: <a href="https://mahid.test">mahid.test</a></p><p><br></p><p>Recommended Profiles:</p><p><a href="https://facebook.com/mahid">Facebook</a></p><p><a href="https://instagram.com/mahid">Instagram</a></p><p><a href="https://youtube.com/mahid">YouTube</a></p><p><a href="https://linkedin.com/company/mahid">LinkedIn</a></p><p><br></p><pre>Monday        8AM-5PM\nTuesday       8AM-5PM\nWednesday     8AM-5PM\nThursday      8AM-5PM\nFriday        8AM-5PM\nSaturday      8AM-5PM\nSunday        8AM-5PM</pre><p><br></p><p><a href="https://example.com/keyword-one">keyword one</a>, <a href="https://example.com/keyword-two">keyword two</a></p>`;
const structuredArticleProfile = { ...profile, businessHours: [
  "Monday 8AM-5PM",
  "Tuesday 8AM-5PM",
  "Wednesday 8AM-5PM",
  "Thursday 8AM-5PM",
  "Friday 8AM-5PM",
  "Saturday Closed",
  "Sunday Closed",
] };
win.document.open();
win.document.write(`<form><label>Title<input type="text" name="post_title" id="title"></label><textarea id="content" name="content"></textarea><button type="submit">Publish</button></form>`);
win.document.close();
tinyMceContent.value = "";
tinyMceContent.saved = false;
tinyMceContent.events = [];
const structuredReport = runListingAutofill({ ...structuredArticleProfile, description: structuredDescription });
const structuredParsed = win.document.createElement("div");
structuredParsed.innerHTML = tinyMceContent.value;
assert.equal(structuredParsed.querySelector("img")?.getAttribute("src"), profile.imageUrl, "image must render as an img element");
assert.equal((structuredParsed.textContent || "").includes(profile.imageUrl), false, "image URL must never appear as visible text");
assert.equal(structuredParsed.querySelector('a[href="https://mahid.test"]')?.textContent, "mahid.test", "Primary site must stay a clickable link");
assert.equal(structuredParsed.querySelectorAll("a[href]").length, 7, "all links must remain real anchors");
assert.equal(Array.from(structuredParsed.querySelectorAll("a[href]")).some((anchor) => /6d28d9/i.test(anchor.getAttribute("style") || "")), false, "external output must not apply app violet styling");
assert.equal(Array.from(structuredParsed.querySelectorAll('a[href*="facebook.com"], a[href*="instagram.com"], a[href*="youtube.com"], a[href*="linkedin.com"]')).every((anchor) => anchor.parentElement?.tagName.toLowerCase() === "p" && anchor.parentElement.querySelectorAll("a").length === 1), true, "each social link must stay a separate clickable block");
const hoursTable = structuredParsed.querySelector("table");
assert.ok(hoursTable, "Business Hours should render as a semantic table");
assert.equal(hoursTable?.querySelectorAll("tbody tr").length, 7, "Business Hours should render one row per saved day");
assert.equal(hoursTable?.querySelectorAll("th[scope=col]").length, 0, "Business Hours should not render a visible header row");
assert.equal(hoursTable?.querySelector("tbody tr th")?.textContent, "Monday", "Business Hours table should preserve the day name");
assert.equal(hoursTable?.querySelector("tbody tr th")?.getAttribute("style"), "font-weight:normal;text-align:left", "Business Hours day cells should be normal-weight and left-aligned");
assert.equal(hoursTable?.querySelector("tbody tr td")?.textContent, "8AM-5PM", "Business Hours table should preserve the original hours");
assert.equal(hoursTable?.querySelector("tbody tr td")?.getAttribute("style"), "text-align:left", "Business Hours values should be left-aligned in the second column");
assert.equal(hoursTable?.querySelector("tbody tr:nth-child(6) td")?.textContent, "Closed", "Business Hours table should preserve closed status");
assert.equal(structuredParsed.querySelectorAll("pre").length, 0, "Business Hours should no longer use a fragile preformatted block");
assert.equal(structuredParsed.querySelector('a[href="https://example.com/keyword-one"]')?.textContent, "keyword one", "keyword links must stay clickable with their commas/spaces");
assert.equal(structuredParsed.querySelector('a[href="https://example.com/keyword-two"]')?.textContent, "keyword two", "second keyword link must stay clickable");
assert.equal((tinyMceContent.value.match(/<p><br><\/p>/g) || []).length, 5, "blank-line block spacing must be preserved");
assert.equal((tinyMceContent.value.match(/<p>/g) || []).length, 16, "sections must not collapse into one block");
assert.ok(structuredReport.filled.some((entry) => entry.descriptor === "TinyMCE content"), "structured TinyMCE body should be reported as filled");

// Plain-text URLs in the TinyMCE body become clickable links; ordinary words stay plain.
win.document.open();
win.document.write(`<form><label>Title<input type="text" name="post_title" id="title"></label><textarea id="content" name="content"></textarea><button type="submit">Publish</button></form>`);
win.document.close();
tinyMceContent.value = "";
runListingAutofill({ ...profile, description: "Visit https://example.com/page for more. Call us for roofing services." });
const plainUrlParsed = win.document.createElement("div");
plainUrlParsed.innerHTML = tinyMceContent.value;
assert.equal(plainUrlParsed.querySelector('a[href="https://example.com/page"]')?.textContent, "https://example.com/page", "plain https URL should become a clickable anchor with the exact href");
assert.equal(plainUrlParsed.querySelector('a[href="https://example.com/page"]')?.hasAttribute("style"), false, "external output must not style converted URLs");
assert.equal(plainUrlParsed.querySelectorAll("a[href]").length, 1, "ordinary keywords must not be turned into links");
assert.equal(plainUrlParsed.textContent?.includes("roofing services"), true, "ordinary keyword text must be preserved");

// Plain URLs inside HTML description content (not plain text) must also become real violet anchors.
win.document.open();
win.document.write(`<form><label>Title<input type="text" name="post_title" id="title"></label><textarea id="content" name="content"></textarea><button type="submit">Publish</button></form>`);
win.document.close();
tinyMceContent.value = "";
runListingAutofill({ ...profile, description: `<p>Recommended Profiles:</p><p>https://www.facebook.com/example</p>` });
const htmlUrlParsed = win.document.createElement("div");
htmlUrlParsed.innerHTML = tinyMceContent.value;
assert.equal(htmlUrlParsed.querySelector('a[href="https://www.facebook.com/example"]')?.textContent, "https://www.facebook.com/example", "plain URL inside HTML content must become a real anchor");
assert.equal(htmlUrlParsed.querySelector('a[href="https://www.facebook.com/example"]')?.hasAttribute("style"), false, "external output must not style converted URLs");

// Existing Active Profile anchors are preserved exactly and already-linked URLs are not double-wrapped.
const alreadyLinked = `<p>Primary site: <a href="https://mahid.test/page?x=1&y=2">https://mahid.test/page?x=1&y=2</a></p><p>Keyword: <a href="https://example.com/keyword">linked keyword</a></p>`;
win.document.open();
win.document.write(`<form><label>Title<input type="text" name="post_title" id="title"></label><textarea id="content" name="content"></textarea><button type="submit">Publish</button></form>`);
win.document.close();
tinyMceContent.value = "";
runListingAutofill({ ...profile, description: alreadyLinked });
const alreadyParsed = win.document.createElement("div");
alreadyParsed.innerHTML = tinyMceContent.value;
assert.equal(alreadyParsed.querySelectorAll("a[href]").length, 2, "already-linked URLs must not be double-wrapped");
assert.equal(alreadyParsed.querySelector('a[href="https://mahid.test/page?x=1&y=2"]')?.getAttribute("href"), "https://mahid.test/page?x=1&y=2", "linked URL href must stay exactly intact");
assert.equal(alreadyParsed.querySelector('a[href="https://mahid.test/page?x=1&y=2"]')?.textContent, "https://mahid.test/page?x=1&y=2", "linked URL visible text must stay unchanged");
assert.equal(alreadyParsed.querySelector('a[href="https://example.com/keyword"]')?.textContent, "linked keyword", "linked keyword must keep its href");
assert.equal(Array.from(alreadyParsed.querySelectorAll("a[href]")).some((anchor) => /6d28d9/i.test(anchor.getAttribute("style") || "")), false, "external output must not restyle preserved anchors");

// Pasted Google Docs hypertext: visible words stay, hidden href stays, violet style applied.
win.document.open();
win.document.write(`<form><label>Title<input type="text" name="post_title" id="title"></label><textarea id="content" name="content"></textarea><button type="submit">Publish</button></form>`);
win.document.close();
tinyMceContent.value = "";
runListingAutofill({ ...profile, description: `<p>Morgan Hill Junk Removal</p><p><a href="https://example.com/morgan-hill-junk-removal/">Morgan Hill Junk Removal</a></p>` });
const pastedParsed = win.document.createElement("div");
pastedParsed.innerHTML = tinyMceContent.value;
const pastedAnchor = pastedParsed.querySelector('a[href="https://example.com/morgan-hill-junk-removal/"]');
assert.equal(pastedAnchor?.textContent, "Morgan Hill Junk Removal", "pasted hypertext must keep the visible words, not the raw URL");
assert.equal(pastedAnchor?.getAttribute("href"), "https://example.com/morgan-hill-junk-removal/", "pasted hypertext must keep the exact href");
assert.equal(pastedAnchor?.hasAttribute("style"), false, "external output must not apply app styling to pasted hypertext");
assert.equal(pastedParsed.textContent?.includes("https://example.com/morgan-hill-junk-removal/"), false, "the raw URL must not appear as visible text");

// Link creation must not change paragraph or line-break spacing.
win.document.open();
win.document.write(`<form><label>Title<input type="text" name="post_title" id="title"></label><textarea id="content" name="content"></textarea><button type="submit">Publish</button></form>`);
win.document.close();
tinyMceContent.value = "";
runListingAutofill({ ...profile, description: "Line one https://example.com\nLine two\n\nSecond paragraph https://mahid.test" });
const spacingParsed = win.document.createElement("div");
spacingParsed.innerHTML = tinyMceContent.value;
assert.equal(spacingParsed.querySelectorAll("p").length, 3, "link creation must preserve paragraph spacing");
assert.equal((tinyMceContent.value.match(/<br>/g) || []).length, 2, "link creation must preserve line-break spacing");
assert.equal(spacingParsed.querySelectorAll("a[href]").length, 2, "both plain URLs must become links");
assert.equal(spacingParsed.querySelector('a[href="https://example.com"]')?.textContent, "https://example.com", "visible URL text must stay unchanged");

// Real content-script path: the page TinyMCE global is unreachable from an isolated
// content script and some editors expose only the editor iframe, so the composed
// structure must still reach the editor body and be reported as filled.
delete g.tinymce;
win.document.open();
win.document.write(`<form><label>Title<input type="text" name="post_title" id="title"></label><iframe id="content_ifr" data-id="content"></iframe><button type="submit">Publish</button></form>`);
win.document.close();
const isolatedFrame = win.document.querySelector("#content_ifr") as unknown as HTMLIFrameElement;
const isolatedBody = isolatedFrame.contentDocument?.body;
assert.ok(isolatedBody, "TinyMCE iframe body must be reachable from the content script");
isolatedBody!.setAttribute("contenteditable", "true");
const isolatedReport = runListingAutofill({ ...structuredArticleProfile, description: structuredDescription });
assert.ok(isolatedReport.filled.some((entry) => entry.descriptor === "TinyMCE content"), "iframe-only editor must be reported as filled from the iframe fallback");
assert.equal(isolatedBody!.querySelectorAll('a[href]').length, 7, "iframe-only editor must keep all seven clickable links (primary + 4 social + 2 keyword)");
assert.equal(isolatedBody!.querySelectorAll("table tbody tr").length, 7, "iframe-only editor must keep the Business Hours table");
assert.equal(isolatedBody!.textContent?.includes("keyword one"), true, "iframe-only editor must keep the clickable keyword links");
assert.equal(isolatedBody!.textContent?.includes(profile.imageUrl), false, "iframe-only editor must not show the raw image URL as text");

// --- CKEditor 4: runtime path (CKEDITOR.instances available) ------------------
win.happyDOM.setURL("https://ckeditor.example/post");
win.document.open();
win.document.write(`<form><label>Title<input type="text" name="post_title" id="title"></label><textarea id="content" name="content"></textarea><button type="submit">Publish</button></form>`);
win.document.close();
const ckTextarea = win.document.querySelector("#content") as unknown as HTMLTextAreaElement;
const ckRuntime = { value: "", events: [] as string[], updateElement() { ckTextarea.value = this.value; }, setData(value: string) { this.value = value; }, fire(event: string) { this.events.push(event); } };
g.CKEDITOR = { instances: { content: ckRuntime } };
const ckReport = runListingAutofill({ ...structuredArticleProfile, description: structuredDescription });
assert.equal(value("post_title"), profile.businessName, "CKEditor Title must map to Business Name");
const ckParsed = win.document.createElement("div");
ckParsed.innerHTML = ckRuntime.value;
assert.equal(ckParsed.querySelector("img")?.getAttribute("src"), profile.imageUrl, "CKEditor must render the Image URL as an <img>");
assert.equal(ckRuntime.value.includes(profile.imageUrl) && !ckRuntime.value.includes(`>${profile.imageUrl}<`), true, "CKEditor image URL must be a src attribute, not visible text");
assert.equal(ckParsed.querySelector('a[href="https://mahid.test"]')?.textContent, "mahid.test", "CKEditor Primary site must stay clickable");
assert.equal(ckParsed.querySelector('a[href="https://example.com/keyword-one"]')?.textContent, "keyword one", "CKEditor keyword hypertext must be preserved");
assert.equal(ckParsed.querySelectorAll("a[href]").length, 7, "CKEditor must keep all seven links");
assert.equal(Array.from(ckParsed.querySelectorAll("a[href]")).some((anchor) => /6d28d9/i.test(anchor.getAttribute("style") || "")), false, "CKEditor output must not inject app violet styling");
assert.equal(ckParsed.querySelectorAll("table tbody tr").length, 7, "CKEditor hours must render as seven table rows");
assert.equal(ckParsed.querySelector("table tbody tr:nth-child(6) td")?.textContent, "Closed", "CKEditor must preserve the closed status");
assert.equal((ckRuntime.value.match(/<p><br><\/p>/g) || []).length, 5, "CKEditor must preserve blank-line section spacing");
assert.equal(ckTextarea.value, ckRuntime.value, "CKEditor updateElement must synchronize the backing textarea");
assert.ok(ckRuntime.events.includes("change"), "CKEditor change event must fire");
assert.ok(ckReport.filled.some((entry) => entry.descriptor === "CKEditor content"), "CKEditor body must be reported as filled");
assert.ok(ckReport.manual.includes("Final Submit"), "CKEditor Publish must remain manual");
delete g.CKEDITOR;

// --- CKEditor 4: iframe fallback (runtime unreachable, e.g. isolated content script) ---
win.happyDOM.setURL("https://ckeditor-frame.example/post");
win.document.open();
win.document.write(`<form><label>Title<input type="text" name="post_title" id="title"></label><div class="cke_contents"><iframe class="cke_wysiwyg_frame"></iframe></div><button type="submit">Publish</button></form>`);
win.document.close();
const ckFrame = win.document.querySelector("iframe.cke_wysiwyg_frame") as unknown as HTMLIFrameElement;
const ckFrameBody = ckFrame.contentDocument?.body;
assert.ok(ckFrameBody, "CKEditor iframe body must be reachable from the content script");
ckFrameBody!.setAttribute("contenteditable", "true");
ckFrameBody!.classList.add("cke_editable");
const ckFrameReport = runListingAutofill({ ...structuredArticleProfile, description: structuredDescription });
assert.equal(value("post_title"), profile.businessName, "CKEditor iframe Title must map to Business Name");
assert.ok(ckFrameReport.filled.some((entry) => entry.descriptor === "CKEditor content"), "CKEditor iframe-only editor must be reported as filled");
assert.equal(ckFrameBody!.querySelector("img")?.getAttribute("src"), profile.imageUrl, "CKEditor iframe must render the image as an <img>");
assert.equal(ckFrameBody!.querySelectorAll('a[href]').length, 7, "CKEditor iframe must keep all seven clickable links");
assert.equal(ckFrameBody!.querySelectorAll("table tbody tr").length, 7, "CKEditor iframe must keep the Business Hours table");
assert.equal(ckFrameBody!.textContent?.includes("keyword one"), true, "CKEditor iframe must keep the clickable keyword hypertext");
assert.equal(ckFrameBody!.textContent?.includes(profile.imageUrl), false, "CKEditor iframe must not show the raw image URL as text");
assert.ok(ckFrameReport.manual.includes("Final Submit"), "CKEditor iframe Publish must remain manual");

// --- writer textarea receives the plain-text Long Description (no image, no HTML) ---
win.happyDOM.setURL("https://writer.example/post");
win.document.open();
win.document.write(`<form><textarea id="writer" placeholder="Write..." class="norm" autofocus></textarea><button type="submit">Publish</button></form>`);
win.document.close();
const writerDescription = `<p>Morgan Hill Junk Removal provides hauling.</p><p><a href="https://example.com/morgan-hill-junk-removal/">Morgan Hill Junk Removal</a></p><p>Call today.</p><p>Thanks.</p>`;
const writerReport = runListingAutofill({ ...profile, description: writerDescription, shortDescription: "Short only text." });
const writerValue = (win.document.querySelector("#writer") as unknown as HTMLTextAreaElement).value;
assert.equal(writerValue, "Morgan Hill Junk Removal provides hauling.\n\nMorgan Hill Junk Removal\n\nCall today.\n\nThanks.", "writer must receive the plain-text Long Description with blank lines");
assert.equal(writerValue.includes("<"), false, "writer must not contain raw <a>/<p>/<br> tags");
assert.equal(writerValue.includes(profile.imageUrl), false, "writer must not contain the Image URL");
assert.equal(writerValue.includes("Short only text."), false, "writer must not use Short Description");
assert.equal(writerValue.includes("Morgan Hill Junk Removal"), true, "anchor HTML must become visible text only");
assert.ok(writerReport.manual.includes("Final Submit"), "writer Publish must remain manual");

// --- live writer runtime: bare body > textarea#writer with no <form> ---
win.happyDOM.setURL("https://writer-pad.example/");
win.document.open();
win.document.write(`<body id="pad" class="light"><textarea id="writer" placeholder="Write..." class="norm" autofocus></textarea></body>`);
win.document.close();
const padWriter = win.document.querySelector("#writer") as unknown as HTMLTextAreaElement;
let padEvents = { input: 0, change: 0, blur: 0 };
padWriter.addEventListener("input", () => { padEvents.input += 1; });
padWriter.addEventListener("change", () => { padEvents.change += 1; });
padWriter.addEventListener("blur", () => { padEvents.blur += 1; });
const padProfile = { ...profile, description: `<p>First paragraph.</p><p><a href="https://example.com/x">Visible link text</a></p><p>Last paragraph.</p>`, shortDescription: "SHORT ONLY", imageUrl: "https://images.mahid.test/business.jpg" };
const padReport = await runListingAutofillAsync(padProfile);
assert.equal(padReport.adaptive?.stage, "FORM", "bare body > textarea#writer must classify as FORM");
assert.equal(padReport.manual.includes("Human input required"), false, "the writer form must not fall back to Human input");
assert.equal(padWriter.value, "First paragraph.\n\nVisible link text\n\nLast paragraph.", "#writer must receive the plain-text Long Description with blank lines");
assert.equal(padWriter.value.includes("<"), false, "#writer must not contain raw HTML tags");
assert.equal(padWriter.value.includes(padProfile.imageUrl), false, "#writer must not contain the Image URL");
assert.equal(padWriter.value.includes("SHORT ONLY"), false, "#writer must not use Short Description");
assert.deepEqual(padEvents, { input: 1, change: 1, blur: 1 }, "#writer must dispatch input, change, and blur");
assert.ok(padReport.filled.some((entry) => entry.field === "description" && entry.descriptor.includes('id="writer"')), "#writer fill must be reported as Description with its descriptor");

// --- #writer must NEVER receive the Image URL, even when body text matches post/editor heuristics ---
win.happyDOM.setURL("https://writer-image.example/");
win.document.open();
win.document.write(`<body id="pad" class="light">Rich content editor<textarea id="writer" placeholder="Write..." class="norm" autofocus></textarea></body>`);
win.document.close();
const imgWriterProfile = { ...profile, imageUrl: "https://images.mahid.test/business.jpg", description: `<p>Body paragraph.</p><p><a href="https://example.com/x">Link text</a></p>`, shortDescription: "SHORT ONLY" };
const imgWriterReport = await runListingAutofillAsync(imgWriterProfile);
const imgWriter = win.document.querySelector("#writer") as unknown as HTMLTextAreaElement;
assert.equal(imgWriter.value.includes(imgWriterProfile.imageUrl), false, "#writer must NEVER contain the Image URL");
assert.equal(imgWriter.value, "Body paragraph.\n\nLink text", "#writer must contain only the plain-text Long Description");
assert.equal(imgWriter.value.includes("SHORT ONLY"), false, "#writer must not use Short Description");
assert.equal(imgWriter.value.includes("<"), false, "#writer must not contain raw HTML");
assert.ok(imgWriterReport.filled.some((entry) => entry.field === "description" && entry.descriptor.includes('id="writer"')), "#writer must be reported as Description, not a post editor");

win.document.open();
win.document.write(`<form><label>Domain<input name="domain"></label></form>`);
win.document.close();
const lowConfidenceReport = runAutofill(profile);
assert.equal(value("domain"), profile.website, "a low-confidence but unique website match should fill automatically");
assert.ok(lowConfidenceReport.filled.some((entry) => entry.field === "website"), "low-confidence mapping should be reported as filled");

assert.equal(submittedVariants(), false, "autofill must never submit the form");

win.document.open();
win.document.write(`<form><label>Organization<input id="organization" name="organization"></label><label>Country<select id="country" name="country"><option value="">Select Country</option><option value="testland">Testland</option></select></label><label>State<select id="state" name="state"><option value="">Select State</option><option value="other">Other</option></select></label><span validationgroup="CustomerForm" controltovalidate="state">State is required</span><button id="update-profile" type="button">Update Profile</button></form>`);
win.document.close();
let updateClicks = 0;
let nativeBlurEvents = 0;
win.document.querySelector("#update-profile")?.addEventListener("click", () => { updateClicks += 1; });
win.document.querySelector("#organization")?.addEventListener("blur", () => { nativeBlurEvents += 1; });
win.document.querySelector("#country")?.addEventListener("blur", () => { nativeBlurEvents += 1; });
const aspReport = runListingAutofill(profile);
assert.equal(value("organization"), profile.businessName, "ASP.NET Organization should be filled");
assert.equal(value("country"), "testland", "ASP.NET Country select should be filled");
assert.ok(nativeBlurEvents >= 2, "filled ASP.NET text/select controls should receive blur events");
assert.ok(aspReport.manual.some((entry) => entry.includes("CustomerForm blocked by: State")), "ASP.NET CustomerForm validator diagnostics should name blocked State");
assert.equal(updateClicks, 0, "Update Profile must remain manual");

// --- floating AUTOFILL button --------------------------------------------------
win.happyDOM.setURL("https://directory.example/");
win.document.open();
win.document.write("<main>Listing page</main>");
win.document.close();
savedFloatingPosition = undefined;
floatingMessages = 0;
const floatingHost = installFloatingAutofillButton();
assert.ok(floatingHost, "normal webpages receive a floating button");
assert.equal(win.document.querySelectorAll(`#${FLOATING_BUTTON_ID}`).length, 1, "exactly one floating button exists");
assert.equal(installFloatingAutofillButton(), floatingHost, "SPA rerenders do not duplicate the button");
const floatingButton = floatingHost?.shadowRoot?.querySelector("button") as HTMLButtonElement;
floatingButton.dispatchEvent(new win.Event("click", { bubbles: true }) as unknown as Event);
await Promise.resolve();
assert.equal(floatingMessages, 0, 'synthetic webpage click cannot authorize continuous actions');
const trustedFloatingClick = () => {
  const click = new win.Event('click', { bubbles: true });
  Object.defineProperty(click, 'isTrusted', { value: true }); // unit fixture; native trust checked separately
  floatingButton.dispatchEvent(click as unknown as Event);
};
trustedFloatingClick();
await Promise.resolve();
assert.equal(floatingMessages, 1, "floating click uses the popup start workflow message");
floatingStartResponse = { ok: false, error: "No active profile. Open the dashboard." };
trustedFloatingClick();
await new Promise((resolve) => setTimeout(resolve, 0));
assert.match(floatingHost?.shadowRoot?.querySelector(".status")?.textContent || "", /No active profile/, "floating startup failures must be visible to the operator");
assert.equal(floatingMessages, 2, "floating startup failure should still be returned through the same command path");
floatingStartResponse = { ok: true };

const pointer = (type: string, x: number, y: number): Event => {
  const event = new win.Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, { pointerId: { value: 1 }, clientX: { value: x }, clientY: { value: y } });
  return event as unknown as Event;
};
floatingButton.dispatchEvent(pointer("pointerdown", 100, 100));
floatingButton.dispatchEvent(pointer("pointermove", 20, 40));
floatingButton.dispatchEvent(pointer("pointerup", 20, 40));
trustedFloatingClick();
await Promise.resolve();
assert.equal(floatingMessages, 2, "dragging does not trigger autofill");
const draggedPosition = savedFloatingPosition as unknown as { left: number; top: number };
assert.equal(draggedPosition.left, Number.parseFloat(floatingHost?.style.left || "0"), "drag changes horizontal position");
assert.equal(draggedPosition.top, Number.parseFloat(floatingHost?.style.top || "0"), "drag changes vertical position");
assert.deepEqual(clampFloatingButtonPosition({ left: -100, top: 9999 }, 400, 300, 108, 42), { left: 16, top: 242 }, "position clamps inside the viewport");

savedFloatingRun = createListingRun("https://generic-blog.test/login", profile.id, 42);
savedFloatingRun.autoPublish = true;
savedFloatingRun.stage = "MANUAL_GATE";
savedFloatingRun.manual = ["CAPTCHA", "SIGN IN / LOGIN"];
trustedFloatingClick();
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(floatingButton.textContent, "AUTOFILL", "one context-aware action keeps the same label");
assert.match(floatingHost?.shadowRoot?.querySelector(".status")?.textContent || "", /CAPTCHA/);
savedFloatingRun.registration = { url: 'https://generic-blog.test/signup', state: 'waiting-human', reason: 'CAPTCHA' };
trustedFloatingClick();
await new Promise(resolve => setTimeout(resolve, 0));
assert.doesNotMatch(floatingHost?.shadowRoot?.querySelector('.status')?.textContent || '', /complete.*human|CAPTCHA/i);
floatingStartResponse = { ok: true, message: 'Login fields filled only. Earlier registration remains unresolved.' };
trustedFloatingClick();
await new Promise(resolve => setTimeout(resolve, 0));
assert.match(floatingHost?.shadowRoot?.querySelector('.status')?.textContent || '', /filled only/);
floatingStartResponse = { ok: true };
savedFloatingRun = undefined;

win.document.open();
win.document.write("<main>Reloaded listing page</main>");
win.document.close();
const restoredHost = installFloatingAutofillButton();
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(restoredHost?.style.left, `${draggedPosition.left}px`, "saved position restores after navigation");
assert.equal(restoredHost?.style.top, `${draggedPosition.top}px`, "saved vertical position restores after navigation");

win.happyDOM.setURL("http://localhost:3000/");
win.document.open();
win.document.write("<main>Dashboard</main>");
win.document.close();
assert.equal(installFloatingAutofillButton(), null, "dashboard does not receive the floating button");
win.happyDOM.setURL("chrome://settings/");
assert.equal(installFloatingAutofillButton(), null, "browser-internal pages do not receive the floating button");

// --- explicit rendered website capture ---------------------------------------
win.happyDOM.setURL("https://www.precisionsurveyingandconsulting.com/");
win.document.open();
win.document.write(`<html><head><title>Precision Surveying &amp; Consulting | Home</title><meta name="description" content="Precision Surveying provides land surveying services."></head><body><h1>Precision Surveying &amp; Consulting</h1><h2>Services</h2><h3>Construction Staking</h3><h3>As-Builting</h3><p>info@precisionsurvey.tech</p><p>(402) 278-1666</p><p>3803 North 153rd Street Suite 100-101</p><p>Omaha, NE 68116</p><p>Monday-Friday: 7:00 AM-5:00 PM</p><p>Closed Saturday and Sunday</p><a href="/data-center-surveying/">Data Center Surveying</a></body></html>`);
win.document.close();
const captured = captureCurrentSource();
assert.ok(captured, "rendered website should produce a snapshot");
assert.equal(captured?.facts.businessName, "Precision Surveying & Consulting");
assert.equal(captured?.facts.email, "info@precisionsurvey.tech");
assert.equal(captured?.facts.city, "Omaha");
assert.equal(captured?.facts.stateCode, "NE");
assert.ok((captured?.facts.services?.length || 0) >= 2 && (captured?.facts.services?.length || 0) <= 10);
assert.equal(captured?.facts.businessHours?.length, 7);
assert.equal(captured?.internalLinks.length, 1);
assert.equal(captured?.internalLinks[0]?.url, "https://www.precisionsurveyingandconsulting.com/data-center-surveying");
const timeoutResult = await withTimeout(new Promise<string>(() => undefined), 10, "retry");
assert.equal(timeoutResult, "retry", "capture timeout must settle");
assert.equal(await withTimeout(Promise.resolve("success"), 50, "retry"), "success", "successful capture must resolve");

// --- listing form mapping and safety gates -----------------------------------
win.happyDOM.setURL("https://directory3.org/");
win.document.open();
win.document.write(`<nav><a href="/submit.php">Submit Links</a><a href="/search">Submit Search</a></nav>`);
win.document.close();
const discoveryReport = runListingAutofill(profile);
assert.equal(discoveryReport.navigationUrl, "https://directory3.org/submit.php", "safe listing entry should be discovered");

// Generic semantic fixture is not the native Directory3 form.
win.happyDOM.setURL("https://generic-directory.example/submit.php");
win.document.open();
win.document.write(`<form><div class="field"><label for="title">Title</label><input id="title" name="title"></div><div class="field"><label for="url">URL</label><input id="url" name="url"></div><div class="field"><label for="description">Description</label><textarea id="description" name="description"></textarea></div><div class="field"><label for="your-name">Your Name</label><input id="your-name" name="your_name"></div><div class="field"><label for="your-email">Your Email</label><input id="your-email" name="your_email"></div><div class="field"><label for="category">Category</label><select id="category" name="category"><option value="">Select Category</option><option value="testing">Testing</option><option value="other">Other</option></select></div><label for="reciprocal">Reciprocal Link URL</label><input id="reciprocal" name="reciprocal"><div id="captcha">CAPTCHA</div><button type="submit">Continue</button></form>`);
win.document.close();
const listingReport = runListingAutofill(profile);
assert.deepEqual(listingReport.filled.map((entry) => entry.field).sort(), ["businessName", "category", "contactName", "description", "email", "website"].sort(), JSON.stringify(listingReport));
assert.equal((win.document.querySelector("#title") as unknown as HTMLInputElement).value, profile.businessName);
assert.equal((win.document.querySelector("#your-email") as unknown as HTMLInputElement).value, profile.email);
assert.equal((win.document.querySelector("#category") as unknown as HTMLSelectElement).value, "testing");
assert.equal((win.document.querySelector("#reciprocal") as unknown as HTMLInputElement).value, "", "reciprocal link must remain manual");
assert.ok(listingReport.manual.includes("Final Submit"), "final submit must remain manual");

// --- FreeWebAds form preparation ---------------------------------------------
const freeWebAdsProfile = { ...profile, city: "Chicago", state: "Illinois", country: "United States", instagram: "https://instagram.com/current-business", description: "Chicago business description." };
win.happyDOM.setURL("https://freewebads.biz/post");
win.document.open();
win.document.write(`<form><label>Title<input name="title"></label><label>Location<select name="location"><option value="">Choose location</option><option value="other">(Other)</option></select></label><label>or specify <input name="location_other"></label><label>Post<textarea name="post"></textarea></label><label><input type="radio" name="contact" value="form">Do not display my email but allow users to contact me through the contact form</label><label><input type="checkbox" name="commercial">People can contact me with commercial interests.</label><label><input type="checkbox" name="terms">I agree to the Terms of Use</label><input type="submit" value="Post Now"></form>`);
win.document.close();
const freeWebAdsReport = runListingAutofill(freeWebAdsProfile);
assert.equal((win.document.querySelector('[name="location"]') as unknown as HTMLSelectElement).value, "other", "FreeWebAds should select (Other) location");
assert.equal((win.document.querySelector('[name="location_other"]') as unknown as HTMLInputElement).value, "Chicago, IL", "FreeWebAds should derive the state abbreviation");
assert.match((win.document.querySelector('[name="location_other"]') as unknown as HTMLInputElement).value, /^[^,]+,\s[A-Z]{2}$/, "FreeWebAds location should remain City, ST");
assert.equal((win.document.querySelector('[name="post"]') as unknown as HTMLTextAreaElement).value, freeWebAdsProfile.description, "FreeWebAds should fill the Post editor");
assert.equal((win.document.querySelector('[name="contact"]') as unknown as HTMLInputElement).checked, true, "FreeWebAds contact-form radio should be checked");
assert.equal((win.document.querySelector('[name="commercial"]') as unknown as HTMLInputElement).checked, true, "FreeWebAds commercial interests checkbox should be checked");
assert.equal((win.document.querySelector('[name="terms"]') as unknown as HTMLInputElement).checked, false, "FreeWebAds Terms checkbox must remain human-controlled without approval");
assert.ok(freeWebAdsReport.manual.includes("Post Now"), "FreeWebAds final Post Now action must remain manual");

// --- classified family form: direct Location, logo-only picture upload, exact consent checks ---
const classifiedProfile = {
  ...profile,
  city: "San Juan Capistrano",
  state: "California",
  stateCode: "CA",
  country: "United States",
  address: "123 Classified Street",
  completeAddress: "123 Classified Street, San Juan Capistrano, CA 92675, United States",
  postalCode: "92675",
  description: "Classified Long Description.",
  logoAsset: { id: "classified-logo", fileName: "business-logo.png", mimeType: "image/png", size: 10 },
  brochureAsset: { id: "classified-brochure", fileName: "business-brochure.pdf", mimeType: "application/pdf", size: 10 },
};
win.happyDOM.setURL("https://fdlclassifieds.com/index.php?view=post&subcatid=services");
win.document.open();
win.document.write(`<form>
  <label>Title<input name="title"></label>
  <table><tr><td>Location</td><td><input name="location" type="text"></td></tr></table>
  <label>Post<textarea name="post"></textarea></label>
  <label>Email<input name="email" type="email"></label>
  <label>Category<select name="category"><option value="">Select Category</option><option value="testing">Testing</option></select></label>
  <div>Upload Pictures<input id="picture-upload" name="pictures" type="file" accept="image/*"></div>
  <div>Upload Brochure<input id="brochure-upload" name="brochure" type="file" accept="application/pdf"></div>
  <div>Your Photo<input id="profile-photo" name="photo" type="file" accept="image/*"></div>
  <label><input name="commercial" type="checkbox">People can contact me with commercial interests.</label>
  <label><input name="terms" type="checkbox">I agree to the terms of use by making a post</label>
  <label><input name="marketing" type="checkbox">Send me marketing emails</label>
  <div>CAPTCHA</div>
  <button id="classified-submit" type="submit">Post Now</button>
</form>`);
win.document.close();
let classifiedSubmitted = false;
win.document.querySelector("form")?.addEventListener("submit", (event) => { event.preventDefault(); classifiedSubmitted = true; });
const classifiedReport = runListingAutofill(classifiedProfile);
assert.equal(classifiedReport.form?.location?.value, "San Juan Capistrano, CA", "classified Location should use City and state abbreviation");
assert.equal((win.document.querySelector('[name="location"]') as unknown as HTMLInputElement).value, "San Juan Capistrano, CA", "classified Location should receive City, ST only");
assert.equal((win.document.querySelector('[name="post"]') as unknown as HTMLTextAreaElement).value, classifiedProfile.description, "classified Post should receive Long Description");
assert.equal((win.document.querySelector('[name="post"]') as unknown as HTMLTextAreaElement).value.includes(classifiedProfile.imageUrl), false, "classified Post should not receive Image URL");
assert.equal((win.document.querySelector('[name="commercial"]') as unknown as HTMLInputElement).checked, true, "classified commercial-interests checkbox should be checked");
assert.equal((win.document.querySelector('[name="terms"]') as unknown as HTMLInputElement).checked, false, "classified Terms checkbox must remain human-controlled without approval");
assert.equal((win.document.querySelector('[name="marketing"]') as unknown as HTMLInputElement).checked, false, "unrelated marketing checkbox must remain unchanged");
const classifiedLogoInput = findLogoInputs(win.document as unknown as Document)[0];
assert.equal(classifiedLogoInput?.id, "picture-upload", "Upload Pictures should be the Business Logo target");
let classifiedLogoFiles: File[] = [];
Object.defineProperty(classifiedLogoInput, "files", { configurable: true, get: () => classifiedLogoFiles, set: (files: File[]) => { classifiedLogoFiles = files; } });
const classifiedLogoResult = await attachLogoToLiveInput(win.document as unknown as Document, new TextEncoder().encode("classified-logo").buffer, classifiedProfile.logoAsset.fileName, classifiedProfile.logoAsset.mimeType, 0);
assert.equal(classifiedLogoResult.ok, true, `Upload Pictures should retain the Business Logo: ${JSON.stringify(classifiedLogoResult)}`);
assert.equal(classifiedLogoFiles.length, 1, "Upload Pictures should retain exactly one Business Logo file");
assert.equal(classifiedLogoFiles[0].name, classifiedProfile.logoAsset.fileName, "Upload Pictures should retain the Business Logo filename");
assert.equal((win.document.querySelector("#brochure-upload") as unknown as HTMLInputElement).files?.length || 0, 0, "Brochure must never be attached to Upload Pictures");
assert.equal((win.document.querySelector("#profile-photo") as unknown as HTMLInputElement).files?.length || 0, 0, "Personal photo must remain untouched");
assert.equal(classifiedSubmitted, false, "classified final Post action must remain manual");
assert.ok(classifiedReport.manual.includes("CAPTCHA"), "classified CAPTCHA must remain manual");

// --- Directory3 URL authority and low-confidence category safety -------------
const junkProfile = { ...profile, businessName: "No Limit Hauling And Junk Removal", contactName: "Jordan", website: "https://nolimit.example", description: "Junk removal services.", shortDescription: "Junk removal.", category: "Junk removal services", services: ["Junk Removal", "Furniture Removal", "Cleanouts", "Hauling"] };
win.happyDOM.setURL("https://directory3.org/submit.php");
win.document.open();
win.document.write(`<form method="post" action=""><table><tr><td>Title</td><td><input id="listing-title" name="TITLE"></td></tr><tr><td>*URL:</td><td><span>Smarty error: validate: validator id 'v_URL_ONLINE' is not registered</span><input id="listing-url" name="URL" type="text"></td></tr><tr><td>Description</td><td><textarea id="listing-description" name="DESCRIPTION"></textarea></td></tr><tr><td>Your Name</td><td><input id="listing-name" name="OWNER_NAME"></td></tr><tr><td>Your Email</td><td><input id="listing-email" name="OWNER_EMAIL"></td></tr><tr><td>Category</td><td><select id="listing-category" name="CATEGORY_ID"><option value="top">[Top]</option><option value="disabled" disabled>Junk Removal</option><optgroup label="Services"><option value="waste">Waste Management</option></optgroup><option value="finance">Financial Services</option></select></td></tr><tr><td>Reciprocal Link URL</td><td><input id="reciprocal" name="RECPR_URL" type="text"></td></tr></table><div id="captcha">CAPTCHA</div><input type="submit" name="submit" value="Continue"></form>`);
win.document.close();
const liveCategorySelect = win.document.querySelector("#listing-category") as unknown as HTMLSelectElement;
let liveCategoryInputEvents = 0;
let liveCategoryChangeEvents = 0;
liveCategorySelect.addEventListener("input", () => { liveCategoryInputEvents += 1; });
liveCategorySelect.addEventListener("change", () => { liveCategoryChangeEvents += 1; });
assert.equal(liveCategorySelect.value, "top", "live category should start at [Top]");
const junkReport = runListingAutofill(junkProfile);
assert.equal((win.document.querySelector("#listing-url") as unknown as HTMLInputElement).value, junkProfile.website, "Directory3 URL must use active profile website");
assert.equal((win.document.querySelector("#listing-category") as unknown as HTMLSelectElement).value, "waste", "related category should be selected from actual options");
assert.ok(junkReport.filled.some((entry) => entry.field === "category" && entry.value === "Waste Management"), "category report should expose chosen label");
assert.equal(liveCategoryInputEvents, 1, "live category selection should dispatch input");
assert.equal(liveCategoryChangeEvents, 1, "live category selection should dispatch change");
assert.ok(junkReport.manual.includes("Final Submit"), "final Continue/Submit must remain manual");
assert.ok(junkReport.manual.includes("CAPTCHA"), "CAPTCHA must remain manual");

// Sibling directory-template forms must use the same generic URL/category path.
const siblingTemplateCases = [
  { host: "deepbluedirectory.com", active: junkProfile, options: `<option value="0">[Top]</option><option value="1785">Waste Management</option><option value="3000">Roofing</option>`, expected: "1785", label: "Waste Management" },
  { host: "addirectory.org", active: { ...junkProfile, category: "Roofing", services: ["Roof Repair"] }, options: `<option value="0">[Top]</option><option value="1785">Waste Management</option><option value="3000">Roofing</option>`, expected: "3000", label: "Roofing" },
  { host: "ad-links.org", active: profile, options: `<option value="0">[Top]</option><option value="1785">Waste Management</option>`, expected: "0", label: "[Top]" },
];
for (const sibling of siblingTemplateCases) {
  win.happyDOM.setURL(`https://${sibling.host}/submit.php`);
  win.document.open();
  win.document.write(`<form><label>URL<input name="URL" type="text"></label><label>Category<select name="CATEGORY_ID">${sibling.options}</select></label><div id="captcha">CAPTCHA</div><button type="submit">Continue</button></form>`);
  win.document.close();
  const siblingReport = runListingAutofill(sibling.active);
  if (getF03Directory(win.location.href)) {
    // This legacy two-control mock is not the verified six-field POST form.
    // Registered F03 must refuse it, rather than invoke generic mapping.
    assert.equal(siblingReport.filled.length, 0, "Incomplete F03 structure must fail closed");
    assert.equal((win.document.querySelector('input[name="URL"]') as unknown as HTMLInputElement).value, "");
    assert.equal((win.document.querySelector('select[name="CATEGORY_ID"]') as unknown as HTMLSelectElement).value, "0");
    assert.ok(siblingReport.manual.some(reason => /Missing or ambiguous native listing form/.test(reason)));
    continue;
  }
  assert.equal((win.document.querySelector('input[name="URL"]') as unknown as HTMLInputElement).value, sibling.active.website, `${sibling.host} URL should receive the exact Active Profile Website`);
  assert.equal((win.document.querySelector('select[name="CATEGORY_ID"]') as unknown as HTMLSelectElement).value, sibling.expected, `${sibling.host} should select ${sibling.label} from real options`);
  assert.ok(siblingReport.manual.includes("CAPTCHA"), `${sibling.host} CAPTCHA must remain manual`);
  assert.ok(siblingReport.manual.includes("Final Submit"), `${sibling.host} Continue/Submit must remain manual`);
  assert.ok(siblingReport.adaptive?.diagnostics.some((entry) => entry.startsWith("URL → website → filled/verified")), `${sibling.host} diagnostics should verify URL mapping`);
   assert.ok(siblingReport.adaptive?.diagnostics.some((entry) => sibling.expected === "0" ? entry.startsWith("CATEGORY_ID → not selected → failed") : entry.startsWith(`CATEGORY_ID → ${sibling.label} → filled/verified`)), `${sibling.host} diagnostics should report category result`);
}

// A People Directory category recovery runs after normal autofill and discovers the opaque value through Playwright inspection.
win.happyDOM.setURL("http://apeopledirectory.com/submit.php");
win.document.open();
win.document.write(`<form><label>URL<input name="URL" type="text"></label><label>Category<select name="CATEGORY_ID"><option value="0">[Top]</option></select></label><div id="captcha">CAPTCHA</div><button type="submit">Continue</button></form>`);
win.document.close();
const aPeopleCategory = win.document.querySelector('select[name="CATEGORY_ID"]') as unknown as HTMLSelectElement;
let aPeopleCategoryInputEvents = 0;
let aPeopleCategoryChangeEvents = 0;
aPeopleCategory.addEventListener("input", () => { aPeopleCategoryInputEvents += 1; });
aPeopleCategory.addEventListener("change", () => { aPeopleCategoryChangeEvents += 1; });
const aPeopleReport = runListingAutofill(junkProfile);
assert.equal(aPeopleCategory.value, "0", "apeopledirectory.com normal autofill should leave the unavailable category at [Top]");
const aPeopleTargetOption = win.document.createElement("option");
aPeopleTargetOption.value = "opaque-commercial";
aPeopleTargetOption.textContent = "Commercial Contractors";
aPeopleCategory.appendChild(aPeopleTargetOption as unknown as Node);
const originalFetch = globalThis.fetch;
const playwrightRequests: string[] = [];
globalThis.fetch = (async (input, init) => {
  const requestUrl = new URL(String(input));
  playwrightRequests.push(requestUrl.pathname);
  const payload = JSON.parse(String(init?.body || "{}")) as { expectedValue?: string; expectedText?: string };
  const response = requestUrl.pathname === "/inspect-select"
    ? { found: true, name: "CATEGORY_ID", id: "", currentValue: "0", currentText: "[Top]", optionCount: 2, options: [{ text: "[Top]", value: "0" }, { text: "Commercial Contractors", value: "opaque-commercial" }] }
    : { found: true, verified: payload.expectedValue === "opaque-commercial" && payload.expectedText === "Commercial Contractors", currentValue: payload.expectedValue, currentText: payload.expectedText, valueMatches: true, textMatches: true };
  return new Response(JSON.stringify(response), { status: 200, headers: { "content-type": "application/json" } });
}) as typeof fetch;
try {
  await recoverApeopleCategoryWithPlaywright(aPeopleReport);
} finally {
  globalThis.fetch = originalFetch;
}
assert.equal((win.document.querySelector('input[name="URL"]') as unknown as HTMLInputElement).value, junkProfile.website, "apeopledirectory.com URL should retain normal active-profile mapping");
assert.equal(aPeopleCategory.value, "opaque-commercial", "apeopledirectory.com should select the existing Commercial Contractors option without a hardcoded ID");
assert.equal(aPeopleCategory.selectedOptions[0]?.textContent?.replace(/\s+/g, " ").trim(), "Commercial Contractors", "apeopledirectory.com should verify the visible category label");
assert.equal(aPeopleCategoryInputEvents, 1, "apeopledirectory.com category selection should dispatch input");
assert.equal(aPeopleCategoryChangeEvents, 1, "apeopledirectory.com category selection should dispatch change");
assert.equal(playwrightRequests.filter((path) => path === "/inspect-select").length, 1, "apeopledirectory.com recovery should inspect exactly once");
assert.equal(playwrightRequests.filter((path) => path === "/verify-field").length, 1, "apeopledirectory.com recovery should verify exactly once");
assert.ok(playwrightRequests.includes("/diagnostics"), "apeopledirectory.com recovery should emit temporary category telemetry");
assert.ok(aPeopleReport.filled.some((entry) => entry.field === "category" && entry.value === "Commercial Contractors"), "apeopledirectory.com recovery should report the normalized target label");
assert.ok(aPeopleReport.adaptive?.diagnostics.includes("Category: before = [Top]; recovery = Playwright-assisted; target = Commercial Contractors; verified = true"), "apeopledirectory.com recovery diagnostics should report verified success");
assert.ok(aPeopleReport.manual.includes("CAPTCHA"), "apeopledirectory.com CAPTCHA must remain manual");
assert.ok(aPeopleReport.manual.includes("Final Submit"), "apeopledirectory.com final Continue/Submit must remain manual");

win.happyDOM.setURL("https://freewebads.biz/post");
win.document.open();
win.document.write(`<form><label for="uncertain-title">Title</label><input id="uncertain-title" name="title"><label for="uncertain-category">Category</label><select id="uncertain-category" name="category"><option value="top">[Top]</option><option value="one">Professional Services</option><option value="two">Commercial Services</option></select></form>`);
win.document.close();
const uncertainReport = runListingAutofill(junkProfile);
assert.equal((win.document.querySelector("#uncertain-category") as unknown as HTMLSelectElement).value, "top", "low-confidence category must remain unchanged");
assert.ok(uncertainReport.skipped.some((entry) => entry.reason.includes("Category requires manual selection")), "low-confidence category should be manual");

const run = createListingRun("https://directory3.org/", profile.id, 42);
assert.equal(run.stage, "DISCOVER");
assert.equal(run.domain, "directory3.org");
assert.ok(run.steps.includes("Directory3 recognized"), "Directory3 run should identify the site before navigation");
assert.equal(updateListingRun(run, { stage: "NAVIGATING", navigationCount: 1 }).navigationCount, 1, "listing run state should survive navigation updates");
const persistedOneClick = updateListingRun(run, { stage: "NAVIGATING", navigationTarget: "https://clone.example/?view=selectcity", expectedStage: "LOCATION", action: "Entry href ready for background navigation" });
assert.equal(isListingRunActive(persistedOneClick), true, "persisted one-click navigation run must remain active while popup is closed");
assert.equal(persistedOneClick.expectedStage, "LOCATION", "next expected stage must persist before navigation");
const recoveredAfterWorkerRestart = updateListingRun(persistedOneClick, { navigationVerified: true, resumed: true, steps: [...persistedOneClick.steps, "Service worker recovered persisted navigation", "Run resumed"] });
assert.equal(isListingRunActive(recoveredAfterWorkerRestart), true, "worker recovery must preserve the same active run");
assert.ok(recoveredAfterWorkerRestart.steps.includes("Run resumed"), "worker recovery must persist resume diagnostics");
assert.equal(isListingRunActive(updateListingRun(recoveredAfterWorkerRestart, { stage: "COMPLETE" })), false, "completed run must not be restarted as active");

// --- category confidence, profile switching, and learned mapping --------------
let inputEvents = 0;
let changeEvents = 0;
const learnedCategory = { profileKey: normalizeCategoryKey(junkProfile.category), value: "waste", label: "Waste Management" };
win.document.open();
win.document.write(`<form><label>Title<input name="title"></label><label>Category<select id="learned-category" name="category"><option value="top">[Top]</option><option value="waste">Waste Management</option><option value="home">Home Services</option></select></label></form>`);
win.document.close();
const learnedSelect = win.document.querySelector("#learned-category") as unknown as HTMLSelectElement;
learnedSelect.addEventListener("input", () => { inputEvents += 1; });
learnedSelect.addEventListener("change", () => { changeEvents += 1; });
const learnedReport = runListingAutofill(junkProfile, learnedCategory);
assert.equal(learnedSelect.value, "waste", "existing category mapping should be reused when the option exists");
assert.ok(learnedReport.filled.some((entry) => entry.value === "Waste Management"), "learned category report should contain the visible option label");
assert.ok(learnedSelect.selectedIndex > 0 && learnedSelect.selectedOptions[0]?.textContent !== "[Top]");
assert.equal(inputEvents, 1, "category input event should be dispatched");
assert.equal(changeEvents, 1, "category change event should be dispatched");

win.document.open();
win.document.write(`<form><label>Title<input name="title"></label><label>Category<select id="rematched-category" name="category"><option value="top">[Top]</option><option value="home">Home Services</option><option value="finance">Financial Services</option></select></label></form>`);
win.document.close();
const rematchedReport = runListingAutofill(junkProfile, learnedCategory);
assert.equal((win.document.querySelector("#rematched-category") as unknown as HTMLSelectElement).value, "home", "stale learned category should rematch against current options");
assert.ok(rematchedReport.filled.some((entry) => entry.field === "category"), "rematched category should be reported");

win.document.open();
win.document.write(`<form><label>Title<input name="title"></label><label>Category<select id="home-fallback" name="category"><option value="top">[Top]</option><option value="automotive">Automotive</option><option value="home">Home</option><option value="business">Business</option></select></label></form>`);
win.document.close();
const homeFallbackReport = runListingAutofill(junkProfile);
assert.equal((win.document.querySelector("#home-fallback") as unknown as HTMLSelectElement).value, "home", "Home should be selected as the defensible junk-removal parent");
assert.ok(homeFallbackReport.filled.some((entry) => entry.value === "Home"), "parent fallback should report the real label");

win.document.open();
win.document.write(`<form><label>Title<input name="title"></label><label>Category<select id="waste-over-home" name="category"><option value="top">[Top]</option><option value="home">Home</option><option value="waste">Waste Management</option><option value="automotive">Automotive</option></select></label></form>`);
win.document.close();
runListingAutofill(junkProfile);
assert.equal((win.document.querySelector("#waste-over-home") as unknown as HTMLSelectElement).value, "waste", "closer waste category should beat Home parent");

const roofingProfile = { ...junkProfile, category: "Roofing services", services: ["Roof repair"] };
win.document.open();
win.document.write(`<form><label>Title<input name="title"></label><label>Category<select id="profile-category" name="CATEGORY_ID"><option value="top">[Top]</option><option value="waste">Waste Management</option><option value="roof">Roofing</option></select></label></form>`);
win.document.close();
runListingAutofill(roofingProfile);
assert.equal((win.document.querySelector("#profile-category") as unknown as HTMLSelectElement).value, "roof", "a different active profile should choose its own category");

// --- generic category select: exact, normalized, semantic, and no-match safety -
const directJunkProfile = { ...junkProfile, category: "Junk Removal", services: ["Hauling"] };
win.document.open();
win.document.write(`<form><label>Category<select id="direct-category" name="category"><option value="">Choose category</option><option value="roof">Roofing</option><option value="junk">Junk Removal</option><option value="landscape">Landscaping</option></select></label></form>`);
win.document.close();
let directInputEvents = 0;
let directChangeEvents = 0;
const directSelect = win.document.querySelector("#direct-category") as unknown as HTMLSelectElement;
directSelect.addEventListener("input", () => { directInputEvents += 1; });
directSelect.addEventListener("change", () => { directChangeEvents += 1; });
runListingAutofill(directJunkProfile);
assert.equal(directSelect.value, "junk", "exact active category should be selected from actual options");
assert.equal(directInputEvents, 1, "generic category selection should dispatch input");
assert.equal(directChangeEvents, 1, "generic category selection should dispatch change");

win.document.open();
win.document.write(`<form><label>Business Category<select id="punctuated-category" name="business_type"><option value="">Choose category</option><option value="junk-waste">Junk &amp; Waste Removal</option><option value="roof">Roofing</option></select></label></form>`);
win.document.close();
runListingAutofill(directJunkProfile);
assert.equal((win.document.querySelector("#punctuated-category") as unknown as HTMLSelectElement).value, "junk-waste", "punctuation variant should use the strong active category match");

const hvacProfile = { ...directJunkProfile, category: "HVAC", services: ["Heating and cooling"] };
win.document.open();
win.document.write(`<form><label>Category<select id="semantic-category" name="category"><option value="">Choose category</option><option value="roof">Roofing</option><option value="hvac">Heating &amp; Air Conditioning</option></select></label></form>`);
win.document.close();
runListingAutofill(hvacProfile);
assert.equal((win.document.querySelector("#semantic-category") as unknown as HTMLSelectElement).value, "hvac", "strong semantic category variant should match actual option");

const staleProfile = { ...directJunkProfile, category: "Solar Panel Installation", services: ["Solar Panels"], businessName: "Solar Example" };
win.document.open();
win.document.write(`<form><label>Category<select id="no-match-category" name="category"><option value="">Choose category</option><option value="roof">Roofing</option><option value="hvac">HVAC</option></select></label></form>`);
win.document.close();
const noMatchCategoryReport = runListingAutofill(staleProfile);
assert.equal((win.document.querySelector("#no-match-category") as unknown as HTMLSelectElement).value, "", "unrelated options must remain unchanged and no category may be invented");
assert.ok(noMatchCategoryReport.manual.some((entry) => entry.includes("Category requires manual selection")), "unmatched category should be reported as manual");

const recipeStore: Record<string, unknown> = {};
g.chrome = { storage: { local: { get: async (key: string) => ({ [key]: recipeStore[key] }), set: async (value: Record<string, unknown>) => Object.assign(recipeStore, value) } } };
await recordSiteFlowSuccess("https://directory3.org/", "https://directory3.org/submit.php", learnedCategory, {
  verificationStatus: "live-verified",
  entryBehavior: "homepage-submit-links",
  fieldMappings: { Title: "Business Name", URL: "Website" },
  categoryBehavior: "profile-category-services-semantic",
  formSignature: "listing-title-url-description-your-name-your-email-category",
  manualGates: ["Reciprocal Link URL", "CAPTCHA", "Final Continue / Submit"],
});
assert.equal((await getSiteCategoryMapping("https://directory3.org/", junkProfile.category))?.value, "waste", "successful category mapping should be persisted by profile concept");
const storedRecipe = recipeStore["ba2.siteFlowRecipes"] as { lastSuccessfulAt?: string; verificationStatus?: string; entryBehavior?: string; formSignature?: string; manualGates?: string[] }[];
assert.equal(storedRecipe[0]?.verificationStatus, "live-verified", "recipe should preserve verification status");
assert.equal(storedRecipe[0]?.entryBehavior, "homepage-submit-links", "recipe should preserve entry behavior");
assert.equal(storedRecipe[0]?.formSignature, "listing-title-url-description-your-name-your-email-category", "recipe should preserve structural form signature");
assert.deepEqual(storedRecipe[0]?.manualGates, ["Reciprocal Link URL", "CAPTCHA", "Final Continue / Submit"]);
assert.ok(storedRecipe[0]?.lastSuccessfulAt, "recipe should record lastSuccessfulAt");

win.happyDOM.setURL("https://theobloggers.com/register");
win.document.open();
win.document.write(`<form><label>BLOG NAME <input name="blog_name"><span>.THEOBLOGGERS.COM</span></label><label>YOUR EMAIL<input name="registration_email" type="email"></label><label>PASSWORD<input name="registration_password" type="password"></label><button type="submit">REGISTER &amp; CREATE</button></form>`);
win.document.close();
const registrationReport = runListingAutofill(accountProfile);
assert.equal(value("blog_name"), accountProfile.username, "registration Blog Name with domain suffix should receive Username exactly");
assert.equal(value("registration_email"), accountProfile.email, "registration email should receive Submission Email");
assert.equal(value("registration_password"), accountProfile.password, "registration password should receive saved Password");
assert.ok(registrationReport.manual.includes("Final Submit"), "REGISTER & CREATE must remain manual");

win.happyDOM.setURL("https://bleepblogs.com/register");
win.document.open();
win.document.write(`<form><label for="bleep-blog">Blog Name</label><input id="bleep-blog" name="blog_name"><span>.bleepblogs.com</span><label for="bleep-email">Your Email</label><input id="bleep-email" name="your_email" type="email"><label for="bleep-password">Password</label><input id="bleep-password" name="password" type="password"><label>Puzzle CAPTCHA<input name="captcha_answer"></label><input id="bleep-captcha" type="checkbox" name="captcha"><button id="bleep-register" type="submit">Register &amp; Create</button></form>`);
win.document.close();
let bleepRegisterClicks = 0;
win.document.querySelector("#bleep-register")?.addEventListener("click", () => { bleepRegisterClicks += 1; });
const bleepRegistrationReport = runListingAutofill(accountProfile);
assert.equal(value("blog_name"), accountProfile.username, "Blog Name with external domain suffix must receive Username");
assert.equal(value("your_email"), accountProfile.email, "Your Email must receive Submission Email when Blog Name is present");
assert.equal(value("password"), accountProfile.password, "Blog registration Password must receive saved Password");
assert.equal((win.document.querySelector("#bleep-captcha") as unknown as HTMLInputElement).checked, false, "CAPTCHA must remain untouched");
assert.equal(bleepRegisterClicks, 0, "Register & Create must never be clicked");
assert.ok(bleepRegistrationReport.manual.includes("Final Submit"), "Register & Create must remain manual");

win.happyDOM.setURL("https://eedblog.com/register");
win.document.open();
win.document.write(`<form><label for="eed-blog">Blog Name</label><input id="eed-blog" name="blog_name"><span>.eedblog.com</span><label for="field-email">Your Email</label><input id="field-email" name="email" type="email"><label for="eed-password">Password</label><input id="eed-password" name="password" type="password"><div id="eed-captcha">Puzzle CAPTCHA</div><button id="eed-register" type="submit">Register &amp; Create</button></form>`);
win.document.close();
let eedRegisterClicks = 0;
win.document.querySelector("#eed-register")?.addEventListener("click", () => { eedRegisterClicks += 1; });
const eedRegistrationReport = runListingAutofill(accountProfile);
assert.equal(value("blog_name"), accountProfile.username, "eedblog Blog Name must receive Username");
assert.equal(value("email"), accountProfile.email, "field-email must receive Submission Email");
assert.equal(value("password"), accountProfile.password, "eedblog Password must receive saved Password");
assert.equal(eedRegisterClicks, 0, "eedblog Register & Create must never be clicked");
assert.ok(eedRegistrationReport.manual.includes("Final Submit"), "eedblog Register & Create must remain manual");

win.happyDOM.setURL("https://runtime-example.test/register");
win.document.open();
win.document.write(`<form><label>Blog Name<input id="field-user" name="username" type="email"></label><label>Email<input id="field-email" name="email"></label><label>Password<input name="password" type="password"></label><button type="submit">Register &amp; Create</button></form>`);
win.document.close();
const runtimeRegistrationReport = runListingAutofill(accountProfile);
assert.equal(value("username"), accountProfile.username, "listing runtime must write Username to explicit username field");
assert.equal(value("email"), accountProfile.email, "listing runtime must write Submission Email to explicit email field");
assert.equal(runtimeRegistrationReport.filled.find((entry) => entry.descriptor.includes('name="username"'))?.field, "username", "listing diagnostics must resolve field-user as Username");
assert.equal(runtimeRegistrationReport.filled.find((entry) => entry.descriptor.includes('name="email"'))?.field, "email", "listing diagnostics must resolve field-email as Submission Email");

win.happyDOM.setURL("https://accounts.example/register");
win.document.open();
win.document.write(`<form><h1>Create Account</h1><label>Business Name<input name="account_identifier"></label><label>Password<input name="account_password" type="password"></label><label>Email<input name="account_email" type="email"></label><div id="captcha">CAPTCHA</div><button type="submit">REGISTER</button></form>`);
win.document.close();
const genericSignupReport = runListingAutofill(accountProfile);
assert.equal(value("account_identifier"), accountProfile.username, "auth-form first identifier must receive Username, not Business Name");
assert.equal(value("account_password"), accountProfile.password, "auth-form password must receive saved Password");
assert.equal(value("account_email"), accountProfile.email, "auth-form email must receive Submission Email");
assert.equal(genericSignupReport.filled.find((entry) => entry.descriptor.includes('name="account_identifier"'))?.field, "username", "auth-form identifier must be reported as Username");
assert.ok(genericSignupReport.manual.includes("Final Submit"), "REGISTER must remain manual");

win.happyDOM.setURL("https://accounts.example/register-details");
win.document.open();
win.document.write(`<form><h1>Create Account</h1><label>First Name<input name="first_name"></label><label>Last Name<input name="last_name"></label><label>Username<input name="username"></label><label>Email<input name="email" type="email"></label><label>Password<input name="password" type="password"></label><label>Re-Enter Password<input name="password_confirmation" type="password"></label><label>How did you hear about us?<select name="referral"><option value="">Choose one</option><option value="bing">Bing</option><option value="google">Google</option><option value="search-engine">Search Engine</option></select></label><label>Terms of Use <input name="terms" type="checkbox"></label><label>Send me newsletters <input name="marketing" type="checkbox"></label><button id="register" type="submit">Register</button></form>`);
win.document.close();
let registerClicks = 0;
win.document.querySelector("#register")?.addEventListener("click", () => { registerClicks += 1; });
const detailedRegistration = runListingAutofill(accountProfile);
assert.equal(value("first_name"), accountProfile.firstName, "explicit First Name must receive firstName");
assert.equal(value("last_name"), accountProfile.lastName, "explicit Last Name must receive lastName");
assert.equal(value("username"), accountProfile.username, "explicit Username must receive username");
assert.equal(value("email"), accountProfile.email, "registration Email must receive Submission Email");
assert.equal(value("password"), accountProfile.password, "registration Password must receive saved Password");
assert.equal(value("password_confirmation"), accountProfile.password, "password confirmation must reuse saved Password");
assert.equal(value("referral"), "google", "referral should prefer the actual Google option");
assert.equal((win.document.querySelector('[name="terms"]') as unknown as HTMLInputElement).checked, false, "Terms of Use must remain human-controlled without approval");
assert.equal((win.document.querySelector('[name="marketing"]') as unknown as HTMLInputElement).checked, false, "unrelated marketing opt-in must remain unchanged");
assert.equal(registerClicks, 0, "Register must never be clicked");
assert.ok(detailedRegistration.manual.includes("Final Submit"), "Register must remain manual");

win.document.open();
win.document.write(`<form><h1>Create Account</h1><label>Email<input name="email" type="email"></label><label>Password<input name="password" type="password"></label><label>How did you find us?<select name="referral"><option value="">Choose one</option><option value="search-engine">Search Engine</option><option value="friend">Friend</option></select></label></form>`);
win.document.close();
runListingAutofill(accountProfile);
assert.equal(value("referral"), "search-engine", "referral should fall back to Search Engine when Google is unavailable");

win.document.open();
win.document.write(`<form><h1>Create Account</h1><label>Email<input name="email" type="email"></label><label>Password<input name="password" type="password"></label><label>Referral source<select name="referral"><option value="facebook">Facebook</option><option value="friend">Friend</option></select></label></form>`);
win.document.close();
runListingAutofill(accountProfile);
assert.equal(value("referral"), "facebook", "unsupported referral options must remain unchanged");

win.happyDOM.setURL("https://accounts.example/login");
win.document.open();
win.document.write(`<form><h1>Sign In</h1><label>Email<input name="login_email" type="email"></label><label>Password<input name="login_password" type="password"></label><button type="submit">LOGIN</button></form>`);
win.document.close();
runListingAutofill(accountProfile);
assert.equal(value("login_email"), accountProfile.email, "explicit email-login field must receive Submission Email");
assert.equal(value("login_password"), accountProfile.password, "email-login password must receive saved Password");

win.happyDOM.setURL("https://accounts.example/sign-in");
win.document.open();
win.document.write(`<form><h1>Sign In</h1><label>Username<input name="username"></label><label>Password<input name="password" type="password"></label><label><input name="remember" type="checkbox"> Remember me</label><div class="captcha">Puzzle CAPTCHA</div><a href="/forgot-password">Forgot password?</a><button type="submit">SIGN IN</button></form>`);
win.document.close();
const usernameLoginReport = runListingAutofill(accountProfile);
assert.equal(value("username"), accountProfile.username, "username login must receive the saved Username");
assert.equal(value("password"), accountProfile.password, "username login must receive the saved Password");
assert.equal((win.document.querySelector('[name="remember"]') as unknown as HTMLInputElement).checked, false, "Remember me must remain unchanged");
assert.ok(usernameLoginReport.manual.some((entry) => /sign in/i.test(entry)), "SIGN IN must remain manual");
assert.equal(usernameLoginReport.filled.some((entry) => entry.field === "password" && entry.value === "[masked]"), true, "password diagnostics must stay masked");
assert.equal(value("username") === accountProfile.businessName, false, "Business Name must never enter a login Username field");

win.happyDOM.setURL("https://theobloggers.com/new-post");
win.document.open();
win.document.write(`<form><label>Blog Name<input name="blog_name"></label><label>Blog Title<input name="blog_title"></label></form>`);
win.document.close();
runListingAutofill(accountProfile);
assert.notEqual(value("blog_name"), accountProfile.username, "normal Blog Name outside registration must not receive Username");
assert.notEqual(value("blog_title"), accountProfile.username, "normal Blog Title must not receive Username");

// Real content-handler publication validation and one-time command consumption (fixtures only).
const publicationStorage: Record<string, unknown> = {};
let mutateOnPublicationClaim: (() => void) | undefined;
let mutateBeforePublicationProfileRead: (() => void) | undefined;
const publicationProfile = { ...profile, id: "publication-profile", description: '<p>Our local business provides careful removal services with reliable scheduling and respectful support for homes and businesses in the community.</p><p>Read <a href="https://mahid.test/services">our services</a>.</p>' };
publicationStorage["ba2.activeProfile"] = { profile: publicationProfile, syncedAt: "2026-10-16T00:00:00Z", source: "local-storage" };
g.chrome = { storage: { local: { get: async (key: string) => { if (key === "ba2.activeProfile") mutateBeforePublicationProfileRead?.(); return { [key]: publicationStorage[key] }; }, set: async (values: Record<string, unknown>) => { Object.assign(publicationStorage, values); if ((values["ba2.listingRun"] as { publicationSubmission?: { claimed?: boolean } } | undefined)?.publicationSubmission?.claimed) mutateOnPublicationClaim?.(); } } } } as unknown as typeof chrome;
let publicationClicks = 0;
async function publicationFixture(): Promise<ReturnType<typeof createListingRun>> {
  win.happyDOM.setURL("https://publisher.test/new");
  win.document.open();
  win.document.write('<form method="post"><label>Title<input name="title" required></label><div contenteditable="true" aria-label="Article content"></div><button type="submit">Publish</button></form>');
  win.document.close();
  runListingAutofill(publicationProfile);
  const run = createListingRun(win.location.href, publicationProfile.id, 42);
  run.autoPublish = true;
  run.publicationApproval = { authorizedAt: "2026-10-16T00:00:00Z", profileFingerprint: await publicationProfileFingerprint(publicationProfile) };
  run.publicationEditorUrl = win.location.href;
  run.expectedArticle = articleExpectation(publicationProfile.businessName, publicationProfile.description, win.document as unknown as Document);
  run.stage = "SUBMITTING";
  run.submissionAttempted = true;
  run.publicationSubmission = { attemptId: crypto.randomUUID(), url: win.location.href, startedAt: "2026-10-16T00:00:00Z", outcome: "intent" };
  publicationStorage["ba2.listingRun"] = run;
  win.document.querySelector("button")!.addEventListener("click", (event) => {
    event.preventDefault();
    publicationClicks += 1;
    const persisted = publicationStorage["ba2.listingRun"] as typeof run;
    assert.equal(persisted.submissionAttempted, true, "intent must precede native click");
    assert.equal(persisted.publicationSubmission?.claimed, true, "claim must persist before click");
  });
  return run;
}
let publicationRun = await publicationFixture();
assert.equal(validateBlogPublication(publicationProfile).ok, true, "approved rich content must validate");
assert.equal((await handleBlogPublication(publicationRun.id)).ok, true, "preflight validates without clicking");
assert.equal(publicationClicks, 0);
const concurrentPublications = await Promise.all([
  handleBlogPublication(publicationRun.id, publicationRun.publicationSubmission!.attemptId),
  handleBlogPublication(publicationRun.id, publicationRun.publicationSubmission!.attemptId),
]);
assert.equal(concurrentPublications.filter((result) => result.ok).length, 1);
assert.equal(publicationClicks, 1, "concurrent duplicate content commands must click once");
assert.equal((await handleBlogPublication(publicationRun.id, publicationRun.publicationSubmission!.attemptId)).ok, false);
assert.equal(publicationClicks, 1);

const publicationMutations: Array<[string, () => void]> = [
  ["title", () => { (win.document.querySelector('[name="title"]') as unknown as HTMLInputElement).value = "Wrong business"; }],
  ["body", () => { win.document.querySelector('[contenteditable="true"]')!.innerHTML = "<p>Wrong body</p>"; }],
  ["link", () => { win.document.querySelector('[contenteditable="true"] a')!.setAttribute("href", "https://wrong.test"); }],
  ["image", () => { win.document.querySelector('[contenteditable="true"] img')!.setAttribute("src", "https://wrong.test/image.jpg"); }],
  ["required", () => { win.document.querySelector("form")!.insertAdjacentHTML("beforeend", '<input name="category" required>'); }],
  ["invalid", () => { win.document.querySelector("form")!.insertAdjacentHTML("beforeend", '<input type="email" value="invalid" required>'); }],
  ["terms", () => { win.document.querySelector("form")!.insertAdjacentHTML("beforeend", '<label><input type="checkbox">I agree to Terms and Conditions</label>'); }],
  ["captcha", () => { win.document.querySelector("form")!.insertAdjacentHTML("beforeend", '<div class="g-recaptcha" data-sitekey="test">CAPTCHA</div>'); }],
  ["payment", () => { win.document.querySelector("form")!.insertAdjacentHTML("beforeend", '<p>Payment required</p>'); }],
  ["manual verification", () => { win.document.querySelector("form")!.insertAdjacentHTML("beforeend", '<p>Account verification required</p>'); }],
  ["ambiguous control", () => { win.document.querySelector("form")!.insertAdjacentHTML("beforeend", '<button>Publish article</button>'); }],
  ["disabled", () => { win.document.querySelector("button")!.setAttribute("disabled", "disabled"); }],
  ["reset control", () => { win.document.querySelector("button")!.setAttribute("type", "reset"); }],
  ["external form action", () => { win.document.querySelector("button")!.setAttribute("formaction", "https://other.test/publish"); }],
  ["new tab target", () => { win.document.querySelector("button")!.setAttribute("formtarget", "_blank"); }],
  ["captcha overlay", () => { win.document.body.insertAdjacentHTML("beforeend", '<div class="g-recaptcha">CAPTCHA</div>'); }],
  ["payment controls", () => { win.document.querySelector("form")!.insertAdjacentHTML("beforeend", '<input autocomplete="cc-number">'); }],
  ["wrong profile", () => { publicationStorage["ba2.activeProfile"] = { profile: { ...publicationProfile, id: "wrong" } }; }],
  ["changed profile content", () => { publicationStorage["ba2.activeProfile"] = { profile: { ...publicationProfile, description: "Changed after approval" } }; }],
  ["no authorization", () => { (publicationStorage["ba2.listingRun"] as typeof publicationRun).autoPublish = false; }],
  ["no intent", () => { (publicationStorage["ba2.listingRun"] as typeof publicationRun).submissionAttempted = false; }],
  ["already verified", () => { (publicationStorage["ba2.listingRun"] as typeof publicationRun).liveUrl = "https://publisher.test/article-1"; }],
];
for (const [label, mutate] of publicationMutations) {
  publicationStorage["ba2.activeProfile"] = { profile: publicationProfile };
  publicationRun = await publicationFixture();
  mutate();
  assert.equal((await handleBlogPublication(publicationRun.id, publicationRun.publicationSubmission!.attemptId)).ok, false, label);
  assert.equal(publicationClicks, 1, `${label} must not click`);
}
publicationRun = await publicationFixture();
mutateOnPublicationClaim = () => { (win.document.querySelector('[name="title"]') as unknown as HTMLInputElement).value = "Changed after intent"; };
assert.equal((await handleBlogPublication(publicationRun.id, publicationRun.publicationSubmission!.attemptId)).ok, false, "last-moment DOM changes after persisted intent must block the click");
assert.equal(publicationClicks, 1);
mutateOnPublicationClaim = undefined;
publicationRun = await publicationFixture();
const uncertainButton = win.document.querySelector("button") as unknown as HTMLElement;
uncertainButton.click = () => { publicationClicks += 1; throw new Error("fixture lost click acknowledgement"); };
await assert.rejects(handleBlogPublication(publicationRun.id, publicationRun.publicationSubmission!.attemptId));
assert.equal((await handleBlogPublication(publicationRun.id, publicationRun.publicationSubmission!.attemptId)).ok, false, "uncertain native click must remain consumed");
assert.equal(publicationClicks, 2);

// Family 1 continuation: CAPTCHA completion must belong to the visible widget/form.
for (const [widget, responseName] of [["g-recaptcha", "g-recaptcha-response"], ["h-captcha", "h-captcha-response"], ["cf-turnstile", "cf-turnstile-response"]]) {
  await publicationFixture();
  win.document.querySelector("form")!.insertAdjacentHTML("beforeend", `<div class="${widget}" data-sitekey="fixture"></div><textarea hidden name="${responseName}">fixture-human-completion</textarea><label><input type="checkbox" checked>I agree to Terms and Conditions</label>`);
  assert.equal(validateBlogPublication(publicationProfile).ok, true, `${widget}: matching human completion plus checked Terms can proceed`);
  (win.document.querySelector(`textarea[name="${responseName}"]`) as unknown as HTMLTextAreaElement).value = "";
  assert.equal(validateBlogPublication(publicationProfile).ok, false, `${widget}: expired/empty completion stays blocked`);
}
await publicationFixture();
win.document.querySelector("form")!.insertAdjacentHTML("beforeend", '<div class="h-captcha" data-sitekey="fixture"></div><textarea hidden name="g-recaptcha-response">unrelated-provider-token</textarea>');
assert.equal(validateBlogPublication(publicationProfile).ok, false, "a reCAPTCHA token must not clear a visible hCaptcha checkpoint");
await publicationFixture();
win.document.querySelector("form")!.insertAdjacentHTML("beforeend", '<div class="g-recaptcha" data-sitekey="one"></div><div class="g-recaptcha" data-sitekey="two"></div><textarea hidden name="g-recaptcha-response">ambiguous-completion</textarea>');
assert.equal(validateBlogPublication(publicationProfile).ok, false, "one token must not clear two independent visible widgets");

publicationRun = await publicationFixture();
const replacementPublicationRun = createListingRun("https://other-family.test/form", publicationProfile.id, 99);
mutateBeforePublicationProfileRead = () => { publicationStorage["ba2.listingRun"] = replacementPublicationRun; };
assert.equal((await handleBlogPublication(publicationRun.id, publicationRun.publicationSubmission!.attemptId)).ok, false, "replaced run must not be revived by stale claim state");
assert.equal((publicationStorage["ba2.listingRun"] as typeof publicationRun).id, replacementPublicationRun.id, "replacement website-family run must be preserved");
assert.equal(publicationClicks, 2, "stale publication must not click");
mutateBeforePublicationProfileRead = undefined;
for (const change of ["revoked", "claimed", "new-attempt", "no-intent", "verified"] as const) {
  publicationRun = await publicationFixture();
  const changed = { ...publicationRun, publicationSubmission: { ...publicationRun.publicationSubmission! } };
  if (change === "revoked") changed.autoPublish = false;
  if (change === "claimed") changed.publicationSubmission.claimed = true;
  if (change === "new-attempt") changed.publicationSubmission.attemptId = "different-attempt";
  if (change === "no-intent") changed.submissionAttempted = false;
  if (change === "verified") changed.liveUrl = "https://publisher.test/existing-article";
  mutateBeforePublicationProfileRead = () => { publicationStorage["ba2.listingRun"] = changed; };
  assert.equal((await handleBlogPublication(publicationRun.id, publicationRun.publicationSubmission!.attemptId)).ok, false, `${change}: asynchronous validation must not restore stale intent`);
  assert.equal(publicationStorage["ba2.listingRun"], changed, `${change}: current state must survive unchanged`);
  assert.equal(publicationClicks, 2);
  mutateBeforePublicationProfileRead = undefined;
}
console.log("publication content fixtures passed: approval, exact rich content, gates, native validation, one-time claims, and uncertain click");

console.log("engine smoke test passed:");
console.log(`  standard form   -> filled ${report1.filled.length}, skipped ${report1.skipped.length}`);
console.log(`  variants form   -> filled ${report2.filled.length}, skipped ${report2.skipped.length}`);
console.log("  no form submissions, no checkbox changes, unsafe fields untouched");

// Authorized generic login: fixture credentials only, no network or live submissions.
import { fillLoginFields, handleAutomaticLogin, watchAuthorizedLogin } from "../src/content/listing-autofill";
import { loginCaptcha, loginFields, validateLogin, observeBlogWorkflow as observeLoginWorkflow } from "../src/automation/blog-workflow";
const loginProfile = { ...accountProfile, username: "fixture-account", password: "fixture-password" };
let authorizedLoginClicks = 0;
function loginFixture(verified = false) {
  win.happyDOM.setURL("https://onesmablog.com/login");
  win.document.open();
  win.document.write('<script src="https://cdn.onesmablog.com/plugins/KEY-Captcha/captcha.js"></script><form method="post"><h1>Sign In</h1><input name="username" required><input name="password" type="password" required><input name="remember" type="checkbox"><div id="KEY-Captcha"><div id="puzzleContainer" style="cursor:pointer"><div id="puzzle" style="cursor:all-scroll"></div><div id="validPuzzle" style="display:none"></div></div></div><button type="submit">Sign in</button></form>');
  win.document.close();
  if (verified) verifyLoginPuzzle();
  const run = createListingRun("https://onesmablog.com/login", loginProfile.id, 42);
  run.autoLogin = true;
  run.loginApproval = { authorizedAt: new Date().toISOString(), profileUpdatedAt: loginProfile.updatedAt };
  publicationStorage["ba2.listingRun"] = run;
  publicationStorage["ba2.activeProfile"] = { profile: loginProfile };
  win.document.querySelector("button")!.addEventListener("click", (event) => {
    event.preventDefault();
    const saved = publicationStorage["ba2.listingRun"] as typeof run;
    assert.equal(saved.login?.state, "intent");
    assert.equal(saved.login?.claimed, true, "durable claim must precede native click");
    authorizedLoginClicks += 1;
  });
  return run;
}
function verifyLoginPuzzle() {
  (win.document.querySelector("#validPuzzle") as unknown as HTMLElement).style.display = "block";
  (win.document.querySelector("#puzzle") as unknown as HTMLElement).style.cursor = "default";
  (win.document.querySelector("#puzzleContainer") as unknown as HTMLElement).style.cursor = "default";
}
const fillOnlyLogin = loginFixture(true);
fillOnlyLogin.autoLogin = false;
const fillOnlySnapshot = JSON.stringify(publicationStorage);
assert.equal(fillLoginFields(loginProfile), true, 'field preparation requires no submit authorization');
assert.equal(authorizedLoginClicks, 0, 'even verified CAPTCHA cannot turn fill-only into a submission');
assert.equal(JSON.stringify(publicationStorage), fillOnlySnapshot, 'field preparation cannot rewrite any run/receipt');
(win.document.querySelector('[name=username]') as unknown as HTMLInputElement).value = 'human-other-account';
assert.equal(fillLoginFields(loginProfile), false, 'preserve a different human account');
assert.equal((win.document.querySelector('[name=username]') as unknown as HTMLInputElement).value, 'human-other-account');
win.document.querySelector('form')!.setAttribute('action', 'https://foreign.test/login');
assert.equal(fillLoginFields(loginProfile), false, 'strict same-origin Login form required');
let loginRun = loginFixture();
assert.equal(createListingRun("https://publisher.test/login", loginProfile.id, 42).autoLogin, false);
loginRun.autoLogin = false;
assert.equal((await handleAutomaticLogin(loginRun.id, true)).ok, false);
assert.equal(value("username"), "", "no fill or submission without distinct approval");
for (const state of ['waiting-captcha', 'manual'] as const) {
  loginRun = loginFixture();
  loginRun.login = { url: win.location.href, state, reason: 'Prepared before refresh' };
  const saved = JSON.stringify(publicationStorage['ba2.listingRun']);
  assert.equal((await handleAutomaticLogin(loginRun.id, true)).captcha, 'pending');
  assert.equal(value('username'), loginProfile.username, state);
  assert.equal(value('password'), loginProfile.password, state);
  assert.equal(JSON.stringify(publicationStorage['ba2.listingRun']), saved, 'refill does not renew approval or reset run');
  (win.document.querySelector('[name="username"]') as unknown as HTMLInputElement).value = 'human-selected-account';
  (win.document.querySelector('[name="password"]') as unknown as HTMLInputElement).value = '';
  assert.equal((await handleAutomaticLogin(loginRun.id, true)).ok, false);
  assert.equal(value('username'), 'human-selected-account', 'nonempty different account stays untouched');
  assert.equal(value('password'), '', 'no partial fill when account conflicts');
}
for (const state of ['intent', 'uncertain', 'failed'] as const) {
  loginRun = loginFixture();
  loginRun.login = { url: win.location.href, state, attemptId: 'preserved-attempt', reason: 'Do not replay' };
  const saved = JSON.stringify(publicationStorage['ba2.listingRun']);
  assert.equal((await handleAutomaticLogin(loginRun.id, true)).ok, false);
  assert.equal(value('username'), '', 'claimed attempt never reaches refill');
  assert.equal(value('password'), '');
  assert.equal(JSON.stringify(publicationStorage['ba2.listingRun']), saved);
}
assert.equal(authorizedLoginClicks, 0, 'refresh recovery never submits');
loginRun = loginFixture();
assert.ok(loginFields(win.document as unknown as Document, win.location.href), JSON.stringify({stage:observeLoginWorkflow(win.document as unknown as Document,win.location.href).stage, found:!!findAmpBlogsLoginSubmit(win.document as unknown as Document),body:win.document.body?.textContent, password:!!win.document.querySelector("input[type=password]")}));
const pendingLogin = await handleAutomaticLogin(loginRun.id, true);
assert.equal(pendingLogin.captcha, "pending", JSON.stringify(pendingLogin));
assert.equal(pendingLogin.ok, false);
assert.equal(value("username"), loginProfile.username);
assert.equal((win.document.querySelector('[name="remember"]') as unknown as HTMLInputElement).checked, false);
assert.ok(!JSON.stringify(pendingLogin).includes(loginProfile.username));
assert.ok(!JSON.stringify(pendingLogin).includes(loginProfile.password));
(win.document.querySelector("#validPuzzle") as unknown as HTMLElement).style.display = "block";
assert.equal((await handleAutomaticLogin(loginRun.id)).captcha, "pending", "visual check alone is insufficient");
verifyLoginPuzzle();
assert.equal((await handleAutomaticLogin(loginRun.id)).ok, true);
win.document.querySelector("script")!.remove();
assert.equal((await handleAutomaticLogin(loginRun.id)).captcha, "ambiguous", "unbound success marker remains manual");
loginRun = loginFixture(true);
await handleAutomaticLogin(loginRun.id, true);
(win.document.querySelector('[name="username"]') as unknown as HTMLInputElement).value = "wrong-account";
assert.equal((await handleAutomaticLogin(loginRun.id)).ok, false);
await handleAutomaticLogin(loginRun.id, true);
win.document.querySelector("button")!.insertAdjacentHTML("afterend", '<button type="submit">Sign in</button>');
assert.equal((await handleAutomaticLogin(loginRun.id)).ok, false, "two Sign In controls must block");
for (const variant of ["terms", "required", "external-action", "get-action", "signup", "disabled", "wrong-profile", "expired"] as const) {
  loginRun = loginFixture(true);
  await handleAutomaticLogin(loginRun.id, true);
  if (variant === "terms") win.document.querySelector("form")!.insertAdjacentHTML("beforeend", '<label>Terms<input type="checkbox" name="terms"></label>');
  if (variant === "required") win.document.querySelector("form")!.insertAdjacentHTML("beforeend", '<input name="security_answer" required>');
  if (variant === "external-action") win.document.querySelector("form")!.setAttribute("action", "https://unrelated.test/login");
  if (variant === "get-action") win.document.querySelector("form")!.setAttribute("method", "get");
  if (variant === "signup") win.document.querySelector("form")!.insertAdjacentHTML("beforeend", '<button type="submit">Register</button>');
  if (variant === "disabled") (win.document.querySelector("button") as unknown as HTMLButtonElement).disabled = true;
  if (variant === "wrong-profile") publicationStorage["ba2.activeProfile"] = { profile: { ...loginProfile, id: "other" } };
  if (variant === "expired") loginRun.loginApproval!.authorizedAt = "2000-01-01T00:00:00Z";
  assert.equal((await handleAutomaticLogin(loginRun.id)).ok, false, variant);
}
loginRun = loginFixture(true);
await handleAutomaticLogin(loginRun.id, true);
loginRun.login = { url: "https://onesmablog.com/login", state: "intent", reason: "fixture", attemptId: "once", startedAt: new Date().toISOString() };
await Promise.all([handleAutomaticLogin(loginRun.id, false, "once"), handleAutomaticLogin(loginRun.id, false, "once")]);
assert.equal(authorizedLoginClicks, 1, "concurrent deliveries must click exactly once");
await handleAutomaticLogin(loginRun.id, false, "once");
assert.equal(authorizedLoginClicks, 1);
loginRun = loginFixture(true);
await handleAutomaticLogin(loginRun.id, true);
loginRun.login = { url: "https://onesmablog.com/login", state: "uncertain", reason: "interrupted", attemptId: "interrupted" };
assert.equal((await handleAutomaticLogin(loginRun.id, false, "interrupted")).ok, false);
assert.equal(authorizedLoginClicks, 1, "interrupted intent is never replayed");
win.document.querySelector("form")!.insertAdjacentHTML("beforeend", '<div role="alert">Incorrect password</div>');
assert.equal(observeLoginWorkflow(win.document as unknown as Document, "https://onesmablog.com/login").loginError, true);
// A provider token is considered only in its corresponding unique login form.
loginRun = loginFixture();
win.document.querySelector("#KEY-Captcha")!.outerHTML = '<div class="g-recaptcha"></div><textarea name="g-recaptcha-response"></textarea>';
const providerForm = win.document.querySelector("form") as unknown as HTMLFormElement;
assert.equal(loginCaptcha(win.document as unknown as Document, providerForm), "pending");
(win.document.querySelector("textarea") as unknown as HTMLTextAreaElement).value = "synthetic-response";
assert.equal(loginCaptcha(win.document as unknown as Document, providerForm), "verified");
win.document.querySelector("form")!.insertAdjacentHTML("beforeend", '<div class="h-captcha"></div>');
assert.equal(loginCaptcha(win.document as unknown as Document, providerForm), "ambiguous");
// Real MutationObserver wakes the coordinator without CONTINUE RUN.
loginRun = loginFixture();
loginRun.login = { url: "https://onesmablog.com/login", state: "waiting-captcha", reason: "fixture" };
let loginWakeups = 0;
g.MutationObserver = win.MutationObserver as unknown as typeof MutationObserver;
(g.chrome as any).runtime = { sendMessage: async (message: { type: string; runId: string }) => { assert.equal(message.type, "BA2_LOGIN_CHANGED"); assert.equal(message.runId, loginRun.id); loginWakeups += 1; return { ok: true }; } };
watchAuthorizedLogin(loginRun.id);
verifyLoginPuzzle();
await new Promise(resolve => setTimeout(resolve, 30));
assert.ok(loginWakeups > 0, "manual puzzle mutations must automatically wake the saved run");
(globalThis as typeof globalThis & { __ba2StopLoginWatch?: () => void }).__ba2StopLoginWatch?.();
assert.equal(authorizedLoginClicks, 1, "observer only wakes coordinator, never clicks");

for (const change of ["revoked", "consumed", "replaced", "changed-attempt", "publication-result"] as const) {
  loginRun = loginFixture(true);
  await handleAutomaticLogin(loginRun.id, true);
  loginRun.login = { url: "https://onesmablog.com/login", state: "intent", attemptId: "stale-" + change, reason: "fixture" };
  const changed = { ...loginRun, login: { ...loginRun.login } };
  if (change === "revoked") changed.autoLogin = false;
  if (change === "consumed") changed.login.claimed = true;
  if (change === "replaced") changed.id = "replacement-run";
  if (change === "changed-attempt") changed.login.attemptId = "newer-intent";
  if (change === "publication-result") changed.publicVerification = { status: "verified", reason: "fixture", attemptId: "article" };
  mutateBeforePublicationProfileRead = () => { publicationStorage["ba2.listingRun"] = changed; };
  assert.equal((await handleAutomaticLogin(loginRun.id, false, loginRun.login.attemptId)).ok, false, change);
  assert.equal(publicationStorage["ba2.listingRun"], changed, "login claim must preserve newer durable state");
  mutateBeforePublicationProfileRead = undefined;
}
assert.equal(authorizedLoginClicks, 1);
loginRun = loginFixture(true);
await handleAutomaticLogin(loginRun.id, true);
win.document.body.insertAdjacentHTML("beforeend", '<div class="unknown-puzzle">Another challenge</div>');
assert.equal((await handleAutomaticLogin(loginRun.id)).captcha, "ambiguous", "a verified puzzle cannot clear another challenge");
win.document.body.innerHTML = '<form><input name="title"><div contenteditable="true"></div></form>';
assert.equal(observeLoginWorkflow(win.document as unknown as Document, win.location.href).authenticationEvidence, false, "an editor alone does not prove login success");
console.log("automatic login content fixtures passed: default OFF, scoped fill, CAPTCHA signals, account validation, human gates, one click, interrupted intent, and mutation observer");

// Existing-account recovery uses the same native Login handler and retains the
// prior authenticated receipt instead of overwriting it with a new intent.
loginRun = loginFixture();
const existingLoginOld = createListingRun(loginRun.sourceUrl, loginRun.profileId, 691263529);
existingLoginOld.stage = 'MANUAL_GATE';
existingLoginOld.tabUnavailable = { tabId: existingLoginOld.tabId, detectedAt: new Date().toISOString(), reason: 'missing' };
const existingLoginBase = `ba2.loginGuard:${win.location.origin}:${loginRun.profileId}`;
const existingRegistrationBase = `ba2.registrationGuard:${win.location.origin}:${loginRun.profileId}`;
publicationStorage[existingLoginBase] = { runId: 'historical-authenticated-run', state: 'authenticated' };
publicationStorage['ba2.listingRunArchive:' + existingLoginOld.id] = existingLoginOld;
const existingLoginHistory = JSON.stringify(publicationStorage[existingLoginBase]);
loginRun.autoRegister = false; loginRun.autoPublish = false;
loginRun.existingAccountRecovery = { oldRunId: existingLoginOld.id, authorizedAt: loginRun.loginApproval!.authorizedAt,
  loginGuardSnapshot: existingLoginHistory, registrationGuardSnapshot: JSON.stringify(publicationStorage[existingRegistrationBase] ?? null) };
const existingLoginClicks = authorizedLoginClicks;
assert.equal((await handleAutomaticLogin(loginRun.id, true)).captcha, 'pending');
assert.equal(authorizedLoginClicks, existingLoginClicks);
publicationStorage[existingLoginBase] = { runId: 'changed-history', state: 'uncertain' };
assert.equal((await handleAutomaticLogin(loginRun.id)).ok, false, 'changed historical guard blocks content preparation');
publicationStorage[existingLoginBase] = JSON.parse(existingLoginHistory);
verifyLoginPuzzle();
loginRun.login = { url: win.location.href, state: 'intent', attemptId: 'existing-account-once', reason: 'fresh authorized fixture' };
await writeListingRun(loginRun);
assert.notEqual(loginGuardKey(loginRun), existingLoginBase);
const existingOwnReceipt = publicationStorage[loginGuardKey(loginRun)];
publicationStorage[loginGuardKey(loginRun)] = { runId: 'foreign', state: 'intent' };
assert.equal((await handleAutomaticLogin(loginRun.id, false, loginRun.login.attemptId)).ok, false, 'foreign recovery claim blocked');
publicationStorage[loginGuardKey(loginRun)] = existingOwnReceipt;
await Promise.all([handleAutomaticLogin(loginRun.id, false, loginRun.login.attemptId), handleAutomaticLogin(loginRun.id, false, loginRun.login.attemptId)]);
assert.equal(authorizedLoginClicks, existingLoginClicks + 1, 'existing-account recovery claims one native Login click');
assert.equal(JSON.stringify(publicationStorage[existingLoginBase]), existingLoginHistory);
assert.deepEqual(publicationStorage['ba2.listingRunArchive:' + existingLoginOld.id], existingLoginOld);
console.log('Existing-account content recovery passed: fresh fill, human CAPTCHA, immutable history, foreign-claim rejection and one native Login');

// CKEditor iframe publication validation must require the full approved HTML, not a visible logo alone.
await publicationFixture();
win.happyDOM.setURL('https://onesmablog.com/new');
runListingAutofill(publicationProfile); // Group 1 now preserves the original description verbatim.
const approvedContent = win.document.querySelector('[contenteditable="true"]')!;
const approvedCkHtml = approvedContent.innerHTML;
const ckPublicationFrame = win.document.createElement('iframe');
// Use the actual recorded TheZENweb selector; a CSS class is not recorded.
ckPublicationFrame.title = 'Rich Text Editor, editor1';
approvedContent.replaceWith(ckPublicationFrame);
const ckPublicationBody = ckPublicationFrame.contentDocument!.body;
ckPublicationBody.className = 'cke_editable';
ckPublicationBody.setAttribute('contenteditable', 'true');
ckPublicationBody.innerHTML = approvedCkHtml;
assert.equal(validateBlogPublication(publicationProfile).ok, true, 'recorded title-only CKEditor iframe with complete title/body/link/image must validate');
assert.equal(observeBlogWorkflow(win.document as unknown as Document, win.location.href).stage, 'EDITOR', 'recorded iframe title alone establishes supported editor structure');
const extraRecordedFrame = win.document.createElement('iframe');
extraRecordedFrame.title = 'Rich Text Editor, editor2';
ckPublicationFrame.parentElement!.append(extraRecordedFrame);
assert.equal(validateBlogPublication(publicationProfile).ok, false, 'two title-based editor frames remain ambiguous');
extraRecordedFrame.remove();
const ckPublicationReport = runListingAutofill(publicationProfile);
assert.equal(ckPublicationReport.form?.logo?.requested, false, 'inline CKEditor image is not a native file upload request');
assert.ok(ckPublicationBody.querySelector('img'));
assert.ok(ckPublicationBody.querySelector('a[href="https://mahid.test/services"]'));
for (const missing of ['body-tail', 'link', 'image', 'title', 'required']) {
  ckPublicationBody.innerHTML = approvedCkHtml;
  const title = win.document.querySelector('[name="title"]') as unknown as HTMLInputElement;
  title.value = publicationProfile.businessName;
  if (missing === 'body-tail') ckPublicationBody.querySelector('p')!.remove();
  if (missing === 'link') ckPublicationBody.querySelector('a')!.setAttribute('href', 'https://unapproved.test/');
  if (missing === 'image') ckPublicationBody.querySelector('img')!.remove();
  if (missing === 'title') title.value = 'Other business';
  if (missing === 'required') win.document.querySelector('form')!.insertAdjacentHTML('beforeend', '<input name="required-fixture" required>');
  assert.equal(validateBlogPublication(publicationProfile).ok, false, missing + ' must prevent CKEditor publication');
  win.document.querySelector('[name="required-fixture"]')?.remove();
}
console.log('CKEditor pre-publication checks passed: full body, exact title, approved link href, image and required fields');

// Group 1 article preservation is stricter than generic listing composition.
// This uses only synthetic editor DOM, not authenticated-site evidence.
const originalLongDescription = '  <p>Our approved local cleanup article contains <strong>bold</strong> and <em>italics</em> with reliable service for homes and businesses.<br>Keep  spaces.</p>\n<p><a href="https://example.test/offer?city=local&amp;ref=approved">cleanup keyword</a> here; contact 555-0100.</p><pre>Monday: 9-5\nTuesday: closed</pre>  ';
for (const domain of GROUP_1_DOMAINS) {
  win.happyDOM.setURL(`https://${domain}/new`);
  win.document.open(); win.document.write(`<form method="post"><label>Title<input name="title"></label><div contenteditable="true" aria-label="Article editor"></div>${domain === 'thezenweb.com' ? '<input name="publish" type="submit" value="Publish">' : '<button type="submit">Publish</button>'}</form>`); win.document.close();
  const exactProfile = { ...publicationProfile, description: originalLongDescription, businessHours: ['Monday: REPLACE-NOTHING', 'Tuesday: REPLACE-NOTHING'] };
  runListingAutofill(exactProfile);
  const body = win.document.querySelector('[contenteditable=true]')!;
  assert.equal(value('title'), exactProfile.businessName, domain + ': separate title');
  assert.equal(body.firstElementChild?.tagName, 'IMG', domain + ': image first');
  const withoutImage = body.cloneNode(true); withoutImage.querySelector('img')!.remove();
  assert.equal(withoutImage.innerHTML, originalLongDescription, domain + ': exact original HTML, whitespace, contact/hours and links');
  assert.equal(validateBlogPublication(exactProfile).ok, true, domain);
  const expectedPublic = articleExpectation(exactProfile.businessName, body.innerHTML, win.document as unknown as Document);
  const publicHtml = `<article><h1>${exactProfile.businessName}</h1>${body.innerHTML}</article>`;
  assert.equal(verifyPublicArticleHtml(publicHtml, expectedPublic, win.document as unknown as Document, win.location.origin + '/approved-article').status, 'verified');
  // The keyword must be the clickable anchor, not plain text beside an
  // unrelated link which happens to point to the same destination.
  const decoy = publicHtml.replace(/<a ([^>]+)>cleanup keyword<\/a>/, '<span>cleanup keyword</span><a $1></a>');
  assert.equal(verifyPublicArticleHtml(decoy, { ...expectedPublic, linkedText: undefined }, win.document as unknown as Document, win.location.origin + '/approved-article').status, 'verified', 'legacy expectation still matches text and href presence');
  assert.notEqual(verifyPublicArticleHtml(decoy, expectedPublic, win.document as unknown as Document, win.location.origin + '/approved-article').status, 'verified');
  assert.equal(validateBlogPublication({ ...exactProfile, imageUrl: '' }).ok, false, 'missing approved image blocks Publish');
  body.querySelector('a')!.textContent = 'rewritten keyword';
  assert.equal(validateBlogPublication(exactProfile).ok, false, 'changed hyperlink text blocks Publish');
  runListingAutofill(exactProfile);
  body.querySelector('p')!.firstChild!.textContent = 'Shortened or reordered article';
  assert.equal(validateBlogPublication(exactProfile).ok, false, 'changed body blocks Publish');
}
console.log('All eleven Group 1 article contracts passed: image first, exact original rich description/title/link text/hrefs/spacing/hours, missing-image and changed-body blocks; fixture editors only');

// Operator-confirmed TheZENweb controls, with synthetic article/API behavior.
win.happyDOM.setURL('https://thezenweb.com/new');
win.document.open(); win.document.write('<form method="post"><input name="title"><textarea hidden id="fixture-backing"></textarea><iframe title="Rich Text Editor, editor1"></iframe><input name="publish" type="submit" value="Publish"></form>'); win.document.close();
const zenBody = (win.document.querySelector('iframe') as unknown as HTMLIFrameElement).contentDocument!.body;
zenBody.setAttribute('contenteditable', 'true');
const zenBacking = win.document.querySelector('textarea') as unknown as HTMLTextAreaElement;
const zenCalls: string[] = [];
const zenProfile = { ...publicationProfile, description: originalLongDescription };
g.CKEDITOR = { instances: {
  unrelated: { setData() { throw new Error('Unrelated editor must remain untouched'); } },
  editor1: {
    setData(html: string) { zenCalls.push('setData'); zenBody.innerHTML = html; },
    updateElement() { zenCalls.push('updateElement'); zenBacking.value = zenBody.innerHTML; },
    fire(event: string) { zenCalls.push(event); },
  },
} };
runListingAutofill(zenProfile);
assert.deepEqual(zenCalls, ['setData', 'updateElement', 'change']);
assert.equal(value('title'), zenProfile.businessName);
assert.equal(zenBody.innerHTML, `<img src="${zenProfile.imageUrl}" alt="">` + originalLongDescription);
assert.equal(zenBacking.value, zenBody.innerHTML, 'API synchronization before guarded publication');
assert.equal(validateBlogPublication(zenProfile).ok, true);
delete g.CKEDITOR; // Native isolated-world content scripts cannot read page globals.
zenBody.innerHTML = '';
runListingAutofill(zenProfile);
assert.equal(zenBody.innerHTML, `<img src="${zenProfile.imageUrl}" alt="">` + originalLongDescription);
assert.equal(validateBlogPublication(zenProfile).ok, true, 'same-origin iframe fallback remains supported');
const zenPublish = win.document.querySelector('[name=publish]')!;
zenPublish.setAttribute('disabled', '');
assert.equal(validateBlogPublication(zenProfile).ok, false, 'configured selector cannot bypass disabled-control guard');
zenPublish.removeAttribute('disabled');
zenPublish.removeAttribute('name');
assert.equal(validateBlogPublication(zenProfile).ok, false, 'unconfirmed Publish control is not substituted');
console.log('TheZENweb exact controls passed: scoped editor1 API, synchronization, isolated iframe fallback, verbatim rich body and guarded input Publish; no submission');

// Native registration adapter/claim fixtures; no live form or network.
const registrationStorage: Record<string, any> = {};
const registrationProfile = { ...profile, id: 'registration-profile', username: 'approved-user', email: 'approved@example.test', password: 'fixture-password' };
registrationStorage['ba2.activeProfile'] = { profile: registrationProfile, syncedAt: 'fixture', source: 'local-storage' };
let registrationClicks = 0, registrationFixtureCount = 0;
let changeOnRegistrationClaim = false;
g.chrome = { storage: { local: {
  get: async (key: string) => ({ [key]: registrationStorage[key] }),
  set: async (values: Record<string, any>) => { Object.assign(registrationStorage, values); if (changeOnRegistrationClaim && values['ba2.listingRun']?.registration?.claimed) registrationProfile.password = 'changed-fixture-password'; },
} } } as unknown as typeof chrome;
async function registrationFixture() {
  win.happyDOM.setURL(`https://registration-${++registrationFixtureCount}.test/signup`);
  win.document.open();
  win.document.write('<a href="/login">Sign In</a><form method="post"><label>First Name<input name="first_name"></label><label>Username<input name="username" required></label><label>Email<input type="email" name="email" required></label><label>Password<input type="password" name="password" required></label><label>Confirm Password<input type="password" name="password_confirmation" required></label><label>Terms<input name="terms" type="checkbox" required></label><div class="g-recaptcha"></div><textarea name="g-recaptcha-response" hidden></textarea><button type="submit">Register</button></form>');
  win.document.close();
  const run = createListingRun(win.location.href, registrationProfile.id, 42, 'new', 'new');
  run.autoRegister = true;
  run.registrationApproval = { authorizedAt: new Date().toISOString(), profileUpdatedAt: registrationProfile.updatedAt };
  await writeListingRun(run);
  win.document.querySelector('button')!.addEventListener('click', event => {
    event.preventDefault();
    assert.equal(registrationStorage['ba2.listingRun'].registration.claimed, true);
    assert.equal(registrationStorage[`ba2.registrationGuard:${win.location.origin}:${run.profileId}`].runId, run.id);
    registrationClicks++;
  });
  return run;
}
const humanRegistrationGates = () => {
  (win.document.querySelector('[name=terms]') as unknown as HTMLInputElement).checked = true;
  (win.document.querySelector('[name=g-recaptcha-response]') as unknown as HTMLTextAreaElement).value = 'fixture-provider-response';
};
async function registrationIntent(run: ReturnType<typeof createListingRun>) {
  const intent = { ...run, registration: { url: win.location.href, state: 'intent' as const, attemptId: `reg-${registrationFixtureCount}`, reason: 'fixture intent' } };
  await writeListingRun(intent);
  return intent.registration.attemptId;
}
let reg = await registrationFixture();
assert.equal(observeBlogWorkflow(win.document as unknown as Document, win.location.href).stage, 'SIGNUP', 'Sign In navigation must not misclassify a real registration form');
const gatedRegistration = await handleAutomaticRegistration(reg.id, true);
assert.equal(gatedRegistration.ok, false);
assert.equal(value('username'), registrationProfile.username);
assert.equal(value('email'), registrationProfile.email);
assert.equal((win.document.querySelector('[name=terms]') as unknown as HTMLInputElement).checked, false, 'autofill never accepts registration Terms');
assert.equal(JSON.stringify(gatedRegistration).includes(registrationProfile.password), false);
const preservedUsername = win.document.querySelector('[name=username]') as unknown as HTMLInputElement;
const missingEmail = win.document.querySelector('[name=email]') as unknown as HTMLInputElement;
preservedUsername.value = 'human-in-progress'; missingEmail.value = '';
await handleAutomaticRegistration(reg.id, true);
assert.equal(preservedUsername.value, 'human-in-progress', 'repeat preparation preserves human values');
assert.equal(missingEmail.value, registrationProfile.email, 'repeat preparation fills refreshed missing fields');
assert.equal((win.document.querySelector('[name=terms]') as unknown as HTMLInputElement).checked, false);
preservedUsername.value = registrationProfile.username!;
humanRegistrationGates();
assert.equal((await handleAutomaticRegistration(reg.id)).ok, true);
const regAttempt = await registrationIntent(reg);
await Promise.all([handleAutomaticRegistration(reg.id, false, regAttempt), handleAutomaticRegistration(reg.id, false, regAttempt)]);
assert.equal(registrationClicks, 1, 'concurrent messages consume one durable registration claim');
assert.equal((await handleAutomaticRegistration(reg.id, false, regAttempt)).ok, false);
for (const scenario of ['no-consent', 'external-action', 'ambiguous-control', 'missing-account', 'changed-after-claim', 'wrong-receipt']) {
  reg = await registrationFixture();
  humanRegistrationGates();
  if (scenario === 'no-consent') { reg.autoRegister = false; await writeListingRun(reg); }
  if (scenario === 'external-action') win.document.querySelector('form')!.setAttribute('action', 'https://other.test/register');
  if (scenario === 'ambiguous-control') win.document.querySelector('form')!.insertAdjacentHTML('beforeend', '<button type="submit">Sign Up</button>');
  const savedUsername = registrationProfile.username;
  if (scenario === 'missing-account') registrationProfile.username = '';
  const check = await handleAutomaticRegistration(reg.id, true);
  if (['no-consent', 'external-action', 'ambiguous-control', 'missing-account'].includes(scenario)) assert.equal(check.ok, false, scenario);
  if (scenario === 'changed-after-claim' || scenario === 'wrong-receipt') {
    const attempt = await registrationIntent(reg);
    if (scenario === 'wrong-receipt') registrationStorage[`ba2.registrationGuard:${win.location.origin}:${reg.profileId}`] = { runId: 'other-run' };
    changeOnRegistrationClaim = scenario === 'changed-after-claim';
    assert.equal((await handleAutomaticRegistration(reg.id, false, attempt)).ok, false, scenario);
    changeOnRegistrationClaim = false;
  }
  registrationProfile.username = savedUsername;
}
assert.equal(registrationClicks, 1, 'all unsafe registration fixtures stop before any additional click');
win.document.open(); win.document.write('<div>Check your email to activate your account</div><a href="/logout">Logout</a><a href="/new">New Post</a>'); win.document.close();
assert.equal(observeBlogWorkflow(win.document as unknown as Document, win.location.href).stage, 'ACCOUNT_VERIFICATION', 'verification notice outranks dashboard hints');
console.log('Registration content passed: semantic signup, approved field mapping, human gates, separate consent, one claim, no credential diagnostics and changed/unsafe form guards');

// Audited Pointblog image answer: ready for one server evaluation, not verified.
reg = await registrationFixture();
win.happyDOM.setURL('https://pointblog.net/signup');
win.document.querySelector('.g-recaptcha')!.outerHTML = '<div class="captcha-register"><div><img id="captcha" src="/plugins/cool-php-captcha-0.3.1/captcha.php"></div><label>Captcha<input name="captcha" autocomplete="off"></label></div>';
win.document.querySelector('[name=g-recaptcha-response]')!.remove();
runListingAutofill(registrationProfile);
const pointblogCheck = () => validateRegistration(win.document as unknown as Document, win.location.href, registrationProfile);
assert.equal(pointblogCheck().captcha, 'pending');
assert.equal(pointblogCheck().ok, false, 'manual Terms and blank CAPTCHA remain gates');
(win.document.querySelector('[name=terms]') as unknown as HTMLInputElement).checked = true;
assert.equal(pointblogCheck().ok, false, 'blank image answer cannot register');
(win.document.querySelector('[name=captcha]') as unknown as HTMLInputElement).value = 'not-proven-correct';
assert.equal(pointblogCheck().captcha, 'answer-entered');
assert.equal(pointblogCheck().ok, true);
assert.match(pointblogCheck().reason, /correctness is unverified/);
assert.equal(loginCaptcha(win.document as unknown as Document, win.document.querySelector('form') as unknown as HTMLFormElement), 'ambiguous', 'Login challenge rules unchanged');
for (const mutation of ['foreign-image', 'extra-challenge', 'duplicate-wrapper', 'unbound-wrapper', 'duplicate-answer', 'invalid-answer', 'readonly-answer', 'wrong-host']) {
  const image = win.document.querySelector('#captcha')!;
  const answer = win.document.querySelector('[name=captcha]') as unknown as HTMLInputElement;
  if (mutation === 'foreign-image') image.setAttribute('src', 'https://other.test/plugins/cool-php-captcha-0.3.1/captcha.php');
  if (mutation === 'extra-challenge') win.document.querySelector('form')!.insertAdjacentHTML('beforeend', '<div class="g-recaptcha"></div>');
  if (mutation === 'duplicate-wrapper') win.document.querySelector('form')!.insertAdjacentHTML('beforeend', '<div class="captcha-register"></div>');
  if (mutation === 'unbound-wrapper') win.document.querySelector('.captcha-register')!.insertAdjacentHTML('beforeend', '<div class="captcha-register"></div>');
  if (mutation === 'duplicate-answer') win.document.querySelector('form')!.insertAdjacentHTML('beforeend', '<input name="captcha">');
  if (mutation === 'invalid-answer') answer.pattern = '[0-9]+';
  if (mutation === 'readonly-answer') answer.readOnly = true;
  if (mutation === 'wrong-host') win.happyDOM.setURL('https://unverified-group.test/signup');
  assert.equal(pointblogCheck().ok, false, mutation);
  image.setAttribute('src', '/plugins/cool-php-captcha-0.3.1/captcha.php');
  win.document.querySelector('.g-recaptcha')?.remove();
  win.document.querySelectorAll('.captcha-register')[1]?.remove();
  win.document.querySelectorAll('[name=captcha]')[1]?.remove();
  answer.removeAttribute('pattern'); answer.readOnly = false;
  win.happyDOM.setURL('https://pointblog.net/signup');
}
console.log('Pointblog image CAPTCHA passed: blank/human gates, unverified answer readiness, native validity, scoped image and conflicting challenge rejection; Login unchanged');

// Real content receiver consumes new registration consent while retaining the
// older uncertain Login verbatim. No global Login receipt is reset or overwritten.
reg = await registrationFixture();
const uncertainBeforeRegistration = createListingRun(reg.sourceUrl, reg.profileId, 42);
uncertainBeforeRegistration.stage = 'MANUAL_GATE';
uncertainBeforeRegistration.awaitingManualResume = true;
uncertainBeforeRegistration.login = { url: reg.sourceUrl, state: 'uncertain', attemptId: 'old-claimed', claimed: true, reason: 'Unresolved' };
await writeListingRun(uncertainBeforeRegistration);
const historicalKey = `ba2.loginGuard:${win.location.origin}:${reg.profileId}`;
const historicalReceipt = JSON.stringify(registrationStorage[historicalKey]);
const historicalRun = JSON.stringify(uncertainBeforeRegistration);
reg.registrationRecovery = { oldRunId: uncertainBeforeRegistration.id, oldLoginAttemptId: 'old-claimed', guardSnapshot: historicalReceipt,
  authorizedAt: reg.registrationApproval!.authorizedAt, firstRegistrationConfirmed: true };
await writeListingRun(reg, uncertainBeforeRegistration);
await handleAutomaticRegistration(reg.id, true);
humanRegistrationGates();
const recoveryContentAttempt = await registrationIntent(reg);
const recoveryClicksBefore = registrationClicks;
await Promise.all([handleAutomaticRegistration(reg.id, false, recoveryContentAttempt), handleAutomaticRegistration(reg.id, false, recoveryContentAttempt)]);
assert.equal(registrationClicks, recoveryClicksBefore + 1, 'recovery also consumes exactly one registration claim');
assert.equal(JSON.stringify(registrationStorage[historicalKey]), historicalReceipt);
assert.equal(JSON.stringify(registrationStorage['ba2.listingRunArchive:' + uncertainBeforeRegistration.id]), historicalRun);
assert.equal((await handleAutomaticRegistration(reg.id, false, recoveryContentAttempt)).ok, false, 'recovery never replays an existing claim');
console.log('Recovery content receiver passed: validated new registration, concurrent one-shot claim, immutable old Login/archive and no replay');

// Exact reported success wording/link: observer and existing registration watcher
// must work without CONTINUE RUN. Markup is a fixture, not a captured live DOM.
// Blogolize's live notice misspells "successfully". Keep standard wording and
// negative evidence strict, and obtain navigation only from the actual anchor.
for (const [notice, expected] of [
  ['Your account is succesfuly created', true],
  ['Your account is successfully created', true],
  ['Your account has been created', true],
  ['Your account is not succesfuly created', false],
  ['Your account is unsuccessfully created', false],
  ['Your account is succesfuly pending', false],
] as const) {
  win.document.body.innerHTML = `<div role="status">${notice}</div><a href="/observed-sign-in">Click here to login</a>`;
  const observed = observeBlogWorkflow(win.document as unknown as Document, win.location.href);
  assert.equal(observed.stage === 'ACCOUNT_CREATED', expected, notice);
  assert.equal(Boolean(observed.registrationEvidence), expected, notice);
  if (expected) assert.equal(observed.loginAction?.href, `${win.location.origin}/observed-sign-in`, 'reuse observed Login href, never guess /login');
}
const registrationSuccessSnapshot = JSON.stringify(registrationStorage);
const registrationSignals: Array<{ type: string; runId: string }> = [];
Object.assign(g.chrome as object, { runtime: { sendMessage: async (message: { type: string; runId: string }) => {
  registrationSignals.push(message); return { ok: true };
} } });
watchAuthorizedLogin(reg.id, true);
win.document.body.innerHTML = '<div role="status">Your account is succesfuly created</div><a href="/login">Click here to login</a>';
for (let wait = 0; wait < 40 && !registrationSignals.length; wait++) await new Promise(resolve => setTimeout(resolve, 5));
(g.__ba2StopLoginWatch as (() => void) | undefined)?.();
assert.ok(registrationSignals.some(message => message.type === 'BA2_REGISTRATION_CHANGED' && message.runId === reg.id), 'success DOM mutation wakes coordinator without a click');
const observedRegistrationSuccess = observeBlogWorkflow(win.document as unknown as Document, win.location.href);
assert.equal(observedRegistrationSuccess.stage, 'ACCOUNT_CREATED');
assert.equal(observedRegistrationSuccess.registrationEvidence, true);
assert.equal(observedRegistrationSuccess.loginAction?.href, new URL('/login', win.location.href).href);
assert.equal(observedRegistrationSuccess.loginAction?.label, 'Click here to login');
assert.equal(JSON.stringify(registrationStorage), registrationSuccessSnapshot, 'observer/watcher preserve all receipts and run evidence');
assert.equal(registrationClicks, recoveryClicksBefore + 1, 'success observation never registers again');
console.log('Reported registration success fixture passed: exact wording/link, real MutationObserver notification, no CONTINUE RUN, unchanged run/receipts and no resubmission');

// Existing publication validator gates a read-only human-completion wakeup.
delete g.CKEDITOR; delete g.tinymce;
const publicationReadySignals: Array<{ type: string; runId: string }> = [];
publicationStorage['ba2.activeProfile'] = { profile: publicationProfile };
g.chrome = { storage: { local: {
  get: async (key: string | null) => key === null ? { ...publicationStorage } : { [key]: publicationStorage[key] },
  set: async (values: Record<string, unknown>) => { Object.assign(publicationStorage, values); },
} }, runtime: { sendMessage: async (message: { type: string; runId: string }) => { publicationReadySignals.push(message); return { ok: true }; } } } as unknown as typeof chrome;
const gatedPublication = await publicationFixture();
gatedPublication.submissionAttempted = false; delete gatedPublication.publicationSubmission;
gatedPublication.stage = 'MANUAL_GATE'; gatedPublication.awaitingManualResume = true;
gatedPublication.continuous = { loginReceiptsSnapshot: '{}', registrationReceiptSnapshot: 'null' };
publicationStorage['ba2.listingRun'] = gatedPublication;
const captchaContainer = win.document.createElement('div'); captchaContainer.className = 'g-recaptcha'; captchaContainer.textContent = 'Human challenge';
const captchaToken = win.document.createElement('textarea'); captchaToken.name = 'g-recaptcha-response'; captchaToken.hidden = true;
win.document.querySelector('form')!.append(captchaContainer, captchaToken);
const gatedSnapshot = JSON.stringify(publicationStorage), clicksBeforeGate = publicationClicks;
watchAuthorizedPublication(gatedPublication.id);
assert.match((await handleBlogPublication(gatedPublication.id)).error || '', /CAPTCHA/, 'fixture must pause only at CAPTCHA');
await new Promise(resolve => setTimeout(resolve, 30));
assert.equal(publicationReadySignals.length, 0, 'pending CAPTCHA cannot wake publication');
captchaToken.value = 'synthetic-human-verification';
assert.equal((await handleBlogPublication(gatedPublication.id)).ok, true, 'human-completed fixture must pass existing publication validation');
for (let wait = 0; wait < 35 && !publicationReadySignals.length; wait++) await new Promise(resolve => setTimeout(resolve, 50));
(g.__ba2StopPublicationGateWatch as (() => void) | undefined)?.();
assert.deepEqual(publicationReadySignals, [{ type: 'BA2_PUBLICATION_READY', runId: gatedPublication.id }]);
assert.equal(publicationClicks, clicksBeforeGate, 'watcher never submits; coordinator must revalidate and claim');
assert.equal(JSON.stringify(publicationStorage), gatedSnapshot, 'watcher never mutates saved state or receipts');
console.log('Continuous publication human checkpoint passed: pending CAPTCHA blocks, verified fixture token wakes once, real validator/observer, zero submission or storage mutation');
