// Packaged MV3, disposable Chromium and intercepted dashboard only.
﻿import assert from 'node:assert/strict';
import {mkdir,mkdtemp} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium} from 'playwright';
await mkdir('extension/test/.tmp',{recursive:true});
const dir=await mkdtemp(resolve('extension/test/.tmp/profile-sync-repro-'));
const browser=await chromium.launchPersistentContext(dir,{channel:'chromium',headless:true,ignoreDefaultArgs:['--disable-extensions'],args:['--enable-unsafe-extension-debugging']});
try{
 await browser.route(/^https?:\/\//,route=>route.request().url().startsWith('http://localhost:3000/')?route.fulfill({contentType:'text/html',body:'<h1>Disposable dashboard</h1>'}):route.abort());
 const cdp=await browser.browser().newBrowserCDPSession(),pending=browser.waitForEvent('serviceworker');
 const{id}=await cdp.send('Extensions.loadUnpacked',{path:resolve('extension/dist')});let worker=await pending;
 const dashboard=browser.pages()[0];await dashboard.goto('http://localhost:3000/');
 const old={id:'sync-test',businessName:'Synthetic Limo',country:'United States',state:'United States',city:'Angeles',updatedAt:'2026-10-21T07:00:00Z'};
 const fresh={...old,state:'California',city:'Los Angeles',updatedAt:'2026-10-21T11:00:00Z'};
 await dashboard.evaluate(p=>localStorage.setItem('ba2.activeProfile',JSON.stringify({profile:p,source:'local-storage',syncedAt:'initial'})),old);
 const tabId=await worker.evaluate(async()=>{const[t]=await chrome.tabs.query({url:'http://localhost:3000/'});await chrome.tabs.sendMessage(t.id,{type:'BA2_SYNC_FROM_DASHBOARD'},{frameId:0});return t.id});
 assert.equal((await worker.evaluate(async()=> (await chrome.storage.local.get('ba2.activeProfile'))['ba2.activeProfile'].profile)).state,old.state);
 const restarted=browser.waitForEvent('serviceworker',{timeout:10000}).catch(()=>null);
 await cdp.send('Extensions.uninstall',{id});await cdp.send('Extensions.loadUnpacked',{path:resolve('extension/dist')});
 const popup=await browser.newPage();await popup.goto('chrome-extension://'+id+'/popup/popup.html');worker=await restarted;assert(worker,'Worker restarts');
 // Fixture-only context replacement: re-seed the synthetic cache lost by uninstall.
 // Dashboard document stays open; actual reload retains storage. No operator Chrome involved.
 await worker.evaluate(async p=>chrome.storage.local.set({'ba2.activeProfile':{profile:p,source:'local-storage',syncedAt:'initial'},'ba2.listingRun':{id:'preserve',stage:'MANUAL_GATE',autoLogin:true,steps:[],manual:[]},'ba2.directory3.receipt:preserved':{outcome:'keep'}}),old);
 await dashboard.evaluate(p=>localStorage.setItem('ba2.activeProfile',JSON.stringify({profile:p,source:'local-storage',syncedAt:'fresh'})),fresh);
 await dashboard.waitForTimeout(2500);
 const history=await worker.evaluate(async()=>{const d=await chrome.storage.local.get(null);delete d['ba2.activeProfile'];return JSON.stringify(d)});
 const dashboardData=await dashboard.evaluate(()=>localStorage.getItem('ba2.activeProfile'));
 const before=await worker.evaluate(async()=> (await chrome.storage.local.get('ba2.activeProfile'))['ba2.activeProfile'].profile);
 await popup.locator('#sync-button').click();await popup.waitForTimeout(500);
 const message=await popup.locator('#result').textContent(),after=await worker.evaluate(async()=> (await chrome.storage.local.get('ba2.activeProfile'))['ba2.activeProfile'].profile);

 if(process.argv.includes('--before-fix')){
  assert.match(message,/Dashboard sync unavailable/);assert.equal(after.state,old.state);
  console.log('REPRODUCED: open dashboard context invalidated, existing Sync fails and stale cache remains despite current worker/popup.');
 }else{
  assert.equal(after.state,fresh.state);assert.equal(after.city,fresh.city);assert.equal(after.updatedAt,fresh.updatedAt);
  assert.equal(await dashboard.evaluate(()=>localStorage.getItem('ba2.activeProfile')),dashboardData,'Source profile must not change');
  const remaining=await worker.evaluate(async()=>{const d=await chrome.storage.local.get(null);delete d['ba2.activeProfile'];return JSON.stringify(d)});
  assert.equal(remaining,history,'Other cache/history/receipts unchanged');
  const next={...fresh,id:'another-active',businessName:'Another Synthetic Business',state:'Nevada',city:'Las Vegas',updatedAt:'2026-10-21T12:00:00Z'};
  await dashboard.evaluate(p=>localStorage.setItem('ba2.activeProfile',JSON.stringify({profile:p,source:'local-storage',syncedAt:'next'})),next);
  await dashboard.waitForTimeout(2300);
  const automatic=await worker.evaluate(async()=> (await chrome.storage.local.get('ba2.activeProfile'))['ba2.activeProfile'].profile);
  assert.equal(automatic.id,next.id);assert.equal(automatic.state,next.state);assert.equal(automatic.city,next.city);
  console.log('PASS existing Refresh from dashboard restores invalidated receiver and syncs exact fresh locations/revision; original source unchanged, all history/receipts preserved, subsequent active-profile edits auto-sync without refresh.');
  await dashboard.close();const snapshot=await worker.evaluate(async()=>JSON.stringify(await chrome.storage.local.get(null)));
  await popup.locator('#sync-button').click();await popup.waitForTimeout(100);
  assert.match(await popup.locator('#result').textContent(),/Open the MAHID dashboard/);
  assert.equal(await worker.evaluate(async()=>JSON.stringify(await chrome.storage.local.get(null))),snapshot);
  console.log('PASS missing dashboard has clear reason and leaves cache unchanged; no navigation/form actions.');
 }
}finally{await browser.close();}
