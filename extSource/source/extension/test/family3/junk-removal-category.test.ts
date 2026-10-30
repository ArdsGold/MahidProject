import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { createEmptyProfileInput, type BusinessProfile } from '@backlink-autofill/shared';
import { runListingAutofill, family2CategoryChoice } from '../../src/content/listing-autofill';

const fixture = readFileSync(new URL('../../family3/fixtures/expansion-directory.html', import.meta.url), 'utf8');
const base: BusinessProfile = { ...createEmptyProfileInput(), id: 'active-junk', businessName: 'Example Business', category: 'Junk Removal Services',
  website: 'https://example.test', contactName: 'Saved Owner', email: 'owner@example.test', description: 'Saved description.', createdAt: '2026-10-21', updatedAt: '2026-10-21' };
const options2 = [['370', 'Junk Hauling'], ['478', 'Trash Removal'], ['493', 'Waste Removal'], ['107', 'Haulers'], ['337', 'Garbage Services'], ['301', 'Disposal'], ['164', 'Removal Services']];
const options3 = [['205', 'Home / Domestic Services'], ['50', 'Business / Business Services'], ['53', 'Business / Construction and Maintenance'], ['210', 'Home / Home Improvement']];
function setup(t: TestContext, family: 2 | 3, options = family === 2 ? options2 : options3) {
  const win = new Window({ url: family === 2 ? 'https://businessizze.com/create-directory-listing' : 'https://expansiondirectory.com/submit.php',
    settings: { disableJavaScriptEvaluation: true, disableJavaScriptFileLoading: true, disableCSSFileLoading: true, disableIframePageLoading: true } });
  win.document.write(family === 3 ? fixture : '<form><label>Business Name<input name="business_name"></label><label>Category<select name="CATEGORY_ID"></select></label><input name="captcha"><button>Submit</button></form>');
  const g = globalThis as Record<string, unknown>;
  for (const key of ['window', 'document', 'location', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement', 'HTMLOptGroupElement', 'HTMLElement', 'Element', 'Event'])
    g[key] = key === 'window' ? win : (win as unknown as Record<string, unknown>)[key];
  const doc = win.document as unknown as Document, select = doc.querySelector<HTMLSelectElement>('select')!;
  select.innerHTML = '<option value="0">--- Select One ---</option>' + options.map(([value, label]) => `<option value="${value}">${label}</option>`).join('');
  for (const el of doc.querySelectorAll('[name=captcha],.g-recaptcha,[name=submit],button'))
    for (const event of ['click', 'focus', 'input', 'change', 'blur']) el.addEventListener(event, () => assert.fail('Human control interacted with'));
  doc.addEventListener('submit', () => assert.fail('Form submitted'));
  t.after(() => win.close());
  return { win, select, fill: (profile: Partial<BusinessProfile> = {}) => runListingAutofill({ ...base, ...profile }) };
}

for (const family of [2, 3] as const) {
  for (const category of ['Junk Removal Services', 'Junk Hauling', 'Trash Removal', 'Waste Removal'])
    test(`Family${family}: active ${category} uses preferred supplied option`, t => {
      const h = setup(t, family); const profile = { ...base, id: category, category }; const before = structuredClone(profile);
      h.fill(profile); assert.equal(h.select.value, family === 2 ? '370' : '205'); assert.deepEqual(profile, before);
    });
  test(`Family${family}: ordered fallbacks use dynamic IDs, construction requires evidence`, t => {
    const h = setup(t, family, (family === 2 ? options2 : options3).map(([value, label]) => ['live-' + value, label]));
    for (const value of (family === 2 ? ['370', '478', '493', '107', '337', '301', '164'] : ['205', '50', '210'])) {
      h.fill(); assert.equal(h.select.value, 'live-' + value); h.select.selectedOptions[0].remove();
    }
    const report = h.fill(); assert.equal(h.select.value, '0');
    assert(report.manual.some(reason => /category/i.test(reason)) || report.skipped.some(item => /category/i.test(item.reason)));
    if (family === 3) { h.fill({ services: ['Construction debris removal'] }); assert.equal(h.select.value, 'live-53'); }
  });
  test(`Family${family}: exact industry labels outrank broad fallback`, t => {
    for (const label of ['Junk Removal', 'Junk Hauling', 'Trash Removal', 'Waste Removal']) {
      const h = setup(t, family, [['broad', family === 2 ? 'Removal Services' : 'Domestic Services'], ['dynamic-exact', label]]);
      h.fill(); assert.equal(h.select.value, 'dynamic-exact');
    }
  });
  test(`Family${family}: generic profile can use genuinely related description/services`, t => {
    const h = setup(t, family);
    h.fill({ businessName: 'Future Client', category: 'Services', description: 'We provide junk hauling and trash removal for homes.' });
    assert.equal(h.select.value, family === 2 ? '370' : '205');
    h.fill({ businessName: 'Other Client', category: '', services: ['Waste Removal'] }); assert.equal(h.select.value, family === 2 ? '370' : '205');
  });
  test(`Family${family}: active profile switch preserves other industries`, t => {
    const h = setup(t, family, [...(family === 2 ? options2 : options3), ['plumb', 'Plumbing'], ['limo', 'Limousine'], ['roof', 'Roofing'], ['hvac', 'HVAC']]);
    for (const [category, value] of [['Plumbing Services', 'plumb'], ['Limousine Services', 'limo'], ['Roofing Contractor', 'roof'], ['HVAC Services', 'hvac'], ['Junk Removal', family === 2 ? '370' : '205']]) {
      h.fill({ id: category, category, description: 'Incidental junk hauling mention.' }); assert.equal(h.select.value, value);
    }
  });
  test(`Family${family}: unsuitable and disabled choices preserve refusal policy`, t => {
    const h = setup(t, family, [['wrong', 'Moving'], ['blocked', 'Junk Hauling']]);
    h.select.querySelector<HTMLOptionElement>('[value=blocked]')!.disabled = true;
    h.fill(); assert.equal(h.select.value, '0');
    h.select.value = 'wrong'; h.fill(); assert.equal(h.select.value, family === 2 ? 'wrong' : '0');
  });
}
test('Family3: construction evidence permits fallback above Home Improvement', t => {
  const h = setup(t, 3, [['construction', 'Construction and Maintenance'], ['home', 'Home Improvement']]);
  h.fill({ services: ['Construction debris hauling'] }); assert.equal(h.select.value, 'construction');
  h.fill({ services: [] }); assert.equal(h.select.value, 'home');
});
test('Smart Autofill and Family1 retain existing junk matching behavior', t => {
  const h = setup(t, 2);
  for (const url of ['https://unfamiliar-directory.example/form', 'https://pages10.com/form']) {
    h.win.happyDOM.setURL(url);
    assert.equal(family2CategoryChoice(h.select, base, true).choice, undefined);
  }
});


