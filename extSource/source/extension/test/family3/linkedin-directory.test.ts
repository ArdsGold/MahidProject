import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import { createEmptyProfileInput, type BusinessProfile } from "@backlink-autofill/shared";
import { getSiteAdapter } from "../../src/automation/adapters";
import { linkedinDirectoryAdapter, inspectLinkedinDirectory } from "../../src/automation/linkedin-directory";
import { runListingAutofill, runListingAutofillAsync } from "../../src/content/listing-autofill";

const fixture = readFileSync(new URL("../../family3/fixtures/linkedin-directory.html", import.meta.url), "utf8");
const profile: BusinessProfile = { ...createEmptyProfileInput(), id: "sample", businessName: "Example Test Business", website: "https://example.test/business", contactName: "Example Owner", email: "owner@example.test", description: "Safe sample description. Never submit.", category: "Illustration", createdAt: "2026-10-19", updatedAt: "2026-10-19" };
function setup(t: TestContext, url = "http://linkedin-directory.com/submit.php", html = fixture) {
  const win = new Window({ url, settings: { disableJavaScriptEvaluation: true, disableJavaScriptFileLoading: true, disableCSSFileLoading: true, disableIframePageLoading: true } }); win.document.write(html);
  const g = globalThis as Record<string, unknown>;
  for (const key of ["window", "document", "location", "HTMLInputElement", "HTMLTextAreaElement", "HTMLSelectElement", "Element", "Event"]) g[key] = key === "window" ? win : (win as unknown as Record<string, unknown>)[key];
  g.chrome = new Proxy({}, { get: () => { throw Error("LinkedIn Directory autofill cannot access runs/receipts/authorization/Sheets"); } });
  const doc = win.document as unknown as Document; let actions = 0;
  doc.addEventListener("click", () => actions++); doc.addEventListener("submit", e => { e.preventDefault(); actions++; });
  for (const form of win.document.forms) for (const method of ["submit", "requestSubmit"]) Object.defineProperty(form, method, { value: () => { throw Error("No submission allowed"); } });
  t.after(() => { assert.equal(actions, 0); win.close(); });
  return { doc, value: (name: string) => doc.querySelector<HTMLInputElement>(`[name="${name}"]`)!.value };
}

test("LinkedIn Directory recorded Submit Link discovers only safe recorded HTTP form", t => {
  const { doc } = setup(t, 'http://linkedin-directory.com/', '<a href="/submit.php">Submit Link</a>');
  assert.equal(getSiteAdapter(location.href)?.config.id, 'linkedin-directory');
  assert.deepEqual(runListingAutofill(profile).entryAction, { label: 'Submit Link', href: 'http://linkedin-directory.com/submit.php' });
  for (const href of ['https://linkedin-directory.com/submit.php', 'http://linkedin-directory.com.evil.test/submit.php', 'https://expansiondirectory.com/submit.php']) assert.equal(linkedinDirectoryAdapter.discoverEntry('', [{ text: 'Submit Link', href }]), null);
  doc.body.insertAdjacentHTML('beforeend', '<a href="/submit.php?c=1">Submit Link</a>'); assert.equal(runListingAutofill(profile).navigationUrl, "http://linkedin-directory.com/submit.php");
});

test("LinkedIn Directory six confirmed fields/current category fill; CAPTCHA/Terms/reciprocal unchanged", t => {
  const { doc, value } = setup(t); assert.equal(inspectLinkedinDirectory(doc, location.href).state, 'form');
  const form = doc.querySelector('form')!; form.insertAdjacentHTML('beforeend', '<input type="checkbox" name="terms"><textarea name="g-recaptcha-response">human-only-token</textarea>');
  for (const name of ['RECPR_URL', 'RECPR_TEXT']) (form.querySelector(`[name=${name}]`) as HTMLInputElement).value = 'unchanged';
  const select = doc.querySelector<HTMLSelectElement>('[name=CATEGORY_ID]')!;
  assert.equal(select.options.length, 621); assert.match([...select.options].find(o => o.value === '36')!.textContent!, /Education/);
  const option = [...select.options].find(o => o.textContent?.trim().endsWith('___Illustration'))!; option.value = 'current-matched-option';
  const report = runListingAutofill(profile); assert.equal(report.filled.length, 6);
  for (const [name, expected] of Object.entries({ TITLE: profile.businessName, URL: profile.website, DESCRIPTION: profile.description, OWNER_NAME: profile.contactName, OWNER_EMAIL: profile.email })) assert.equal(value(name), expected);
  assert.equal(value('CATEGORY_ID'), option.value); assert.equal(doc.querySelector<HTMLInputElement>('[name=terms]')!.checked, false);
  for (const name of ['RECPR_URL', 'RECPR_TEXT']) assert.equal(value(name), 'unchanged');
  assert.equal(value('g-recaptcha-response'), 'human-only-token'); assert.equal(report.form, undefined); assert.equal(report.liveUrl, undefined); assert(report.manual.includes('Final Continue (manual only)'));
});

test("LinkedIn Directory duplicate Web Design options remain manual; distinctive approved services match", t => {
  const { doc, value } = setup(t); const select = doc.querySelector<HTMLSelectElement>('[name=CATEGORY_ID]')!;
  assert.equal([...select.options].filter(o => o.textContent?.trim().endsWith('___Web Design and Development')).length, 2);
  let report = runListingAutofill({ ...profile, category: 'Web Design and Development', services: [] }); assert.equal(value('CATEGORY_ID'), '0'); assert(!report.filled.some(f => f.field === 'category'));
  report = runListingAutofill({ ...profile, category: '', services: ['Illustration'] }); assert(report.filled.some(f => f.field === 'category'));
  select.value = '0'; runListingAutofill({ ...profile, category: 'zzzzzz', services: [], businessName: 'Illustration', description: 'Illustration' }); assert.equal(value('CATEGORY_ID'), '0');
});

test("LinkedIn Directory required validation/changed description retain native refusal", t => {
  const { doc, value } = setup(t); const report = runListingAutofill({ ...profile, businessName: '', website: 'invalid', email: 'invalid' });
  assert(report.skipped.length >= 3); for (const name of ['TITLE', 'URL', 'OWNER_EMAIL']) assert.equal(value(name), '');
  doc.querySelector('[name=DESCRIPTION]')!.outerHTML = '<input name="DESCRIPTION">'; assert.equal(runListingAutofill(profile).filled.length, 0);
});

test("LinkedIn Directory async native route fails closed on HTTPS/error structure", async t => {
  setup(t); assert.equal((await runListingAutofillAsync(profile)).filled.length, 6);
  setup(t, 'https://linkedin-directory.com/submit.php'); assert.equal((await runListingAutofillAsync(profile)).filled.length, 0);
  setup(t, 'http://linkedin-directory.com/submit.php', '<title>403 Forbidden</title><h1>Forbidden</h1>'); assert.equal((await runListingAutofillAsync(profile)).filled.length, 0);
});


test('LinkedIn Directory preserves first Submit Link rather than choosing later targets', t => {
 setup(t,'http://linkedin-directory.com/','<a href="/submit.php?c=4">Submit Link</a><a href="/submit.php">Submit Link</a>');
 assert.equal(runListingAutofill(profile).navigationUrl,'http://linkedin-directory.com/submit.php?c=4');
});
test('LinkedIn Directory never skips an unsafe first recorded link', t => {
 setup(t,'http://linkedin-directory.com/','<a href="https://example.test/submit.php">Submit Link</a><a href="/submit.php">Submit Link</a>');
 assert.equal(runListingAutofill(profile).navigationUrl,undefined);
});
test('LinkedIn Directory changed final button fails closed', t => {
 const {doc}=setup(t);doc.querySelector<HTMLInputElement>('[name=submit]')!.value='Submit';assert.equal(runListingAutofill(profile).filled.length,0);
});

test('LinkedIn Directory clears stale Events when the active plumbing business has no suitable category', t => {
  const { doc, value } = setup(t);
  const select = doc.querySelector<HTMLSelectElement>('[name=CATEGORY_ID]')!;
  for (const option of [...select.options]) if (/Home Improvement|Construction and Maintenance/.test(option.textContent || '')) option.remove();
  select.value = [...select.options].find(option => option.textContent?.trim().endsWith('___Events'))!.value;
  const report = runListingAutofill({ ...profile, businessName: 'Smiley Drain Plumbing and Drain Cleaning', category: 'Plumbing Services', services: ['Events'] });
  assert.equal(value('CATEGORY_ID'), '0');
  assert.equal(report.filled.length, 5);
  assert(report.manual.some(reason => /category:.*no suitable/i.test(reason)));
  assert.equal(value('TITLE'), 'Smiley Drain Plumbing and Drain Cleaning');
});

test('LinkedIn Directory uses its actual Home Improvement option as Smiley plumbing fallback', t => {
  const { doc } = setup(t);
  const report = runListingAutofill({ ...profile, businessName: 'Smiley Drain Plumbing and Drain Cleaning', category: 'waste management' });
  assert.equal(report.filled.length, 6);
  assert.match(doc.querySelector<HTMLSelectElement>('[name=CATEGORY_ID]')!.selectedOptions[0].textContent!, /Home Improvement/);
});

test('LinkedIn Directory uses current plumbing option values and ignores unrelated services and stale IDs', t => {
  const { doc, value } = setup(t);
  const select = doc.querySelector<HTMLSelectElement>('[name=CATEGORY_ID]')!;
  select.insertAdjacentHTML('beforeend', '<option value="fresh-plumber">Plumbing</option>');
  let report = runListingAutofill({ ...profile, category: 'Plumbing Services', services: ['Events'] }, { value: '37', label: 'Events' } as never);
  assert.equal(value('CATEGORY_ID'), 'fresh-plumber');
  assert(report.filled.some(field => field.field === 'category'));
  select.selectedOptions[0].value = 'another-live-id';
  runListingAutofill({ ...profile, id: 'second-active-business', category: 'Plumbing Contractor' });
  assert.equal(value('CATEGORY_ID'), 'another-live-id');
  report = runListingAutofill({ ...profile, id: 'unrelated-business', category: 'zzzzzz', services: ['Plumbing'] });
  assert.equal(value('CATEGORY_ID'), '0');
  assert(report.manual.some(reason => /category:.*no suitable/i.test(reason)));
});

test('LinkedIn Directory never clicks, focuses or dispatches events to CAPTCHA or final controls', t => {
  const { doc } = setup(t);
  const captcha = doc.querySelector<HTMLElement>('.g-recaptcha')!;
  captcha.innerHTML = '<iframe title="reCAPTCHA"></iframe><textarea name="g-recaptcha-response">human-token</textarea>';
  for (const element of [captcha, ...captcha.querySelectorAll<HTMLElement>('*'), doc.querySelector<HTMLElement>('[name=submit]')!]) {
    element.click = () => assert.fail('Human control clicked');
    element.focus = () => assert.fail('Human control focused');
    for (const type of ['click', 'focus', 'focusin', 'input', 'change', 'blur', 'pointerdown', 'mousedown']) element.addEventListener(type, () => assert.fail(`Human control event: ${type}`));
  }
  runListingAutofill({ ...profile, category: 'Plumbing Services' });
  assert.equal(doc.querySelector<HTMLTextAreaElement>('[name=g-recaptcha-response]')!.value, 'human-token');
});

test('LinkedIn Directory excludes disabled category groups and refuses ambiguous matches', t => {
  const { doc, value } = setup(t);
  const select = doc.querySelector<HTMLSelectElement>('[name=CATEGORY_ID]')!;
  select.insertAdjacentHTML('beforeend', '<optgroup label="Disabled" disabled><option value="disabled-plumbing">Plumbing Services</option></optgroup><option value="enabled-plumber">Plumber</option>');
  runListingAutofill({ ...profile, category: 'Plumbing Services' });
  assert.equal(value('CATEGORY_ID'), 'enabled-plumber');
  select.insertAdjacentHTML('beforeend', '<option value="tied-plumber">Plumber</option>');
  const report = runListingAutofill({ ...profile, category: 'Plumbing Services' });
  assert.equal(value('CATEGORY_ID'), '0');
  assert(report.manual.some(reason => /category:.*ambiguous/i.test(reason)));
});

test('LinkedIn Directory never fills a confirmed-name control inside a CAPTCHA container', t => {
  const { doc, value } = setup(t);
  const title = doc.querySelector<HTMLInputElement>('[name=TITLE]')!;
  title.value = 'Human control value';
  const container = doc.createElement('div'); container.className = 'g-recaptcha';
  title.replaceWith(container); container.append(title);
  for (const type of ['input', 'change', 'blur', 'focus', 'click']) title.addEventListener(type, () => assert.fail(`CAPTCHA received ${type}`));
  const report = runListingAutofill(profile);
  assert.equal(value('TITLE'), 'Human control value');
  assert(report.manual.some(reason => /Human verification control TITLE/.test(reason)));
});
