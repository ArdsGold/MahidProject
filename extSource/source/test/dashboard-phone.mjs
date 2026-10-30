import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createEmptyProfileInput, normalizeBusinessProfile } from '../shared/src/business-profile.ts';

// Disposable Chromium storage only; never connects to an operator browser or saves a form.
const baseUrl = process.argv[2] || 'http://127.0.0.1:3000';
const records = [
  { id: 'phone-a', businessName: 'Phone Binding A', phone: '555-0107', username: 'different-username-a' },
  { id: 'phone-b', businessName: 'Phone Binding B', phone: '+44 20 7946 0123', username: 'different-username-b' },
  { id: 'phone-empty', businessName: 'Phone Binding Empty', phone: '', username: 'never-use-as-phone' },
].map(record => normalizeBusinessProfile({ ...createEmptyProfileInput(), ...record, password: 'Fixture-Only', createdAt: 'fixture', updatedAt: 'fixture' }));
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const errors = [];
await context.addInitScript(records => {
  localStorage.setItem('ba2.profiles', JSON.stringify(records));
  localStorage.setItem('ba2.activeProfileId', JSON.stringify(records[0].id));
  localStorage.setItem('ba2.activeProfile', JSON.stringify({ profile: records[0], source: 'local-storage', syncedAt: 'fixture' }));
}, records);
const page = await context.newPage();
page.on('pageerror', error => errors.push(error.message));
try {
  await page.goto(baseUrl);
  const before = await page.evaluate(() => JSON.stringify(localStorage));
  for (const record of records) {
    await page.locator('.saved-item').filter({ hasText: record.businessName }).getByRole('button', { name: new RegExp(record.businessName) }).click();
    assert.equal(await page.locator('#field-phone').inputValue(), record.phone);
    assert.equal(await page.locator('#field-phone').getAttribute('name'), 'phone');
    assert.equal(await page.locator('#field-phone').getAttribute('type'), 'tel');
    assert.equal(await page.locator('section[aria-labelledby="submission-heading"] #field-username').inputValue(), record.username);
    await page.getByRole('button', { name: 'Show', exact: true }).click();
    await page.locator('#field-phone').focus();
    await page.waitForTimeout(150);
    assert.equal(await page.locator('#field-phone').inputValue(), record.phone);
    assert.equal(await page.locator('#field-username').inputValue(), record.username);
    assert.equal(await page.evaluate(() => JSON.stringify(localStorage)), before, 'Opening/reviewing never rewrites saved data');
    console.log(`PASS ${record.id}: saved phone and username remain separate; storage unchanged`);
  }
  assert.deepEqual(errors, []);
  console.log('PASS dashboard Phone binding: two distinct saved phones, empty phone stays empty, profile switching, password visibility/focus, zero saved-profile writes; no dashboard build performed');
} finally { await browser.close(); }
