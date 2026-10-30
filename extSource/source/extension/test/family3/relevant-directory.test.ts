import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import { createEmptyProfileInput, type BusinessProfile } from "@backlink-autofill/shared";
import { getSiteAdapter } from "../../src/automation/adapters";
import { relevantDirectoryAdapter, inspectRelevantDirectory } from "../../src/automation/relevant-directory";
import { runListingAutofill, runListingAutofillAsync } from "../../src/content/listing-autofill";

const fixture = readFileSync(new URL("../../family3/fixtures/relevant-directory.html", import.meta.url), "utf8");
const profile: BusinessProfile = { ...createEmptyProfileInput(), id: "sample", businessName: "Example Test Business", website: "https://example.test/business", contactName: "Example Owner", email: "owner@example.test", description: "Safe sample description. Never submit.", category: "Illustration", createdAt: "2026-10-19", updatedAt: "2026-10-19" };
function setup(t: TestContext, url = "http://relevantdirectory.biz/submit.php", html = fixture) {
  const win = new Window({ url, settings: { disableJavaScriptEvaluation: true, disableJavaScriptFileLoading: true, disableCSSFileLoading: true, disableIframePageLoading: true } }); win.document.write(html);
  const g = globalThis as Record<string, unknown>;
  for (const key of ["window", "document", "location", "HTMLInputElement", "HTMLTextAreaElement", "HTMLSelectElement", "Element", "Event"]) g[key] = key === "window" ? win : (win as unknown as Record<string, unknown>)[key];
  g.chrome = new Proxy({}, { get: () => { throw Error("Relevant Directory autofill cannot access runs/receipts/authorization/Sheets"); } });
  const doc = win.document as unknown as Document; let actions = 0;
  doc.addEventListener("click", () => actions++); doc.addEventListener("submit", e => { e.preventDefault(); actions++; });
  for (const form of win.document.forms) for (const method of ["submit", "requestSubmit"]) Object.defineProperty(form, method, { value: () => { throw Error("No submission allowed"); } });
  t.after(() => { assert.equal(actions, 0); win.close(); });
  return { doc, value: (name: string) => doc.querySelector<HTMLInputElement>(`[name="${name}"]`)!.value };
}

test("Relevant Directory recorded Submit Link discovers only safe recorded HTTP form", t => {
  const { doc } = setup(t, 'http://relevantdirectory.biz/', '<a href="/submit.php">Submit Link</a>');
  assert.equal(getSiteAdapter(location.href)?.config.id, 'relevant-directory');
  assert.deepEqual(runListingAutofill(profile).entryAction, { label: 'Submit Link', href: 'http://relevantdirectory.biz/submit.php' });
  for (const href of ['ftp://relevantdirectory.biz/submit.php', 'http://relevantdirectory.biz.evil.test/submit.php', 'https://expansiondirectory.com/submit.php']) assert.equal(relevantDirectoryAdapter.discoverEntry('', [{ text: 'Submit Link', href }]), null);
  doc.body.insertAdjacentHTML('beforeend', '<a href="/submit.php?c=1">Submit Link</a>'); assert.equal(runListingAutofill(profile).navigationUrl, "http://relevantdirectory.biz/submit.php");
});

test("Relevant Directory six confirmed fields/current category fill; CAPTCHA/Terms/reciprocal unchanged", t => {
  const { doc, value } = setup(t); assert.equal(inspectRelevantDirectory(doc, location.href).state, 'form');
  const form = doc.querySelector('form')!; form.insertAdjacentHTML('beforeend', '<input type="checkbox" name="terms"><textarea name="g-recaptcha-response">human-only-token</textarea>');
  for (const name of ['RECPR_URL', 'RECPR_TEXT']) (form.querySelector(`[name=${name}]`) as HTMLInputElement).value = 'unchanged';
  const select = doc.querySelector<HTMLSelectElement>('[name=CATEGORY_ID]')!;
  assert.equal(select.options.length, 621); assert.match([...select.options].find(o => o.value === '35')!.textContent!, /Digital/);
  const option = [...select.options].find(o => o.textContent?.trim().endsWith('___Illustration'))!; option.value = 'current-matched-option';
  const report = runListingAutofill(profile); assert.equal(report.filled.length, 6);
  for (const [name, expected] of Object.entries({ TITLE: profile.businessName, URL: profile.website, DESCRIPTION: profile.description, OWNER_NAME: profile.contactName, OWNER_EMAIL: profile.email })) assert.equal(value(name), expected);
  assert.equal(value('CATEGORY_ID'), option.value); assert.equal(doc.querySelector<HTMLInputElement>('[name=terms]')!.checked, false);
  for (const name of ['RECPR_URL', 'RECPR_TEXT']) assert.equal(value(name), 'unchanged');
  assert.equal(value('g-recaptcha-response'), 'human-only-token'); assert.equal(report.form, undefined); assert.equal(report.liveUrl, undefined); assert(report.manual.includes('Final Continue (manual only)'));
});

test("Relevant Directory duplicate Web Design options remain manual; distinctive approved services match", t => {
  const { doc, value } = setup(t); const select = doc.querySelector<HTMLSelectElement>('[name=CATEGORY_ID]')!;
  assert.equal([...select.options].filter(o => o.textContent?.trim().endsWith('___Web Design and Development')).length, 2);
  let report = runListingAutofill({ ...profile, category: 'Web Design and Development', services: [] }); assert.equal(value('CATEGORY_ID'), '0'); assert(!report.filled.some(f => f.field === 'category'));
  report = runListingAutofill({ ...profile, category: '', services: ['Illustration'] }); assert(report.filled.some(f => f.field === 'category'));
  select.value = '0'; runListingAutofill({ ...profile, category: 'zzzzzz', services: [], businessName: 'Illustration', description: 'Illustration' }); assert.equal(value('CATEGORY_ID'), '0');
});

test("Relevant Directory required validation/changed description retain native refusal", t => {
  const { doc, value } = setup(t); const report = runListingAutofill({ ...profile, businessName: '', website: 'invalid', email: 'invalid' });
  assert(report.skipped.length >= 3); for (const name of ['TITLE', 'URL', 'OWNER_EMAIL']) assert.equal(value(name), '');
  doc.querySelector('[name=DESCRIPTION]')!.outerHTML = '<input name="DESCRIPTION">'; assert.equal(runListingAutofill(profile).filled.length, 0);
});

test("Relevant Directory async native route accepts verified HTTP/HTTPS and refuses error structure", async t => {
  setup(t); assert.equal((await runListingAutofillAsync(profile)).filled.length, 6);
  setup(t, 'https://relevantdirectory.biz/submit.php'); assert.equal((await runListingAutofillAsync(profile)).filled.length, 6);
  setup(t, 'http://relevantdirectory.biz/submit.php', '<title>403 Forbidden</title><h1>Forbidden</h1>'); assert.equal((await runListingAutofillAsync(profile)).filled.length, 0);
});


test('Relevant Directory preserves first Submit Link rather than choosing later targets', t => {
 setup(t,'http://relevantdirectory.biz/','<a href="/submit.php?c=4">Submit Link</a><a href="/submit.php">Submit Link</a>');
 assert.equal(runListingAutofill(profile).navigationUrl,'http://relevantdirectory.biz/submit.php?c=4');
});
test('Relevant Directory never skips an unsafe first recorded link', t => {
 setup(t,'http://relevantdirectory.biz/','<a href="https://example.test/submit.php">Submit Link</a><a href="/submit.php">Submit Link</a>');
 assert.equal(runListingAutofill(profile).navigationUrl,undefined);
});
test('Relevant Directory changed final button fails closed', t => {
 const {doc}=setup(t);doc.querySelector<HTMLInputElement>('[name=submit]')!.value='Submit';assert.equal(runListingAutofill(profile).filled.length,0);
});

test('Relevant captured HTTPS native form maps6 without scheme downgrade or stored category ID',t=>{
 const html=readFileSync(new URL('../../family3/fixtures/relevant-directory-https.html',import.meta.url),'utf8');const {doc,value}=setup(t,'https://relevantdirectory.biz/submit.php',html);const native=inspectRelevantDirectory(doc,location.href);assert.equal(native.state,'form');if(native.state!=='form')throw Error('Expected captured HTTPS form');assert.equal(native.form.action,'https://relevantdirectory.biz/submit.php');const opt=[...doc.querySelector<HTMLSelectElement>('[name=CATEGORY_ID]')!.options].find(o=>o.textContent?.trim().endsWith('___Illustration'))!;opt.value='dynamic-https-option';assert.equal(runListingAutofill(profile).filled.length,6);assert.equal(value('CATEGORY_ID'),opt.value);
});
