import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
// Browser plugin unavailable. Isolated Chromium, mocked extension APIs, network blocked.
const html = (await readFile(new URL('../dist/popup/popup.html', import.meta.url), 'utf8')).replace(/<script[\s\S]*?<\/script>/g, '').replace(/<link[^>]*>/g, '');
const css = await readFile(new URL('../dist/popup/popup.css', import.meta.url), 'utf8');
const script = await readFile(new URL('../dist/popup/popup.js', import.meta.url), 'utf8');
await mkdir(new URL('./.tmp/popup-layout/', import.meta.url), { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  for (const height of [420, 600]) {
    const page = await browser.newPage({ viewport: { width: 344, height } });
    await page.route('**/*', route => route.abort());
    const errors = [], commands = [];
    page.on('pageerror', error => errors.push(error.message));
    let release;
    const pending = new Promise(resolve => { release = resolve; });
    const saved = { stage: 'MANUAL_GATE', manual: ['Complete CAPTCHA manually'], login: { state: 'waiting-captcha' }, continuous: {} };
    const before = JSON.stringify(saved);
    await page.exposeFunction('fixtureMessage', async message => {
      if (message.type === 'BA2_GET_ACTIVE_PROFILE') return { ok: true, profileName: 'Fixture profile' };
      if (message.type === 'BA2_GET_LISTING_STATUS') return saved;
      commands.push(message);
      assert.deepEqual(message, { type: 'BA2_START_LISTING_AUTOFILL', continuous: true });
      await pending;
      return { ok: true, runId: 'fixture-run' };
    });
    await page.setContent(html);
    await page.addStyleTag({ content: css });
    await page.evaluate(() => {
      window.chrome = { runtime: { sendMessage: message => window.fixtureMessage(message) },
        tabs: { query: async () => [{ id: 42, url: 'https://bloguetechno.com/login' }] },
        storage: { onChanged: { addListener: () => {} } } };
    });
    await page.addScriptTag({ content: script });
    const button = page.getByRole('button', { name: 'AUTOFILL', exact: true });
    await button.waitFor();
    await page.waitForFunction(() => !document.getElementById('autofill-button').disabled);
    const box = await button.boundingBox();
    assert.ok(box && box.y >= 0 && box.y + box.height <= height);
    assert.equal(await page.getByRole('button', { name: /Prepare|Recover|Inspect|START/ }).count(), 0);
    assert.equal(await page.getByRole('checkbox').count(), 0);
    assert.equal(commands.length, 0, 'popup opening does not authorize anything');
    await button.focus(); await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.getElementById('autofill-button').disabled);
    assert.equal(commands.length, 1);
    release();
    await page.waitForFunction(() => !document.getElementById('autofill-button').disabled);
    assert.match(await page.locator('#result').textContent(), /WAITING FOR HUMAN CHECKPOINT/);
    assert.equal(JSON.stringify(saved), before);
    assert.deepEqual(errors, []);
    await page.screenshot({ path: new URL(`./.tmp/popup-layout/continuous-${height}.png`, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1') });
    console.log(`PASS one AUTOFILL popup ${height}px: visible keyboard action, explicit authorization, no secondary workflow controls, one request and no state mutation`);
    await page.close();
  }
} finally { await browser.close(); }
