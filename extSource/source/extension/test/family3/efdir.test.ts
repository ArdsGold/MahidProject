import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import { createEmptyProfileInput, type BusinessProfile } from "@backlink-autofill/shared";
import { getSiteAdapter } from "../../src/automation/adapters";
import { efdirAdapter, inspectEfdir } from "../../src/automation/efdir";
import { runListingAutofill, runListingAutofillAsync } from "../../src/content/listing-autofill";

const fixture = readFileSync(new URL("../../family3/fixtures/efdir-https.html", import.meta.url), "utf8");
const profile: BusinessProfile = { ...createEmptyProfileInput(), id: "sample", businessName: "Example Test Business", website: "https://example.test/business", contactName: "Example Owner", email: "owner@example.test", description: "Safe sample description. Never submit.", category: "Cleaning", createdAt: "2026-10-18", updatedAt: "2026-10-18" };
function setup(t: TestContext, url = "https://efdir.com/submit.php", html = fixture) {
  const win = new Window({ url, settings: { disableJavaScriptEvaluation: true, disableJavaScriptFileLoading: true, disableCSSFileLoading: true, disableIframePageLoading: true } }); win.document.write(html);
  const g = globalThis as Record<string, unknown>;
  for (const key of ["window", "document", "location", "HTMLInputElement", "HTMLTextAreaElement", "HTMLSelectElement", "Element", "Event"]) g[key] = key === "window" ? win : (win as unknown as Record<string, unknown>)[key];
  g.chrome = new Proxy({}, { get: () => { throw Error("Efdir fill cannot access runs/receipts/authorization/Sheets"); } });
  const doc = win.document as unknown as Document; let actions = 0;
  doc.addEventListener("click", () => actions++); doc.addEventListener("submit", e => { e.preventDefault(); actions++; });
  doc.addEventListener("change", e => { if ((e.target as Element).getAttribute("name") === "agree") actions++; });
  for (const form of win.document.forms) for (const method of ["submit", "requestSubmit"]) Object.defineProperty(form, method, { value: () => { throw Error("No submission allowed"); } });
  t.after(() => win.close());
  return { doc, value: (name: string) => doc.querySelector<HTMLInputElement>(`[name="${name}"]`)!.value, checkbox: doc.querySelector<HTMLInputElement>('[name=agree]'), actions: () => actions };
}

test("Efdir HTTP+HTTPS Add Site route refuses forged domains and non-web targets", () => {
  assert.equal(getSiteAdapter("https://efdir.com/")?.config.id, "efdir");
  assert.equal(getSiteAdapter("http://efdir.com/")?.config.id, "efdir");
  assert.equal(getSiteAdapter("https://efdir.com.evil.test/"), null);
  assert.equal(efdirAdapter.discoverEntry("", [{ text: "Add Site", href: "https://efdir.com/submit.php" }])?.target, "https://efdir.com/submit.php");
  assert.equal(efdirAdapter.discoverEntry("", [{ text: "Add Site", href: "ftp://efdir.com/submit.php" }]), null);
});

test("Efdir six profile fields/current category and explicitly authorized Terms only, no actions", t => {
  const s = setup(t);
  s.doc.querySelector('form')!.insertAdjacentHTML("beforeend", '<input name="RECPR_URL" value="unchanged"><textarea name="g-recaptcha-response">human-only-unchanged</textarea>');
  const report = runListingAutofill(profile);
  assert.equal(inspectEfdir(s.doc, location.href).state, "form");
  assert.equal(report.filled.length, 6); assert.equal(s.checkbox!.checked, true); assert.equal(s.checkbox!.value, "0");
  for (const [name, value] of Object.entries({ TITLE: profile.businessName, URL: profile.website, DESCRIPTION: profile.description, OWNER_NAME: profile.contactName, OWNER_EMAIL: profile.email })) assert.equal(s.value(name), value);
  const select = s.doc.querySelector<HTMLSelectElement>('[name=CATEGORY_ID]')!;
  assert.equal(select.options.length, 689); assert.match(select.selectedOptions[0].textContent!, /Cleaning/);
  assert.equal(s.value("RECPR_URL"), "unchanged"); assert.equal(s.value("g-recaptcha-response"), "human-only-unchanged");
  assert.equal(s.actions(), 0); assert(report.manual.some(m => /explicit workflow authorization/.test(m)));
  assert(!report.manual.some(m => /Terms.*human acceptance|Terms\/Agreement/.test(m)));
  assert.equal(report.liveUrl, undefined); assert.equal(report.form, undefined);
});

for (const field of ["businessName", "website", "email", "description", "category"]) test(`Efdir incomplete field ${field} cannot accept Terms`, t => {
  const s = setup(t); const report = runListingAutofill({ ...profile, [field]: "" });
  assert(report.filled.length < 6); assert.equal(s.checkbox!.checked, false); assert.equal(s.actions(), 0);
});

test("Efdir preserves existing contact-name fallback to approved business name", t => {
  const s = setup(t); const report = runListingAutofill({ ...profile, contactName: "", firstName: "", lastName: "" });
  assert.equal(report.filled.length, 6); assert.equal(s.value("OWNER_NAME"), profile.businessName); assert.equal(s.checkbox!.checked, true);
});

for (const change of ["label", "value", "foreign-rules", "extra-checkbox", "exit", "foreign-action", "hidden-checkbox"]) test(`Efdir changed contract ${change} never accepts Terms`, t => {
  const s = setup(t);
  if (change === "label") s.checkbox!.parentElement!.querySelector('a')!.textContent = "Unverified agreement";
  if (change === "value") s.checkbox!.value = "1";
  if (change === "foreign-rules") s.checkbox!.parentElement!.querySelector('a')!.href = "https://example.test/rules.php";
  if (change === "extra-checkbox") s.checkbox!.after(s.checkbox!.cloneNode(true));
  if (change === "exit") s.doc.querySelector('input[type=button]')!.remove();
  if (change === "foreign-action") s.doc.querySelector('form')!.action = "https://jet-links.com/submit.php";
  if (change === "hidden-checkbox") s.checkbox!.style.display = "none";
  runListingAutofill(profile); assert.equal(s.checkbox!.checked, false); assert.equal(s.actions(), 0);
});

test("Efdir no unrelated category match or profile-description category fallback", t => {
  const s = setup(t); runListingAutofill({ ...profile, category: "zzzzzz", businessName: "Cleaning", description: "Cleaning" });
  assert.equal(s.checkbox!.checked, false); assert.equal(s.value("CATEGORY_ID"), "0");
});

test("Efdir final native event value changes block consent", t => {
  const s = setup(t);
  s.doc.querySelector('[name=CATEGORY_ID]')!.addEventListener('change', () => { (s.doc.querySelector('[name=TITLE]') as HTMLInputElement).value = ""; });
  assert(runListingAutofill(profile).filled.length < 6); assert.equal(s.checkbox!.checked, false);
});

test("Efdir invalid scheme and error page fail closed; no generic autofill fallback", t => {
  let s = setup(t, "ftp://efdir.com/submit.php"); assert.equal(runListingAutofill(profile).filled.length, 0); assert.equal(s.checkbox!.checked, false);
  s = setup(t, "https://efdir.com/submit.php", '<title>403 Forbidden</title><h1>Forbidden</h1>'); assert.equal(runListingAutofill(profile).filled.length, 0);
});

test("Efdir async autofill reuses native engine without consent UI/storage", async t => {
  const s = setup(t); assert.equal((await runListingAutofillAsync(profile)).filled.length, 6); assert.equal(s.checkbox!.checked, true);
  assert.equal(s.doc.querySelector('#mahid-jet-terms'), null); assert.equal(s.actions(), 0);
});

test('Efdir actual recorded HTTP Add Site and form retain explicit checkbox authorization',t=>{const html=readFileSync(new URL('../../family3/fixtures/efdir-http.html',import.meta.url),'utf8');let x=setup(t,'http://efdir.com/','<a href="/submit.php">Add Site</a>');assert.equal(runListingAutofill(profile).navigationUrl,'http://efdir.com/submit.php');x=setup(t,'http://efdir.com/submit.php',html);assert.equal(runListingAutofill(profile).filled.length,6);assert.equal(x.checkbox!.checked,true);assert.equal(x.actions(),0);});
test('Efdir category15 Events is not default; changed option ID selected dynamically',t=>{const s=setup(t);const select=s.doc.querySelector<HTMLSelectElement>('[name=CATEGORY_ID]')!;assert.match([...select.options].find(o=>o.value==='15')!.textContent!,/Events/);const option=[...select.options].find(o=>/___Cleaning$/.test(o.textContent?.trim()||''))!;option.value='current-approved-cleaning';assert.equal(runListingAutofill(profile).filled.length,6);assert.equal(s.value('CATEGORY_ID'),option.value);assert.equal(s.checkbox!.checked,true);assert.equal(s.actions(),0);});
