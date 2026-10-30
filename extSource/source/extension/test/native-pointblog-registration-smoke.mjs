import assert from 'node:assert/strict';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

// Actual built MV3 coordinator/watchers; every request intercepted. No real
// account, CAPTCHA provider, operator profile or Sheets access.
await mkdir('extension/test/.tmp', { recursive: true });
const origin = 'https://pointblog.net';
for (const scenario of ['terms-first', 'captcha-first', 'before-watcher', 'invalid-captcha']) {
  const outcome = scenario === 'invalid-captcha' ? 'invalid-captcha' : 'created';
  const path = await mkdtemp(resolve('extension/test/.tmp/pointblog-registration-'));
  const context = await chromium.launchPersistentContext(path, {
    channel: 'chromium', headless: true, ignoreDefaultArgs: ['--disable-extensions'], args: ['--enable-unsafe-extension-debugging'],
  });
  let posts = 0, unexpected = 0, worker, page;
  try {
    await context.route(/^https?:\/\//, route => {
      const request = route.request(), url = request.url();
      const html = body => route.fulfill({ contentType: 'text/html', body });
      if (url === origin + '/signup') {
        if (request.method() === 'POST') {
          posts++;
          return html(outcome === 'created'
            ? '<p>Your account is succesfuly created. <a href="/login">Click here to login</a></p>'
            : '<div class="alert-danger">Invalid captcha</div>' + signup);
        }
        return html(signup);
      }
      if (url === origin + '/' && request.method() === 'GET') return html('<a href="/signup">Sign Up</a><a href="/login">Login</a>');
      if (url === origin + '/login' && request.method() === 'GET') return html('<form method="post"><label>Username<input name="username"></label><label>Password<input name="password" type="password"></label><div class="g-recaptcha"></div><textarea name="g-recaptcha-response" hidden></textarea><button type="submit">Sign in</button></form>');
      if (url === origin + '/plugins/cool-php-captcha-0.3.1/captcha.php' && request.method() === 'GET')
        return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="30"><text y="20">fixture</text></svg>' });
      unexpected++;
      return route.abort();
    });
    // Current public DOM: the CAPTCHA wrapper itself contains "captcha" in its
    // class. It is layout, not another independent challenge. Native Terms state
    // is authoritative; the theme's checked CSS class alone never authorizes.
    const signup = '<form method="post" class="sign-in-new"><label>Username<input name="username"></label><label>Password<input name="password" type="password"></label><label>Email<input name="email" type="text"></label><div class="captcha-register"><label>Captcha<input name="captcha" autocomplete="off"></label><div style="display:inline-block"><img id="captcha" src="/plugins/cool-php-captcha-0.3.1/captcha.php"></div></div><div class="check-newsletter"><span class="ST-checkbox"><input id="agreement" name="agree" type="checkbox"></span><label for="agreement">I have read and agree to the terms.</label></div><button id="register" type="submit">Register</button></form>';
    if (scenario === 'before-watcher') await context.addInitScript(() => {
      // Simulated human-completed fixture state BEFORE document-idle receiver
      // startup or BA2_REGISTRATION_WATCH. Never applied to a real website.
      document.addEventListener('DOMContentLoaded', () => {
        if (location.pathname !== '/signup') return;
        document.querySelector('[name=captcha]').value = 'precompleted-fixture-answer';
        document.querySelector('#agreement').checked = true;
      }, { once: true });
    });
    const cdp = await context.browser().newBrowserCDPSession();
    const pending = context.waitForEvent('serviceworker');
    const { id } = await cdp.send('Extensions.loadUnpacked', { path: resolve('extension/dist') });
    worker = await pending;
    page = context.pages()[0];
    await page.goto(origin + '/');
    await page.locator('#ba2-floating-autofill').waitFor();
    await worker.evaluate(async () => {
      const profile = { id: 'pointblog-registration-fixture', businessName: 'Synthetic fixture', description: '', imageUrl: '', businessHours: [],
        username: 'synthetic-user', email: 'fixture@example.test', password: 'synthetic-not-live', updatedAt: '2026-10-19' };
      await chrome.storage.local.set({ 'ba2.activeProfile': { profile, syncedAt: '', source: 'local-storage' } });
      // Fixture-only sanitized ordering evidence if a continuation fails.
      globalThis.fixtureTrace = [];
      const record = value => globalThis.fixtureTrace.push(value);
      const get = chrome.tabs.get.bind(chrome.tabs);
      chrome.tabs.get = async id => { const tab = await get(id); record({ get: tab.url, status: tab.status }); return tab; };
      const set = chrome.storage.local.set.bind(chrome.storage.local);
      chrome.storage.local.set = async values => { const r = values['ba2.listingRun']; if (r) record({ save: r.stage, registration: r.registration?.state }); return set(values); };
    });
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${id}/popup/popup.html`);
    await popup.waitForFunction(() => !document.getElementById('autofill-button').disabled);
    await page.bringToFront();
    await popup.evaluate(() => document.getElementById('autofill-button').click());
    await page.waitForURL(origin + '/signup');
    if (scenario !== 'before-watcher') {
      await page.waitForFunction(() => document.querySelector('[name=username]').value === 'synthetic-user');
      assert.equal(await page.locator('[name=captcha]').inputValue(), '');
      assert.equal(await page.locator('#agreement').isChecked(), false);
      await expectRun(worker, run => run?.registration?.state === 'waiting-human' && /Terms/.test(run.registration.reason));
      assert.equal(posts, 0);
      if (scenario === 'captcha-first') {
        // Theme appearance cannot substitute for the real checkbox property.
        await page.locator('.ST-checkbox').evaluate(e => e.classList.add('checked'));
        await page.locator('[name=captcha]').fill('human-fixture-answer');
        await page.waitForTimeout(1200);
        assert.equal(posts, 0, 'entered CAPTCHA and checked CSS still require native Terms consent');
        assert.equal(await page.locator('#agreement').isChecked(), false);
        await expectRun(worker, run => /Terms/.test(run?.registration?.reason || ''));
        await page.locator('#agreement').check();
      } else {
        await page.locator('#agreement').check(); // Synthetic human consent only.
        await page.waitForTimeout(1200);
        assert.equal(posts, 0, 'blank image answer must never submit');
        // Only readiness, never asserted to be a correct/verified answer.
        await page.locator('[name=captcha]').fill('human-fixture-answer');
      }
    }
    if (outcome === 'created') {
      await page.waitForURL(origin + '/login');
      await page.waitForFunction(() => document.querySelector('[name=username]').value === 'synthetic-user');
      await expectRun(worker, run => run?.registration?.state === 'confirmed' && run?.login?.state === 'waiting-captcha');
    } else {
      await expectRun(worker, run => run?.registration?.state === 'failed');
      const before = await worker.evaluate(async () => await chrome.storage.local.get(null));
      await page.locator('[name=captcha]').fill('another-answer-must-not-submit');
      await page.locator('#agreement').check();
      await page.waitForTimeout(2200); // More than two watcher intervals.
      assert.equal(posts, 1, 'answer edits after server rejection cannot submit again');
      await page.goto(origin + '/signup'); // Explicit GET; never reload/replay a POST response.
      await page.waitForTimeout(1200);
      const after = await worker.evaluate(async () => await chrome.storage.local.get(null));
      const key = 'ba2.registrationGuard:https://pointblog.net:pointblog-registration-fixture';
      assert.deepEqual(after[key], before[key], 'failed attempt receipt never replaced');
      assert.equal(after['ba2.listingRun'].id, before['ba2.listingRun'].id);
      assert.equal(after['ba2.listingRun'].registration.state, 'failed');
    }
    assert.equal(posts, 1, 'one initial AUTOFILL and one registration dispatch only');
    assert.equal(unexpected, 0, 'no Login, publication, real network or Sheets submission');
    console.log(`PASS native Pointblog ${scenario}: actual captcha-register/Terms wrapper, one registration, ${outcome === 'created' ? 'automatic real Login link and credential fill; pending Login CAPTCHA' : 'server rejection retained; edits and GET reload cannot replay'}; all traffic intercepted`);
  } catch (error) {
    const run = worker && await worker.evaluate(async () => {
      const r = (await chrome.storage.local.get('ba2.listingRun'))['ba2.listingRun'];
      return { stage: r?.stage, manual: r?.manual, error: r?.error, registration: r?.registration?.state, registrationReason: r?.registration?.reason, login: r?.login?.state, loginReason: r?.login?.reason, trace: globalThis.fixtureTrace?.slice(-22) };
    }).catch(() => null);
    throw Error(`${scenario}: ${JSON.stringify({ page: page?.url(), posts, unexpected, run })}; ${error.message}`);
  } finally { await context.close(); }
}

async function expectRun(worker, predicate) {
  let run;
  for (let attempt = 0; attempt < 80; attempt++) {
    run = await worker.evaluate(async () => (await chrome.storage.local.get('ba2.listingRun'))['ba2.listingRun']);
    if (predicate(run)) return run;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw Error(`Unexpected fixture checkpoint: ${JSON.stringify({ stage: run?.stage, registration: run?.registration?.state, login: run?.login?.state, reason: run?.registration?.reason })}`);
}
