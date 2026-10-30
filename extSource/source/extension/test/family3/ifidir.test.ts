import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import { createEmptyProfileInput, type BusinessProfile } from "@backlink-autofill/shared";
import { getSiteAdapter } from "../../src/automation/adapters";
import { ifidirAdapter, inspectIfidir } from "../../src/automation/ifidir";
import { runListingAutofill, runListingAutofillAsync } from "../../src/content/listing-autofill";

const fixture = readFileSync(new URL("../../family3/fixtures/ifidir.html", import.meta.url), "utf8");
const profile: BusinessProfile = { ...createEmptyProfileInput(), id: "sample", businessName: "Example Test Business", website: "https://example.test/business", contactName: "Example Owner", email: "owner@example.test", description: "Safe sample description. Never submit.", category: "Web Design and Development", createdAt: "2026-10-19", updatedAt: "2026-10-19" };
function setup(t: TestContext, url = "http://ifidir.com/submit.php", html = fixture) {
  const win = new Window({ url, settings: { disableJavaScriptEvaluation: true, disableJavaScriptFileLoading: true, disableCSSFileLoading: true, disableIframePageLoading: true } }); win.document.write(html);
  const g = globalThis as Record<string, unknown>;
  for (const key of ["window", "document", "location", "HTMLInputElement", "HTMLTextAreaElement", "HTMLSelectElement", "Element", "Event"]) g[key] = key === "window" ? win : (win as unknown as Record<string, unknown>)[key];
  g.chrome = new Proxy({}, { get: () => { throw Error("Ifidir autofill cannot access runs/receipts/authorization/Sheets"); } });
  const doc = win.document as unknown as Document; let actions = 0;
  doc.addEventListener("click", () => actions++); doc.addEventListener("submit", e => { e.preventDefault(); actions++; });
  for (const form of win.document.forms) for (const method of ["submit", "requestSubmit"]) Object.defineProperty(form, method, { value: () => { throw Error("No submission allowed"); } });
  t.after(() => { assert.equal(actions, 0); win.close(); });
  return { doc, value: (name: string) => doc.querySelector<HTMLInputElement>(`[name="${name}"]`)!.value };
}


// These verify compatibility with the existing contract, not inaccessible live DOM.
test('Ifidir recorded HTTP Add Site discovers exact submission URL',t=>{
 setup(t,'http://ifidir.com/','<a href="/submit.php">Add Site</a>');assert.equal(getSiteAdapter(location.href)?.config.id,'ifidir');assert.deepEqual(runListingAutofill(profile).entryAction,{label:'Add Site',href:'http://ifidir.com/submit.php'});
 for(const href of ['ftp://ifidir.com/submit.php','http://ifidir.com.evil.test/submit.php','http://example.test/submit.php'])assert.equal(ifidirAdapter.discoverEntry('',[{text:'Add Site',href}]),null);
});
test('Ifidir synthetic compatible form maps6 dynamically and preserves human fields',t=>{
 const {doc,value}=setup(t);assert.equal(inspectIfidir(doc,location.href).state,'form');
 for(const name of ['RECPR_URL','RECPR_TEXT'])(doc.querySelector('[name='+name+']') as HTMLInputElement).value='untouched';
 doc.querySelector('form')!.insertAdjacentHTML('beforeend','<input type="checkbox" name="terms"><textarea name="g-recaptcha-response">human-only-token</textarea>');
 const option=doc.querySelector<HTMLOptionElement>('option[value="test-only-design"]')!;option.value='changed-current-option';
 const report=runListingAutofill(profile);assert.equal(report.filled.length,6);assert.equal(value('CATEGORY_ID'),option.value);
 for(const [name,expected]of Object.entries({TITLE:profile.businessName,URL:profile.website,DESCRIPTION:profile.description,OWNER_NAME:profile.contactName,OWNER_EMAIL:profile.email}))assert.equal(value(name),expected);
 for(const name of ['RECPR_URL','RECPR_TEXT'])assert.equal(value(name),'untouched');assert.equal(value('g-recaptcha-response'),'human-only-token');assert.equal(doc.querySelector<HTMLInputElement>('[name=terms]')!.checked,false);assert(report.manual.includes('Final Continue (manual only)'));assert.equal(report.form,undefined);assert.equal(report.liveUrl,undefined);
});
test('Ifidir unrelated category cannot default to recorded17 or incidental text',t=>{
 const {value}=setup(t);runListingAutofill({...profile,category:'zzzzzz',services:[],businessName:profile.category,description:profile.category});assert.equal(value('CATEGORY_ID'),'0');
});
test('Ifidir native value validation and changed structure fail closed',t=>{
 const {doc,value}=setup(t);const report=runListingAutofill({...profile,businessName:'',website:'invalid',email:'invalid'});assert(report.skipped.length>=3);for(const name of ['TITLE','URL','OWNER_EMAIL'])assert.equal(value(name),'');doc.querySelector('[name=DESCRIPTION]')!.outerHTML='<input name="DESCRIPTION">';assert.equal(runListingAutofill(profile).filled.length,0);
});
test('Ifidir unknown final control refuses autofill; Continue not asserted as live evidence',t=>{
 const {doc}=setup(t);doc.querySelector<HTMLInputElement>('[name=submit]')!.value='Submit';assert.equal(runListingAutofill(profile).filled.length,0);
});
test('Ifidir competing native targets remain ambiguous, no first-link fallback',t=>{
 setup(t,'http://ifidir.com/','<a href="/submit.php">Add Site</a><a href="/submit.php?c=1">Add Site</a>');assert.equal(runListingAutofill(profile).navigationUrl,undefined);
});
test('Ifidir async route accepts synthetic compatible HTTP/HTTPS and refuses error docs',async t=>{
 setup(t);assert.equal((await runListingAutofillAsync(profile)).filled.length,6);setup(t,'https://ifidir.com/submit.php');assert.equal((await runListingAutofillAsync(profile)).filled.length,6);setup(t,'http://ifidir.com/submit.php','<title>Unavailable</title>');assert.equal((await runListingAutofillAsync(profile)).filled.length,0);
});

test('Ifidir HTTPS entry stays on its actual origin, no fixed HTTP downgrade',t=>{setup(t,'https://www.ifidir.com/','<a href="/submit.php">Add Site</a>');assert.equal(getSiteAdapter(location.href)?.config.id,'ifidir');assert.equal(runListingAutofill(profile).entryAction?.href,'https://www.ifidir.com/submit.php');});
