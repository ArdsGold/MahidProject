import assert from 'node:assert/strict';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

await mkdir('extension/test/.tmp', { recursive: true });
const path = await mkdtemp(resolve('extension/test/.tmp/family2-category-'));
const context = await chromium.launchPersistentContext(path, { channel: 'chromium', headless: true,
  ignoreDefaultArgs: ['--disable-extensions'], args: ['--enable-unsafe-extension-debugging'] });
let body = '', nonGets = 0, unexpected = 0;
const baseProfile = { id: 'category-active', businessName: 'Unrelated Roofing Name', category: 'Medical Clinic', services: ['Roof repair'],
  description: 'Roofing services description.', email: 'category@example.test', phone: '555-0199', website: 'https://example.test', updatedAt: '2026-10-20' };
try {
  await context.route(/^https?:\/\//, route => {
    if (route.request().method() !== 'GET') { nonGets++; return route.abort(); }
    if (route.request().url() === 'https://businessizze.com/create-directory-listing') return route.fulfill({ contentType: 'text/html', body });
    if (route.request().resourceType() !== 'document') return route.fulfill({ body: '' });
    unexpected++; return route.abort();
  });
  const cdp = await context.browser().newBrowserCDPSession(), pending = context.waitForEvent('serviceworker');
  const { id } = await cdp.send('Extensions.loadUnpacked', { path: resolve('extension/dist') });
  const worker = await pending, page = context.pages()[0];
  const popup = await context.newPage(); await popup.goto(`chrome-extension://${id}/popup/popup.html`);
  const cases = [
    { name: 'junk reference inventory prefers Junk Hauling over alias ties', category: 'Junk Removal Services',
      options: [['370', 'Junk Hauling'], ['478', 'Trash Removal'], ['493', 'Waste Removal'], ['107', 'Haulers'], ['337', 'Garbage Services'], ['301', 'Disposal'], ['164', 'Removal Services']], expected: '370' },
    { name: 'future waste removal uses live Trash Removal when hauling is absent', category: 'Waste Removal',
      options: [['live-trash', 'Trash Removal'], ['live-waste', 'Waste Removal'], ['live-haulers', 'Haulers']], expected: 'live-trash' },
    { name: 'junk last resort uses live Removal Services rather than moving', category: 'Junk Hauling',
      options: [['live-removal', 'Removal Services'], ['wrong', 'Moving']], expected: 'live-removal' },
    { name: 'active limousine uses live Taxi Service fallback', businessName: 'Future Luxury Transportation', category: 'Limousine Services',
      options: [['543', 'Taxi Service'], ['447', 'Travel'], ['330', 'Automotive']], expected: '543' },
    { name: 'active chauffeur prefers exact category over taxi', category: 'Chauffeur Services',
      options: [['live-chauffeur', 'Chauffeur Services'], ['new-taxi', 'Taxi Service']], expected: 'live-chauffeur' },
    { name: 'executive car services uses Travel when taxi is absent', category: 'Executive Car Services',
      options: [['dynamic-travel', 'Travel'], ['dynamic-auto', 'Automotive']], expected: 'dynamic-travel' },
    { name: 'private passenger transportation uses broad Automotive only when needed', category: 'Private Passenger Transportation',
      options: [['auto-live', 'Automotive'], ['wrong', 'Car Rental']], expected: 'auto-live' },
    { name: 'Smiley actual business identity with supplied plumbing inventory', businessName: 'Smiley Drain Plumbing and Drain Cleaning', category: 'waste management',
      options: [['416', 'Plumbing'], ['150', 'Plumbing Services'], ['302', 'Drain Cleaning'], ['wrong', 'Removal Services']], expected: '416' },
    { name: 'future sewer repair with dynamic trade option', category: 'Sewer Repair', options: [['fresh-trade', 'Trade Services'], ['wrong', 'Cleaning']], expected: 'fresh-trade' },
    ...[
      ['Junk Removal Services', 'junk'],
      ['Roofing Contractor', 'roof'],
      ['HVAC Services', 'hvac'],
      ['Plumbing Services', 'plumbing'],
    ].map(([category, value]) => ({ name: `active business ${category}`, category,
      options: [['generic', 'Services'], ['contractor', 'Contractor'], ['junk', 'Junk Hauling'], ['roof', 'Roofing'], ['hvac', 'HVAC'], ['plumbing', 'Plumbing Services']], expected: value })),
    { name: 'HVAC semantic label', category: 'HVAC Services', options: [['generic', 'Services'], ['climate', 'Heating & Cooling']], expected: 'climate' },
    { name: 'junk removal is not moving', category: 'Junk Removal Services', options: [['moving', 'Moving'], ['generic', 'Services']], expected: '0', reason: /Category:.*no suitable/i },
    { name: 'plumbing is not pools', category: 'Plumbing Services', options: [['pool', 'Pools'], ['generic', 'Services']], expected: '0', reason: /Category:.*no suitable/i },
    { name: 'existing beauty synonym preserved', category: 'Beauty Services', options: [['generic', 'Services'], ['salon', 'Spa']], expected: 'salon' },
    { name: 'existing cleaning synonym preserved', category: 'Housekeeping Services', options: [['generic', 'Services'], ['clean', 'Cleaning']], expected: 'clean' },
    { name: 'healthcare broad parent', category: 'Medical Clinic', options: [['fresh-health', 'Health & Beauty'], ['fresh-roof', 'Roofing']], expected: 'fresh-health' },
    { name: 'exact beats parent', category: 'Medical Clinic', options: [['random-parent', 'Health & Beauty'], ['random-clinic', 'Medical Clinic']], expected: 'random-clinic' },
    { name: 'dynamic IDs and normalized exact', category: 'health and beauty', options: [['new-id-not-recorded', 'Health & Beauty'], ['other', 'Home Services']], expected: 'new-id-not-recorded' },
    { name: 'existing synonym matching', category: 'Plumber', options: [['dynamic-plumbing', 'Plumbing'], ['unrelated', 'Beauty']], expected: 'dynamic-plumbing' },
    { name: 'missing category ignores services/name/description', category: '', options: [['roof', 'Roofing'], ['health', 'Health & Beauty']], expected: '0', reason: /Category:.*no.*category/i },
    { name: 'unrelated options unchanged', category: 'Medical Clinic', options: [['cars', 'Automotive'], ['roof', 'Roofing']], expected: 'cars', initial: 'cars', reason: /Category:.*no suitable/i },
    { name: 'ambiguous options unchanged', category: 'Medical Clinic', options: [['a', 'Medical Services'], ['b', 'Medical Care']], expected: '0', reason: /Category:.*ambiguous/i },
    { name: 'generic service overlap not suitable', category: 'Medical Services', options: [['roof', 'Roofing Services'], ['car', 'Car Services']], expected: '0', reason: /Category:.*no suitable/i },
    { name: 'disabled and placeholder options excluded', category: 'Medical Clinic', options: [['blocked', 'Medical Clinic', true], ['parent', 'Health & Beauty']], expected: 'parent' },
  ];
  for (const fixture of cases) {
    const profile = { ...baseProfile, id: `active-${cases.indexOf(fixture)}`, category: fixture.category, businessName: fixture.businessName || baseProfile.businessName };
    await worker.evaluate(async profile => chrome.storage.local.set({
      'ba2.activeProfile': { profile, syncedAt: 'fixture', source: 'local-storage' },
      'ba2.listingRun': { id: 'preserved', sourceUrl: 'https://businessizze.com/create-directory-listing', stage: 'MANUAL_GATE', tabId: 999, steps: [], manual: [], submissionAttempted: true },
      'ba2.publicationGuard:preserved': { outcome: 'uncertain' },
    }), profile);
    body = `<h1>Create Directory Listing</h1><form method="post" onsubmit="window.submits++;return false">
      <label>Business Name<input name="business_name"></label><label>Email<input name="email" type="email"></label>
      <label>Phone<input name="phone"></label><label>Website<input name="website"></label><label>Description<textarea name="description"></textarea></label>
      <label for="cat">Category</label><select id="cat" name="category"><option value="0">--- Select One ---</option>${fixture.options.map(([value, label, disabled]) => `<option value="${value}" ${disabled ? 'disabled' : ''} ${fixture.initial === value ? 'selected' : ''}>${label}</option>`).join('')}</select>
      <table><tr><td>Include Profile With Listing</td><td><label><input type="radio" name="include_profile" value="opaque-yes">Yes</label><label><input type="radio" name="include_profile" value="opaque-no" checked>No</label></td></tr>
      <tr><td>Receive Promotions</td><td><label><input type="radio" name="promotions" value="yes">Yes</label><label><input type="radio" name="promotions" value="no" checked>No</label></td></tr></table>
      <label><input name="terms" type="checkbox">Terms</label><input name="captcha" placeholder="CAPTCHA"><button>Submit Listing</button></form><script>window.submits=0;window.categoryChanges=0;window.includeChanges=0;document.querySelector('select').addEventListener('change',()=>window.categoryChanges++);document.querySelector('[name=include_profile][value=opaque-yes]').addEventListener('change',()=>window.includeChanges++);</script>`;
    await page.goto('https://businessizze.com/create-directory-listing'); await page.locator('#ba2-floating-autofill').waitFor();
    const before = await worker.evaluate(async () => JSON.stringify(await chrome.storage.local.get(null)));
    await page.bringToFront(); await popup.evaluate(() => document.getElementById('autofill-button').click());
    await popup.waitForFunction(() => !document.getElementById('autofill-button').disabled && document.getElementById('result').textContent.trim());
    const result = await popup.locator('#result').textContent();
    assert.equal(await page.locator('#cat').inputValue(), fixture.expected, `${fixture.name}: ${result}`);
    if (fixture.reason) assert.match(result, fixture.reason, fixture.name);
    assert.equal(await page.locator('[name=include_profile][value=opaque-yes]').isChecked(), true, fixture.name);
    assert.equal(await page.locator('[name=include_profile][value=opaque-no]').isChecked(), false, fixture.name);
    assert.equal(await page.locator('[name=promotions][value=no]').isChecked(), true, fixture.name);
    if (fixture.name === 'unrelated options unchanged') {
      await page.locator('#ba2-floating-autofill button').click();
      await page.waitForFunction(() => document.querySelector('#ba2-floating-autofill').shadowRoot.querySelector('.status').textContent.startsWith('Category:'));
      const title = await page.locator('#ba2-floating-autofill .status').getAttribute('title');
      assert.match(title, fixture.reason);
    }
    assert.equal(await page.evaluate(() => window.includeChanges), 1, 'radio change fires once; repeated autofill is idempotent');
    assert.equal(await page.locator('[name=business_name]').inputValue(), profile.businessName, fixture.name);
    assert.equal(await page.locator('[name=email]').inputValue(), profile.email, fixture.name);
    assert.equal(await page.locator('[name=phone]').inputValue(), profile.phone, fixture.name);
    assert.equal(await page.locator('[name=website]').inputValue(), profile.website, fixture.name);
    assert.equal(await page.locator('[name=description]').inputValue(), profile.description, fixture.name);
    assert.equal(await page.evaluate(() => window.submits), 0);
    assert.equal(await page.locator('[name=terms]').isChecked(), false);
    assert.equal(await page.locator('[name=captcha]').inputValue(), '');
    if (fixture.reason) assert.equal(await page.evaluate(() => window.categoryChanges), 0);
    assert.equal(page.url(), 'https://businessizze.com/create-directory-listing');
    assert.equal(await worker.evaluate(async () => JSON.stringify(await chrome.storage.local.get(null))), before);
    console.log(`PASS ${fixture.name}`);
  }
  // Change the active business on the same loaded form; do not reload content scripts.
  for (const [index, category, expected] of [[1, 'Junk Removal Services', 'junk'], [2, 'Roofing Contractor', 'roof'], [3, 'HVAC Services', 'hvac'], [4, 'Plumbing Services', 'plumbing']]) {
    await worker.evaluate(async profile => chrome.storage.local.set({ 'ba2.activeProfile': { profile, syncedAt: 'switched', source: 'local-storage' } }),
      { ...baseProfile, id: `switch-${index}`, businessName: `Business ${index}`, category });
    await page.locator('#cat').evaluate((select, index) => {
      select.innerHTML = `<option value="0">--- Select One ---</option><option value="generic">Services</option>` +
        [['junk', 'Junk Hauling'], ['roof', 'Roofing'], ['hvac', 'HVAC'], ['plumbing', 'Plumbing Services']].map(([value, label]) => `<option value="${value}-${index}">${label}</option>`).join('');
    }, index);
    const before = await worker.evaluate(async () => JSON.stringify(await chrome.storage.local.get(null)));
    await page.bringToFront(); await popup.evaluate(() => document.getElementById('autofill-button').click());
    await popup.waitForFunction(() => !document.getElementById('autofill-button').disabled && document.getElementById('result').textContent.trim());
    assert.equal(await page.locator('#cat').inputValue(), `${expected}-${index}`, category);
    assert.equal(await page.locator('[name=business_name]').inputValue(), `Business ${index}`);
    assert.equal(await page.evaluate(() => window.submits), 0);
    assert.equal(await worker.evaluate(async () => JSON.stringify(await chrome.storage.local.get(null))), before);
    console.log(`PASS same-page active profile switch ${category} with changed option IDs`);
  }
  await worker.evaluate(async profile => chrome.storage.local.set({ 'ba2.activeProfile': { profile, syncedAt: 'fixture', source: 'local-storage' } }), baseProfile);
  for (const variant of ['already-yes', 'disabled-yes', 'missing-yes', 'different-question', 'broad-mixed-container', 'inline-unwrapped-labels']) {
    await page.reload();
    await page.evaluate(variant => {
      const yes = document.querySelector('[name=include_profile][value=opaque-yes]');
      if (variant === 'already-yes') yes.checked = true;
      if (variant === 'disabled-yes') yes.disabled = true;
      if (variant === 'missing-yes') yes.closest('label').remove();
      if (variant === 'different-question') yes.closest('tr').cells[0].textContent = 'Show Contact Details';
      if (variant === 'broad-mixed-container') {
        const table = yes.closest('table');
        const fieldset = document.createElement('fieldset');
        fieldset.innerHTML = '<legend>Include Profile With Listing</legend>';
        for (const cell of table.querySelectorAll('td:nth-child(2)')) fieldset.append(...cell.childNodes);
        table.replaceWith(fieldset);
        yes.disabled = true;
      }
      if (variant === 'inline-unwrapped-labels') yes.closest('tr').cells[1].innerHTML = '<input type="radio" name="include_profile" value="1"> Yes <input type="radio" name="include_profile" value="0" checked> No';
    }, variant);
    const before = await worker.evaluate(async () => JSON.stringify(await chrome.storage.local.get(null)));
    await page.bringToFront(); await popup.evaluate(() => document.getElementById('autofill-button').click());
    await popup.waitForFunction(() => !document.getElementById('autofill-button').disabled && document.getElementById('result').textContent.trim());
    const expectedYes = ['already-yes', 'inline-unwrapped-labels'].includes(variant);
    assert.equal(await page.locator('[name=include_profile]:checked').inputValue(), expectedYes ? variant === 'inline-unwrapped-labels' ? '1' : 'opaque-yes' : 'opaque-no', variant);
    assert.equal(await page.evaluate(() => window.includeChanges), 0, variant);
    assert.equal(await page.locator('[name=promotions][value=no]').isChecked(), true, variant);
    assert.equal(await page.locator('#cat').inputValue(), 'parent', variant);
    assert.equal(await page.evaluate(() => window.submits), 0, variant);
    assert.equal(await worker.evaluate(async () => JSON.stringify(await chrome.storage.local.get(null))), before);
    console.log(`PASS include-profile ${variant}`);
  }
  assert.equal(nonGets, 0); assert.equal(unexpected, 0);
  console.log(`PASS ${cases.length}/${cases.length} Family2 category + Include Profile Yes cases, 4 same-page active-profile switches and 6 radio variants; other fields preserved, zero submit/navigation/Terms/CAPTCHA/history mutation, zero non-GET/unexpected HTTP`);
} finally { await context.close(); }
