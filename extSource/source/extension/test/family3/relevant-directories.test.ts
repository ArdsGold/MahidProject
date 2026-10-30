import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import { createEmptyProfileInput, type BusinessProfile } from "@backlink-autofill/shared";
import { inspectNativeDirectory } from "../../src/automation/native-directory";
import { getSiteAdapter } from "../../src/automation/adapters";
import { relevantDirectoriesAdapter, inspectRelevantDirectories, relevantDirectoriesSite } from "../../src/automation/relevant-directories";
import { runListingAutofill, runListingAutofillAsync } from "../../src/content/listing-autofill";

const fixture = readFileSync(new URL("../../family3/fixtures/relevant-directories-http.html", import.meta.url), "utf8");
const profile: BusinessProfile = { ...createEmptyProfileInput(), id: "sample", businessName: "Example Test Business", website: "https://example.test/business", contactName: "Example Owner", email: "owner@example.test", description: "Safe sample description. Never submit.", category: "Web Design and Development", createdAt: "2026-10-19", updatedAt: "2026-10-19" };
function setup(t: TestContext, url = "http://relevantdirectories.com/submit.php", html = fixture) {
  const win = new Window({ url, settings: { disableJavaScriptEvaluation: true, disableJavaScriptFileLoading: true, disableCSSFileLoading: true, disableIframePageLoading: true } }); win.document.write(html);
  const g = globalThis as Record<string, unknown>;
  for (const key of ["window", "document", "location", "HTMLInputElement", "HTMLTextAreaElement", "HTMLSelectElement", "Element", "Event"]) g[key] = key === "window" ? win : (win as unknown as Record<string, unknown>)[key];
  g.chrome = new Proxy({}, { get: () => { throw Error("Relevant Directories autofill cannot access runs/receipts/authorization/Sheets"); } });
  const doc = win.document as unknown as Document; let actions = 0;
  doc.addEventListener("click", () => actions++); doc.addEventListener("submit", e => { e.preventDefault(); actions++; });
  for (const form of win.document.forms) for (const method of ["submit", "requestSubmit"]) Object.defineProperty(form, method, { value: () => { throw Error("No submission allowed"); } });
  t.after(() => { assert.equal(actions, 0); win.close(); });
  return { doc, value: (name: string) => doc.querySelector<HTMLInputElement>(`[name="${name}"]`)!.value };
}

test("Relevant Directories exact Add Site preserves recorded HTTP navigation and refuses scheme/host substitution", t => {
  setup(t, 'http://relevantdirectories.com/', '<a href="/submit.php">Add Site</a>');
  assert.equal(getSiteAdapter(location.href)?.config.id, 'relevant-directories');
  assert.deepEqual(runListingAutofill(profile).entryAction, { label: 'Add Site', href: 'http://relevantdirectories.com/submit.php' });
  for (const href of ['ftp://relevantdirectories.com/submit.php', 'http://relevantdirectories.com.evil.test/submit.php', 'http://directory3.org/submit.php']) assert.equal(relevantDirectoriesAdapter.discoverEntry('', [{ text: 'Add Site', href }]), null);
});

test("Relevant Directories captured Submit is native same-page POST; six values/category fill without activation or reciprocal changes", t => {
  const { doc, value } = setup(t); const inspection = inspectRelevantDirectories(doc, location.href); assert.equal(inspection.state, 'form');
  if (inspection.state !== 'form') throw Error('Expected captured native Relevant Directories contract');
  assert.equal(inspection.submit.type, 'submit'); assert.equal(inspection.submit.name, 'submit'); assert.equal(inspection.submit.value, 'Submit');
  assert.equal(inspection.submit.form, inspection.form); assert.equal(inspection.form.method.toLowerCase(), 'post'); assert.equal(inspection.form.action, 'http://relevantdirectories.com/submit.php'); assert.equal(inspection.form.target, '');
  assert.equal(inspection.submit.hasAttribute('formaction'), false); assert.equal(inspection.submit.hasAttribute('onclick'), false);
  for (const name of ['RECPR_URL', 'RECPR_TEXT']) (doc.querySelector(`[name=${name}]`) as HTMLInputElement).value = 'unchanged';
  inspection.form.insertAdjacentHTML('beforeend', '<input type="checkbox" name="terms"><textarea name="g-recaptcha-response">human-only-token</textarea>');
  const select = doc.querySelector<HTMLSelectElement>('[name=CATEGORY_ID]')!; assert.equal(select.options.length, 985); assert.match([...select.options].find(o => o.value === '13')!.textContent!, /Crafts/);
  const option = [...select.options].find(o => o.textContent?.trim().endsWith('___Web Design and Development'))!; option.value = 'current-approved-option';
  const report = runListingAutofill(profile); assert.equal(report.filled.length, 6); assert.equal(value('CATEGORY_ID'), option.value);
  for (const [name, expected] of Object.entries({ TITLE: profile.businessName, URL: profile.website, DESCRIPTION: profile.description, OWNER_NAME: profile.contactName, OWNER_EMAIL: profile.email })) assert.equal(value(name), expected);
  for (const name of ['RECPR_URL', 'RECPR_TEXT']) assert.equal(value(name), 'unchanged'); assert.equal(value('g-recaptcha-response'), 'human-only-token'); assert.equal(doc.querySelector<HTMLInputElement>('[name=terms]')!.checked, false);
  assert(report.manual.includes('Final Submit (manual only)')); assert(!report.manual.includes('Final Continue (manual only)')); assert(report.adaptive?.diagnostics.includes('Submit identified; never clicked')); assert.equal(report.form, undefined); assert.equal(report.liveUrl, undefined);
});

test("Relevant Directories Submit support is explicit opt-in; default Continue inspector still refuses this control", t => {
  const { doc } = setup(t);
  assert.equal(inspectNativeDirectory(doc, location.href, { ...relevantDirectoriesSite, submitValue: undefined }).state, 'unsupported');
  assert.equal(inspectRelevantDirectories(doc, location.href).state, 'form');
});

for (const change of ['wrong-label', 'disabled', 'extra-submit', 'formaction', 'foreign-form', 'wrong-description']) test(`Relevant Directories final/form contract refuses ${change}`, t => {
  const { doc } = setup(t); const submit = doc.querySelector<HTMLInputElement>('[name=submit]')!;
  if (change === 'wrong-label') submit.value = 'Continue';
  if (change === 'disabled') submit.disabled = true;
  if (change === 'extra-submit') submit.after(submit.cloneNode(true));
  if (change === 'formaction') submit.setAttribute('formaction', '/other.php');
  if (change === 'foreign-form') submit.form!.action = 'http://directory3.org/submit.php';
  if (change === 'wrong-description') doc.querySelector('[name=DESCRIPTION]')!.outerHTML = '<input name="DESCRIPTION">';
  assert.equal(runListingAutofill(profile).filled.length, 0);
});

test("Relevant Directories category uses approved category/services, never incidental text/remembered13", t => {
  const { value } = setup(t); runListingAutofill({ ...profile, category: 'zzzzzz', services: [], businessName: profile.category, description: profile.category }); assert.equal(value('CATEGORY_ID'), '0');
  const report = runListingAutofill({ ...profile, category: '', services: ['Web Design and Development'] }); assert(report.filled.some(f => f.field === 'category'));
});

test("Relevant Directories missing/invalid native business values remain unfilled", t => {
  const { value } = setup(t); const report = runListingAutofill({ ...profile, businessName: '', website: 'invalid', email: 'invalid' }); assert(report.skipped.length >= 3);
  for (const name of ['TITLE', 'URL', 'OWNER_EMAIL']) assert.equal(value(name), '');
});

test("Relevant Directories async route preserves HTTP and accepts verified HTTPS, refusing error docs", async t => {
  setup(t); assert.equal((await runListingAutofillAsync(profile)).filled.length, 6);
  setup(t, 'https://relevantdirectories.com/submit.php'); assert.equal((await runListingAutofillAsync(profile)).filled.length, 6);
  setup(t, 'http://relevantdirectories.com/submit.php', '<title>403 Forbidden</title><h1>Forbidden</h1>'); assert.equal((await runListingAutofillAsync(profile)).filled.length, 0);
});


test('Relevant Directories actual HTTPS form reuses six-field mapper on same current origin',t=>{const html=readFileSync(new URL('../../family3/fixtures/relevant-directories-https.html',import.meta.url),'utf8');const {doc,value}=setup(t,'https://relevantdirectories.com/submit.php',html);const native=inspectRelevantDirectories(doc,location.href);assert.equal(native.state,'form');if(native.state!=='form')throw Error('Expected actual HTTPS form');assert.equal(native.form.action,'https://relevantdirectories.com/submit.php');assert.equal(runListingAutofill(profile).filled.length,6);assert.notEqual(value('CATEGORY_ID'),'13');});
