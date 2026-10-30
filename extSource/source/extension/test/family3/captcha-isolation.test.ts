import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { createEmptyProfileInput, type BusinessProfile } from '@backlink-autofill/shared';
import { FAMILY3_ADAPTERS } from '../../src/automation/adapters';
import { nativeDirectoryEntryLinks, isNativeDirectoryHumanControl } from '../../src/automation/native-directory';
import { clickSelectedCategory, clickSelectedLocation, runListingAutofill, validateDirectory3Submission } from '../../src/content/listing-autofill';

function setup(t: TestContext, url: string, html: string) {
  const win = new Window({ url, settings: { disableJavaScriptEvaluation: true, disableIframePageLoading: true } });
  win.document.write(html);
  const global = globalThis as Record<string, unknown>;
  for (const key of ['window', 'document', 'location', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement', 'Element', 'Event']) global[key] = key === 'window' ? win : (win as unknown as Record<string, unknown>)[key];
  const doc = win.document as unknown as Document;
  doc.addEventListener('click', () => assert.fail('Directory page target clicked'));
  doc.addEventListener('focusin', () => assert.fail('Directory page target focused'));
  t.after(() => win.close());
  return doc;
}

for (const adapter of FAMILY3_ADAPTERS) test(`${adapter.config.id}: CAPTCHA cannot supply native navigation or generic click targets`, t => {
  const url = adapter.config.startingUrl!, label = adapter.config.entryLabels[0];
  const doc = setup(t, url, `<div class="g-recaptcha"><a href="/submit.php">${label}</a></div><div data-sitekey="test"><a href="/submit.php">${label}</a></div><div id="turnstile"><a href="/submit.php">${label}</a></div>`);
  assert.equal(nativeDirectoryEntryLinks(doc).length, 0);
  assert.equal(adapter.discoverEntry('', nativeDirectoryEntryLinks(doc)), null);
  assert.equal(clickSelectedCategory(label, new URL('/submit.php', url).href), null);
  assert.equal(clickSelectedLocation(label, new URL('/submit.php', url).href), null);
  doc.body.insertAdjacentHTML('beforeend', `<a href="/submit.php">${label}</a>`);
  const links = nativeDirectoryEntryLinks(doc);
  assert.equal(links.length, 1);
  assert.equal(adapter.discoverEntry('', links)?.target, new URL('/submit.php', url).href);
});

const profile: BusinessProfile = { ...createEmptyProfileInput(), id: 'captcha-test', businessName: 'Synthetic Business',
  category: 'Web Design', website: 'https://example.test', contactName: 'Synthetic Owner', email: 'owner@example.test',
  description: 'Synthetic description.', createdAt: '2026-10-20', updatedAt: '2026-10-20' };

for (const [file, url] of [['expansion-directory', 'https://expansiondirectory.com/submit.php'], ['linkedin-directory', 'http://linkedin-directory.com/submit.php']]) test(`${file}: native writes never synthesize blur or human-control events`, t => {
  const fixture = readFileSync(new URL(`../../family3/fixtures/${file}.html`, import.meta.url), 'utf8');
  const doc = setup(t, url, fixture);
  const select = doc.querySelector<HTMLSelectElement>('[name=CATEGORY_ID]')!;
  select.insertAdjacentHTML('beforeend', '<option value="fresh-web-design">Web Design</option>');
  for (const type of ['blur', 'focus', 'invalid']) doc.addEventListener(type, () => assert.fail(`Unexpected native ${type}`), true);
  doc.querySelector('.g-recaptcha')!.addEventListener('change', () => assert.fail('Human control changed'));
  assert.equal(runListingAutofill(profile).filled.length, 6);
  assert.equal(select.value, 'fresh-web-design');
});

test('Directory3 validation reads validity without dispatching invalid events on a human CAPTCHA', t => {
  const fixture = readFileSync(new URL('../../family3/fixtures/directory3.html', import.meta.url), 'utf8');
  const doc = setup(t, 'http://directory3.org/submit.php', fixture);
  runListingAutofill(profile);
  doc.querySelector('[name=TITLE]')!.closest('form')!.insertAdjacentHTML('beforeend', '<textarea name="g-recaptcha-response" required></textarea>');
  doc.addEventListener('invalid', () => assert.fail('Human validation event dispatched'), true);
  assert.equal(validateDirectory3Submission(profile).ok, false);
});

test('shared human-control exclusion covers response names, labels and embedded widgets', t => {
  const doc = setup(t, 'http://linkedin-directory.com/submit.php', '<input name="h-captcha-response"><button aria-label="reCAPTCHA">Verify</button><a href="/submit.php"><span class="g-recaptcha"></span></a>');
  for (const element of doc.querySelectorAll('input,button,a')) assert.equal(isNativeDirectoryHumanControl(element), true);
});
