import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

// Actual built popup/worker/content, audited Tinyblogging public Login fixture.
// All requests intercepted. Never use the operator profile or submit an account.
const evidence = JSON.parse(await readFile('research/group-1-automation/public-evidence.json', 'utf8'));
const fixture = evidence.find(s => s.domain === 'tinyblogging.com').pages.find(p => p.stage === 'login').fixture;
await mkdir('extension/test/.tmp', { recursive: true });
for (const scenario of ['stale-checkpoint', 'uncertain-attempt', 'orphan-receipt']) {
  const profilePath = await mkdtemp(resolve('extension/test/.tmp/protected-registration-login-'));
  const context = await chromium.launchPersistentContext(profilePath, {
    channel: 'chromium', headless: true, ignoreDefaultArgs: ['--disable-extensions'], args: ['--enable-unsafe-extension-debugging'],
  });
  let nonGets = 0, unexpected = 0;
  try {
    await context.route(/^https?:\/\//, route => {
      if (route.request().method() !== 'GET') { nonGets++; return route.abort(); }
      if (route.request().url() === 'https://tinyblogging.com/login')
        return route.fulfill({ contentType: 'text/html', body: fixture });
      unexpected++; return route.abort();
    });
    const cdp = await context.browser().newBrowserCDPSession();
    const pending = context.waitForEvent('serviceworker');
    const { id } = await cdp.send('Extensions.loadUnpacked', { path: resolve('extension/dist') });
    const worker = await pending;
    const page = context.pages()[0];
    await page.goto('https://tinyblogging.com/login');
    await page.locator('#ba2-floating-autofill').waitFor();
    await worker.evaluate(async ({ scenario }) => {
      const [tab] = await chrome.tabs.query({ url: 'https://tinyblogging.com/login' });
      const profile = { id: 'protected-registration-fixture', businessName: 'Synthetic', username: 'synthetic-user',
        password: 'synthetic-not-live', email: 'fixture@example.test', updatedAt: '2026-10-20', description: '<p>Unchanged synthetic article</p>' };
      const run = { id: 'preserved-registration-run', tabId: tab.id, sourceUrl: 'https://tinyblogging.com/signup', domain: 'tinyblogging.com',
        profileId: profile.id, stage: 'MANUAL_GATE', manual: ['CAPTCHA'], steps: ['Old registration checkpoint'],
        autoRegister: false, autoLogin: false, autoPublish: false, awaitingManualResume: false,
        registration: { url: 'https://tinyblogging.com/signup', state: 'waiting-human', reason: 'CAPTCHA' } };
      if (scenario === 'uncertain-attempt') {
        Object.assign(run, { autoRegister: true, autoLogin: true, autoPublish: true, accountStatus: 'new',
          registrationApproval: { authorizedAt: new Date().toISOString(), profileUpdatedAt: profile.updatedAt } });
        run.registration = { ...run.registration, state: 'uncertain', attemptId: 'immutable-registration', claimed: true };
      }
      await chrome.storage.local.set({ 'ba2.activeProfile': { profile, syncedAt: '', source: 'local-storage' },
        ...(scenario === 'orphan-receipt' ? {} : { 'ba2.listingRun': run }),
        ['ba2.registrationGuard:https://tinyblogging.com:' + profile.id]: { runId: scenario === 'stale-checkpoint' ? 'earlier-run' : run.id, state: 'uncertain' },
        'ba2.listingRunArchive:other-family': { id: 'other-family', domain: 'directory3.org', directory3: { preserved: true } } });
    }, { scenario });
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${id}/popup/popup.html`);
    await popup.waitForFunction(() => !document.getElementById('autofill-button').disabled);
    const before = await worker.evaluate(async () => JSON.stringify(await chrome.storage.local.get(null)));
    await page.bringToFront();
    if (scenario === 'uncertain-attempt') {
      await worker.evaluate(async () => {
        const [tab] = await chrome.tabs.query({ url: 'https://tinyblogging.com/login' });
        await chrome.tabs.sendMessage(tab.id, { type: 'BA2_REGISTRATION_WATCH', runId: 'preserved-registration-run' }, { frameId: 0 });
      });
      await page.locator('#ba2-floating-autofill button').click();
    }
    else await popup.evaluate(() => document.getElementById('autofill-button').click());
    try { await page.waitForFunction(() => document.querySelector('[name=username]')?.value === 'synthetic-user', null, { timeout: 5000 }); }
    catch {
      throw Error(`${scenario}: Login stayed empty; popup=${await popup.locator('#result').innerText()}; floating=${await page.locator('#ba2-floating-autofill .status').innerText()}`);
    }
    assert.equal(await page.locator('[name=password]').inputValue(), 'synthetic-not-live');
    const status = scenario === 'uncertain-attempt' ? await page.locator('#ba2-floating-autofill .status').innerText() : await popup.locator('#result').innerText();
    assert.match(status, /filled only/i);
    assert.match(status, /submit manually/i);
    assert.equal(await worker.evaluate(async () => JSON.stringify(await chrome.storage.local.get(null))), before);
    if (scenario === 'stale-checkpoint') {
      assert.doesNotMatch(await page.locator('#ba2-floating-autofill .status').innerText(), /complete.*human|CAPTCHA/i);
      await page.reload();
      await page.locator('#ba2-floating-autofill').waitFor();
      await popup.evaluate(() => document.getElementById('autofill-button').click());
      await page.waitForFunction(() => document.querySelector('[name=username]')?.value === 'synthetic-user');
      assert.equal(await worker.evaluate(async () => JSON.stringify(await chrome.storage.local.get(null))), before);
    }
    await page.waitForTimeout(1200); // Cross a watcher tick; no action is authorized.
    assert.equal(nonGets, 0); assert.equal(unexpected, 0);
    assert.equal(await worker.evaluate(async () => JSON.stringify(await chrome.storage.local.get(null))), before);
    console.log(`PASS Tinyblogging ${scenario}: Login fill only, history/receipts unchanged, no account/publication/Sheets requests`);
  } finally { await context.close(); }
}
