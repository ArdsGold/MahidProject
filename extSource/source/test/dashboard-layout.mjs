import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createEmptyProfileInput, normalizeBusinessProfile } from '../shared/src/business-profile.ts';

const url = process.argv[2] || 'http://127.0.0.1:3100';
const output = 'docs/screenshots';
await mkdir(output, { recursive: true });
const originalDescription = '<p><strong>Precision for every project.</strong>  Northline Surveying provides boundary and land surveys.</p>\n<p><br></p>\n<p>Explore our <a href="https://example.test/boundary-surveys">boundary survey services</a> or speak with our team.<br>Clear plans. Confident decisions.</p>';
const profile = { ...createEmptyProfileInput(), id: 'dashboard-fixture', createdAt: '2026-10-20T00:00:00Z', updatedAt: '2026-10-20T00:00:00Z',
  businessName: 'Northline Surveying', phone: '(312) 555-0146', website: 'https://example.test', category: 'Land Surveying',
  country: 'United States', state: 'Illinois', stateCode: 'IL', city: 'Chicago', postalCode: '60614', address: '1840 North Clark Street', completeAddress: '1840 North Clark Street, Chicago, IL 60614, United States',
  shortDescription: 'Land surveying, clear boundaries, and dependable project support.', description: originalDescription,
  services: ['Boundary surveys', 'Topographic surveys', 'Construction staking'], businessHours: ['Monday – Friday: 8:00 AM – 5:00 PM', 'Saturday: By appointment', 'Sunday: Closed'],
  firstName: 'Morgan', lastName: 'Ellis', contactName: 'Morgan Ellis', username: 'northline', email: 'hello@example.test', password: 'Fixture-Only-Password', imageUrl: 'https://example.test/business.jpg',
  socialLinks: [{ platform: 'facebook', url: 'https://facebook.com/northline' }, { platform: 'instagram', url: 'https://instagram.com/northline' }, { platform: 'linkedin', url: 'https://linkedin.com/company/northline' }],
  facebook: 'https://facebook.com/northline', instagram: 'https://instagram.com/northline', linkedin: 'https://linkedin.com/company/northline',
  logoAsset: { id: 'kept-logo', fileName: 'original-logo.png', size: 19, mimeType: 'image/png' }, brochureAsset: { id: 'kept-brochure', fileName: 'original-brochure.pdf', size: 22, mimeType: 'application/pdf' },
};
const profiles = [profile, { ...profile, id: 'second-fixture', businessName: 'Oak & Stone Studio', city: 'Austin' }, { ...profile, id: 'third-fixture', businessName: 'Harbor Dental Care', city: 'Seattle' }].map(normalizeBusinessProfile);
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const errors = [], unexpected = [];
await context.route('**/*', route => {
  const request = route.request();
  if (!request.url().startsWith(url)) { unexpected.push(request.url()); return route.abort(); }
  if (new URL(request.url()).pathname.startsWith('/api/')) { unexpected.push(request.url()); return route.abort(); }
  if (request.method() !== 'GET') { unexpected.push(`${request.method()} ${request.url()}`); return route.abort(); }
  return route.continue();
});
await context.addInitScript(({ profiles, profile }) => {
  if (!localStorage.getItem('ba2.profiles')) {
    localStorage.setItem('ba2.profiles', JSON.stringify(profiles)); localStorage.setItem('ba2.activeProfileId', JSON.stringify(profile.id));
    localStorage.setItem('ba2.activeProfile', JSON.stringify({ profile, syncedAt: 'fixture', source: 'local-storage' }));
  }
}, { profiles, profile });
const page = await context.newPage();
page.on('pageerror', error => errors.push(error.message));
page.on('console', event => { if (event.type() === 'error') errors.push(event.text()); });
try {
  await page.goto(url);
  assert.match(await page.title(), /Backlink Autofill/);
  await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => { const request = indexedDB.open('backlink-autofill-assets', 1); request.onupgradeneeded = () => request.result.createObjectStore('profile-assets', { keyPath: 'key' }); request.onsuccess = () => resolve(request.result); request.onerror = reject; });
    await new Promise((resolve, reject) => { const transaction = db.transaction('profile-assets', 'readwrite');
      for (const [kind, assetId, type] of [['logo', 'kept-logo', 'image/png'], ['brochure', 'kept-brochure', 'application/pdf']]) transaction.objectStore('profile-assets').put({ key: `${kind}:${assetId}`, kind, assetId, profileId: 'dashboard-fixture', blob: new Blob([`exact original ${kind} bytes`], { type }) });
      transaction.oncomplete = resolve; transaction.onerror = reject;
    }); db.close();
  });
  const assetSnapshot = () => page.evaluate(async () => {
    const db = await new Promise(resolve => { const r = indexedDB.open('backlink-autofill-assets', 1); r.onsuccess = () => resolve(r.result); });
    const rows = await new Promise(resolve => { const r = db.transaction('profile-assets', 'readonly').objectStore('profile-assets').getAll(); r.onsuccess = () => resolve(r.result); }); db.close();
    return Promise.all(rows.map(async ({ blob, ...row }) => ({ ...row, type: blob.type, bytes: Array.from(new Uint8Array(await blob.arrayBuffer())) })));
  });
  const originalAssets = await assetSnapshot();
  const originalStorage = await page.evaluate(() => JSON.stringify(localStorage));
  await page.getByRole('button', { name: 'Northline Surveying Chicago' }).click();
  assert.equal(await page.locator('.section-nav').count(), 0);
  assert.equal(await page.locator('input[type=file]').count(), 0);
  assert.equal(await page.getByText('Business logo', { exact: true }).count(), 0);
  assert.equal(await page.getByText('Brochure', { exact: true }).count(), 0);
  const metrics = [];
  for (const [width, height] of [[1440, 900], [1920, 1080], [1440, 800], [390, 844], [768, 1024]]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => window.scrollTo(0, 0));
    const dimensions = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, pageWidth: document.documentElement.scrollWidth, pageHeight: document.documentElement.scrollHeight,
      headings: [...document.querySelectorAll('.editor-content .section-heading')].map(e => ({ name: e.textContent, top: e.getBoundingClientRect().top, bottom: e.getBoundingClientRect().bottom })),
      saveBottom: document.querySelector('[type=submit]').getBoundingClientRect().bottom,
    }));
    metrics.push(dimensions);
    assert.ok(dimensions.pageWidth <= width + 1, `No horizontal overflow at ${width}`);
    assert.equal(dimensions.headings.length, 5);
    if (width >= 1440) {
      assert.ok(dimensions.headings.every(h => h.top >= 0 && h.bottom < height), `All five headers visible at ${width}`);
      assert.ok(dimensions.pageHeight <= height + 2, `No desktop page scrolling at ${width}x${height}`);
      assert.ok(dimensions.saveBottom <= height, `Save visible at ${width}`);
    }
    await page.screenshot({ path: `${output}/mahid-dashboard-${width}${height === 800 ? '-compact' : ''}.png`, fullPage: width < 1000 });
  }
  assert.equal(await page.evaluate(() => JSON.stringify(localStorage)), originalStorage, 'Resizing/reviewing never changes stored profile values');
  for (const width of [720, 320]) {
    await page.setViewportSize({ width, height: 720 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Reflow at ${width}px / enlarged text equivalent`);
    await page.locator('#field-password').focus();
    assert.equal(await page.locator('#field-password').evaluate(e => document.activeElement === e), true);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  const description = page.locator('.description-editor');
  await description.evaluate(element => { const original = element.innerHTML; element.innerHTML += '<p>Lengthy description content.</p>'.repeat(80); if (element.scrollHeight <= element.clientHeight) throw new Error('Long Description must scroll internally'); element.innerHTML = original; });
  assert.equal(await page.locator('.social-saved-list').evaluate(e => getComputedStyle(e).overflowY), 'auto');
  assert.equal(await description.locator('a').getAttribute('href'), 'https://example.test/boundary-surveys');
  await description.focus(); await page.locator('#field-phone').focus();
  assert.equal(await page.locator('.save-state').textContent(), 'Ready to save', 'Unchanged rich-text blur must not rewrite stored HTML');
  await page.getByRole('button', { name: 'Show', exact: true }).click();
  assert.equal(await page.locator('#field-password').getAttribute('type'), 'text');
  await page.getByRole('button', { name: 'Hide', exact: true }).click();
  assert.equal(await page.locator('#field-password').getAttribute('type'), 'password');
  await page.locator('#social-url-entry').fill('https://youtube.com/@northline');
  assert.match(await page.locator('.social-entry-row').textContent(), /YouTube/);
  await page.getByRole('button', { name: 'Add social link' }).click();
  assert.equal(await page.locator('.social-saved-row').count(), 4);
  await page.locator('#social-url-entry').fill('https://youtube.com/@northline');
  assert.equal(await page.getByRole('button', { name: 'Add social link' }).isDisabled(), true);
  await page.locator('#social-url-entry').fill('');
  await page.locator('.social-saved-row').last().getByRole('button', { name: 'Remove' }).click();
  assert.equal(await page.locator('.social-saved-row').count(), 3);
  await page.locator('#field-phone').fill('(312) 555-0199');
  await page.getByRole('button', { name: 'Save Profile', exact: true }).click();
  await page.locator('.empty-workspace').waitFor();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('ba2.profiles')).find(p => p.id === 'dashboard-fixture'));
  const expected = { ...profiles[0], phone: '(312) 555-0199' };
  assert.deepEqual({ ...saved, updatedAt: expected.updatedAt }, expected, 'All profile values/schema survive a save apart from intended Phone and updatedAt');
  assert.equal(saved.description, originalDescription, 'Exact HTML, spaces, line breaks and href preserved');
  assert.deepEqual(await assetSnapshot(), originalAssets, 'Original logo and brochure files/owners/bytes preserved');
  await page.getByRole('button', { name: 'Northline Surveying Chicago' }).click();
  assert.equal(await page.locator('#field-phone').inputValue(), '(312) 555-0199');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.locator('.saved-item').filter({ hasText: 'Oak & Stone Studio' }).getByRole('button', { name: 'Set active' }).click();
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('ba2.activeProfile')).profile.id), 'second-fixture');
  const third = page.locator('.saved-item').filter({ hasText: 'Harbor Dental Care' });
  page.once('dialog', dialog => dialog.dismiss()); await third.getByRole('button', { name: 'Delete', exact: true }).click();
  assert.equal(await page.locator('.saved-item').count(), 3);
  page.once('dialog', dialog => dialog.accept()); await third.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('ba2.profiles')).length === 2);
  await page.getByRole('button', { name: '+ New', exact: true }).click();
  await page.getByRole('button', { name: 'Save Profile', exact: true }).click();
  assert.match(await page.locator('.editor-message[role=alert]').textContent(), /Business Name/);
  assert.equal(await page.locator('#field-businessName').evaluate(e => e === document.activeElement), true);
  await page.locator('#field-businessName').fill('New QA Business');
  await page.getByRole('button', { name: 'Save Profile', exact: true }).click();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('ba2.profiles')).some(p => p.businessName === 'New QA Business'));
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('ba2.activeProfile')).profile.id), 'second-fixture', 'Creation does not replace an existing active profile');
  assert.deepEqual(await assetSnapshot(), originalAssets);
  await writeFile(`${output}/mahid-dashboard-metrics.json`, JSON.stringify(metrics, null, 2));
  console.log(JSON.stringify(metrics.map(({ width, height, pageWidth, pageHeight }) => ({ width, height, pageWidth, pageHeight })), null, 2));
  assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
  console.log('PASS dashboard: 5 simultaneous sections at 1440/1920, no desktop page scroll, mobile/tablet reflow, exact rich text, hidden upload UI with intact asset refs/Blob bytes, social add/remove/detection, password show/hide, create/edit/save/cancel/delete/active profile, no console errors or external/backend requests');
} finally { await browser.close(); }
