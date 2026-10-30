import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import { createEmptyProfileInput, type BusinessProfile } from "@backlink-autofill/shared";
import { getSiteAdapter } from "../../src/automation/adapters";
import { familydirAdapter, inspectFamilydir } from "../../src/automation/familydir";
import { runListingAutofill, runListingAutofillAsync } from "../../src/content/listing-autofill";

const fixture = readFileSync(new URL("../../family3/fixtures/familydir.html", import.meta.url), "utf8");
const profile: BusinessProfile = { ...createEmptyProfileInput(), id: "sample", businessName: "Example Test Business", website: "https://example.test/business", contactName: "Example Owner", email: "owner@example.test", description: "Safe sample description. Never submit.", category: "Web Design and Development", createdAt: "2026-10-19", updatedAt: "2026-10-19" };
function setup(t: TestContext, url = "https://familydir.com/submit.php", html = fixture) {
  const win = new Window({ url, settings: { disableJavaScriptEvaluation: true, disableJavaScriptFileLoading: true, disableCSSFileLoading: true, disableIframePageLoading: true } }); win.document.write(html);
  const g = globalThis as Record<string, unknown>;
  for (const key of ["window", "document", "location", "HTMLInputElement", "HTMLTextAreaElement", "HTMLSelectElement", "Element", "Event"]) g[key] = key === "window" ? win : (win as unknown as Record<string, unknown>)[key];
  g.chrome = new Proxy({}, { get: () => { throw Error("Familydir autofill cannot access runs/receipts/authorization/Sheets"); } });
  const doc = win.document as unknown as Document; let actions = 0;
  doc.addEventListener("click", () => actions++); doc.addEventListener("submit", e => { e.preventDefault(); actions++; });
  for (const form of win.document.forms) for (const method of ["submit", "requestSubmit"]) Object.defineProperty(form, method, { value: () => { throw Error("No submission allowed"); } });
  t.after(() => { assert.equal(actions, 0); win.close(); });
  return { doc, value: (name: string) => doc.querySelector<HTMLInputElement>(`[name="${name}"]`)!.value };
}

test("Familydir exact recorded Submit Link reuses F05 entry safely", t => {
  setup(t, 'https://familydir.com/', '<a href="/submit.php">Submit Link</a>');
  assert.equal(getSiteAdapter(location.href)?.config.id, 'familydir');
  assert.deepEqual(runListingAutofill(profile).entryAction, { label: 'Submit Link', href: 'https://familydir.com/submit.php' });
  for (const href of ['http://familydir.com/submit.php', 'https://familydir.com.evil.test/submit.php', 'https://reddit-directory.com/submit.php']) assert.equal(familydirAdapter.discoverEntry('', [{ text: 'Submit Link', href }]), null);
});

test("Familydir validates free Regular Reviews and six fields/current category then checks only normal radio", t => {
  const { doc, value } = setup(t); const radio = doc.querySelector<HTMLInputElement>('[name=LINK_TYPE]')!;
  assert.equal(inspectFamilydir(doc, location.href).state, 'form'); assert.equal(radio.checked, false);
  const cells = radio.closest('tr')!.children; assert.equal(cells[0].textContent?.trim(), 'Regular Reviews'); assert.equal(cells[1].textContent?.trim(), 'free');
  let radioEvents = 0; for (const type of ['click', 'input', 'change']) radio.addEventListener(type, () => radioEvents++);
  doc.querySelector('form')!.insertAdjacentHTML('beforeend', '<input type="checkbox" name="terms"><textarea name="g-recaptcha-response">human-only-token</textarea>');
  const select = doc.querySelector<HTMLSelectElement>('[name=CATEGORY_ID]')!; assert.equal(select.options.length, 541);
  assert.match([...select.options].find(o => o.value === '17')!.textContent!, /Education/);
  const option = [...select.options].find(o => o.textContent?.trim().endsWith('___Web Design and Development'))!; option.value = 'current-approved-option';
  const report = runListingAutofill(profile); assert.equal(report.filled.length, 6); assert.equal(value('CATEGORY_ID'), option.value);
  for (const [name, expected] of Object.entries({ TITLE: profile.businessName, URL: profile.website, DESCRIPTION: profile.description, OWNER_NAME: profile.contactName, OWNER_EMAIL: profile.email })) assert.equal(value(name), expected);
  assert.equal(radio.checked, true); assert.equal(radio.value, 'normal'); assert.equal(radioEvents, 0);
  assert.equal(doc.querySelector<HTMLInputElement>('[name=terms]')!.checked, false); assert.equal(value('g-recaptcha-response'), 'human-only-token');
  assert(report.manual.some(m => /Free Regular Reviews.*selected/.test(m))); assert(!report.manual.some(m => /LINK_TYPE.*human selection/.test(m)));
  assert.equal(report.form, undefined); assert.equal(report.liveUrl, undefined); assert(report.manual.includes('Final Continue (manual only)'));
});

for (const change of ['label', 'price', 'missing', 'paid-value', 'duplicate', 'wrong-type', 'disabled', 'hidden']) test(`Familydir refuses unverified listing purpose/availability: ${change}`, t => {
  const { doc } = setup(t); const radio = doc.querySelector<HTMLInputElement>('[name=LINK_TYPE]')!;
  if (change === 'label') radio.parentElement!.lastChild!.textContent = 'Accept Terms';
  if (change === 'price') radio.closest('tr')!.children[1].textContent = '$5';
  if (change === 'missing') radio.remove();
  if (change === 'paid-value') radio.value = 'featured';
  if (change === 'duplicate') radio.after(radio.cloneNode(true));
  if (change === 'wrong-type') radio.type = 'checkbox';
  if (change === 'disabled') radio.disabled = true;
  if (change === 'hidden') radio.style.display = 'none';
  assert.equal(runListingAutofill(profile).filled.length, 0); assert.equal(radio.checked, false);
});

test("Familydir requires approved matching category; ties/unrelated text cannot select a plan", t => {
  const { doc, value } = setup(t); const radio = doc.querySelector<HTMLInputElement>('[name=LINK_TYPE]')!;
  runListingAutofill({ ...profile, category: 'zzzzzz', services: [], businessName: profile.category, description: profile.category }); assert.equal(value('CATEGORY_ID'), '0'); assert.equal(radio.checked, false);
  const option = [...doc.querySelector<HTMLSelectElement>('[name=CATEGORY_ID]')!.options].find(o => o.textContent?.trim().endsWith('___Web Design and Development'))!;
  const duplicate = option.cloneNode(true) as HTMLOptionElement; duplicate.value = 'second-tied-value'; option.after(duplicate);
  const report = runListingAutofill(profile); assert.equal(report.filled.length, 5); assert.equal(radio.checked, false);
});

test("Familydir incomplete business validation leaves the radio untouched", t => {
  const { doc } = setup(t); const report = runListingAutofill({ ...profile, email: 'invalid' });
  assert(report.skipped.length); assert.equal(doc.querySelector<HTMLInputElement>('[name=LINK_TYPE]')!.checked, false);
});

test("Familydir price changed by a field event prevents radio selection", t => {
  const { doc } = setup(t); const radio = doc.querySelector<HTMLInputElement>('[name=LINK_TYPE]')!;
  doc.querySelector('[name=CATEGORY_ID]')!.addEventListener('change', () => { radio.closest('tr')!.children[1].textContent = '$5'; });
  assert.equal(runListingAutofill(profile).filled.length, 0); assert.equal(radio.checked, false);
});

test("Familydir async reuses native mapper and refuses HTTP/default hosting error pages", async t => {
  let s = setup(t); assert.equal((await runListingAutofillAsync(profile)).filled.length, 6); assert.equal(s.doc.querySelector<HTMLInputElement>('[name=LINK_TYPE]')!.checked, true);
  s = setup(t, 'http://familydir.com/submit.php'); assert.equal((await runListingAutofillAsync(profile)).filled.length, 0); assert.equal(s.doc.querySelector<HTMLInputElement>('[name=LINK_TYPE]')!.checked, false);
  setup(t, 'https://familydir.com/submit.php', '<title>Softaculous Webuzo | Default Website Page</title><h1>Default Website Page</h1>'); assert.equal((await runListingAutofillAsync(profile)).filled.length, 0);
});

