import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import { createEmptyProfileInput, type BusinessProfile } from "@backlink-autofill/shared";
import { getSiteAdapter } from "../../src/automation/adapters";
import { advancedSeoDirectoryAdapter, inspectAdvancedSeoDirectory } from "../../src/automation/advanced-seo-directory";
import { runListingAutofill, runListingAutofillAsync } from "../../src/content/listing-autofill";

const fullFixture = readFileSync(new URL("../../family3/fixtures/advanced-seo-directory.html", import.meta.url), "utf8");
// Repeated safety cases retain only observed options; full dictionary stays in
// the field-mapping test and offline headed captured-form workflow.
const fixture = fullFixture.replace(/(<select\b[^>]*name="CATEGORY_ID"[^>]*>)([\s\S]*?)(<\/select>)/i, (_all, open, options, close) => open + (options.match(/<option\b[\s\S]*?<\/option>/gi) || []).filter((option: string) => /value="(?:0|15|18|504)"/.test(option)).join("") + close);
const profile: BusinessProfile = { ...createEmptyProfileInput(), id: "sample", businessName: "Example Test Business", website: "https://example.test/business", contactName: "Example Owner", email: "owner@example.test", description: "Safe sample description. Never submit.", category: "Cleaning", createdAt: "2026-10-19", updatedAt: "2026-10-19" };
function setup(t: TestContext, url = "http://advancedseodirectory.com/submit.php", html = fixture) {
  const win = new Window({ url, settings: { disableJavaScriptEvaluation: true, disableJavaScriptFileLoading: true, disableCSSFileLoading: true, disableIframePageLoading: true } }); win.document.write(html);
  const g = globalThis as Record<string, unknown>;
  for (const key of ["window", "document", "location", "HTMLInputElement", "HTMLTextAreaElement", "HTMLSelectElement", "Element", "Event"]) g[key] = key === "window" ? win : (win as unknown as Record<string, unknown>)[key];
  g.chrome = new Proxy({}, { get: () => { throw Error("Advanced SEO Directory autofill cannot access runs/receipts/authorization/Sheets"); } });
  const doc = win.document as unknown as Document; let actions = 0;
  doc.addEventListener("click", () => actions++); doc.addEventListener("submit", e => { e.preventDefault(); actions++; });
  for (const form of win.document.forms) for (const method of ["submit", "requestSubmit"]) Object.defineProperty(form, method, { value: () => { throw Error("No submission allowed"); } });
  t.after(() => { assert.equal(actions, 0); win.close(); });
  return { doc, value: (name: string) => doc.querySelector<HTMLInputElement>(`[name="${name}"]`)!.value };
}


// HTTP main form captured read-only; no live submission or CAPTCHA actions.
test('Advanced SEO Directory conditional HTTP Add Site discovers exact submission URL',t=>{
 setup(t,'http://advancedseodirectory.com/','<a href="/submit.php">Add Site</a>');assert.equal(getSiteAdapter(location.href)?.config.id,'advanced-seo-directory');assert.equal(advancedSeoDirectoryAdapter.config.startingUrl,'http://advancedseodirectory.com/');assert.deepEqual(runListingAutofill(profile).entryAction,{label:'Add Site',href:'http://advancedseodirectory.com/submit.php'});
 for(const href of ['ftp://advancedseodirectory.com/submit.php','http://advancedseodirectory.com.evil.test/submit.php','http://example.test/submit.php'])assert.equal(advancedSeoDirectoryAdapter.discoverEntry('',[{text:'Add Site',href}]),null);
});
test('Advanced SEO Directory captured HTTP form maps6 dynamically and preserves human fields',t=>{
 const {doc,value}=setup(t,'http://advancedseodirectory.com/submit.php',fullFixture);assert.equal(inspectAdvancedSeoDirectory(doc,location.href).state,'form');
 doc.querySelector('form')!.insertAdjacentHTML('beforeend','<input name="RECPR_URL" value="untouched"><textarea name="RECPR_TEXT">untouched</textarea>');
 doc.querySelector('form')!.insertAdjacentHTML('beforeend','<input type="checkbox" name="terms"><textarea name="g-recaptcha-response">human-only-token</textarea>');
 const option=doc.querySelector<HTMLOptionElement>('option[value="504"]')!;option.value='changed-current-option';
 assert.equal(doc.querySelector<HTMLSelectElement>('[name=CATEGORY_ID]')!.options.length,689);assert.match(doc.querySelector('option[value="15"]')!.textContent!,/___Events$/);const report=runListingAutofill(profile);assert.equal(report.filled.length,6);assert.equal(value('CATEGORY_ID'),option.value);
 for(const [name,expected]of Object.entries({TITLE:profile.businessName,URL:profile.website,DESCRIPTION:profile.description,OWNER_NAME:profile.contactName,OWNER_EMAIL:profile.email}))assert.equal(value(name),expected);
 for(const name of ['RECPR_URL','RECPR_TEXT'])assert.equal(value(name),'untouched');assert.equal(value('g-recaptcha-response'),'human-only-token');assert.equal(doc.querySelector<HTMLInputElement>('[name=terms]')!.checked,false);assert(report.manual.includes('Final Continue (manual only)'));assert.equal(report.form,undefined);assert.equal(report.liveUrl,undefined);
});
test('Advanced SEO Directory unrelated category cannot default to recorded15 or incidental text',t=>{
 const {value}=setup(t);runListingAutofill({...profile,category:'zzzzzz',services:[],businessName:profile.category,description:profile.category});assert.equal(value('CATEGORY_ID'),'0');
});
test('Advanced SEO Directory native value validation and changed structure fail closed',t=>{
 const {doc,value}=setup(t);const report=runListingAutofill({...profile,businessName:'',website:'invalid',email:'invalid'});assert(report.skipped.length>=3);for(const name of ['TITLE','URL','OWNER_EMAIL'])assert.equal(value(name),'');doc.querySelector('[name=DESCRIPTION]')!.outerHTML='<input name="DESCRIPTION">';assert.equal(runListingAutofill(profile).filled.length,0);
});
test('Advanced SEO Directory changed final control refuses autofill; confirmed Continue remains manual',t=>{
 const {doc}=setup(t);doc.querySelector<HTMLInputElement>('[name=submit]')!.value='Submit';assert.equal(runListingAutofill(profile).filled.length,0);
});
test('Advanced SEO Directory competing native targets remain ambiguous, no first-link fallback',t=>{
 setup(t,'http://advancedseodirectory.com/','<a href="/submit.php">Add Site</a><a href="/submit.php?c=1">Add Site</a>');assert.equal(runListingAutofill(profile).navigationUrl,undefined);
});
test('Advanced SEO Directory async route accepts captured HTTP contract with retained HTTPS recognition and refuses error docs',async t=>{
 setup(t);assert.equal((await runListingAutofillAsync(profile)).filled.length,6);setup(t,'https://advancedseodirectory.com/submit.php');assert.equal((await runListingAutofillAsync(profile)).filled.length,6);setup(t,'http://advancedseodirectory.com/submit.php','<title>Unavailable</title>');assert.equal((await runListingAutofillAsync(profile)).filled.length,0);
});

test('Advanced SEO Directory HTTPS entry stays on its actual origin, no fixed HTTP downgrade',t=>{setup(t,'https://www.advancedseodirectory.com/','<a href="/submit.php">Add Site</a>');assert.equal(getSiteAdapter(location.href)?.config.id,'advanced-seo-directory');assert.equal(runListingAutofill(profile).entryAction?.href,'https://www.advancedseodirectory.com/submit.php');});

test('Advanced SEO observed empty error response is not filled or used for fallback navigation',async t=>{setup(t,'https://www.advancedseodirectory.com/submit.php','');const report=await runListingAutofillAsync(profile);assert.equal(report.filled.length,0);assert.equal(report.navigationUrl,undefined);assert.equal(report.form,undefined);assert.equal(report.liveUrl,undefined);});
test('Advanced SEO confirmed category name remains a strict compatibility requirement',t=>{const {doc}=setup(t);doc.querySelector('[name=CATEGORY_ID]')!.setAttribute('name','unverified-category');assert.equal(runListingAutofill(profile).filled.length,0);});

test('Advanced SEO Chrome internal error URL is never a supported native document',t=>{const {doc}=setup(t);assert.equal(getSiteAdapter('chrome-error://chromewebdata/'),null);assert.equal(inspectAdvancedSeoDirectory(doc,'chrome-error://chromewebdata/').state,'unsupported');});
