import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import { createEmptyProfileInput, type BusinessProfile } from "@backlink-autofill/shared";
import { getSiteAdapter } from "../../src/automation/adapters";
import { smartdirAdapter, inspectSmartdir } from "../../src/automation/smartdir";
import { runListingAutofill, runListingAutofillAsync } from "../../src/content/listing-autofill";

// Keep observed placeholder/Movies/Cleaning and both tied design options for
// repeated contract tests; full captured forms remain in dedicated/browser tests.
const compactSmartdir = (html: string) => html.replace(/(<select\b[^>]*name="CATEGORY_ID"[^>]*>)([\s\S]*?)(<\/select>)/i, (_all, open, options, close) => open + (options.match(/<option\b[\s\S]*?<\/option>/gi) || []).filter((option: string) => /value="(?:0|70|2086|1816|2423)"/.test(option)).join("") + close);
const fullFixture = readFileSync(new URL("../../family3/fixtures/smartdir-http.html", import.meta.url), "utf8");
const fixture = compactSmartdir(fullFixture);
const profile: BusinessProfile = { ...createEmptyProfileInput(), id: "sample", businessName: "Example Test Business", website: "https://example.test/business", contactName: "Example Owner", email: "owner@example.test", description: "Safe sample description. Never submit.", category: "Web Design and Development", createdAt: "2026-10-19", updatedAt: "2026-10-19" };
function setup(t: TestContext, url = "http://smartdir.org/submit.php", html = fixture) {
  const win = new Window({ url, settings: { disableJavaScriptEvaluation: true, disableJavaScriptFileLoading: true, disableCSSFileLoading: true, disableIframePageLoading: true } }); win.document.write(html);
  const g = globalThis as Record<string, unknown>;
  for (const key of ["window", "document", "location", "HTMLInputElement", "HTMLTextAreaElement", "HTMLSelectElement", "Element", "Event"]) g[key] = key === "window" ? win : (win as unknown as Record<string, unknown>)[key];
  g.chrome = new Proxy({}, { get: () => { throw Error("Smartdir autofill cannot access runs/receipts/authorization/Sheets"); } });
  const doc = win.document as unknown as Document; let actions = 0;
  doc.addEventListener("click", () => actions++); doc.addEventListener("submit", e => { e.preventDefault(); actions++; });
  for (const form of win.document.forms) for (const method of ["submit", "requestSubmit"]) Object.defineProperty(form, method, { value: () => { throw Error("No submission allowed"); } });
  t.after(() => { assert.equal(actions, 0); win.close(); });
  return { doc, value: (name: string) => doc.querySelector<HTMLInputElement>(`[name="${name}"]`)!.value };
}



test('Smartdir observed Add Site entry supports HTTP/HTTPS and rejects unsafe targets', t => {
 for(const scheme of ['http','https']) { setup(t,scheme+'://smartdir.org/','<a href="/submit.php">Add Site</a>');assert.equal(getSiteAdapter(location.href)?.config.id,'smartdir');assert.deepEqual(runListingAutofill(profile).entryAction,{label:'Add Site',href:scheme+'://smartdir.org/submit.php'}); }
 for(const href of ['ftp://smartdir.org/submit.php','https://smartdir.org.evil.test/submit.php','http://directory3.org/submit.php'])assert.equal(smartdirAdapter.discoverEntry('',[{text:'Add Site',href}]),null);
});
test('Smartdir captured native Continue maps five saved values/current category without human-control activation',t=>{
 const {doc,value}=setup(t,'http://smartdir.org/submit.php',fullFixture);const inspected=inspectSmartdir(doc,location.href);assert.equal(inspected.state,'form');if(inspected.state!=='form')throw Error('Expected captured native form');assert.equal(inspected.form.method,'post');assert.equal(inspected.form.action,location.href);assert.equal(inspected.submit.value,'Continue');assert.equal(inspected.submit.hasAttribute('onclick'),false);
 const select=doc.querySelector<HTMLSelectElement>('[name=CATEGORY_ID]')!;assert.equal(select.options.length,3500);assert.match([...select.options].find(o=>o.value==='70')!.textContent!,/Movies/);
 inspected.form.insertAdjacentHTML('beforeend','<input name="RECPR_URL" value="untouched"><textarea name="RECPR_TEXT">untouched</textarea><input type="checkbox" name="terms"><textarea name="g-recaptcha-response">human-only-token</textarea>');
 const chosen=[...select.options].find(o=>o.value==='2086')!;assert.match(chosen.textContent!,/___Cleaning$/);chosen.value='changed-current-option';const report=runListingAutofill({...profile,category:'Cleaning'});assert.equal(report.filled.length,6);assert.equal(value('CATEGORY_ID'),chosen.value);
 for(const [name,expected]of Object.entries({TITLE:profile.businessName,URL:profile.website,DESCRIPTION:profile.description,OWNER_NAME:profile.contactName,OWNER_EMAIL:profile.email}))assert.equal(value(name),expected);
 for(const name of ['RECPR_URL','RECPR_TEXT'])assert.equal(value(name),'untouched');assert.equal(value('g-recaptcha-response'),'human-only-token');assert.equal(doc.querySelector<HTMLInputElement>('[name=terms]')!.checked,false);assert(report.manual.includes('Final Continue (manual only)'));assert.equal(report.form,undefined);assert.equal(report.liveUrl,undefined);
});
test('Smartdir full options reject unrelated category and ambiguous services-only matches',t=>{
 const {value}=setup(t,'http://smartdir.org/submit.php',fullFixture);runListingAutofill({...profile,category:'zzzzzz',services:[],businessName:'Cleaning',description:'Cleaning'});assert.equal(value('CATEGORY_ID'),'0');const report=runListingAutofill({...profile,category:'',services:['Cleaning']});assert.equal(value('CATEGORY_ID'),'0');assert.equal(report.filled.some(f=>f.field==='category'),false);
});
test('Smartdir duplicate Web Design and Development options remain manual',t=>{
 const {value}=setup(t);const report=runListingAutofill(profile);assert.equal(value('CATEGORY_ID'),'0');assert.equal(report.filled.some(f=>f.field==='category'),false);
});
test('Smartdir validates required business values before writing them',t=>{
 const {value}=setup(t);const report=runListingAutofill({...profile,businessName:'',website:'invalid',email:'invalid',category:'Cleaning'});assert(report.skipped.length>=3);for(const name of ['TITLE','URL','OWNER_EMAIL'])assert.equal(value(name),'');
});
for(const change of ['wrong-description','extra-submit','foreign-action','disabled-field','changed-final'])test('Smartdir changed native structure refuses '+change,t=>{
 const {doc}=setup(t);if(change==='wrong-description')doc.querySelector('[name=DESCRIPTION]')!.outerHTML='<input name="DESCRIPTION">';if(change==='extra-submit')doc.querySelector('[name=submit]')!.after(doc.querySelector('[name=submit]')!.cloneNode(true));if(change==='foreign-action')doc.querySelector('form')!.action='http://directory3.org/submit.php';if(change==='disabled-field')doc.querySelector<HTMLInputElement>('[name=OWNER_EMAIL]')!.disabled=true;if(change==='changed-final')doc.querySelector<HTMLInputElement>('[name=submit]')!.value='Submit';assert.equal(runListingAutofill({...profile,category:'Cleaning'}).filled.length,0);
});
test('Smartdir async native route fills captured HTTP and HTTPS forms, refuses inaccessible documents',async t=>{
 for(const scheme of ['http','https']){const html=readFileSync(new URL('../../family3/fixtures/smartdir-'+scheme+'.html',import.meta.url),'utf8');setup(t,scheme+'://smartdir.org/submit.php',html);assert.equal((await runListingAutofillAsync({...profile,category:'Cleaning'})).filled.length,6);}setup(t,'https://smartdir.org/submit.php','<title>Bot Verification</title>');assert.equal((await runListingAutofillAsync(profile)).filled.length,0);
});
test('Smartdir www stays on its current origin; ambiguous Add Site targets refuse navigation',t=>{
 setup(t,'https://www.smartdir.org/','<a href="/submit.php">Add Site</a>');assert.equal(getSiteAdapter(location.href)?.config.id,'smartdir');assert.equal(runListingAutofill(profile).entryAction?.href,'https://www.smartdir.org/submit.php');setup(t,'http://smartdir.org/','<a href="/submit.php">Add Site</a><a href="/submit.php?c=1">Add Site</a>');assert.equal(runListingAutofill(profile).navigationUrl,undefined);
});
