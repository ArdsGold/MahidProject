import assert from 'node:assert/strict';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

// Browser plugin unavailable. Native MV3 in a disposable profile, intercepted
// synthetic pages only. No real account/session or submission is used.
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const temp = join(root, 'test', '.tmp');
await mkdir(temp, { recursive: true });
const profile = await mkdtemp(join(temp, 'native-autofill-'));
const context = await chromium.launchPersistentContext(profile, {
  channel: 'chromium', headless: true, ignoreDefaultArgs: ['--disable-extensions'],
  args: ['--enable-unsafe-extension-debugging'],
});
try {
  await context.route(/^https?:\/\//, route => {
    const url = route.request().url();
    if (url === 'https://bloguetechno.com/') return route.fulfill({ contentType: 'text/html',
      body: '<html><body><a href="/login">Login</a><label>Business Name<input name="businessName"></label><iframe src="/frame"></iframe></body></html>' });
    if (url === 'https://bloguetechno.com/frame') return route.fulfill({ contentType: 'text/html', body: '<html><body>Child frame</body></html>' });
    if (url === 'https://bloguetechno.com/login') return route.fulfill({ contentType: 'text/html', body: '<html><body><h1>Sign in</h1><form method="post"><label>Username<input name="username" required></label><label>Password<input name="password" type="password" required></label><div class="g-recaptcha">Human challenge</div><textarea hidden name="g-recaptcha-response"></textarea><button type="submit">Sign in</button></form></body></html>' });
    return route.abort();
  });
  const cdp = await context.browser().newBrowserCDPSession();
  const pending = context.waitForEvent('serviceworker');
  const loaded = await cdp.send('Extensions.loadUnpacked', { path: join(root, 'dist') });
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${loaded.id}/popup/popup.html`);
  let worker = await pending;
  const page = context.pages()[0];
  await page.goto('https://bloguetechno.com/');
  await page.locator('#ba2-floating-autofill').waitFor();
  const replacement = context.waitForEvent('serviceworker');
  await cdp.send('Extensions.uninstall', { id: loaded.id });
  const reloaded = await cdp.send('Extensions.loadUnpacked', { path: join(root, 'dist') });
  const newPopup = await context.newPage();
  await newPopup.goto(`chrome-extension://${reloaded.id}/popup/popup.html`);
  worker = await replacement;
  await worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ url: 'https://bloguetechno.com/' });
    await chrome.scripting.executeScript({ target: { tabId: tab.id, frameIds: [0] }, files: ['content/content.js'] });
  });
  const result = await worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ url: 'https://bloguetechno.com/' });
    await chrome.storage.local.set({ 'ba2.activeProfile': { profile: {
      id: 'native-fixture', businessName: 'Native fixture business', contactName: 'Fixture Person',
      email: 'fixture@example.test', website: 'https://example.test',
    }, syncedAt: '2026-10-18T00:00:00Z', source: 'local-storage' } });
    const before = JSON.stringify(await chrome.storage.local.get(null));
    const status = await chrome.tabs.sendMessage(tab.id, { type: 'BA2_GET_ACTIVE_PROFILE' }, { frameId: 0 });
    const reply = await chrome.tabs.sendMessage(tab.id, { type: 'BA2_LISTING_AUTOFILL' }, {});
    return { status, reply, unchanged: before === JSON.stringify(await chrome.storage.local.get(null)) };
  });
  console.log(JSON.stringify({ statusOK: result.status?.ok, actionReplyType: typeof result.reply,
    actionOK: result.reply?.ok, filled: await page.locator('input').inputValue(), unchanged: result.unchanged }));
  assert.equal(result.status?.ok, true);
  assert.equal(result.reply?.ok, true);
  assert.equal(await page.locator('input').inputValue(), 'Native fixture business');
  await page.locator('input').evaluate(input => { input.value = ''; });
  // Fault injection, not a claim about the live trigger: drop only the async
  // channel return after invoking the actual built handler. A native empty
  // acknowledgement does not establish that its action was never executed.
  const lost = await worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ url: 'https://bloguetechno.com/' });
    await chrome.scripting.executeScript({ target: { tabId: tab.id, frameIds: [0] }, func: () => {
      const original = globalThis.__ba2FullContentListener;
      chrome.runtime.onMessage.removeListener(original);
      chrome.runtime.onMessage.addListener((message, sender, reply) => {
        const result = original(message, sender, reply);
        if (message.type !== 'BA2_LISTING_AUTOFILL') return result;
        // Deliberately close this test channel before asynchronous completion.
      });
    } });
    const before = JSON.stringify(await chrome.storage.local.get(null));
    const status = await chrome.tabs.sendMessage(tab.id, { type: 'BA2_GET_ACTIVE_PROFILE' }, { frameId: 0 });
    const reply = await chrome.tabs.sendMessage(tab.id, { type: 'BA2_LISTING_AUTOFILL' }, {});
    return { statusOK: status?.ok, replyType: typeof reply, unchanged: before === JSON.stringify(await chrome.storage.local.get(null)) };
  });
  await page.waitForFunction(() => document.querySelector('input').value === 'Native fixture business');
  assert.equal(lost.statusOK, true);
  assert.equal(lost.replyType, 'undefined');
  assert.equal(lost.unchanged, true);
  await page.locator('input').evaluate(input => { input.value = ''; });
  await worker.evaluate(() => {
    globalThis.__nativeActionCount = 0;
    const original = chrome.tabs.sendMessage.bind(chrome.tabs);
    chrome.tabs.sendMessage = (...args) => {
      if (args[1]?.type === 'BA2_LISTING_AUTOFILL') globalThis.__nativeActionCount++;
      return original(...args);
    };
  });
  await page.bringToFront();
  const ack = await newPopup.evaluate(() => chrome.runtime.sendMessage({ type: 'BA2_START_LISTING_AUTOFILL',
    autoLogin: false, autoRegister: false, autoPublish: false, accountStatus: 'existing', ampBlogsAccountStatus: 'existing' }));
  assert.equal(ack.ok, false);
  await page.waitForFunction(() => document.querySelector('input').value === 'Native fixture business');
  const failed = await worker.evaluate(async () => {
    const data = await chrome.storage.local.get('ba2.listingRun');
    const run = data['ba2.listingRun'];
    return { stage: run?.stage, error: run?.error, homepageFirst: run?.homepageStart,
      loginAttempt: !!run?.login?.attemptId, publicationAttempt: !!run?.submissionAttempted, actions: globalThis.__nativeActionCount };
  });
  assert.equal(failed.stage, 'ERROR');
  assert.equal(failed.error, 'Listing autofill returned no response. Inspect the saved run; no automatic retry.');
  assert.equal(failed.homepageFirst, true);
  assert.equal(failed.actions, 1);
  assert.equal(failed.loginAttempt, false);
  assert.equal(failed.publicationAttempt, false);
  console.log('PASS native built coordinator/handler: healthy action reply; channel fault after valid status yields exact saved ERROR despite executed synthetic fill; one dispatch, homepage-first, no account submissions');
  let posts = 0;
  page.on('request', request => { if (request.method() === 'POST') posts++; });
  const setup = await worker.evaluate(async () => {
    const data = await chrome.storage.local.get(['ba2.activeProfile', 'ba2.listingRun']);
    const payload = data['ba2.activeProfile'];
    payload.profile.username = 'native-fixture-user'; payload.profile.password = 'synthetic-fixture-secret';
    const old = { ...data['ba2.listingRun'], stage: 'MANUAL_GATE', autoLogin: false, autoPublish: false, error: undefined };
    const key = `ba2.loginGuard:https://bloguetechno.com:${payload.profile.id}`;
    await chrome.storage.local.set({ 'ba2.activeProfile': payload, 'ba2.listingRun': old, [key]: { runId: 'historical-authenticated', state: 'authenticated' } });
    return { oldSnapshot: JSON.stringify(old), oldId: old.id, receiptKey: key };
  });
  await page.goto('https://bloguetechno.com/login');
  await page.locator('#ba2-floating-autofill').waitFor();
  await page.bringToFront();
  await newPopup.reload();
  await newPopup.waitForFunction(() => !document.getElementById('autofill-button').disabled);
  await newPopup.evaluate(() => document.getElementById('autofill-button').click());
  try { await page.waitForFunction(() => document.querySelector('[name=username]').value === 'native-fixture-user', null, { timeout: 5000 }); }
  catch {
    const diagnostic = await worker.evaluate(async () => {
      const r = (await chrome.storage.local.get('ba2.listingRun'))['ba2.listingRun'];
      const [selected] = await chrome.tabs.query({ active: true, currentWindow: true });
      return { stage: r?.stage, error: r?.error, manual: r?.manual, continuous: !!r?.continuous,
        selectedIsPublisher: selected?.url === 'https://bloguetechno.com/login', loginState: r?.login?.state };
    });
    throw Error('Synthetic Login fixture did not fill: ' + JSON.stringify({ ...diagnostic, popupResult: await newPopup.locator('#result').textContent() }));
  }
  await page.waitForFunction(() => document.querySelector('[name=password]').value.length > 0);
  const continuous = await worker.evaluate(async ({ oldId, oldSnapshot, receiptKey }) => {
    for (let i = 0; i < 60; i++) {
      const data = await chrome.storage.local.get(['ba2.listingRun', 'ba2.listingRunArchive:' + oldId, receiptKey]);
      const run = data['ba2.listingRun'];
      if (run?.login?.state === 'waiting-captcha') return { paused: true, continuous: !!run.continuous,
        oldArchivedUnchanged: JSON.stringify(data['ba2.listingRunArchive:' + oldId]) === oldSnapshot,
        historicalReceiptPreserved: data[receiptKey]?.runId === 'historical-authenticated' && data[receiptKey]?.state === 'authenticated',
        loginAttempt: !!run.login.attemptId, publicationAttempt: !!run.submissionAttempted };
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    return { paused: false };
  }, setup);
  assert.deepEqual(continuous, { paused: true, continuous: true, oldArchivedUnchanged: true, historicalReceiptPreserved: true, loginAttempt: false, publicationAttempt: false });
  assert.equal(posts, 0);
  console.log('PASS native one-click Login: actual popup/worker/content fills synthetic credentials, old authenticated receipt/archive preserved, human CAPTCHA pause, no Login/publication submission');
  const beforeRefresh = await worker.evaluate(async () => {
    const r = (await chrome.storage.local.get('ba2.listingRun'))['ba2.listingRun'];
    return { id: r.id, approval: JSON.stringify(r.loginApproval) };
  });
  await page.reload();
  await page.locator('#ba2-floating-autofill').waitFor();
  await page.bringToFront();
  await newPopup.reload();
  await newPopup.waitForFunction(() => !document.getElementById('autofill-button').disabled);
  await newPopup.evaluate(() => document.getElementById('autofill-button').click());
  try {
    await page.waitForFunction(() => document.querySelector('[name=username]').value === 'native-fixture-user'
      && document.querySelector('[name=password]').value.length > 0, null, { timeout: 5000 });
  } catch {
    const state = await worker.evaluate(async () => {
      const r = (await chrome.storage.local.get('ba2.listingRun'))['ba2.listingRun'];
      return { stage: r?.stage, loginState: r?.login?.state, reason: r?.login?.reason, attempt: !!r?.login?.attemptId };
    });
    throw Error('Refresh refill failed: ' + JSON.stringify(state));
  }
  const afterRefresh = await worker.evaluate(async () => {
    const r = (await chrome.storage.local.get('ba2.listingRun'))['ba2.listingRun'];
    return { id: r.id, approval: JSON.stringify(r.loginApproval), loginAttempt: !!r.login?.attemptId,
      publicationAttempt: !!r.submissionAttempted };
  });
  assert.deepEqual(afterRefresh, { ...beforeRefresh, loginAttempt: false, publicationAttempt: false });
  assert.equal(posts, 0);
  console.log('PASS native refresh then AUTOFILL restores empty Login fields in the same authorized run, zero submissions');
  // A nonempty human edit must not be overwritten. Its manual checkpoint
  // must also be recoverable once the conflicting field is cleared.
  await page.locator('[name=username]').fill('different-fixture-account');
  await newPopup.evaluate(() => document.getElementById('autofill-button').click());
  await newPopup.waitForFunction(() => !document.getElementById('autofill-button').disabled
    && document.getElementById('result').textContent.includes('Login fields do not match'));
  assert.equal(await page.locator('[name=username]').inputValue(), 'different-fixture-account');
  await page.locator('[name=username]').fill('');
  await page.locator('[name=password]').fill('');
  await newPopup.evaluate(() => document.getElementById('autofill-button').click());
  await page.waitForFunction(() => document.querySelector('[name=username]').value === 'native-fixture-user'
    && document.querySelector('[name=password]').value.length > 0);
  assert.equal(posts, 0);
  console.log('PASS native manual checkpoint: different nonempty account preserved with visible reason; clearing fields allows safe refill, no submission');
  // Runs prepared by the old START contract have no continuous metadata.
  // A field-preparation checkpoint is not a submitted Login attempt.
  let legacyPreparation = await worker.evaluate(async () => {
    const data = await chrome.storage.local.get('ba2.listingRun');
    const old = data['ba2.listingRun'];
    delete old.continuous;
    old.stage = 'MANUAL_GATE'; old.login.state = 'waiting-captcha';
    await chrome.storage.local.set({ 'ba2.listingRun': old });
    return { id: old.id, snapshot: JSON.stringify(old) };
  });
  await page.reload();
  await page.locator('#ba2-floating-autofill').waitFor();
  await page.bringToFront();
  await newPopup.reload();
  await newPopup.waitForFunction(() => !document.getElementById('autofill-button').disabled);
  // The real onCompleted handler can update the legacy preparation during
  // refresh. Compare archival against the record at the click, not before it.
  legacyPreparation = await worker.evaluate(async () => {
    for (let i = 0; i < 60; i++) {
      const r = (await chrome.storage.local.get('ba2.listingRun'))['ba2.listingRun'];
      if (r.login?.state === 'manual') return { id: r.id, snapshot: JSON.stringify(r) };
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw Error('Legacy refresh checkpoint did not settle');
  });
  await newPopup.evaluate(() => document.getElementById('autofill-button').click());
  await newPopup.waitForFunction(() => !document.getElementById('autofill-button').disabled);
  assert.equal(await page.locator('[name=username]').inputValue(), 'native-fixture-user',
    'prepared legacy Login should refill: ' + await newPopup.locator('#result').textContent());
  const legacyRecovery = await worker.evaluate(async ({ id, snapshot }) => {
    const data = await chrome.storage.local.get(['ba2.listingRun', 'ba2.listingRunArchive:' + id]);
    const r = data['ba2.listingRun'];
    return { fresh: r.id !== id, archivedUnchanged: JSON.stringify(data['ba2.listingRunArchive:' + id]) === snapshot,
      continuous: !!r.continuous, loginAttempt: !!r.login?.attemptId, publicationAttempt: !!r.submissionAttempted };
  }, legacyPreparation);
  assert.deepEqual(legacyRecovery, { fresh: true, archivedUnchanged: true, continuous: true, loginAttempt: false, publicationAttempt: false });
  assert.equal(posts, 0);
  console.log('PASS native legacy prepared Login -> refresh/AUTOFILL: immutable archive, fresh run authorization, credentials filled, zero submissions');
  await worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ url: 'https://bloguetechno.com/login' });
    await chrome.scripting.executeScript({ target: { tabId: tab.id, frameIds: [0] }, func: () => {
      globalThis.__nativeContinuousRequests = 0;
      const original = chrome.runtime.sendMessage.bind(chrome.runtime);
      chrome.runtime.sendMessage = (...args) => {
        if (args[0]?.type === 'BA2_START_LISTING_AUTOFILL') globalThis.__nativeContinuousRequests++;
        return original(...args);
      };
      document.querySelector('#ba2-floating-autofill').shadowRoot.querySelector('button').click();
    } });
  });
  const requestCount = () => worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ url: 'https://bloguetechno.com/login' });
    const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id, frameIds: [0] }, func: () => globalThis.__nativeContinuousRequests });
    return result.result;
  });
  assert.equal(await requestCount(), 0, 'native synthetic click cannot authorize continuous run');
  await page.getByRole('button', { name: 'Autofill current page', exact: true }).click();
  assert.equal(await requestCount(), 1, 'native trusted click uses same coordinator action');
  assert.equal(posts, 0);
  console.log('PASS native floating-button trust: synthetic click ignored, physical click dispatches once and remains at manual CAPTCHA');
  const stoppedTab = await worker.evaluate(async () => {
    const r = (await chrome.storage.local.get('ba2.listingRun'))['ba2.listingRun'];
    return { id: r.id, tabId: r.tabId, snapshot: JSON.stringify(r) };
  });
  await page.close();
  const replacementPage = await context.newPage();
  await replacementPage.goto('https://bloguetechno.com/login');
  await replacementPage.locator('#ba2-floating-autofill').waitFor();
  await replacementPage.bringToFront();
  await newPopup.reload();
  await newPopup.waitForFunction(() => !document.getElementById('autofill-button').disabled);
  // The missing-tab handler legitimately records unavailability before START.
  stoppedTab.snapshot = await worker.evaluate(async () => JSON.stringify((await chrome.storage.local.get('ba2.listingRun'))['ba2.listingRun']));
  await newPopup.evaluate(() => document.getElementById('autofill-button').click());
  await newPopup.waitForFunction(() => !document.getElementById('autofill-button').disabled);
  assert.equal(await replacementPage.locator('[name=username]').inputValue(), 'native-fixture-user',
    'new selected Login should fill without reassigning old tab: ' + await newPopup.locator('#result').textContent());
  assert.equal(await worker.evaluate(async ({ id, tabId, snapshot }) => {
    const data = await chrome.storage.local.get(['ba2.listingRun', 'ba2.listingRunArchive:' + id]);
    const old = data['ba2.listingRunArchive:' + id], fresh = data['ba2.listingRun'];
    return old.tabId === tabId && JSON.stringify(old) === snapshot && fresh.id !== id && fresh.tabId !== tabId && !fresh.login?.attemptId;
  }, stoppedTab), true);
  assert.equal(posts, 0);
  console.log('PASS native closed prepared tab: next AUTOFILL fills selected Login with fresh run, old tab/run archived intact, no tab reassignment or submission');
} finally { await context.close(); }
