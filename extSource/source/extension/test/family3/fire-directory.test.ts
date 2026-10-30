import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import { createEmptyProfileInput, type BusinessProfile } from "@backlink-autofill/shared";
import { inspectNativeDirectory } from "../../src/automation/native-directory";
import { getSiteAdapter } from "../../src/automation/adapters";
import { fireDirectoryAdapter, inspectFireDirectory, fireDirectorySite } from "../../src/automation/fire-directory";
import { runListingAutofill, runListingAutofillAsync } from "../../src/content/listing-autofill";

const fixture = readFileSync(new URL("../../family3/fixtures/fire-directory.html", import.meta.url), "utf8");
const profile: BusinessProfile = { ...createEmptyProfileInput(), id: "sample", businessName: "Example Test Business", website: "https://example.test/business", contactName: "Example Owner", email: "owner@example.test", description: "Safe sample description. Never submit.", category: "Web Design and Development", createdAt: "2026-10-19", updatedAt: "2026-10-19" };
function setup(t: TestContext, url = "https://fire-directory.com/submit.php", html = fixture) {
  const win = new Window({ url, settings: { disableJavaScriptEvaluation: true, disableJavaScriptFileLoading: true, disableCSSFileLoading: true, disableIframePageLoading: true } }); win.document.write(html);
  const g = globalThis as Record<string, unknown>;
  for (const key of ["window", "document", "location", "HTMLInputElement", "HTMLTextAreaElement", "HTMLSelectElement", "Element", "Event"]) g[key] = key === "window" ? win : (win as unknown as Record<string, unknown>)[key];
  g.chrome = new Proxy({}, { get: () => { throw Error("Fire Directory autofill cannot access runs/receipts/authorization/Sheets"); } });
  const doc = win.document as unknown as Document; let actions = 0;
  doc.addEventListener("click", () => actions++); doc.addEventListener("submit", e => { e.preventDefault(); actions++; });
  for (const form of win.document.forms) for (const method of ["submit", "requestSubmit"]) Object.defineProperty(form, method, { value: () => { throw Error("No submission allowed"); } });
  t.after(() => { assert.equal(actions, 0); win.close(); });
  return { doc, value: (name: string) => doc.querySelector<HTMLInputElement>(`[name="${name}"]`)!.value };
}

test("F08 exact Add Site preserves recorded Add Site navigation and refuses scheme/host substitution", t => {
  setup(t, 'https://fire-directory.com/', '<a href="/submit.php">Add Site</a>');
  assert.equal(getSiteAdapter(location.href)?.config.id, 'fire-directory');
  assert.deepEqual(runListingAutofill(profile).entryAction, { label: 'Add Site', href: 'https://fire-directory.com/submit.php' });
  for (const href of ['http://fire-directory.com/submit.php', 'https://fire-directory.com.evil.test/submit.php', 'http://directory3.org/submit.php']) assert.equal(fireDirectoryAdapter.discoverEntry('', [{ text: 'Add Site', href }]), null);
});

test("F08 captured Submit is native same-page POST; six values/category fill without activation or reciprocal changes", t => {
  const { doc, value } = setup(t); const inspection = inspectFireDirectory(doc, location.href); assert.equal(inspection.state, 'form');
  if (inspection.state !== 'form') throw Error('Expected captured native F08 contract');
  assert.equal(inspection.submit.type, 'submit'); assert.equal(inspection.submit.name, 'submit'); assert.equal(inspection.submit.value, 'Submit');
  assert.equal(inspection.submit.form, inspection.form); assert.equal(inspection.form.method.toLowerCase(), 'post'); assert.equal(inspection.form.action, 'https://fire-directory.com/submit.php'); assert.equal(inspection.form.target, '');
  assert.equal(inspection.submit.hasAttribute('formaction'), false); assert.equal(inspection.submit.hasAttribute('onclick'), false);
  for (const name of ['RECPR_URL', 'RECPR_TEXT']) (doc.querySelector(`[name=${name}]`) as HTMLInputElement).value = 'unchanged';
  inspection.form.insertAdjacentHTML('beforeend', '<input type="checkbox" name="terms"><textarea name="g-recaptcha-response">human-only-token</textarea>');
  const select = doc.querySelector<HTMLSelectElement>('[name=CATEGORY_ID]')!; assert.equal(select.options.length, 540); assert.match([...select.options].find(o => o.value === '15')!.textContent!, /Digital/);
  const option = [...select.options].find(o => o.textContent?.trim().endsWith('___Web Design and Development'))!; option.value = 'current-approved-option';
  const report = runListingAutofill(profile); assert.equal(report.filled.length, 6); assert.equal(doc.querySelector<HTMLInputElement>('[name=LINK_TYPE]')!.checked, true); assert(!report.manual.some(m => /LINK_TYPE.*human selection/.test(m))); assert.equal(value('CATEGORY_ID'), option.value);
  for (const [name, expected] of Object.entries({ TITLE: profile.businessName, URL: profile.website, DESCRIPTION: profile.description, OWNER_NAME: profile.contactName, OWNER_EMAIL: profile.email })) assert.equal(value(name), expected);
  for (const name of ['RECPR_URL', 'RECPR_TEXT']) assert.equal(value(name), 'unchanged'); assert.equal(value('g-recaptcha-response'), 'human-only-token'); assert.equal(doc.querySelector<HTMLInputElement>('[name=terms]')!.checked, false);
  assert(report.manual.includes('Final Submit (manual only)')); assert(!report.manual.includes('Final Continue (manual only)')); assert(report.adaptive?.diagnostics.includes('Submit identified; never clicked')); assert.equal(report.form, undefined); assert.equal(report.liveUrl, undefined);
});

test("F08 Submit support is explicit opt-in; default Continue inspector still refuses this control", t => {
  const { doc } = setup(t);
  assert.equal(inspectNativeDirectory(doc, location.href, { ...fireDirectorySite, submitValue: undefined }).state, 'unsupported');
  assert.equal(inspectFireDirectory(doc, location.href).state, 'form');
});

for (const change of ['wrong-label', 'disabled', 'extra-submit', 'formaction', 'foreign-form', 'wrong-description']) test(`F08 final/form contract refuses ${change}`, t => {
  const { doc } = setup(t); const submit = doc.querySelector<HTMLInputElement>('[name=submit]')!;
  if (change === 'wrong-label') submit.value = 'Continue';
  if (change === 'disabled') submit.disabled = true;
  if (change === 'extra-submit') submit.after(submit.cloneNode(true));
  if (change === 'formaction') submit.setAttribute('formaction', '/other.php');
  if (change === 'foreign-form') submit.form!.action = 'http://directory3.org/submit.php';
  if (change === 'wrong-description') doc.querySelector('[name=DESCRIPTION]')!.outerHTML = '<input name="DESCRIPTION">';
  assert.equal(runListingAutofill(profile).filled.length, 0);
});

test("F08 category uses approved category/services, never incidental text/remembered15", t => {
  const { value } = setup(t); runListingAutofill({ ...profile, category: 'zzzzzz', services: [], businessName: profile.category, description: profile.category }); assert.equal(value('CATEGORY_ID'), '0');
  const report = runListingAutofill({ ...profile, category: '', services: ['Web Design and Development'] }); assert(report.filled.some(f => f.field === 'category'));
});

test("F08 missing/invalid native business values remain unfilled", t => {
  const { value } = setup(t); const report = runListingAutofill({ ...profile, businessName: '', website: 'invalid', email: 'invalid' }); assert(report.skipped.length >= 3);
  for (const name of ['TITLE', 'URL', 'OWNER_EMAIL']) assert.equal(value(name), '');
});

test("F08 async route preserves HTTPS and fails closed on HTTP/error docs", async t => {
  setup(t); assert.equal((await runListingAutofillAsync(profile)).filled.length, 6);
  setup(t, 'http://fire-directory.com/submit.php'); assert.equal((await runListingAutofillAsync(profile)).filled.length, 0);
  setup(t, 'https://fire-directory.com/submit.php', '<title>403 Forbidden</title><h1>Forbidden</h1>'); assert.equal((await runListingAutofillAsync(profile)).filled.length, 0);
});


for (const change of ['duplicate', 'wrong-value', 'wrong-type', 'disabled']) test(`F08 unsupported radio ${change} fails closed`, t => {
 const {doc} = setup(t); const radio = doc.querySelector<HTMLInputElement>('[name=LINK_TYPE]')!;
 if(change==='duplicate') radio.after(radio.cloneNode(true));
 if(change==='wrong-value') radio.value='paid';
 if(change==='wrong-type') radio.type='checkbox';
 if(change==='disabled') radio.disabled=true;
 assert.equal(runListingAutofill(profile).filled.length,0); assert.equal(radio.checked,false);
});
test('F08 incomplete profile leaves radio unchanged, no consent or submission side effects', t => {
 const {doc}=setup(t); const report=runListingAutofill({...profile, email:''});
 assert(report.skipped.length>0); assert.equal(doc.querySelector<HTMLInputElement>('[name=LINK_TYPE]')!.checked,false);
});

test('F08 unrelated profile category cannot default to recorded15 or select radio', t => {
 const {doc,value}=setup(t); const report=runListingAutofill({...profile, category:'zzzzzz', services:[]});
 assert(report.skipped.some(s=>/category/i.test(s.reason))); assert.equal(value('CATEGORY_ID'),'0');
 assert.equal(doc.querySelector<HTMLInputElement>('[name=LINK_TYPE]')!.checked,false);
});
