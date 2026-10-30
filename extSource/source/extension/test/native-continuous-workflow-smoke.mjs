import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

// Connected native MV3 flow. ALL HTTP is intercepted; no operator profile,
// real account, CAPTCHA endpoint, publication or Sheets service is contacted.
await mkdir('extension/test/.tmp', { recursive: true });
const crossSiteEditor = process.argv.includes('--cross-site-editor');
const entryRefresh = process.argv.includes('--entry-refresh');
const refreshRace = process.argv.includes('--refresh-race');
const group1 = process.argv.includes('--group-1') || crossSiteEditor || entryRefresh || refreshRace;
if (group1) {
  // Parse as text only: never import or execute the operator's skipped reference.
  const reference = await readFile('recordings/thezenweb-complete-codegen-reference.spec.ts', 'utf8');
  assert.match(reference, /test\.skip\(/);
  assert.ok(reference.includes('iframe[title="Rich Text Editor, editor1"]'));
  assert.ok(reference.includes("name: 'New post'"));
  assert.ok(reference.includes("name: 'Visit'"));
}
const evidence = group1 ? JSON.parse(await readFile('research/group-1-automation/public-evidence.json', 'utf8')) : [{ domain: 'bloguetechno.com' }];
const results = [];
for (const site of evidence.filter(site => refreshRace ? site.domain === 'bloguetechno.com' : !(crossSiteEditor || entryRefresh) || site.domain === 'thezenweb.com')) {
const origin = `https://${site.domain}`;
const homeNavigation = group1 ? site.pages.find(p => p.stage === 'homepage').navigation.map(a => `<a href="${a.href}">${a.label}</a>`).join('') : '<a href="/signup">Sign Up</a><a href="/login">Login</a><a href="/signup" id="create-website-button">Start now</a>';
// Same-origin synthetic URL is a transport/content test, NOT evidence of any
// site's real public hosting pattern. Existing cross-origin policies unchanged.
const liveUrl = origin + '/approved-fixture-12345678';
const imageUrl = origin + '/fixture-business.png';
const title = 'Synthetic cleanup fixture';
const body = 'This synthetic approved article describes careful local cleanup services with reliable appointments and clear helpful information for homes and businesses throughout the community.';
const description = `  <p>${body} <strong>Bold text</strong> and <em>italics</em>.<br>Keep  these spaces.</p>\n<p>Call 555-0100. <a href="https://example.test/services?city=local&amp;ref=approved">cleanup keyword</a> stays here.</p>\n<pre>Monday: 9-5\nTuesday: closed</pre>  `;
const challenge = '<div class="g-recaptcha">Synthetic human checkpoint</div><textarea name="g-recaptcha-response" hidden></textarea>';
// TheZENweb operator evidence confirms this title-only frame and input Publish.
// No unobserved class added. Editor runtime/content and other sites remain models.
const editorControl = group1 ? `<iframe ${site.domain === 'thezenweb.com' ? '' : 'class="cke_wysiwyg_frame"'} title="Rich Text Editor, editor1" srcdoc="<body contenteditable=true class=cke_editable></body>"></iframe>` : '<div contenteditable="true" aria-label="Article editor"></div>';
const publishControl = site.domain === 'thezenweb.com' ? '<input name="publish" type="submit" value="Publish">' : '<button type="submit">Publish</button>';
const editor = `<form method="post" action="/new"><label>Title<input name="title" required></label><input name="fixtureBody" type="hidden">${editorControl}${publishControl}</form><script>document.querySelector("form").addEventListener("submit",()=>{document.querySelector("[name=fixtureBody]").value=(document.querySelector("iframe")?.contentDocument.body||document.querySelector("[contenteditable=true]")).innerHTML})</script>`;
for (const scenario of refreshRace ? ['historical-publication'] : crossSiteEditor ? ['editor-entry'] : entryRefresh ? ['new-account', 'existing-account', 'authenticated', 'signup-entry', 'login-entry', 'dashboard-entry', 'editor-entry', 'historical-publication', 'known-signup-entry'] : group1 ? ['new-account', 'existing-account', 'authenticated', 'signup-entry', 'login-entry', 'dashboard-entry', 'editor-entry', 'historical-publication'] : ['new-account', 'existing-account', 'authenticated', 'historical-publication']) {
  const needsRegistration = ['new-account','signup-entry'].includes(scenario);
  const needsLogin = !['authenticated','dashboard-entry','editor-entry'].includes(scenario);
  const entryPath = ({ 'signup-entry': '/signup', 'known-signup-entry': '/signup', 'login-entry': '/login', 'dashboard-entry': '/posts', 'editor-entry': '/new' })[scenario] || '/';
  const profilePath = await mkdtemp(resolve('extension/test/.tmp/continuous-native-'));
  const context = await chromium.launchPersistentContext(profilePath, {
    channel: 'chromium', headless: true, ignoreDefaultArgs: ['--disable-extensions'], args: ['--enable-unsafe-extension-debugging'],
  });
  const posts = { registration: 0, login: 0, publish: 0, unexpected: 0 };
  let articleGets = 0;
  let worker, page;
  try {
    await context.route(/^https?:\/\//, route => {
      const r = route.request(), url = r.url(), post = r.method() === 'POST';
      const html = text => route.fulfill({ contentType: 'text/html', body: text });
      if ((url === origin + '/' || url === origin + '/posts') && !post) return html(scenario === 'authenticated' || url.endsWith('/posts')
        ? '<p>Dashboard</p><a href="/logout">Log out</a><a href="/new">New post</a>'
        : homeNavigation);
      if (url === origin + '/signup') {
        if (post) { posts.registration++; return html('<p>Your account is succesfuly created. <a href="/login">Click here to login</a></p>'); }
        const observedLogin = group1 && site.pages.find(p => p.stage === 'homepage').navigation.find(a => /login|sign in/i.test(a.label));
        return html(group1 ? site.pages.find(p => p.stage === 'registration').fixture + (scenario === 'known-signup-entry' ? `<a href="${observedLogin.href}">Sign in</a>` : '') : `<form method="post"><label>Username<input name="username" required></label><label>Email<input type="email" name="email" required></label><label>Password<input type="password" name="password" required></label>${challenge}<label><input type="checkbox" name="agreement" required>Terms</label><button type="submit">Register</button></form>`);
      }
      if (url === origin + '/login') {
        if (post) { posts.login++; return html('<p>Dashboard</p><a href="/logout">Log out</a><a href="/new">New post</a>'); }
        return html(group1 ? site.pages.find(p => p.stage === 'login').fixture.replace('<div id="KEY-Captcha"></div>', '<div id="KEY-Captcha"><div id="puzzleContainer" style="cursor:pointer"><div id="puzzle" style="cursor:all-scroll"></div><div id="validPuzzle" style="display:none"></div></div></div>') + `<script src="https://cdn.${site.domain}/plugins/KEY-Captcha/captcha.js"></script>` : `<form method="post"><label>Username<input name="username" required></label><label>Password<input type="password" name="password" required></label>${challenge}<button type="submit">Sign in</button></form>`);
      }
      if (url === origin + '/new') {
        if (post) {
          posts.publish++;
          const data = new URLSearchParams(r.postData());
          assert.equal(data.get('title'), title);
          // Native form serialization uses CRLF; the editor DOM itself is
          // checked by the production pre-publication validator before clicking.
          assert.equal(data.get('fixtureBody').replaceAll('\r\n', '\n'), `<img src="${imageUrl}" alt="">${description}`, 'image first + exact approved HTML, whitespace/formatting/contact/link positions; no injected body title/hours rewrite');
          return html(['bloguetechno.com', 'thezenweb.com'].includes(site.domain) ? `<form><input name="title"><textarea id="content"></textarea><a id="successfully_posted" href="${liveUrl}">Visit</a><a href="/edit/12345678">Edit</a></form>` : `<p>The Article was successfully published. <a href="${liveUrl}">Visit</a> / <a href="/edit/12345678">Edit</a></p>`);
        }
        return html(editor);
      }
      if (url === liveUrl && !post) { articleGets++; return html(`<link rel="canonical" href="${liveUrl}"><article><h1>${title}</h1><img src="${imageUrl}" alt="">${description}</article>`); }
      if (!post && (url === imageUrl || url === origin + '/plugins/cool-php-captcha-0.3.1/captcha.php' || url === `https://cdn.${site.domain}/plugins/cool-php-captcha-0.3.1/refresh_icon.gif`)) return route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64') });
      if (!post && url === `https://cdn.${site.domain}/plugins/KEY-Captcha/captcha.js`) return route.fulfill({ contentType: 'text/javascript', body: '// Inert fixture. No real provider callback or challenge is executed.' });
      posts.unexpected++; return route.abort();
    });
    const cdp = await context.browser().newBrowserCDPSession();
    const pending = context.waitForEvent('serviceworker');
    const { id } = await cdp.send('Extensions.loadUnpacked', { path: resolve('extension/dist') });
    worker = await pending;
    page = context.pages()[0];
    await page.goto(origin + entryPath);
    await page.locator('#ba2-floating-autofill').waitFor();
    const seed = await worker.evaluate(async ({ scenario, title, description, imageUrl, origin, domain, needsRegistration, entryPath, crossSiteEditor }) => {
      const [tab] = await chrome.tabs.query({ url: origin + entryPath });
      const profile = { id: 'connected-native-fixture', businessName: title, description, imageUrl, businessHours: ['Monday: DIFFERENT', 'Tuesday: DIFFERENT'],
        username: 'synthetic-user', email: 'fixture@example.test', password: 'synthetic-not-live', updatedAt: '2026-10-19' };
      const data = { 'ba2.activeProfile': { profile, syncedAt: '', source: 'local-storage' } };
      if (!needsRegistration) data['ba2.loginGuard:' + origin + ':' + profile.id] = { runId: 'existing-account-history', state: 'authenticated' };
      if (scenario === 'historical-publication') {
        data['ba2.listingRun'] = { id: 'original-published-run', profileId: profile.id, tabId: tab.id, sourceUrl: origin + '/new',
          domain, stage: 'MANUAL_GATE', status: 'needs-human', manual: [], steps: [], submissionAttempted: true,
          publicationSubmission: { attemptId: 'immutable-attempt', claimed: true, outcome: 'uncertain' } };
        data['ba2.publicationGuard:' + domain + ':' + profile.id] = { runId: 'original-published-run' };
      }
      if (crossSiteEditor) {
        data['ba2.listingRun'] = { id: 'preserved-pointblog-run', profileId: profile.id, tabId: 991,
          sourceUrl: 'https://pointblog.net/signup', domain: 'pointblog.net', stage: 'MANUAL_GATE', manual: ['Unresolved original attempt'], steps: [],
          autoLogin: true, autoPublish: true, submissionAttempted: true,
          login: { state: 'uncertain', attemptId: 'old-login', claimed: true },
          publicationSubmission: { attemptId: 'old-publication', claimed: true, outcome: 'uncertain' } };
        data['ba2.loginGuard:https://pointblog.net:' + profile.id] = { runId: 'preserved-pointblog-run', state: 'uncertain' };
        data['ba2.publicationGuard:pointblog.net:' + profile.id] = { runId: 'preserved-pointblog-run' };
        // Existing SAME-site uncertain receipt must permit filling but stop Publish.
        data['ba2.publicationGuard:' + domain + ':' + profile.id] = { runId: 'preserved-thezenweb-attempt' };
      }
      await chrome.storage.local.set(data);
      return data;
    }, { scenario, title, description, imageUrl, origin, domain: site.domain, needsRegistration, entryPath, crossSiteEditor });
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${id}/popup/popup.html`);
    await popup.waitForFunction(() => !document.getElementById('autofill-button').disabled);
    await page.bringToFront();
    await popup.evaluate(() => document.getElementById('autofill-button').click());
    if (entryRefresh && (needsRegistration || needsLogin) && scenario !== 'historical-publication') {
      await page.waitForURL(origin + (needsRegistration ? '/signup' : '/login'));
      await page.waitForFunction(() => document.querySelector('[name=username]')?.value === 'synthetic-user');
      assert.equal(posts.registration, 0); assert.equal(posts.login, 0);
      await popup.waitForFunction(() => !document.getElementById('autofill-button').disabled);
      await page.reload(); // GET form before submission, never a POST success document.
      assert.equal(await page.locator('[name=username]').inputValue(), '');
      await page.bringToFront();
      await popup.evaluate(() => document.getElementById('autofill-button').click());
      await page.waitForFunction(() => document.querySelector('[name=username]')?.value === 'synthetic-user');
      assert.equal(posts.registration, 0); assert.equal(posts.login, 0);
    }
    if (crossSiteEditor) {
      for (let click = 0; click < 2; click++) {
        await page.waitForFunction(expected => document.querySelector('[name=title]').value === expected, title);
        const actual = await page.frameLocator('iframe[title="Rich Text Editor, editor1"]').locator('body').innerHTML();
        assert.equal(actual, `<img src="${imageUrl}" alt="">` + description);
        await popup.waitForFunction(() => !document.getElementById('autofill-button').disabled);
        const data = await worker.evaluate(async () => await chrome.storage.local.get(null));
        assert.equal(data['ba2.listingRun'].domain, 'thezenweb.com');
        assert.equal(data['ba2.listingRun'].stage, 'MANUAL_GATE');
        assert.deepEqual(data['ba2.listingRunArchive:preserved-pointblog-run'], seed['ba2.listingRun']);
        for (const [key, receipt] of Object.entries(seed).filter(([key]) => key.includes('Guard:'))) assert.deepEqual(data[key], receipt);
        assert.deepEqual(posts, { registration: 0, login: 0, publish: 0, unexpected: 0 });
        assert.match(data['ba2.listingRun'].manual.join(' '), /publication attempt or confirmation already exists/i);
        if (!click) {
          await page.reload();
          await page.locator('#ba2-floating-autofill').waitFor();
          assert.equal(await page.locator('[name=title]').inputValue(), '');
          await page.bringToFront();
          await popup.evaluate(() => document.getElementById('autofill-button').click());
        }
      }
      console.log('PASS native TheZENweb cross-site fill/GET refresh/refill: exact Title/image/Long Description, immutable uncertain Pointblog history/receipts, 0 Login/registration/Publish/Sheets');
      continue;
    }
    const completeFixtureChallenge = async () => {
      // Simulated human input ONLY in these intercepted fixtures, never a
      // provider callback, CAPTCHA solver, real challenge or page outside test.
      await page.locator('input[name=username]').waitFor();
      await page.waitForFunction(() => document.querySelector('input[name=username]').value === 'synthetic-user');
      if (group1 && page.url().endsWith('/signup')) await page.locator('[name=captcha]').fill('synthetic-human-answer');
      else if (group1) await page.evaluate(() => { document.querySelector('#puzzleContainer').style.cursor = 'default'; document.querySelector('#puzzle').style.cursor = 'default'; document.querySelector('#validPuzzle').style.display = 'block'; });
      else await page.locator('textarea[name=g-recaptcha-response]').evaluate(field => { field.value = 'synthetic-human-completion'; });
    };
    if (needsRegistration) {
      await page.waitForURL(origin + '/signup');
      await completeFixtureChallenge();
      assert.equal(posts.registration, 0);
      const terms = page.locator(group1 ? '#agreement' : 'input[name=agreement]');
      assert.equal(await terms.isChecked(), false);
      // Captured forms retain inline floats but intentionally exclude the full
      // theme stylesheet. Set only the synthetic human checkbox property to
      // avoid a fixture-only image/float pointer overlay; no production code.
      if (group1) await terms.evaluate(field => { field.checked = true; field.dispatchEvent(new Event('change', { bubbles: true })); });
      else await terms.check();
    }
    if (needsLogin) {
      await page.waitForURL(origin + '/login');
      await completeFixtureChallenge();
    }
    if (scenario === 'historical-publication') {
      await page.waitForURL(origin + '/new');
      await popup.locator('#result').filter({ hasText: 'A publication attempt or confirmation already exists' }).waitFor();
      assert.equal(await page.locator('input[name=title]').inputValue(), title);
      assert.match(await (group1 ? page.frameLocator('iframe[title="Rich Text Editor, editor1"]').locator('body') : page.locator('[contenteditable=true]')).innerHTML(), /synthetic approved article/);
      if (refreshRace) await worker.evaluate(({ domain }) => {
        const get = chrome.storage.local.get.bind(chrome.storage.local);
        let held = false;
        chrome.storage.local.get = async (...args) => {
          const data = await get(...args);
          if (!held && args[0] === `ba2.publicationGuard:${domain}:connected-native-fixture`) {
            held = true;
            return new Promise(resolve => { globalThis.__releaseRefreshValidation = () => { chrome.storage.local.get = get; resolve(data); }; });
          }
          return data;
        };
      }, { domain: site.domain });
      await page.reload(); // Refresh only the GET editor fixture, never POST success.
      await page.locator('#ba2-floating-autofill').waitFor();
      await popup.waitForFunction(() => !document.getElementById('autofill-button').disabled);
      if (refreshRace) {
        let held = false;
        for (let poll = 0; poll < 100 && !held; poll++) {
          held = await worker.evaluate(() => !!globalThis.__releaseRefreshValidation);
          if (!held) await new Promise(resolve => setTimeout(resolve, 20));
        }
        assert.equal(held, true, 'hold the automatic refresh validation under its real run lock');
      }
      await page.bringToFront();
      await popup.evaluate(() => document.getElementById('autofill-button').click());
      if (refreshRace) {
        await new Promise(resolve => setTimeout(resolve, 100));
        await worker.evaluate(() => globalThis.__releaseRefreshValidation());
      }
      await page.waitForFunction(expected => document.querySelector('input[name=title]').value === expected, title);
      await popup.waitForFunction(() => !document.getElementById('autofill-button').disabled);
      assert.equal(posts.publish, 0);
      const data = await worker.evaluate(async () => await chrome.storage.local.get(null));
      assert.deepEqual(data['ba2.listingRunArchive:original-published-run'], seed['ba2.listingRun']);
      assert.deepEqual(data['ba2.publicationGuard:' + site.domain + ':connected-native-fixture'], seed['ba2.publicationGuard:' + site.domain + ':connected-native-fixture']);
      assert.deepEqual(data['ba2.loginGuard:' + origin + ':connected-native-fixture'], seed['ba2.loginGuard:' + origin + ':connected-native-fixture']);
    } else {
      await page.waitForURL(liveUrl, { timeout: 20000 });
      const run = await worker.evaluate(async () => (await chrome.storage.local.get('ba2.listingRun'))['ba2.listingRun']);
      assert.equal(run.publicVerification?.status, 'verified');
      assert.equal(run.liveUrl, liveUrl);
      assert.ok(articleGets >= 2, 'Anonymous verification and actual visible Visit GET');
    }
    assert.deepEqual(posts, { registration: needsRegistration ? 1 : 0, login: needsLogin ? 1 : 0, publish: scenario === 'historical-publication' ? 0 : 1, unexpected: 0 });
    results.push({ domain: site.domain, scenario, status: 'PASS', posts, articleGets, evidence: group1 ? 'Captured public forms; authenticated stages modeled, NOT live verified' : 'Controlled fixtures only' });
    console.log(`PASS connected native ${site.domain} ${scenario}: one AUTOFILL; exact image+Long Description; ${scenario === 'historical-publication' ? 'no duplicate Publish' : 'guarded fixture Publish/automatic Visit/public verification'}; zero live traffic/Sheets`);
  } catch (error) {
    const state = worker && await worker.evaluate(async () => {
      const r = (await chrome.storage.local.get('ba2.listingRun'))['ba2.listingRun'];
      return { stage: r?.stage, manual: r?.manual, error: r?.error, login: r?.login?.state, registration: r?.registration?.state,
        verification: r?.publicVerification?.status, verificationReason: r?.publicVerification?.reason };
    }).catch(() => null);
    results.push({ domain: site.domain, scenario, status: 'FAIL', state, posts });
    if (crossSiteEditor) console.log('Cross-site fixture failure evidence:', JSON.stringify({ posts, state }));
    if (!group1 || crossSiteEditor || entryRefresh || refreshRace) throw error;
    console.log(`FAIL connected fixture ${site.domain} ${scenario}: ${JSON.stringify({ page: page?.url(), posts, articleGets, state })}; ${error.message}`);
  } finally { await context.close(); }
}
}
if (group1 && !crossSiteEditor && !entryRefresh && !refreshRace) {
  await writeFile('research/group-1-automation/offline-results.json', JSON.stringify(results, null, 2) + '\n');
  if (results.some(r => r.status !== 'PASS')) process.exitCode = 1;
}
if (entryRefresh) assert.equal(results.length, 9, 'all current-page/refresh/known-account cases executed');
