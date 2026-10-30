import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { createEmptyProfileInput, type BusinessProfile } from '@backlink-autofill/shared';
import { runListingAutofill, family2CategoryChoice } from '../../src/content/listing-autofill';

const fixture = readFileSync(new URL('../../family3/fixtures/expansion-directory.html', import.meta.url), 'utf8');
const base: BusinessProfile = { ...createEmptyProfileInput(), id: 'active-limo', businessName: 'Example Business', category: 'Limousine Services',
  website: 'https://example.test', contactName: 'Saved Owner', email: 'owner@example.test', description: 'Saved description.', createdAt: '2026-10-21', updatedAt: '2026-10-21' };
const options2 = [['543', 'Taxi Service'], ['447', 'Travel'], ['330', 'Automotive']];
const options3 = [['47', '|___Transport'], ['303', '|___Transportation'], ['73', '|___Transportation and Logistics']];
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
  for (const category of ['Limousine Services', 'Limo Services', 'Chauffeur Services', 'Luxury Transportation', 'Executive Car Services', 'Private Passenger Transportation'])
    test(`Family${family}: active ${category} uses supplied live transport fallback`, t => {
      const h = setup(t, family); const profile = { ...base, id: `future-${category}`, category }; const before = structuredClone(profile);
      h.fill(profile); assert.equal(h.select.value, family === 2 ? '543' : '47'); assert.deepEqual(profile, before);
    });
  test(`Family${family}: exact industry labels beat broader choices, using changed IDs`, t => {
    const h = setup(t, family, [['exact-limousine', 'Limousine'], ['exact-limo', 'Limo'], ['exact-chauffeur', 'Chauffeur Services'], ...(family === 2 ? options2 : options3)]);
    h.fill(); assert.equal(h.select.value, 'exact-limousine');
    h.fill({ category: 'Chauffeur Services' }); assert.equal(h.select.value, 'exact-chauffeur');
    h.select.querySelector('[value=exact-limousine]')!.remove(); h.fill(); assert.equal(h.select.value, 'exact-limo');
    h.select.querySelector('[value=exact-limo]')!.remove(); h.fill(); assert.equal(h.select.value, 'exact-chauffeur');
  });
  test(`Family${family}: reference fallback order, changed values and hierarchical labels`, t => {
    const h = setup(t, family, (family === 2 ? options2 : [['47', 'Automotive → Transport'], ['303', 'Travel and Tourism → Transportation'], ['73', 'Business → Transportation and Logistics']])
      .map(([value, label]) => ['live-' + value, label]));
    for (const expected of (family === 2 ? ['543', '447', '330'] : ['47', '303', '73'])) {
      h.fill(); assert.equal(h.select.value, 'live-' + expected); h.select.selectedOptions[0].remove();
    }
  });
  test(`Family${family}: generic saved category can use explicit specialist name/services`, t => {
    const h = setup(t, family); h.fill({ category: 'Transportation', businessName: 'Future Limousine Services' });
    assert.equal(h.select.value, family === 2 ? '543' : '47');
    h.fill({ category: '', services: ['Chauffeur Services'] }); assert.equal(h.select.value, family === 2 ? '543' : '47');
    h.fill({ category: 'Services', businessName: 'Future Chauffeur Services' }); assert.equal(h.select.value, family === 2 ? '543' : '47');
  });
  test(`Family${family}: freight, car repair and rental are not passenger-limo fallbacks`, t => {
    const h = setup(t, family, [['freight', 'Freight Transportation'], ['repair', 'Automotive Repair'], ['rental', 'Car Rental']]);
    const report = h.fill(); assert.equal(h.select.value, '0');
    assert(report.manual.some(reason => /category.*no suitable/i.test(reason)) || report.skipped.some(item => /category|suitable/i.test(item.reason)));
    h.select.value = 'repair'; h.fill(); assert.equal(h.select.value, family === 2 ? 'repair' : '0');
  });
  test(`Family${family}: active profile changes and other industries retain matching authority`, t => {
    const h = setup(t, family, [...(family === 2 ? options2 : options3), ['plumb', 'Plumbing'], ['junk', 'Junk Hauling'], ['roof', 'Roofing'], ['hvac', 'HVAC']]);
    h.fill(); assert.equal(h.select.value, family === 2 ? '543' : '47');
    for (const [category, expected] of [['Plumbing Services', 'plumb'], ['Junk Removal Services', 'junk'], ['Roofing Contractor', 'roof'], ['HVAC Services', 'hvac']]) {
      h.fill({ id: category, category, services: ['Limousine Services'], description: 'Chauffeur and luxury transportation mentioned incidentally.' });
      assert.equal(h.select.value, expected, category);
    }
  });
  test(`Family${family}: disabled/ambiguous live options keep existing refusal policy`, t => {
    const label = family === 2 ? 'Taxi Service' : 'Transport';
    const h = setup(t, family, [['first', label], ['second', label]]);
    h.fill(); assert.equal(h.select.value, '0');
    h.select.querySelector<HTMLOptionElement>('[value=first]')!.disabled = true;
    h.fill(); assert.equal(h.select.value, 'second');
    h.select.innerHTML = `<option value="0">Select</option><optgroup label="Unavailable" disabled><option value="blocked">${label}</option></optgroup><option value="allowed">${family === 2 ? 'Travel' : 'Transportation'}</option>`;
    h.fill(); assert.equal(h.select.value, 'allowed');
  });
}

test('Smart Autofill/Family1 callers do not gain family-specific limousine fallback rules', t => {
  const h = setup(t, 2);
  for (const url of ['https://unfamiliar-directory.example/form', 'https://pages10.com/form']) {
    h.win.happyDOM.setURL(url);
    assert.equal(family2CategoryChoice(h.select, base, true).choice, undefined);
  }
});
