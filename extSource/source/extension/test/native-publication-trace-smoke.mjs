import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

// Native MV3, disposable profile and intercepted synthetic pages only.
// Fixture bootstrap seeds storage BEFORE importing the unchanged built worker.
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const built = await readFile(join(root, 'dist/background.js'), 'utf8');
assert.ok(built.includes('-read-only'), 'Build with --read-only-trace first');
await mkdir(join(root, 'test/.tmp'), { recursive: true });
const temporary = await mkdtemp(join(root, 'test/.tmp/native-trace-'));
const fixtureExtension = join(temporary, 'extension');
await cp(join(root, 'dist'), fixtureExtension, { recursive: true });
const verify = process.argv.includes('--verify');
const body = 'private fixture content must not appear in trace this synthetic approved article contains enough complete independent content evidence for the bounded anonymous check';
const liveUrl = 'https://fixture.bloguetechno.com/existing-80348278';
const profile = { id: 'trace-fixture', businessName: 'Synthetic fixture', description: `<p>${body}</p>`, imageUrl: '', businessHours: [], updatedAt: '2026-10-19' };
const fingerprint = createHash('sha256').update(JSON.stringify([profile.id, profile.updatedAt, profile.businessName, profile.description, profile.imageUrl, profile.businessHours])).digest('hex');
const run = { id: 'trace-existing-run', profileId: profile.id, tabId: 99999999, sourceUrl: 'https://bloguetechno.com/new', domain: 'bloguetechno.com',
  stage: 'MANUAL_GATE', status: 'needs-human', manual: [], steps: [], autoPublish: true, submissionAttempted: true,
  publicationSubmission: { attemptId: 'unchanged-attempt', outcome: 'uncertain', claimed: true },
  publicationApproval: { profileFingerprint: fingerprint }, expectedArticle: { title: 'synthetic fixture', bodyText: body, bodyExcerpt: body.split(' ').slice(0, 24).join(' '), links: [], images: [] },
  automaticPublicationRecoveries: verify ? 0 : 2 };
const seed = { 'ba2.activeProfile': { profile, syncedAt: '', source: 'local-storage' }, 'ba2.listingRun': run,
  'ba2.publicationGuard:bloguetechno.com:trace-fixture': { runId: run.id },
  'ba2.listingRunArchive:old': { id: 'old', evidence: 'preserved' } };
await writeFile(join(fixtureExtension, 'built-worker.js'), built);
await writeFile(join(fixtureExtension, 'background.js'), `const seeded = chrome.storage.local.set(${JSON.stringify(seed)}); const get = chrome.storage.local.get.bind(chrome.storage.local); chrome.storage.local.get = async (...args) => { await seeded; return get(...args); }; importScripts('built-worker.js');`);
const context = await chromium.launchPersistentContext(join(temporary, 'profile'), {
  channel: 'chromium', headless: true, ignoreDefaultArgs: ['--disable-extensions'], args: ['--enable-unsafe-extension-debugging'],
});
let network = 0, publicGets = 0, nonGets = 0;
try {
  await context.route(/^https?:\/\//, route => {
    network++;
    if (route.request().method() !== 'GET') { nonGets++; return route.abort(); }
    if (route.request().url() === liveUrl) {
      publicGets++;
      return route.fulfill({ contentType: 'text/html', body: `<link rel="canonical" href="${liveUrl}"><article><h1>Synthetic fixture</h1><p>${body}</p></article>` });
    }
    if (route.request().url() === run.sourceUrl && route.request().method() === 'GET')
      return route.fulfill({ contentType: 'text/html', body: '<form method="post"><input name="title"><textarea id="content"></textarea><a id="successfully_posted" href="https://fixture.bloguetechno.com/existing-80348278">Visit</a></form>' });
    return route.abort();
  });
  // Existing success tab is present before worker startup, as in operator recovery.
  const page = context.pages()[0];
  await page.goto(run.sourceUrl);
  const cdp = await context.browser().newBrowserCDPSession();
  const pending = context.waitForEvent('serviceworker');
  const { id } = await cdp.send('Extensions.loadUnpacked', { path: fixtureExtension });
  await pending;
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${id}/popup/popup.html`);
  try { await popup.locator('#publication-trace').filter({ hasText: verify ? 'Anonymous approved-content verification passed' : 'automatic recovery budget exhausted' }).waitFor({ state: 'attached', timeout: 15000 }); }
  catch { throw Error('Native diagnostic trace: ' + await popup.locator('#publication-trace').textContent()); }
  const trace = JSON.parse(await popup.locator('#publication-trace').textContent());
  assert.equal(trace.popupBuild, trace.worker.build);
  assert.equal(trace.worker.readOnly, true);
  assert.equal(trace.worker.steps.length, 6);
  assert.equal(trace.worker.steps[1].status, 'observed');
  assert.equal(trace.worker.steps[2].status, 'observed');
  assert.equal(trace.worker.steps[3].status, 'observed');
  assert.ok(trace.worker.transport.some(note => note.includes('missing receiver; existing bounded read-only publication-reader restoration attempted.')),
    'Exercise native missing receiver, not a preinstalled content receiver');
  assert.ok(trace.worker.transport.some(note => note.includes('restored reader replied.')),
    'Built standalone reader must acknowledge after bounded restoration');
  assert.match(trace.worker.steps[2].reason, /stage=CONFIRMATION; publicationEvidence=true; publicUrlPresent=true; safeUrl=true/,
    'Restored reader must prioritize the Visit marker over retained title/editor DOM');
  assert.equal(trace.worker.steps[4].status, 'skipped');
  assert.match(trace.worker.steps[4].reason, verify ? /verification passed.*deliberately stops/ : /budget exhausted/);
  assert.doesNotMatch(JSON.stringify(trace), /private fixture|unchanged-attempt|trace-fixture|profileFingerprint/);
  assert.equal(page.url(), run.sourceUrl, 'Diagnostic must not follow Visit');
  assert.equal(nonGets, 0);
  assert.equal(publicGets, verify ? 1 : 0);
  assert.equal(await popup.locator('#autofill-button').isDisabled(), true);
  const beforeNetwork = network;
  const result = await popup.evaluate(async () => {
    const before = await chrome.storage.local.get(null);
    const replies = [];
    for (const type of ['BA2_START_LISTING_AUTOFILL', 'BA2_RECOVER_PUBLICATION', 'BA2_PUBLICATION_CHANGED', 'BA2_LOGIN_CHANGED', 'BA2_ARCHIVE_STOPPED_LISTING_RUN', 'BA2_SYNC_VERIFIED_LISTING'])
      replies.push(await chrome.runtime.sendMessage({ type, continuous: true, runId: 'trace-existing-run', attemptId: 'unchanged-attempt' }));
    const [tab] = await chrome.tabs.query({ url: 'https://bloguetechno.com/new' });
    await chrome.tabs.remove(tab.id); // fixture lifecycle event must not write tabUnavailable
    await new Promise(resolve => setTimeout(resolve, 100));
    return { before, after: await chrome.storage.local.get(null), replies };
  });
  assert.deepEqual(result.before, seed);
  assert.deepEqual(result.after, seed);
  assert.ok(result.replies.every(reply => reply?.ok === false && /Read-only trace/.test(reply.error)));
  assert.equal(network, beforeNetwork, 'No verification, Visit, dashboard or Sheets network requests');
  console.log(`PASS native diagnostic build (${verify ? 'anonymous verification passed, Visit suppressed' : 'exhausted recovery budget'}): six popup trace steps, matching builds, recognized success, zero run/receipt/archive changes or automation dispatch`);
} finally { await context.close(); }
