import assert from 'node:assert/strict';
import {readFile,mkdir,mkdtemp} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium} from 'playwright';

await mkdir('extension/test/.tmp',{recursive:true});
const folder=await mkdtemp(resolve('extension/test/.tmp/adbrite-browser-'));
const context=await chromium.launchPersistentContext(folder,{channel:'chromium',headless:true,ignoreDefaultArgs:['--disable-extensions'],args:['--enable-unsafe-extension-debugging']});
const fixture=(await readFile('extension/test/family3/fixtures/adbritedirectory.com.html','utf8')).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');
const form=fixture+`<script>
window.capEvents=[];window.submits=0;
document.querySelector('.g-recaptcha').innerHTML='<textarea name="g-recaptcha-response" hidden>human-unchanged</textarea><iframe title="reCAPTCHA" srcdoc="Inert CAPTCHA witness"></iframe>';
for(const type of ['click','focus','focusin','blur','input','change','pointerdown'])document.addEventListener(type,event=>{if(event.target.closest?.('.g-recaptcha,[name=submit]'))window.capEvents.push(type)},true);
document.addEventListener('submit',event=>{event.preventDefault();window.submits++},true);
for(const method of ['submit','requestSubmit'])document.querySelector('[name=TITLE]').form[method]=()=>window.submits++;
</script>`;
let nonGets=0,unexpected=0,checks=0;
try{
 await context.route(/^https?:\/\//,route=>{
  const request=route.request(),url=new URL(request.url());
  if(request.method()!=='GET'){nonGets++;return route.abort();}
  if(['adbritedirectory.com','www.adbritedirectory.com'].includes(url.hostname)){
   if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:'<a href="/submit.php">Add Site</a>'});
   if(url.pathname==='/submit.php')return route.fulfill({contentType:'text/html',body:form});
  }
  if(request.resourceType()!=='document')return route.fulfill({body:''});
  unexpected++;return route.abort();
 });
 const cdp=await context.browser().newBrowserCDPSession(),pending=context.waitForEvent('serviceworker');
 const{id}=await cdp.send('Extensions.loadUnpacked',{path:resolve('extension/dist')});const worker=await pending;
 const page=context.pages()[0],popup=await context.newPage();await popup.goto(`chrome-extension://${id}/popup/popup.html`);
 const receipt={'ba2.directory3.receipt:historic':{claimed:true,outcome:'uncertain'},'ba2.publicationGuard:historic':{outcome:'uncertain'}};
 await worker.evaluate(values=>chrome.storage.local.set(values),receipt);
 for(const origin of ['http://adbritedirectory.com','http://www.adbritedirectory.com','https://www.adbritedirectory.com'])for(const homepage of [true,false]){
  const profile={id:'adbrite-'+checks,businessName:homepage?'Smiley Drain Plumbing and Drain Cleaning':'Example Cleaning Business',category:homepage?'waste management':'Cleaning',services:[],website:'https://example.test',contactName:'Example Owner',email:'owner@example.test',description:'Example business description. Never submit.',updatedAt:'2026-10-21'};
  const payload={profile,source:'local-storage',syncedAt:'offline'};
  await worker.evaluate(payload=>chrome.storage.local.set({'ba2.activeProfile':payload}),payload);
  await page.goto(origin+(homepage?'/':'/submit.php'),{waitUntil:'domcontentloaded'});await page.locator('#ba2-floating-autofill').waitFor();
  await page.bringToFront();await popup.evaluate(()=>document.getElementById('autofill-button').click());
  await popup.waitForFunction(()=>!document.getElementById('autofill-button').disabled&&document.getElementById('result').textContent.trim());
  const saved=await worker.evaluate(()=>chrome.storage.local.get(null)),run=saved['ba2.listingRun'];
  assert.equal(run?.stage,'MANUAL_GATE',run?.error||await popup.locator('#result').textContent());
  assert.equal(run.nativeDirectory.phase,'manual');assert.equal(run.navigationCount||0,homepage?1:0);
  assert.equal(page.url(),origin+'/submit.php');
  for(const[name,value]of Object.entries({TITLE:profile.businessName,URL:profile.website,DESCRIPTION:profile.description,OWNER_NAME:profile.contactName,OWNER_EMAIL:profile.email}))assert.equal(await page.locator(`[name=${name}]`).inputValue(),value);
  const category=(await page.locator('[name=CATEGORY_ID] option:checked').textContent()).replace(/[^a-z]+/gi,' ').trim();
  assert.equal(category,homepage?'Trade Services':'Cleaning');
  assert.equal(await page.locator('[name=g-recaptcha-response]').inputValue(),'human-unchanged');
  assert.deepEqual(await page.evaluate(()=>window.capEvents),[]);assert.equal(await page.evaluate(()=>window.submits),0);
  // Retain the existing explicitly authorized Adbrite checkbox behavior.
  assert.equal(await page.locator('[name=agree]').isChecked(),true);
  assert.deepEqual(saved['ba2.activeProfile'],payload);for(const[key,value]of Object.entries(receipt))assert.deepEqual(saved[key],value);
  checks++;console.log(`PASS ${origin} ${homepage?'homepage → form':'direct form'}: active business/category, CAPTCHA/Continue untouched, profile/receipts retained`);
 }
 assert.equal(nonGets,0);assert.equal(unexpected,0);
 console.log(JSON.stringify({status:'PASS',flows:checks,nonGets,unexpected,liveSubmissions:0,realCaptchaLoaded:false}));
}finally{await context.close();}
