import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import { createEmptyProfileInput, type BusinessProfile } from "@backlink-autofill/shared";
import { getSiteAdapter } from "../../src/automation/adapters";
import { toptendirAdapter, inspectToptendir } from "../../src/automation/toptendir";
import { runListingAutofill, runListingAutofillAsync } from "../../src/content/listing-autofill";

const fixture = readFileSync(new URL("../../family3/fixtures/toptendir-http.html", import.meta.url), "utf8");
const profile: BusinessProfile = { ...createEmptyProfileInput(), id: "sample", businessName: "Example Test Business", website: "https://example.test/business", contactName: "Example Owner", email: "owner@example.test", description: "Safe sample description. Never submit.", category: "Web Design and Development", createdAt: "2026-10-19", updatedAt: "2026-10-19" };
function setup(t: TestContext, url = "http://toptendir.net/submit.php", html = fixture) {
  const win = new Window({ url, settings: { disableJavaScriptEvaluation: true, disableJavaScriptFileLoading: true, disableCSSFileLoading: true, disableIframePageLoading: true } }); win.document.write(html);
  const g = globalThis as Record<string, unknown>;
  for (const key of ["window", "document", "location", "HTMLInputElement", "HTMLTextAreaElement", "HTMLSelectElement", "Element", "Event"]) g[key] = key === "window" ? win : (win as unknown as Record<string, unknown>)[key];
  g.chrome = new Proxy({}, { get: () => { throw Error("Toptendir autofill cannot access runs/receipts/authorization/Sheets"); } });
  const doc = win.document as unknown as Document; let actions = 0;
  doc.addEventListener("click", () => actions++); doc.addEventListener("submit", e => { e.preventDefault(); actions++; });
  for (const form of win.document.forms) for (const method of ["submit", "requestSubmit"]) Object.defineProperty(form, method, { value: () => { throw Error("No submission allowed"); } });
  t.after(() => { assert.equal(actions, 0); win.close(); });
  return { doc, value: (name: string) => doc.querySelector<HTMLInputElement>(`[name="${name}"]`)!.value };
}


// These verify compatibility with the existing contract, captured native DOM.
test('Toptendir recorded HTTP Add Site discovers exact submission URL',t=>{
 setup(t,'http://toptendir.net/','<a href="/submit.php">Add Site</a>');assert.equal(getSiteAdapter(location.href)?.config.id,'toptendir');assert.deepEqual(runListingAutofill(profile).entryAction,{label:'Add Site',href:'http://toptendir.net/submit.php'});
 for(const href of ['ftp://toptendir.net/submit.php','http://toptendir.net.evil.test/submit.php','http://example.test/submit.php'])assert.equal(toptendirAdapter.discoverEntry('',[{text:'Add Site',href}]),null);
});
test('Toptendir captured compatible form maps6 dynamically and preserves human fields',t=>{
 const {doc,value}=setup(t);assert.equal(inspectToptendir(doc,location.href).state,'form');
 doc.querySelector('form')!.insertAdjacentHTML('beforeend','<input name="RECPR_URL" value="untouched"><textarea name="RECPR_TEXT">untouched</textarea>');
 doc.querySelector('form')!.insertAdjacentHTML('beforeend','<input type="checkbox" name="terms"><textarea name="g-recaptcha-response">human-only-token</textarea>');
 const option=doc.querySelector<HTMLOptionElement>('option[value="656"]')!;option.value='changed-current-option';
 assert.equal(doc.querySelector<HTMLSelectElement>('[name=CATEGORY_ID]')!.options.length,540);assert.match(doc.querySelector<HTMLOptionElement>('option[value="14"]')!.textContent!,/___Design$/);const report=runListingAutofill(profile);assert.equal(report.filled.length,6);assert.equal(value('CATEGORY_ID'),option.value);
 for(const [name,expected]of Object.entries({TITLE:profile.businessName,URL:profile.website,DESCRIPTION:profile.description,OWNER_NAME:profile.contactName,OWNER_EMAIL:profile.email}))assert.equal(value(name),expected);
 for(const name of ['RECPR_URL','RECPR_TEXT'])assert.equal(value(name),'untouched');assert.equal(value('g-recaptcha-response'),'human-only-token');assert.equal(doc.querySelector<HTMLInputElement>('[name=terms]')!.checked,false);assert(report.manual.includes('Final Continue (manual only)'));assert.equal(report.form,undefined);assert.equal(report.liveUrl,undefined);
});
test('Toptendir unrelated category cannot default to recorded14 or incidental text',t=>{
 const {value}=setup(t);runListingAutofill({...profile,category:'zzzzzz',services:[],businessName:profile.category,description:profile.category});assert.equal(value('CATEGORY_ID'),'0');
});
test('Toptendir native value validation and changed structure fail closed',t=>{
 const {doc,value}=setup(t);const report=runListingAutofill({...profile,businessName:'',website:'invalid',email:'invalid'});assert(report.skipped.length>=3);for(const name of ['TITLE','URL','OWNER_EMAIL'])assert.equal(value(name),'');doc.querySelector('[name=DESCRIPTION]')!.outerHTML='<input name="DESCRIPTION">';assert.equal(runListingAutofill(profile).filled.length,0);
});
test('Toptendir changed final control refuses autofill; confirmed Continue stays manual',t=>{
 const {doc}=setup(t);doc.querySelector<HTMLInputElement>('[name=submit]')!.value='Submit';assert.equal(runListingAutofill(profile).filled.length,0);
});
test('Toptendir competing native targets remain ambiguous, no first-link fallback',t=>{
 setup(t,'http://toptendir.net/','<a href="/submit.php">Add Site</a><a href="/submit.php?c=1">Add Site</a>');assert.equal(runListingAutofill(profile).navigationUrl,undefined);
});
test('Toptendir async route accepts synthetic compatible HTTP/HTTPS and refuses error docs',async t=>{
 setup(t);assert.equal((await runListingAutofillAsync(profile)).filled.length,6);setup(t,'https://toptendir.net/submit.php',readFileSync(new URL('../../family3/fixtures/toptendir-https.html',import.meta.url),'utf8'));assert.equal((await runListingAutofillAsync(profile)).filled.length,6);setup(t,'http://toptendir.net/submit.php','<title>Unavailable</title>');assert.equal((await runListingAutofillAsync(profile)).filled.length,0);
});

test('Toptendir HTTPS entry stays on its actual origin, no fixed HTTP downgrade',t=>{setup(t,'https://www.toptendir.net/','<a href="/submit.php">Add Site</a>');assert.equal(getSiteAdapter(location.href)?.config.id,'toptendir');assert.equal(runListingAutofill(profile).entryAction?.href,'https://www.toptendir.net/submit.php');});

test('Toptendir refuses foreign POST target and unavailable confirmed field',t=>{const {doc}=setup(t);doc.querySelector('form')!.action='https://directory3.org/submit.php';assert.equal(runListingAutofill(profile).filled.length,0);doc.querySelector('form')!.action='';doc.querySelector<HTMLInputElement>('[name=OWNER_EMAIL]')!.disabled=true;assert.equal(runListingAutofill(profile).filled.length,0);});
