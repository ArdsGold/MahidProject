import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright';

// Browser plugin unavailable. Isolated Chromium, built popup only; all network
// and action APIs blocked. Never attach the operator profile or click Archive.
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const output = join(root, 'test', '.tmp', 'archive-popup-layout');
await mkdir(output, { recursive: true });
const html = (await readFile(join(root, 'dist/popup/popup.html'), 'utf8')).replace(/<script[\s\S]*?<\/script>/g, '').replace(/<link[^>]*>/g, '');
const css = await readFile(join(root, 'dist/popup/popup.css'), 'utf8');
const script = await readFile(join(root, 'dist/popup/popup.js'), 'utf8');
const saved = { id: 'preserved-onesmablog', sourceUrl: 'https://onesmablog.com/', tabId: 42, stage: 'MANUAL_GATE',
  steps: ['Historical Onesmablog run'], manual: ['Saved publisher tab unavailable'], awaitingManualResume: true,
  tabUnavailable: { tabId: 42 }, autoLogin: true, autoPublish: true };
const browser = await chromium.launch({ headless: true });
try {
  for (const scenario of [
    { name: 'eligible', url: 'https://bloguetechno.com/', visible: true },
    { name: 'http', url: 'http://bloguetechno.com/', visible: false },
    { name: 'query', url: 'https://bloguetechno.com/?example=1', visible: false },
    { name: 'hash', url: 'https://bloguetechno.com/#example', visible: false },
    { name: 'non-homepage', url: 'https://bloguetechno.com/example', visible: false },
    { name: 'syncing', url: 'https://bloguetechno.com/', visible: false, syncing: true },
  ]) {
    const page = await browser.newPage({ viewport: { width: 344, height: 600 } });
    await page.route('**/*', route => route.abort());
    const errors = [], messages = [];
    page.on('pageerror', error => errors.push(error.message));
    const run = structuredClone(saved);
    if (scenario.syncing) run.sheetSync = { status: 'syncing', code: 'fixture', reason: 'Fixture operation' };
    const before = JSON.stringify(run);
    await page.exposeFunction('fixtureMessage', message => {
      messages.push(message.type);
      if (message.type === 'BA2_GET_ACTIVE_PROFILE') return { ok: true, profileName: 'Fixture profile' };
      if (message.type === 'BA2_GET_LISTING_STATUS') return run;
      throw Error('Forbidden popup action: ' + message.type);
    });
    await page.setContent(html);
    await page.addStyleTag({ content: css });
    await page.evaluate(url => {
      const forbidden = () => { throw Error('Forbidden action'); };
      window.chrome = {
        runtime: { sendMessage: message => window.fixtureMessage(message) },
        tabs: { query: async () => [{ id: 200, url }], update: forbidden, create: forbidden, sendMessage: forbidden },
        storage: { local: { set: forbidden, remove: forbidden, clear: forbidden } },
      };
    }, scenario.url);
    await page.addScriptTag({ content: script });
    await page.waitForFunction(() => document.getElementById('result').textContent.includes('Historical Onesmablog run'));
    assert.match(await page.locator('#current-site').textContent(), /bloguetechno\.com/);
    const button = page.locator('#archive-stopped-button');
    assert.equal(await button.count(), 1, 'local built markup includes archive button');
    assert.equal(await button.isVisible(), scenario.visible, scenario.name);
    if (scenario.visible) {
      const box = await button.boundingBox();
      assert.ok(box && box.y >= 0 && box.y + box.height <= 600, 'eligible control visible without scrolling');
      assert.match(await button.textContent(), /onesmablog\.com/);
      console.log('PASS eligible built popup: archive visible at y=' + box.y);
    } else console.log('PASS ' + scenario.name + ': conditionally hidden despite same Current Site and MANUAL REVIEW history');
    await page.screenshot({ path: join(output, scenario.name + '.png') });
    assert.equal(JSON.stringify(run), before);
    assert.ok(messages.every(type => ['BA2_GET_ACTIVE_PROFILE', 'BA2_GET_LISTING_STATUS'].includes(type)));
    assert.deepEqual(errors, []);
    await page.close();
  }
} finally { await browser.close(); }
console.log('PASS archive rendering: six scenarios, no clicks, no archival/START/storage/network/submission');
