import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium} from 'playwright';
await mkdir('extension/test/.tmp',{recursive:true});
const path=await mkdtemp(resolve('extension/test/.tmp/unified-native-'));
const context=await chromium.launchPersistentContext(path,{channel:'chromium',headless:true,ignoreDefaultArgs:['--disable-extensions'],args:['--enable-unsafe-extension-debugging']});
const origin='https://relevantdirectory.biz';
let nonGets=0,unexpected=0,checks=0;
try{
 let fixture=await readFile('extension/test/family3/fixtures/relevant-directory-https.html','utf8');
 if(process.argv.includes('--limousine')) fixture=fixture.replace(/(<select\b[^>]*name="CATEGORY_ID"[^>]*>)[\s\S]*?<\/select>/,
  '$1<option value="0">[Top]</option><option value="47">Transport</option><option value="303">Transportation</option><option value="73">Transportation and Logistics</option></select>');
 // Reference inventory reconstruction; no live website/category claim.
 if(process.argv.includes('--junk-removal')) fixture=fixture.replace(/(<select\b[^>]*name="CATEGORY_ID"[^>]*>)[\s\S]*?<\/select>/,
  '$1<option value="0">[Top]</option><option value="205">Domestic Services</option><option value="50">Business Services</option><option value="53">Construction and Maintenance</option><option value="210">Home Improvement</option></select>');
 await context.route(/^https?:\/\//,route=>{
  const req=route.request(),url=req.url();
  if(req.method()!=='GET'){nonGets++;return route.abort();}
  if(url===origin+'/')return route.fulfill({contentType:'text/html',body:'<a href="/submit.php">Submit Link</a><a href="/submit.php?c=2">Submit Link</a>'});
  if(url===origin+'/submit.php')return route.fulfill({contentType:'text/html',body:fixture});
  // All assets/challenges/third parties are inert; never contact the live site.
  if(req.resourceType()!=='document')return route.fulfill({contentType:'text/plain',body:''});
  unexpected++;return route.abort();
 });
 const cdp=await context.browser().newBrowserCDPSession(),pending=context.waitForEvent('serviceworker');
 const {id}=await cdp.send('Extensions.loadUnpacked',{path:resolve('extension/dist')});const worker=await pending;
 const page=context.pages()[0];await page.goto(origin+'/',{waitUntil:'domcontentloaded'});await page.locator('#ba2-floating-autofill').waitFor();
 const initial=await worker.evaluate(async(category)=>{
  const profile={id:'unified-native-test',businessName:'Example Test Business',contactName:'Example Test Owner',email:'owner@example.test',website:'https://example.test/business',description:'Approved sample description. No live submission.',category,services:[],updatedAt:'2026-10-20'};
  const old={id:'original-uncertain-directory3',domain:'directory3.org',sourceUrl:'http://directory3.org/submit.php',profileId:profile.id,tabId:991,stage:'MANUAL_GATE',steps:[],manual:['Original uncertain outcome'],directory3:{phase:'attempted',intentId:'historic-human',outcome:'uncertain',review:{identityKey:'historic',digest:'historic'}}};
  const seed={'ba2.activeProfile':{profile,source:'local-storage',syncedAt:'offline'},'ba2.listingRun':old,['ba2.listingRunArchive:'+old.id]:{...old,manual:['Prior immutable snapshot']},'ba2.directory3.receipt:historic':{runId:old.id,claimed:true,outcome:'uncertain'},['ba2.publicationGuard:pointblog.net:'+profile.id]:{runId:'old-family1',outcome:'uncertain'},'ba2.cargo.runs':{historical:{outcome:'uncertain'}}};
  await chrome.storage.local.set(seed);return seed;
 },process.argv.includes('--limousine')?'Limousine Services':process.argv.includes('--junk-removal')?'Junk Removal Services':'Illustration');
 const popup=await context.newPage();await popup.goto(`chrome-extension://${id}/popup/popup.html`);await page.bringToFront();
 await popup.getByRole('button',{name:'AUTOFILL',exact:true}).waitFor();await popup.getByRole('button',{name:'AUTOFILL',exact:true}).click();
 await page.waitForURL(origin+'/submit.php',{waitUntil:'domcontentloaded'});
 for(const [name,value]of Object.entries({TITLE:'Example Test Business',URL:'https://example.test/business',DESCRIPTION:'Approved sample description. No live submission.',OWNER_NAME:'Example Test Owner',OWNER_EMAIL:'owner@example.test'})){
  await page.waitForFunction(({name,value})=>document.querySelector(`[name="${name}"]`)?.value===value,{name,value});checks++;
 }
 const category=await page.locator('select[name=CATEGORY_ID] option:checked').textContent();assert.match(category,process.argv.includes('--limousine')?/^Transport$/:process.argv.includes('--junk-removal')?/^Domestic Services$/:/Illustration/);
 await worker.evaluate(async()=>{for(let i=0;i<30;i++){if((await chrome.storage.local.get('ba2.listingRun'))['ba2.listingRun']?.stage==='MANUAL_GATE')return;await new Promise(r=>setTimeout(r,50));}throw Error('Manual gate not reached');});
 const saved=await worker.evaluate(()=>chrome.storage.local.get(null));const run=saved['ba2.listingRun'];
 assert.equal(run.domain,'relevantdirectory.biz');assert.equal(run.autoPublish,false);assert.equal(run.publicationApproval,undefined);assert.equal(run.submissionAttempted,undefined);
 for(const [key,value]of Object.entries(initial))if(key!=='ba2.listingRun')assert.deepEqual(saved[key],value,key);
 const archived=Object.entries(saved).find(([key])=>key.startsWith('ba2.listingRunArchive:'+initial['ba2.listingRun'].id+':snapshot:'));assert(archived);assert.deepEqual(archived[1],initial['ba2.listingRun']);
 assert.equal(nonGets,0);assert.equal(unexpected,0);
 const report={status:'PASS',fields:checks,category:category.trim(),nativeRun:run.domain,protectedHistoricalRun:true,receiptsUnchanged:true,nonGets,unexpected,operatorProfileUsed:false};
 await writeFile(process.argv.includes('--limousine')?'research/family3-integration/native-limousine-browser.json':process.argv.includes('--junk-removal')?'research/family3-integration/native-junk-removal-browser.json':'research/family3-integration/native-browser.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await context.close();}
