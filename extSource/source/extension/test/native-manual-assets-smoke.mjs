import assert from 'node:assert/strict';
import {mkdir,mkdtemp} from 'node:fs/promises';import {resolve}from'node:path';import{chromium}from'playwright';
await mkdir('extension/test/.tmp',{recursive:true});const path=await mkdtemp(resolve('extension/test/.tmp/manual-assets-'));
const context=await chromium.launchPersistentContext(path,{channel:'chromium',headless:true,ignoreDefaultArgs:['--disable-extensions'],args:['--enable-unsafe-extension-debugging']});let nonGets=0,unexpected=0;
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const profile={id:'asset-only',businessName:'Separate Title',description:'<p><strong>Exact</strong>  body <a href="https://example.test/service">keyword</a></p>\n<p>Second paragraph.</p>',imageUrl:'',updatedAt:'2026-10-20',logoAsset:{id:'original-logo',fileName:'saved.png',mimeType:'image/png',size:68}};
const payload={profile,syncedAt:'fixture',source:'local-storage'};
try{
 await context.addInitScript(payload=>{if(location.origin==='http://localhost:3000')localStorage.setItem('ba2.activeProfile',JSON.stringify(payload));},payload);
 await context.route(/^https?:\/\//,route=>{
  if(route.request().method()!=='GET'){nonGets++;return route.abort();}
  if(route.request().url()==='http://localhost:3000/fixture')return route.fulfill({contentType:'text/html',body:'<p>Disposable asset-store fixture</p>'});
  if(route.request().url()==='https://thezenweb.com/new')return route.fulfill({contentType:'text/html',body:'<form method="post"><label>Title<input name="title"></label><textarea name="content" hidden></textarea><iframe title="Rich Text Editor, editor1" srcdoc="<body contenteditable=true class=cke_editable></body>"></iframe><input type="submit" name="publish" value="Publish"></form>'});
  if(route.request().resourceType()!=='document')return route.fulfill({body:''});unexpected++;return route.abort();
 });
 const cdp=await context.browser().newBrowserCDPSession(),pending=context.waitForEvent('serviceworker');const{id}=await cdp.send('Extensions.loadUnpacked',{path:resolve('extension/dist')});let worker=await pending;
 const dashboard=context.pages()[0];await dashboard.goto('http://localhost:3000/fixture');
 await dashboard.evaluate(async({profile,png})=>{
  const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('backlink-autofill-assets',1);r.onupgradeneeded=()=>r.result.createObjectStore('profile-assets');r.onsuccess=()=>resolve(r.result);r.onerror=reject;});
  await new Promise((resolve,reject)=>{const t=db.transaction('profile-assets','readwrite');t.objectStore('profile-assets').put({profileId:profile.id,kind:'logo',assetId:'original-logo',blob:new Blob([Uint8Array.from(atob(png),c=>c.charCodeAt(0))],{type:'image/png'})},'logo:original-logo');t.oncomplete=resolve;t.onerror=reject;});db.close();
 },{profile,png});
 await worker.evaluate(async()=>{await chrome.storage.local.set({'ba2.listingRun':{id:'kept',sourceUrl:'https://thezenweb.com/new',domain:'thezenweb.com',stage:'MANUAL_GATE',tabId:999,submissionAttempted:true,publicationSubmission:{attemptId:'preserve'},autoPublish:true,steps:[],manual:[]},'ba2.publicationGuard:preserve':{runId:'kept',outcome:'uncertain'}});});
 const page=await context.newPage();await page.goto('https://thezenweb.com/new');await page.locator('#ba2-floating-autofill').waitFor();
 await page.waitForTimeout(2100);const before=await worker.evaluate(async()=>JSON.stringify(await chrome.storage.local.get(null)));
 const popup=await context.newPage();await popup.goto(`chrome-extension://${id}/popup/popup.html`);await page.bringToFront();await popup.evaluate(()=>document.getElementById('autofill-button').click());
 await popup.waitForFunction(()=>!document.getElementById('autofill-button').disabled&&/filled only/.test(document.getElementById('result').textContent));
 const expected=`<img src="data:image/png;base64,${png}" alt="">${profile.description}`;
 assert.equal(await page.frameLocator('iframe').locator('body').innerHTML(),expected);assert.equal(await page.locator('[name=title]').inputValue(),profile.businessName);assert.equal(await page.locator('[name=content]').inputValue(),expected);
 assert.equal(await worker.evaluate(async()=>JSON.stringify(await chrome.storage.local.get(null))),before);
 const replies=await worker.evaluate(async()=>{const[tab]=await chrome.tabs.query({url:'https://thezenweb.com/new'});const replies=[];for(const type of ['BA2_LOGIN_SUBMIT_ONCE','BA2_REGISTRATION_SUBMIT_ONCE','BA2_BLOG_PUBLISH_ONCE','BA2_SELECT_ENTRY','BA2_WATCH_PUBLICATION_READY'])replies.push(await chrome.tabs.sendMessage(tab.id,{type,runId:'kept',attemptId:'preserve'},{frameId:0}));return replies;});
 assert.ok(replies.every(r=>r.ok===false));
 const bodyBefore=await page.frameLocator('iframe').locator('body').innerHTML();
 await page.waitForTimeout(1400);assert.equal(page.url(),'https://thezenweb.com/new');assert.equal(await page.frameLocator('iframe').locator('body').innerHTML(),bodyBefore);
 assert.equal(await worker.evaluate(async()=>JSON.stringify(await chrome.storage.local.get(null))),before);
 const bytes=await dashboard.evaluate(async()=>{const db=await new Promise(resolve=>{const r=indexedDB.open('backlink-autofill-assets',1);r.onsuccess=()=>resolve(r.result);});const row=await new Promise(resolve=>{const r=db.transaction('profile-assets','readonly').objectStore('profile-assets').get('logo:original-logo');r.onsuccess=()=>resolve(r.result);});db.close();return Array.from(new Uint8Array(await row.blob.arrayBuffer()));});assert.deepEqual(bytes,Array.from(Buffer.from(png,'base64')));
 assert.equal(nonGets,0);assert.equal(unexpected,0);console.log('PASS native manual asset: original Blob bytes embedded above exact HTML, title/backing field synchronized, saved run/receipt/asset unchanged, stale action messages rejected, zero non-GET/unexpected requests');
}finally{await context.close();}
