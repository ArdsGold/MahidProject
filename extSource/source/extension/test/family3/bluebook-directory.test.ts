import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import { createEmptyProfileInput, type BusinessProfile } from "@backlink-autofill/shared";
import { getSiteAdapter } from "../../src/automation/adapters";
import { bluebookDirectoryAdapter, inspectBluebookDirectory } from "../../src/automation/bluebook-directory";
import { runListingAutofill, runListingAutofillAsync } from "../../src/content/listing-autofill";

const fixture = readFileSync(new URL("../../family3/fixtures/bluebook-directory.html", import.meta.url), "utf8");
const profile: BusinessProfile = { ...createEmptyProfileInput(), id: "sample", businessName: "Example Test Business", website: "https://example.test/business", contactName: "Example Owner", email: "owner@example.test", description: "Safe sample description. Never submit.", category: "Cleaning", createdAt: "2026-10-19", updatedAt: "2026-10-19" };
function setup(t: TestContext, url = "https://bluebook-directory.com/submit.php", html = fixture) {
  const win = new Window({ url, settings: { disableJavaScriptEvaluation: true, disableJavaScriptFileLoading: true, disableCSSFileLoading: true, disableIframePageLoading: true } }); win.document.write(html);
  const g = globalThis as Record<string, unknown>;
  for (const key of ["window", "document", "location", "HTMLInputElement", "HTMLTextAreaElement", "HTMLSelectElement", "Element", "Event"]) g[key] = key === "window" ? win : (win as unknown as Record<string, unknown>)[key];
  g.chrome = new Proxy({}, { get: () => { throw Error("Bluebook autofill cannot access runs/receipts/authorization/Sheets"); } });
  const doc = win.document as unknown as Document; let actions = 0;
  doc.addEventListener("click", () => actions++); doc.addEventListener("submit", e => { e.preventDefault(); actions++; });
  for (const form of win.document.forms) for (const method of ["submit", "requestSubmit"]) Object.defineProperty(form, method, { value: () => { throw Error("No submission allowed"); } });
  t.after(() => { assert.equal(actions, 0); win.close(); });
  return { doc, value: (name: string) => doc.querySelector<HTMLInputElement>(`[name="${name}"]`)!.value };
}

test("Bluebook exact recorded Submit entry uses verified same-site HTTPS form", t => {
  setup(t, "https://bluebook-directory.com/", '<a href="/submit.php">Submit</a><a href="/gosearch.php">Search</a>');
  assert.equal(getSiteAdapter(location.href)?.config.id, "bluebook-directory");
  assert.deepEqual(runListingAutofill(profile).entryAction, { label: "Submit", href: "https://bluebook-directory.com/submit.php" });
  for (const href of ["http://bluebook-directory.com/submit.php", "https://bluebook-directory.com.evil.test/submit.php", "https://user:pass@bluebook-directory.com/submit.php", "https://expansiondirectory.com/submit.php"]) assert.equal(bluebookDirectoryAdapter.discoverEntry("", [{ text: "Submit", href }]), null);
  assert.equal(bluebookDirectoryAdapter.discoverEntry("", [{ text: "Submit Links", href: "https://bluebook-directory.com/submit.php" }]), null);
});

test("Bluebook maps actual description textarea inside unnamed cell and all six fields; gates untouched", t => {
  const { doc, value } = setup(t); const description = doc.querySelector<HTMLTextAreaElement>('textarea[name="DESCRIPTION"]')!;
  assert.equal(description.closest('td')!.getAttribute('name'), null); assert.equal(description.closest('td')!.textContent?.trim(), "");
  const form = doc.querySelector('form')!;
  form.insertAdjacentHTML("beforeend", '<input type="checkbox" name="terms"><textarea name="g-recaptcha-response">human-only-token</textarea>');
  for (const name of ["RECPR_URL", "RECPR_TEXT"]) (form.querySelector(`[name=${name}]`) as HTMLInputElement).value = "unchanged";
  assert.equal(inspectBluebookDirectory(doc, location.href).state, "form");
  const report = runListingAutofill(profile); assert.equal(report.filled.length, 6);
  for (const [name, expected] of Object.entries({ TITLE: profile.businessName, URL: profile.website, DESCRIPTION: profile.description, OWNER_NAME: profile.contactName, OWNER_EMAIL: profile.email })) assert.equal(value(name), expected);
  assert.match(doc.querySelector<HTMLSelectElement>('[name=CATEGORY_ID]')!.selectedOptions[0].textContent!, /Cleaning/);
  for (const name of ["RECPR_URL", "RECPR_TEXT"]) assert.equal(value(name), "unchanged");
  assert.equal(value("g-recaptcha-response"), "human-only-token"); assert.equal(doc.querySelector<HTMLInputElement>('[name=terms]')!.checked, false);
  assert.equal(report.form, undefined); assert.equal(report.liveUrl, undefined);
  assert(report.manual.includes("CAPTCHA")); assert(report.manual.includes("Final Continue (manual only)"));
});

test("Bluebook category uses current approved options/services, never recorded13/incidental description", t => {
  const { doc, value } = setup(t); const select = doc.querySelector<HTMLSelectElement>('[name=CATEGORY_ID]')!;
  assert.equal(select.options.length, 689); assert.match([...select.options].find(o => o.value === '13')!.textContent!, /Design Arts/);
  const cleaning = [...select.options].find(o => o.textContent?.trim().endsWith('___Cleaning'))!; cleaning.value = "current-service-option";
  runListingAutofill(profile); assert.equal(value("CATEGORY_ID"), "current-service-option");
  select.value = '0'; runListingAutofill({ ...profile, category: "zzzzzz", services: [], businessName: "Cleaning", description: "Cleaning" }); assert.equal(value("CATEGORY_ID"), '0');
  runListingAutofill({ ...profile, category: "", services: ["Cleaning"] }); assert.equal(value("CATEGORY_ID"), "current-service-option");
});

test("Bluebook validates missing business name/invalid email and website/native description length", t => {
  const { doc, value } = setup(t); doc.querySelector<HTMLTextAreaElement>('[name=DESCRIPTION]')!.maxLength = 3;
  const report = runListingAutofill({ ...profile, businessName: "", website: "invalid", email: "invalid" });
  assert(report.skipped.length >= 4); for (const name of ["TITLE", "URL", "OWNER_EMAIL", "DESCRIPTION"]) assert.equal(value(name), "");
});

for (const change of ["wrong-description-tag", "unnamed-description", "duplicate-description", "upload", "foreign-action", "changed-continue"]) test(`Bluebook changed contract refuses autofill: ${change}`, t => {
  const { doc } = setup(t); const description = doc.querySelector('[name=DESCRIPTION]')!;
  if (change === "wrong-description-tag") description.outerHTML = '<input name="DESCRIPTION">';
  if (change === "unnamed-description") description.removeAttribute('name');
  if (change === "duplicate-description") description.after(description.cloneNode(true));
  if (change === "upload") doc.querySelector('form')!.insertAdjacentHTML('beforeend', '<input type="file" name="unknown">');
  if (change === "foreign-action") doc.querySelector('form')!.action = 'https://expansiondirectory.com/submit.php';
  if (change === "changed-continue") doc.querySelector<HTMLInputElement>('[name=submit]')!.value = 'Submit';
  assert.equal(runListingAutofill(profile).filled.length, 0);
});

test("Bluebook async uses native mapper; HTTP/403/unsupported forms never fall back", async t => {
  setup(t); assert.equal((await runListingAutofillAsync(profile)).filled.length, 6);
  setup(t, 'http://bluebook-directory.com/submit.php'); assert.equal((await runListingAutofillAsync(profile)).filled.length, 0);
  setup(t, 'https://bluebook-directory.com/submit.php', '<h1>403 Forbidden</h1>'); assert.equal((await runListingAutofillAsync(profile)).filled.length, 0);
});
