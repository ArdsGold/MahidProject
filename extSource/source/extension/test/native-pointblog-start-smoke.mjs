import assert from 'node:assert/strict';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

// Actual built MV3 popup/coordinator, isolated synthetic sites/profile only.
// Stop at incomplete registration; never submit any form or use live credentials.
await mkdir('extension/test/.tmp', { recursive: true });
for (const scenario of ['same-site-publication', 'failed-homepage', 'fresh', 'unresolved-other-site']) {
  const origin = ['same-site-publication', 'failed-homepage'].includes(scenario) ? 'https://bloguetechno.com' : 'https://pointblog.net';
  const profilePath = await mkdtemp(resolve('extension/test/.tmp/pointblog-start-'));
  const context = await chromium.launchPersistentContext(profilePath, {
    channel: 'chromium', headless: true, ignoreDefaultArgs: ['--disable-extensions'],
    args: ['--enable-unsafe-extension-debugging'],
  });
  let posts = 0;
  try {
    await context.route(/^https?:\/\//, route => {
      const request = route.request();
      if (request.method() !== 'GET') { posts++; return route.abort(); }
      if (request.url() === origin + '/') return route.fulfill({ contentType: 'text/html',
        body: '<a href="/signup">Sign Up</a><a href="/login">Login</a><a id="create-website-button" href="/signup">Start now</a>' });
      if (request.url() === origin + '/signup') return route.fulfill({ contentType: 'text/html',
        body: '<form method="post"><label>Username<input name="username" required></label><label>Email<input type="email" name="email" required></label><label>Password<input type="password" name="password" required></label><label>Captcha<input name="captcha" required></label><label><input type="checkbox" name="agreement">Terms</label><button type="submit">Register</button></form>' });
      if (request.url() === origin + '/login') return route.fulfill({ contentType: 'text/html',
        body: '<form method="post"><label>Username<input name="username" required></label><label>Password<input type="password" name="password" required></label><button type="submit">Sign in</button></form>' });
      return route.abort();
    });
    const cdp = await context.browser().newBrowserCDPSession();
    const pending = context.waitForEvent('serviceworker');
    const { id } = await cdp.send('Extensions.loadUnpacked', { path: resolve('extension/dist') });
    const worker = await pending;
    const page = context.pages()[0];
    await page.goto(origin + '/');
    await page.locator('#ba2-floating-autofill').waitFor();
    const seed = await worker.evaluate(async scenario => {
      const profile = { id: 'pointblog-start-fixture', businessName: 'Synthetic fixture', email: 'fixture@example.test', updatedAt: '2026-10-19' };
      const values = { 'ba2.activeProfile': { profile, syncedAt: '', source: 'local-storage' } };
      if (scenario !== 'fresh') {
        const [tab] = await chrome.tabs.query({ url: 'https://bloguetechno.com/' });
        values['ba2.listingRun'] = { id: 'preserved-bloguetechno', profileId: profile.id, tabId: 99999999,
          sourceUrl: 'https://bloguetechno.com/new', domain: 'bloguetechno.com', stage: 'MANUAL_GATE',
          status: 'needs-human', steps: [], manual: [], submissionAttempted: true,
          publicationSubmission: { attemptId: 'preserved-attempt', outcome: 'uncertain', claimed: true } };
        values['ba2.publicationGuard:bloguetechno.com:' + profile.id] = { runId: 'preserved-bloguetechno' };
        if (scenario === 'same-site-publication') values['ba2.listingRun'].tabId = tab.id;
        if (scenario === 'failed-homepage') {
          Object.assign(values['ba2.listingRun'], { stage: 'ERROR', sourceUrl: 'https://bloguetechno.com/', tabId: tab.id,
            continuous: { loginReceiptsSnapshot: '{}', registrationReceiptSnapshot: 'null' }, error: 'Listing autofill returned no response.' });
          delete values['ba2.listingRun'].submissionAttempted;
          delete values['ba2.listingRun'].publicationSubmission;
          delete values['ba2.publicationGuard:bloguetechno.com:' + profile.id];
        }
      }
      await chrome.storage.local.set(values);
      return await chrome.storage.local.get(null);
    }, scenario);
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${id}/popup/popup.html`);
    await popup.waitForFunction(() => !document.getElementById('autofill-button').disabled);
    await page.bringToFront();
    // Invoke the actual popup DOM listener while the website remains selected.
    await popup.evaluate(() => document.getElementById('autofill-button').click());
    {
      const target = origin + (scenario === 'same-site-publication' ? '/login' : '/signup');
      try { await page.waitForURL(target, { timeout: 5000 }); }
      catch { throw Error('Homepage navigation interrupted: ' + await popup.locator('#result').textContent()); }
      await popup.waitForFunction(() => /MANUAL REVIEW|WAITING FOR HUMAN CHECKPOINT/.test(document.getElementById('result').textContent));
      const saved = await worker.evaluate(async () => (await chrome.storage.local.get('ba2.listingRun'))['ba2.listingRun']);
      assert.equal(saved.sourceUrl, origin + '/');
      assert.equal(saved.homepageStart, true);
      assert.equal(saved.autoRegister, scenario !== 'same-site-publication');
      assert.equal(saved.autoLogin, true);
      assert.equal(saved.autoPublish, true);
      assert.equal(saved.navigationTarget, target);
      assert.equal(Boolean(saved.registration?.attemptId || saved.login?.attemptId || saved.submissionAttempted), false);
      if (scenario !== 'same-site-publication') {
        assert.equal(await page.locator('input[type=checkbox]').isChecked(), false);
        assert.equal(await page.locator('input[name=captcha]').inputValue(), '');
      }
      if (scenario !== 'fresh') {
        const after = await worker.evaluate(async () => await chrome.storage.local.get(null));
        assert.deepEqual(after['ba2.listingRunArchive:preserved-bloguetechno'], seed['ba2.listingRun']);
        assert.deepEqual(after['ba2.publicationGuard:bloguetechno.com:pointblog-start-fixture'], seed['ba2.publicationGuard:bloguetechno.com:pointblog-start-fixture']);
      }
    }
    assert.equal(posts, 0);
    console.log(`PASS native homepage (${scenario}): observed account navigation, manual human gate, zero attempts, historical run/receipt preserved`);
  } finally { await context.close(); }
}
