import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import { createEmptyProfileInput, type BusinessProfile } from "@backlink-autofill/shared";
import { getSiteAdapter } from "../../src/automation/adapters";
import { auroraDirectoryAdapter, inspectAuroraDirectory } from "../../src/automation/aurora-directory";
import { runListingAutofill, runListingAutofillAsync } from "../../src/content/listing-autofill";

const fixture = readFileSync(new URL("../../family3/fixtures/aurora-directory.html", import.meta.url), "utf8");
const profile: BusinessProfile = { ...createEmptyProfileInput(), id: "sample", businessName: "Example Test Business", website: "https://example.test/business", contactName: "Example Owner", email: "owner@example.test", description: "Safe sample description. Never submit.", category: "Web Design and Development", createdAt: "2026-10-19", updatedAt: "2026-10-19" };
function setup(t: TestContext, url = "https://aurora-directory.com/submit.php", html = fixture) {
  const win = new Window({ url, settings: { disableJavaScriptEvaluation: true, disableJavaScriptFileLoading: true, disableCSSFileLoading: true, disableIframePageLoading: true } }); win.document.write(html);
  const g = globalThis as Record<string, unknown>;
  for (const key of ["window", "document", "location", "HTMLInputElement", "HTMLTextAreaElement", "HTMLSelectElement", "Element", "Event"]) g[key] = key === "window" ? win : (win as unknown as Record<string, unknown>)[key];
  g.chrome = new Proxy({}, { get: () => { throw Error("Aurora autofill cannot access runs/receipts/authorization/Sheets"); } });
  const doc = win.document as unknown as Document; let actions = 0;
  doc.addEventListener("click", () => actions++); doc.addEventListener("submit", e => { e.preventDefault(); actions++; });
  for (const form of win.document.forms) for (const method of ["submit", "requestSubmit"]) Object.defineProperty(form, method, { value: () => { throw Error("No submission allowed"); } });
  t.after(() => { assert.equal(actions, 0); win.close(); });
  return { doc, value: (name: string) => doc.querySelector<HTMLInputElement>(`[name="${name}"]`)!.value };
}

test("Aurora preserves #navigation Submit Link, ignoring matching links outside the recorded scope", t => {
  setup(t, "https://aurora-directory.com/", '<div id="navigation"><a href="/submit.php">Submit Link</a></div><a href="/submit.php?c=99">Submit Link</a>');
  assert.equal(getSiteAdapter(location.href)?.config.id, "aurora-directory");
  assert.deepEqual(runListingAutofill(profile).entryAction, { label: "Submit Link", href: "https://aurora-directory.com/submit.php" });
  for (const href of ["http://aurora-directory.com/submit.php", "https://aurora-directory.com.evil.test/submit.php", "https://expansiondirectory.com/submit.php"]) assert.equal(auroraDirectoryAdapter.discoverEntry("", [{ text: "Submit Link", href }]), null);
});

for (const scenario of ["missing", "duplicate", "wrong-link"]) test(`Aurora refuses changed recorded navigation: ${scenario}`, t => {
  const { doc } = setup(t, "https://aurora-directory.com/", '<div id="navigation"><a href="/submit.php">Submit Link</a></div>');
  const nav = doc.querySelector('#navigation')!;
  if (scenario === "missing") nav.removeAttribute('id');
  if (scenario === "duplicate") nav.after(nav.cloneNode(true));
  if (scenario === "wrong-link") nav.querySelector('a')!.textContent = 'Submit';
  const report = runListingAutofill(profile); assert.equal(report.navigationUrl, undefined); assert.equal(report.filled.length, 0);
});

test("Aurora actual six fields and985 options reuse F04 mapping; no fixed25 or gate changes", t => {
  const { doc, value } = setup(t); assert.equal(inspectAuroraDirectory(doc, location.href).state, "form");
  const form = doc.querySelector('form')!;
  form.insertAdjacentHTML('beforeend', '<input type="checkbox" name="terms"><textarea name="g-recaptcha-response">human-only-token</textarea>');
  for (const name of ['RECPR_URL', 'RECPR_TEXT']) (form.querySelector(`[name=${name}]`) as HTMLInputElement).value = 'unchanged';
  const select = doc.querySelector<HTMLSelectElement>('[name=CATEGORY_ID]')!;
  assert.equal(select.options.length, 985); assert.match([...select.options].find(o => o.value === '25')!.textContent!, /Illustration/);
  const matchedOption = [...select.options].find(o => o.textContent?.trim().endsWith('___Web Design and Development'))!; matchedOption.value = 'current-approved-service-option';
  const report = runListingAutofill(profile); assert.equal(report.filled.length, 6);
  for (const [name, expected] of Object.entries({ TITLE: profile.businessName, URL: profile.website, DESCRIPTION: profile.description, OWNER_NAME: profile.contactName, OWNER_EMAIL: profile.email })) assert.equal(value(name), expected);
  assert.equal(value('CATEGORY_ID'), matchedOption.value);
  for (const name of ['RECPR_URL', 'RECPR_TEXT']) assert.equal(value(name), 'unchanged');
  assert.equal(value('g-recaptcha-response'), 'human-only-token'); assert.equal(doc.querySelector<HTMLInputElement>('[name=terms]')!.checked, false);
  assert.equal(report.liveUrl, undefined); assert.equal(report.form, undefined); assert(report.manual.includes('Final Continue (manual only)'));
});

test("Aurora category requires approved category/services, never incidental business text", t => {
  const { value } = setup(t);
  runListingAutofill({ ...profile, category: 'zzzzzz', services: [], businessName: 'Web Design and Development', description: 'Web Design and Development' }); assert.equal(value('CATEGORY_ID'), '0');
  const report = runListingAutofill({ ...profile, category: '', services: ['Web Design and Development'] }); assert(report.filled.some(f => f.field === 'category'));
});

test("Aurora retains required value and unsupported-description validation", t => {
  const { doc, value } = setup(t);
  const report = runListingAutofill({ ...profile, businessName: '', website: 'invalid', email: 'invalid' }); assert(report.skipped.length >= 3);
  for (const name of ['TITLE', 'URL', 'OWNER_EMAIL']) assert.equal(value(name), '');
  doc.querySelector('[name=DESCRIPTION]')!.outerHTML = '<input name="DESCRIPTION">'; assert.equal(runListingAutofill(profile).filled.length, 0);
});

test("Aurora async native dispatch refuses HTTP/403 instead of generic fallback", async t => {
  setup(t); assert.equal((await runListingAutofillAsync(profile)).filled.length, 6);
  setup(t, 'http://aurora-directory.com/submit.php'); assert.equal((await runListingAutofillAsync(profile)).filled.length, 0);
  setup(t, 'https://aurora-directory.com/submit.php', '<h1>403 Forbidden</h1>'); assert.equal((await runListingAutofillAsync(profile)).filled.length, 0);
});

