import assert from 'node:assert/strict';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

// Browser plugin unavailable: native built MV3, disposable profile, intercepted
// success/public pages only. Begin AFTER publication; never dispatch Publish.
const root = dirname(dirname(fileURLToPath(import.meta.url)));
await mkdir(join(root, 'test/.tmp'), { recursive: true });
const profilePath = await mkdtemp(join(root, 'test/.tmp/native-visit-'));
const domain = process.argv.includes('--thezenweb') ? 'thezenweb.com' : 'bloguetechno.com';
const verifiedStart = process.argv.includes('--verified-start');
const replacementTab = process.argv.includes('--replacement-tab');
const wrongVisit = process.argv.includes('--wrong-visit');
assert.ok(!wrongVisit || verifiedStart, 'negative case requires preserved verification');
const publisher = `https://${domain}/new`;
const originalEditor = `https://${domain}/original-editor`;
const liveUrl = domain === 'thezenweb.com'
  ? 'https://novanestdemo26.thezenweb.com/hot-mess-cleanup-junk-removal-82418102'
  : 'https://fixture.bloguetechno.com/already-published-80348278';
const title = 'Hot Mess Cleanup Junk Removal';
const text = 'This synthetic approved article contains complete local cleanup service information and enough independent content evidence for a bounded anonymous verification test.';
const successHtml = `<form method="post"><input name="title"><textarea id="content"></textarea><a href="${liveUrl}" id="successfully_posted">Visit</a><a href="/edit/80348278">Edit</a></form><script>document.querySelector('a#successfully_posted').addEventListener('click',()=>window.__recordVisitClick())</script>`;
const articleHtml = `<link rel="canonical" href="${liveUrl}"><article><h1>${title}</h1><p>${text}</p></article>`;
const context = await chromium.launchPersistentContext(profilePath, {
  channel: 'chromium', headless: true, ignoreDefaultArgs: ['--disable-extensions'],
  args: ['--enable-unsafe-extension-debugging'],
});
let nonGets = 0, publicGets = 0, visitClicks = 0;
try {
  await context.route(/^https?:\/\//, route => {
    const request = route.request();
    if (request.method() !== 'GET') { nonGets++; return route.abort(); }
    if (request.url() === publisher) return route.fulfill({ contentType: 'text/html', body: successHtml });
    if (request.url() === originalEditor) return route.fulfill({ contentType: 'text/html', body: '<input name="title"><textarea id="content"></textarea>' });
    if (request.url() === liveUrl) { publicGets++; return route.fulfill({ contentType: 'text/html', body: articleHtml }); }
    return route.abort();
  });
  // Existing POST-success document predates extension load: no content receiver.
  const page = context.pages()[0];
  await page.exposeFunction('__recordVisitClick', () => { visitClicks++; });
  await page.goto(publisher);
  const cdp = await context.browser().newBrowserCDPSession();
  const pendingWorker = context.waitForEvent('serviceworker');
  const { id } = await cdp.send('Extensions.loadUnpacked', { path: join(root, 'dist') });
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${id}/popup/popup.html`);
  const worker = await pendingWorker;
  const original = await context.newPage();
  await original.goto(originalEditor);
  await original.locator('#ba2-floating-autofill').waitFor();
  const originalTabId = await worker.evaluate(async ({ publisher, title, text, domain, originalEditor, verifiedStart, replacementTab, wrongVisit, liveUrl }) => {
    const [tab] = await chrome.tabs.query({ url: publisher });
    const [oldTab] = await chrome.tabs.query({ url: originalEditor });
    const profile = { id: 'native-existing-publication', businessName: title, description: `<p>${text}</p>`, imageUrl: '', businessHours: [], updatedAt: '2026-10-19T00:00:00Z' };
    const snapshot = JSON.stringify([profile.id, profile.updatedAt, profile.businessName, profile.description, profile.imageUrl, profile.businessHours]);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(snapshot));
    const fingerprint = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
    let missingReceiver = false;
    try { await chrome.tabs.sendMessage(tab.id, { type: 'BA2_BLOG_OBSERVE' }, { frameId: 0 }); }
    catch (error) { missingReceiver = String(error).includes('Receiving end does not exist'); }
    if (!missingReceiver) throw Error('Native fixture must begin with missing success-page receiver');
    const expected = await chrome.tabs.sendMessage(oldTab.id, { type: 'BA2_BUILD_ARTICLE_EXPECTATION', title, html: profile.description }, { frameId: 0 });
    const run = { id: 'already-published-native', profileId: profile.id, tabId: oldTab.id, sourceUrl: publisher, domain,
      stage: 'MANUAL_GATE', status: 'needs-human', steps: [], manual: ['Publication outcome is not confirmed.'], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      autoPublish: true, publicationApproval: { authorizedAt: new Date().toISOString(), profileFingerprint: fingerprint },
      submissionAttempted: true, publicationSubmission: { attemptId: 'preserved-native-attempt', claimed: true, outcome: 'uncertain' }, expectedArticle: expected };
    if (verifiedStart) Object.assign(run, { tabId: replacementTab ? oldTab.id : tab.id, stage: 'COMPLETE', liveUrl,
      publicationConfirmation: { url: publisher, visitUrl: liveUrl },
      publicVerification: { status: 'verified', attemptId: 'preserved-verification', candidateUrl: liveUrl, confirmationUrl: publisher } });
    if (wrongVisit) run.publicationConfirmation.visitUrl = liveUrl + '-different';
    await chrome.storage.local.set({ 'ba2.publicationGuard:onesmablog.com:unrelated-profile': { runId: 'unrelated-old-run', liveUrl: 'https://onesmablog.com/earlier-publication-80348003' },
      'ba2.listingRunArchive:unrelated-old-run': { id: 'unrelated-old-run', stage: 'COMPLETE', marker: 'preserve-exactly' },
      'ba2.activeProfile': { profile, syncedAt: new Date().toISOString(), source: 'local-storage' },
      'ba2.listingRun': run, [`ba2.publicationGuard:${domain}:${profile.id}`]: { runId: run.id } });
    globalThis.__visitActionRequests = 0;
    globalThis.__visitAnonymousChecks = 0;
    globalThis.__visitSawPreservedPause = false;
    globalThis.__visitReaderRestorations = 0;
    const execute = chrome.scripting.executeScript.bind(chrome.scripting);
    chrome.scripting.executeScript = (...args) => {
      if (args[0]?.files?.includes('content/publication-reader.js')) globalThis.__visitReaderRestorations++;
      return execute(...args);
    };
    const send = chrome.tabs.sendMessage.bind(chrome.tabs);
    chrome.tabs.sendMessage = (...args) => {
      if (/AUTOFILL|SUBMIT_ONCE|PUBLISH_ONCE/.test(args[1]?.type || '')) { globalThis.__visitActionRequests++; throw Error('Recovery must never submit or autofill'); }
      return send(...args);
    };
    const nativeFetch = fetch;
    globalThis.fetch = async (url, init) => {
      if (init?.credentials !== 'omit' || init?.method !== 'GET' || init?.redirect !== 'manual') throw Error('Anonymous GET contract violated');
      globalThis.__visitAnonymousChecks++;
      const r = (await chrome.storage.local.get('ba2.listingRun'))['ba2.listingRun'];
      globalThis.__visitSawPreservedPause ||= r.manual.some(s => s.includes('Publication outcome is not confirmed.'))
        && r.manual.some(s => s.includes('Saved publisher tab is unavailable.'));
      return nativeFetch(url, init);
    };
    return oldTab.id;
  }, { publisher, title, text, domain, originalEditor, verifiedStart, replacementTab, wrongVisit, liveUrl });
  const protectedSnapshot = wrongVisit ? await worker.evaluate(async (domain) => {
    const d = await chrome.storage.local.get(null);
    return JSON.stringify([d['ba2.listingRun'], d['ba2.publicationGuard:' + domain + ':native-existing-publication']]);
  }, domain) : null;
  // Existing success document stays open and inactive. Only the original
  // publisher closes; no page refresh, AUTOFILL, Recover, Visit or Publish.
  if (verifiedStart) {
    await page.bringToFront();
    await popup.waitForFunction(() => !document.getElementById('autofill-button').disabled);
    await popup.evaluate(() => document.getElementById('autofill-button').click());
  } else { await popup.bringToFront(); await original.close(); }
  if (wrongVisit) {
    await popup.locator('#result').filter({ hasText: /differs|could not be verified/ }).waitFor();
    const after = await worker.evaluate(async (domain) => {
      const d = await chrome.storage.local.get(null);
      return JSON.stringify([d['ba2.listingRun'], d['ba2.publicationGuard:' + domain + ':native-existing-publication']]);
    }, domain);
    assert.equal(after, protectedSnapshot);
    assert.equal(page.url(), publisher);
    assert.equal(visitClicks, 0); assert.equal(publicGets, 0); assert.equal(nonGets, 0);
    console.log('PASS verified success mismatch: explicit reason, preserved run/receipt, zero navigation/action/Sheets');
  } else {
  try { await page.waitForURL(liveUrl, { timeout: 15000 }); }
  catch {
    const diagnostic = await worker.evaluate(async () => {
      const r = (await chrome.storage.local.get('ba2.listingRun'))['ba2.listingRun'];
      return { stage: r?.stage, error: r?.error, reason: r?.publicVerification?.reason, verification: r?.publicVerification?.status,
        anonymousChecks: globalThis.__visitAnonymousChecks, actions: globalThis.__visitActionRequests };
    });
    throw Error('Saved publication recovery did not navigate: ' + JSON.stringify({ ...diagnostic, publicGets, nonGets }));
  }
  const result = await worker.evaluate(async (domain) => {
    const data = await chrome.storage.local.get(null), r = data['ba2.listingRun'];
    const [visibleTab] = await chrome.tabs.query({ url: r.liveUrl });
    return { id: r.id, liveUrl: r.liveUrl, verified: r.publicVerification?.status, tabId: r.tabId, verifiedTabAdopted: r.tabId === visibleTab?.id,
      attempt: r.publicationSubmission?.attemptId, claimed: r.publicationSubmission?.claimed,
      verificationAttempt: r.publicVerification?.attemptId,
      receiptOwner: data[`ba2.publicationGuard:${domain}:native-existing-publication`]?.runId,
      unrelatedReceipt: data['ba2.publicationGuard:onesmablog.com:unrelated-profile'],
      unrelatedArchive: data['ba2.listingRunArchive:unrelated-old-run'],
      actions: globalThis.__visitActionRequests, anonymousChecks: globalThis.__visitAnonymousChecks, sawBothMessages: globalThis.__visitSawPreservedPause,
      readerRestorations: globalThis.__visitReaderRestorations,
      sheetsRecorded: ['recorded', 'already-recorded'].includes(r.sheetSync?.status) };
  }, domain);
  assert.equal(result.id, 'already-published-native');
  assert.equal(result.liveUrl, liveUrl);
  assert.equal(result.verified, 'verified');
  assert.equal(result.verifiedTabAdopted, true);
  assert.notEqual(result.tabId, originalTabId);
  assert.equal(result.sawBothMessages, !verifiedStart, 'verified success does not require a missing-tab interruption');
  assert.equal(result.attempt, 'preserved-native-attempt');
  assert.equal(result.claimed, true);
  if (verifiedStart) assert.equal(result.verificationAttempt, 'preserved-verification');
  assert.equal(result.receiptOwner, result.id);
  assert.deepEqual(result.unrelatedReceipt, { runId: 'unrelated-old-run', liveUrl: 'https://onesmablog.com/earlier-publication-80348003' });
  assert.deepEqual(result.unrelatedArchive, { id: 'unrelated-old-run', stage: 'COMPLETE', marker: 'preserve-exactly' });
  assert.equal(result.actions, 0);
  assert.ok(result.readerRestorations >= 1, 'Existing bounded restoration must load standalone reader into success form');
  assert.ok(result.anonymousChecks >= (verifiedStart ? 0 : 1));
  assert.equal(result.sheetsRecorded, false);
  assert.equal(nonGets, 0);
  assert.ok(publicGets >= (verifiedStart ? 1 : 2), 'verified success opens original href without another submission');
  assert.equal(visitClicks, domain === 'thezenweb.com' ? 1 : 0, 'TheZENweb must perform recorded DOM click, not tabs.update');
  console.log(`PASS native missing receiver -> restored reader -> ${domain} success inside publisher form with editor -> automatic Visit/anonymous verification -> same run/live URL/receipt; zero action dispatches, submissions or Sheets writes`);
  }
} finally { await context.close(); }
