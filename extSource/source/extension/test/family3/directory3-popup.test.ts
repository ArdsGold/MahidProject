import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { integrationHarness } from './integration-harness';
test('unified popup retains ONE AUTOFILL and no directory test/review/recovery controls',()=>{
 const html=readFileSync(new URL('../../../dist/popup/popup.html',import.meta.url),'utf8');
 assert.equal((html.match(/id="autofill-button"/g)||[]).length,1);
 assert.doesNotMatch(html,/directory3-test-button|directory3-review-button|recover-button/);
});
test('unrelated historical Directory3 status is not presented as the current website result',async t=>{
 const h=await integrationHarness('relevantdirectory.biz',{oldDirectory3:true});t.after(h.close);
 assert.equal(h.commands.includes('BA2_LISTING_AUTOFILL'),false);
 assert.match(h.popup.document.getElementById('result')!.textContent!,/Ready/);
 await h.click();assert.equal(h.stored['ba2.listingRun'].domain,'relevantdirectory.biz');
 assert.equal(h.stored['ba2.listingRun'].autoPublish,false);
});
test('opening popup or refreshing status never authorizes directory actions or changes historical data',async t=>{
 const h=await integrationHarness('groovy-directory.com',{oldDirectory3:true});t.after(h.close);
 assert.deepEqual(h.stored,h.baseline);assert.equal(h.fills(),0);assert.equal(h.navigations.length,0);
});
