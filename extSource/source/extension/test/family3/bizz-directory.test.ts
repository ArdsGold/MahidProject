import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import { createEmptyProfileInput, type BusinessProfile } from "@backlink-autofill/shared";
import { getSiteAdapter } from "../../src/automation/adapters";
import { bizzDirectoryAdapter, inspectBizzDirectory } from "../../src/automation/bizz-directory";
import { runListingAutofill, runListingAutofillAsync } from "../../src/content/listing-autofill";
const fixture = readFileSync(new URL("../../family3/fixtures/bizz-directory.html", import.meta.url), "utf8");
const profile: BusinessProfile = { ...createEmptyProfileInput(), id: "sample", businessName: "Example Business", website: "https://example.test/business", contactName: "Example Owner", email: "owner@example.test", description: "Approved sample business description. Never submit.", category: "Web Design", createdAt: "2026-10-18", updatedAt: "2026-10-18" };
function setup(t: TestContext, url = "https://bizz-directory.com/submit.php", html = fixture) {
  const win = new Window({ url, settings: { disableJavaScriptEvaluation: true, disableJavaScriptFileLoading: true, disableCSSFileLoading: true, disableIframePageLoading: true } });
  win.document.write(html);
  const g = globalThis as Record<string, unknown>;
  for (const key of ["window", "document", "location", "HTMLInputElement", "HTMLTextAreaElement", "HTMLSelectElement", "Element", "Event"]) g[key] = key === "window" ? win : (win as unknown as Record<string, unknown>)[key];
  g.chrome = new Proxy({}, { get: () => { throw Error("Form-only route must not access runs, receipts, submission or Sheets"); } });
  const doc = win.document as unknown as Document;
  let actions = 0;
  doc.addEventListener("click", () => actions++);
  doc.addEventListener("submit", e => { actions++; e.preventDefault(); });
  for (const form of win.document.forms) for (const method of ["submit", "requestSubmit"]) Object.defineProperty(form, method, { value: () => actions++ });
  t.after(async () => { assert.equal(actions, 0); await win.happyDOM.close(); });
  return { doc, value: (name: string) => doc.querySelector<HTMLInputElement>(`[name="${name}"]`)!.value };
}
test("Bizz routes singular observed Submit Link through existing native navigation", t => {
  setup(t, "https://bizz-directory.com/", '<a href="/submit.php">Submit Link</a><a href="/submit.php">Submit Link</a>');
  const report = runListingAutofill(profile);
  assert.equal(getSiteAdapter(location.href)?.config.id, "bizz-directory");
  assert.equal(report.navigationUrl, "https://bizz-directory.com/submit.php");
  assert.deepEqual(report.entryAction, { label: "Submit Link", href: report.navigationUrl });
  assert.equal(report.filled.length, 0);
  assert.equal(bizzDirectoryAdapter.discoverEntry("", [{ text: "Submit Links", href: report.navigationUrl! }]), null);
});
test("verified Bizz form reuses six mappings and current options without touching reciprocal/search/Terms", t => {
  const { doc, value } = setup(t);
  doc.body.insertAdjacentHTML("beforeend", '<input name="q" type="text"><input type="checkbox" name="terms" aria-label="Accept Terms">');
  const reciprocal = value("RECPR_TEXT");
  assert.equal(inspectBizzDirectory(doc, location.href).state, "form");
  const web = [...doc.querySelector<HTMLSelectElement>('[name=CATEGORY_ID]')!.options].find(o => o.textContent?.trim().endsWith("___Web Design"))!;
  web.value = "current-bizz-option-not-37";
  const report = runListingAutofill(profile);
  assert.equal(report.filled.length, 6);
  for (const [name, expected] of Object.entries({ TITLE: profile.businessName, URL: profile.website, OWNER_NAME: profile.contactName, OWNER_EMAIL: profile.email, DESCRIPTION: profile.description })) assert.equal(value(name), expected);
  assert.equal(value("CATEGORY_ID"), web.value);
  assert.equal(value("RECPR_TEXT"), reciprocal); assert.equal(value("RECPR_URL"), ""); assert.equal(value("q"), "");
  assert.equal(doc.querySelector<HTMLInputElement>('[name=terms]')!.checked, false);
  assert.equal(report.liveUrl, undefined); assert.equal(report.form, undefined);
});
test("Bizz category needs actual category/services evidence, no incidental business words", t => {
  const { value } = setup(t);
  const report = runListingAutofill({ ...profile, category: "zzzzzz", businessName: "Web Design", description: "Web Design" });
  assert.equal(value("CATEGORY_ID"), "0"); assert(!report.filled.some(f => f.field === "category"));
});
for (const changed of ['<input type="file" name="new_upload">', '<input type="text" name="unexpected">']) test(`Bizz unsupported controls fail closed: ${changed}`, t => {
  const { doc } = setup(t); doc.querySelector('form')!.insertAdjacentHTML("beforeend", changed);
  assert.equal(runListingAutofill(profile).filled.length, 0);
});
test("Bizz adapter refuses HTTP, foreign actions, forged hosts and cross-site entry", t => {
  const { doc } = setup(t);
  doc.querySelector('form')!.action = "https://directory3.org/submit.php";
  assert.equal(runListingAutofill(profile).filled.length, 0);
  for (const href of ["http://bizz-directory.com/submit.php", "https://bizz-directory.com.evil.test/submit.php", "https://directory3.org/submit.php", "https://user:pass@bizz-directory.com/submit.php"]) assert.equal(bizzDirectoryAdapter.discoverEntry("", [{ text: "Submit Link", href }]), null);
});
test("async Bizz uses native branch without generic navigation or storage side effects", async t => {
  setup(t); const report = await runListingAutofillAsync(profile); assert.equal(report.filled.length, 6);
});

test("Bizz keeps tied service-only categories manual and uses a distinctive approved service, never37", t => {
  const { value } = setup(t);
  const ambiguous = runListingAutofill({ ...profile, category: "", services: ["Web Design"] });
  assert(!ambiguous.filled.some(f => f.field === "category")); assert.equal(value("CATEGORY_ID"), "0");
  const report = runListingAutofill({ ...profile, category: "", services: ["Web Design and Development"] });
  assert(report.filled.some(f => f.field === "category")); assert.notEqual(value("CATEGORY_ID"), "37");
});

test("Bizz validates missing title and invalid email/URL without submission", t => {
  const { value } = setup(t);
  const report = runListingAutofill({ ...profile, businessName: "", email: "invalid", website: "not-a-url" });
  for (const name of ["TITLE", "URL", "OWNER_EMAIL"]) assert.equal(value(name), "");
  assert(report.skipped.length >= 3);
});
