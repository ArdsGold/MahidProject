import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test, type TestContext } from "node:test";
import { Window } from "happy-dom";
import { createEmptyProfileInput, type BusinessProfile } from "@backlink-autofill/shared";
import { inspectUniqueListing, uniqueListingAdapter } from "../../src/automation/unique-listing";
import { getSiteAdapter } from "../../src/automation/adapters";
import { runListingAutofill, runListingAutofillAsync } from "../../src/content/listing-autofill";
import { createListingRun, updateListingRun } from "../../src/listing-run";
import { detectSubmissionResult, extractLiveUrl } from "../../src/automation/verification";

// Runner bundles into test/.tmp/family3/.
const fixture = readFileSync(new URL("../../family3/fixtures/unique-listing.html", import.meta.url), "utf8");
const profile: BusinessProfile = { ...createEmptyProfileInput(), id: "family3-test", businessName: "Example Business", contactName: "Example Owner", email: "owner@example.test", website: "https://example.test/", description: "<p>Long description with <a href='https://example.test/'>visible words</a>.</p><p>Second paragraph.</p>", shortDescription: "Short only", category: "Web Design", services: [], imageUrl: "https://example.test/image.png", logoAsset: { id: "logo", fileName: "logo.png", mimeType: "image/png", size: 10 }, createdAt: "2026-10-17T00:00:00Z", updatedAt: "2026-10-17T00:00:00Z" };

function setup(t: TestContext, html = fixture, url = "https://unique-listing.com/submit.php") {
  const win = new Window({ url, settings: { disableJavaScriptEvaluation: true, disableJavaScriptFileLoading: true, disableCSSFileLoading: true, disableIframePageLoading: true } });
  const g = globalThis as Record<string, unknown>;
  for (const key of ["window", "document", "location", "HTMLInputElement", "HTMLTextAreaElement", "HTMLSelectElement", "Element", "Event"]) g[key] = key === "window" ? win : (win as unknown as Record<string, unknown>)[key];
  g.chrome = new Proxy({}, { get: () => { throw Error("No browser storage or messages allowed in adapter"); } });
  win.document.write(html);
  let submits = 0, clicks = 0;
  win.document.addEventListener("submit", e => { submits++; e.preventDefault(); });
  win.document.addEventListener("click", () => { clicks++; });
  for (const form of win.document.forms) {
    Object.defineProperty(form, "submit", { value: () => { submits++; } });
    Object.defineProperty(form, "requestSubmit", { value: () => { submits++; } });
  }
  const value = (name: string) => (win.document.querySelector(`[name="${name}"]`) as unknown as HTMLInputElement).value;
  t.after(async () => { assert.equal(submits, 0); assert.equal(clicks, 0); await win.happyDOM.close(); });
  return { win, doc: win.document as unknown as Document, value };
}

test("verified native form and Continue control are recognized; unknown success is never claimed", t => {
  const { doc } = setup(t);
  const result = inspectUniqueListing(doc, location.href);
  assert.equal(result.state, "form");
  if (result.state === "form") { assert.equal(result.submit.name, "submit"); assert.equal(result.submit.value, "Continue"); }
  assert.equal(getSiteAdapter(location.href)?.config.id, "unique-listing");
  assert.equal(detectSubmissionResult({ url: location.href, text: "Continue clicked; listing submitted successfully" }, uniqueListingAdapter.config), "in-progress");
  assert.equal(extractLiveUrl({ url: location.href, links: [{ text: "View Listing", href: "https://unique-listing.com/test" }] }, uniqueListingAdapter.config), undefined);
});

test("all six fields use existing profile mapping and real options; search/outside/reciprocal/Terms/media untouched", t => {
  const { doc, value } = setup(t);
  doc.body.insertAdjacentHTML("beforeend", '<input type="file" accept="image/*" name="outside-logo"><input type="checkbox" name="terms" aria-label="I agree to Terms"><select name="country"><option value="">Country</option><option value="US">United States</option></select>');
  let events = 0;
  doc.querySelector('[name="TITLE"]')!.addEventListener("change", () => { events++; });
  const report = runListingAutofill(profile);
  assert.deepEqual(report.filled.map(f => f.field), ["businessName", "website", "description", "contactName", "email", "category"]);
  assert.equal(value("TITLE"), profile.businessName); assert.equal(value("URL"), profile.website);
  assert.equal(value("OWNER_NAME"), profile.contactName); assert.equal(value("OWNER_EMAIL"), profile.email);
  assert(value("DESCRIPTION").includes("visible words")); assert(!value("DESCRIPTION").includes("<")); assert(!value("DESCRIPTION").includes(profile.imageUrl)); assert(!value("DESCRIPTION").includes("Short only"));
  const category = doc.querySelector<HTMLSelectElement>('[name="CATEGORY_ID"]')!;
  assert(category.selectedOptions[0].textContent?.includes("Web Design")); assert.notEqual(category.value, "0");
  for (const name of ["q", "email", "RECPR_URL", "RECPR_TEXT", "country"]) assert.equal(value(name), "");
  assert.equal(doc.querySelector<HTMLInputElement>('[name="terms"]')!.checked, false);
  assert.equal(doc.querySelector<HTMLInputElement>('[type="file"]')!.files?.length, 0);
  assert.equal(report.form, undefined); assert.equal(events, 1);
  assert(report.manual.includes("CAPTCHA")); assert(report.manual.some(x => /Final Continue/.test(x)));
});

test("invalid and missing profile values and native max length are reported without inventing replacements", t => {
  const { value } = setup(t);
  const report = runListingAutofill({ ...profile, businessName: "x".repeat(256), email: "invalid", website: "javascript:alert(1)", contactName: "", firstName: "", lastName: "", category: "zzzzzzzzzz", description: "" });
  assert.equal(value("TITLE"), ""); assert.equal(value("URL"), ""); assert.equal(value("OWNER_EMAIL"), ""); assert.equal(value("CATEGORY_ID"), "0");
  assert(report.skipped.some(x => /maximum length/.test(x.reason))); assert(report.manual.some(x => /Email is invalid/.test(x))); assert(report.manual.some(x => /CATEGORY_ID/.test(x)));
});

test("site-cleared values are not reported verified, including values changed by a later field event", t => {
  const { doc } = setup(t);
  doc.querySelector('[name="OWNER_EMAIL"]')!.addEventListener("change", () => { doc.querySelector<HTMLInputElement>('[name="TITLE"]')!.value = ""; });
  doc.querySelector('[name="DESCRIPTION"]')!.addEventListener("change", () => { doc.querySelector<HTMLTextAreaElement>('[name="DESCRIPTION"]')!.value = ""; });
  const report = runListingAutofill(profile);
  assert(!report.filled.some(f => ["businessName", "description"].includes(f.field)));
  assert(report.manual.some(x => /value changed after autofill/.test(x)));
  assert(report.manual.some(x => /validation failed/.test(x)));
});

test("a form action changed by a final-field event prevents a verified report", t => {
  const { doc } = setup(t);
  doc.querySelector('[name="CATEGORY_ID"]')!.addEventListener("change", () => { doc.querySelector('[name="TITLE"]')!.closest("form")!.action = "https://evil.test/submit.php"; });
  const report = runListingAutofill(profile);
  assert.equal(report.filled.length, 0);
  assert(report.manual.some(x => /structure changed after autofill/.test(x)));
});

test("missing, duplicate, disabled, hidden, new upload and changed actions/submit controls stop before writes", t => {
  const { doc } = setup(t);
  const variants = [
    (f: HTMLFormElement) => f.querySelector('[name="OWNER_EMAIL"]')!.remove(),
    (f: HTMLFormElement) => f.append(f.querySelector('[name="TITLE"]')!.cloneNode(true)),
    (f: HTMLFormElement) => { f.querySelector<HTMLInputElement>('[name="TITLE"]')!.disabled = true; },
    (f: HTMLFormElement) => { f.querySelector<HTMLElement>('[name="TITLE"]')!.style.display = "none"; },
    (f: HTMLFormElement) => f.insertAdjacentHTML("beforeend", '<input type="file" name="new-image">'),
    (f: HTMLFormElement) => { f.action = "https://evil.test/submit.php"; },
    (f: HTMLFormElement) => { f.setAttribute("action", "http://["); },
    (f: HTMLFormElement) => { f.querySelector<HTMLInputElement>('[name="submit"]')!.value = "Publish"; },
    (f: HTMLFormElement) => { f.querySelector<HTMLInputElement>('[name="submit"]')!.setAttribute("formaction", "/other.php"); },
  ];
  for (const mutate of variants) {
    doc.body.innerHTML = fixture;
    const form = doc.querySelector('[name="TITLE"]')!.closest("form")!;
    mutate(form);
    const before = doc.body.innerHTML;
    const report = runListingAutofill(profile);
    assert.equal(report.filled.length, 0); assert(report.manual.some(x => /manual review/.test(x))); assert.equal(doc.body.innerHTML, before);
  }
});

test("home navigation returns only observed native safe Submit Links without clicking", t => {
  setup(t, '<form><input name="q"><button>Search</button></form><a href="/submit.php">Submit Links</a>', "https://unique-listing.com/");
  const report = runListingAutofill(profile);
  assert.equal(report.navigationUrl, "https://unique-listing.com/submit.php"); assert.equal(report.entryClick, false); assert.equal(report.filled.length, 0);
  for (const href of ["https://evil.test/submit.php", "javascript:alert(1)", "https://unique-listing.com/submit.php?token=x", "https://user:secret@unique-listing.com/submit.php", "http://unique-listing.com/submit.php"]) assert.equal(uniqueListingAdapter.discoverEntry("", [{ text: "Submit Links", href }]), null);
  assert.equal(uniqueListingAdapter.discoverEntry("", [{ text: "Submit Links", href: "https://unique-listing.com/submit.php" }, { text: "Submit Links", href: "https://unique-listing.com/submit.php?c=158" }]), null);
});

test("challenge, login, changed page and unsafe origin never fall back to generic form mapping", t => {
  const { doc, win } = setup(t);
  for (const url of ["https://unique-listing.com/login.php", "http://unique-listing.com/submit.php", "https://unique-listing.com:3210/submit.php", "https://unique-listing.com/submit.php?activate=1"]) {
    win.happyDOM.setURL(url); const report = runListingAutofill(profile); assert.equal(report.filled.length, 0);
  }
  win.happyDOM.setURL("https://unique-listing.com/submit.php"); doc.body.innerHTML = '<h1>Bot Verification</h1><form><input name="email"><input name="password"></form>';
  assert.equal(runListingAutofill(profile).filled.length, 0);
  assert.equal(uniqueListingAdapter.matches("https://unique-listing.com.evil.test/"), false);
});

test("async path skips unrelated location cascade and repeated autofill never dispatches submission or changes run identity", async t => {
  const { doc } = setup(t);
  doc.body.insertAdjacentHTML("beforeend", '<select name="country"><option value="">Country</option><option value="US">United States</option></select>');
  const run = createListingRun(location.href, profile.id, 42);
  for (let i = 0; i < 2; i++) {
    const report = await runListingAutofillAsync({ ...profile, country: "United States" });
    const next = updateListingRun(run, { stage: "MANUAL_GATE", manual: report.manual });
    assert.equal(next.id, run.id); assert.equal(next.profileId, profile.id); assert.equal(next.tabId, 42); assert.equal(next.stage, "MANUAL_GATE");
    assert.equal(report.filled.length, 6);
  }
  assert.equal(doc.querySelector<HTMLSelectElement>('[name="country"]')!.value, "");
});
