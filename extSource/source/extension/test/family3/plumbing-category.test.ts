import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { createEmptyProfileInput, type BusinessProfile } from '@backlink-autofill/shared';
import { runListingAutofill } from '../../src/content/listing-autofill';

const fixture = readFileSync(new URL('../../family3/fixtures/expansion-directory.html', import.meta.url), 'utf8');
const base: BusinessProfile = { ...createEmptyProfileInput(), id: 'active-business', businessName: 'Example Business', category: 'Plumbing Services',
  website: 'https://example.test', contactName: 'Example Owner', email: 'owner@example.test', description: 'Business description.', createdAt: '2026-10-21', updatedAt: '2026-10-21' };
const family2Options = [['416', 'Plumbing'], ['150', 'Plumbing Services'], ['302', 'Drain Cleaning'], ['wrong-removal', 'Removal Services'], ['wrong-clean', 'Cleaning']];
const family3Options = [['658', 'Trade Services'], ['505', 'Building and Construction'], ['wrong-removal', 'Removal Services'], ['wrong-clean', 'Cleaning']];
function setup(t: TestContext, family: 2 | 3, options: string[][]) {
  const win = new Window({ url: family === 2 ? 'https://businessizze.com/create-directory-listing' : 'https://expansiondirectory.com/submit.php',
    settings: { disableJavaScriptEvaluation: true, disableJavaScriptFileLoading: true, disableCSSFileLoading: true, disableIframePageLoading: true } });
  win.document.write(family === 3 ? fixture : '<form><label>Business Name<input name="business_name"></label><label>Category<select name="category"></select></label><input name="captcha"><button>Submit</button></form>');
  const g = globalThis as Record<string, unknown>;
  for (const key of ['window', 'document', 'location', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement', 'HTMLOptGroupElement', 'HTMLElement', 'Element', 'Event']) g[key] = key === 'window' ? win : (win as unknown as Record<string, unknown>)[key];
  const doc = win.document as unknown as Document, select = doc.querySelector<HTMLSelectElement>('select')!;
  select.innerHTML = '<option value="0">--- Select One ---</option>' + options.map(([value, label]) => `<option value="${value}">${label}</option>`).join('');
  const human = [...doc.querySelectorAll<HTMLElement>('[name=captcha],.g-recaptcha,[name=submit],button')];
  for (const element of human) for (const type of ['click', 'focus', 'input', 'change', 'blur']) element.addEventListener(type, () => assert.fail('Human control interacted with'));
  doc.addEventListener('submit', () => assert.fail('Form submitted'));
  t.after(() => win.close());
  return { select, doc, fill: (profile: Partial<BusinessProfile>) => runListingAutofill({ ...base, ...profile }) };
}

for (const family of [2, 3] as const) {
  test(`Family${family}: Smiley's explicit plumbing identity overrides saved waste management without changing data`, t => {
    const h = setup(t, family, family === 2 ? family2Options : family3Options);
    const profile = { ...base, businessName: 'Smiley Drain Plumbing and Drain Cleaning', category: 'waste management', services: [] };
    const before = structuredClone(profile); h.fill(profile);
    assert.equal(h.select.value, family === 2 ? '416' : '658'); assert.deepEqual(profile, before);
  });
  for (const category of ['Plumber', 'Plumbers', 'Plumbing Services', 'Drain Repair', 'Sewer Repair', 'Drain Cleaning'])
    test(`Family${family}: future active category ${category}`, t => {
      const h = setup(t, family, family === 2 ? family2Options : family3Options); h.fill({ category });
      assert.equal(h.select.value, family === 2 ? '416' : '658');
    });
  test(`Family${family}: live priorities and changed IDs; drains only for a drain specialist`, t => {
    const h = setup(t, family, [['new-service', 'Plumbing Services'], ['new-drain', 'Drain Cleaning'], ...family3Options]);
    const drain = { category: 'Sewer Repair', businessName: 'Example Sewer Repair' };
    h.fill(drain); assert.equal(h.select.value, 'new-service'); h.select.querySelector('[value=new-service]')!.remove();
    h.fill(drain); assert.equal(h.select.value, 'new-drain');
    h.fill({ id: 'another-active-client', category: 'Plumbing Services' }); assert.equal(h.select.value, '658');
    h.select.querySelector('[value="658"]')!.remove(); h.fill(drain); assert.equal(h.select.value, 'new-drain');
    h.select.querySelector('[value=new-drain]')!.remove(); h.fill(drain); assert.equal(h.select.value, '505');
  });
  test(`Family${family}: plumbing never falls back to general cleaning or removal`, t => {
    const h = setup(t, family, [['bad-removal', 'Removal Services'], ['bad-cleaning', 'Cleaning']]);
    const report = h.fill({ category: 'Drain Cleaning' }); assert.equal(h.select.value, '0');
    assert(report.manual.some(reason => /category.*no suitable/i.test(reason)) || report.skipped.some(item => /category|suitable/i.test(item.reason)));
  });
  test(`Family${family}: missing category can use explicit plumber identity or generic-category plumbing services`, t => {
    const h = setup(t, family, family3Options); h.fill({ category: '', businessName: 'Future Licensed Plumbers' }); assert.equal(h.select.value, '658');
    h.fill({ category: 'Home Services', services: ['Sewer Repair'] }); assert.equal(h.select.value, '658');
  });
  test(`Family${family}: incidental plumbing services/description do not override another industry's saved category`, t => {
    const h = setup(t, family, [['junk', 'Junk Removal'], ['roof', 'Roofing'], ['hvac', 'HVAC'], ['house', 'Cleaning'], ...family3Options.filter(([value]) => value !== 'wrong-clean')]);
    for (const [category, expected] of [['Junk Removal', 'junk'], ['Roofing', 'roof'], ['HVAC', 'hvac'], ['Cleaning', 'house']]) {
      h.fill({ category, services: ['Drain Cleaning', 'Plumbing'], description: 'We work near plumbers.' }); assert.equal(h.select.value, expected, category);
    }
  });
  test(`Family${family}: disabled/tied plumbing options retain existing refusal policy`, t => {
    const h = setup(t, family, [['a', 'Plumbing'], ['b', 'Plumbing'], ...family3Options]);
    h.fill({}); assert.equal(h.select.value, '0');
    h.select.querySelector<HTMLOptionElement>('[value=a]')!.disabled = true; h.fill({}); assert.equal(h.select.value, 'b');
  });
}

test('Family3: full captured Expansion inventory matches Trade Services for actual Smiley business identity', t => {
  const h = setup(t, 3, []);
  const original = new Window(); original.document.write(fixture);
  h.select.innerHTML = original.document.querySelector('select[name=CATEGORY_ID]')!.innerHTML;
  original.close();
  h.fill({ businessName: 'Smiley Drain Plumbing and Drain Cleaning', category: 'waste management' });
  assert.equal(h.select.selectedOptions[0].textContent!.replace(/[^a-z]+/gi, ' ').trim(), 'Trade Services');
});

test('Family3: supplied broad plumbing inventory prefers Home Improvement', t => {
  const h = setup(t, 3, [['301', 'Home Improvement'], ['102', 'Construction and Maintenance'], ['bad', 'Removal Services'], ['clean', 'Cleaning']]);
  h.fill({ businessName: 'Smiley Drain Plumbing and Drain Cleaning', category: 'waste management' });
  assert.equal(h.select.value, '301');
});

test('Family3: latest supplied CATEGORY_ID values346/84/337 select and retain346 for actual Smiley identity', async t => {
  const h = setup(t, 3, [['346', 'Home Improvement'], ['84', 'Construction and Maintenance'], ['337', 'Domestic Services']]);
  assert.equal(h.select.name, 'CATEGORY_ID');
  const profile = { businessName: 'Smiley Drain Plumbing and Drain Cleaning', category: 'waste management', services: [] };
  const changes: string[] = [];
  h.select.addEventListener('input', () => changes.push(`input:${h.select.value}`));
  h.select.addEventListener('change', () => changes.push(`change:${h.select.value}`));
  const report = h.fill(profile);
  assert.equal(h.select.value, '346'); assert.equal(h.select.selectedOptions[0].textContent, 'Home Improvement');
  assert(report.filled.some(field => field.field === 'category' && field.value === 'Home Improvement'));
  assert.deepEqual(changes, ['input:346', 'change:346']);
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(h.select.value, '346');
  h.fill(profile); assert.equal(h.select.value, '346'); assert.equal(changes.length, 2, 'retained choice is not rewritten');
});

test('Family3: Construction and Maintenance is an alternative when Home Improvement is absent', t => {
  const h = setup(t, 3, [['102', 'Construction and Maintenance'], ['bad', 'Cleaning']]);
  h.fill({ category: 'Plumber' }); assert.equal(h.select.value, '102');
});

test('Family3: exact plumbing and trade beat broader fallbacks using current option IDs', t => {
  const options = [['live-home', 'Home Improvement'], ['live-construction', 'Construction & Maintenance'], ['live-trade', 'Trade Services'], ['live-service', 'Plumbing Services'], ['live-exact', 'Plumbers']];
  const h = setup(t, 3, options);
  for (const value of ['live-exact', 'live-service', 'live-trade', 'live-home', 'live-construction']) {
    h.fill({ category: 'Plumbing Services' }); assert.equal(h.select.value, value);
    h.select.selectedOptions[0].remove();
  }
});

test('Family3: disabled Home Improvement cannot displace available Construction and Maintenance', t => {
  const h = setup(t, 3, [['301', 'Home Improvement'], ['102', 'Construction and Maintenance']]);
  h.select.querySelector<HTMLOptionElement>('[value="301"]')!.disabled = true;
  h.fill({}); assert.equal(h.select.value, '102');
});

test('Family2: new broad Family3 plumbing fallbacks do not change its selection policy', t => {
  const h = setup(t, 2, [['301', 'Home Improvement'], ['102', 'Construction and Maintenance']]);
  h.fill({}); assert.equal(h.select.value, '0');
  h.select.value = '102'; h.fill({}); assert.equal(h.select.value, '102');
});
