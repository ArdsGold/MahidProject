import assert from 'node:assert/strict';
import { mkdir,mkdtemp,readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
// Disposable Chrome and intercepted fixture requests only. No operator data/live actions.
const source=await readFile('extension/src/manual-autofill-policy.ts','utf8');
const family1=JSON.parse(source.match(/FAMILY1_HOSTS = (.*);/)[1]);
const family2=JSON.parse(source.match(/FAMILY2_HOSTS = (.*);/)[1]);
const group1=['pages10.com','ampblogs.com','blogocial.com','onesmablog.com','blogolize.com','bloguetechno.com','ampedpages.com','pointblog.net','full-design.com','thezenweb.com','tinyblogging.com'];
const evidence=JSON.parse(await readFile('research/group-1-automation/public-evidence.json','utf8'));
const description='<p><strong>Exact original</strong>  text</p>\n\n<p>Second <em>paragraph</em> <a href="https://example.test/service">keyword link</a>.</p>';
const form=(inner,label='Save')=>`<form method="post" action="/submit">${inner}<button type="submit">${label}</button></form>`;
const field=(label,name,type='text')=>`<label>${label}<input name="${name}" type="${type}"></label>`;
let current,nonGets=0,unexpected=0,checks=0;
await mkdir('extension/test/.tmp',{recursive:true});
const dir=await mkdtemp(resolve('extension/test/.tmp/manual-families-'));
const context=await chromium.launchPersistentContext(dir,{channel:'chromium',headless:true,ignoreDefaultArgs:['--disable-extensions'],args:['--enable-unsafe-extension-debugging']});
try {
 await context.route(/^https?:\/\//,route=>{
   if(route.request().method()!=='GET'){nonGets++;return route.abort();}
   if(route.request().isNavigationRequest() && route.request().url()===current?.url) return route.fulfill({contentType:'text/html',body:current.html});
   if(route.request().resourceType()!=='document')return route.fulfill({contentType:'text/plain',body:''});
   unexpected++;return route.abort();
 });
 const cdp=await context.browser().newBrowserCDPSession(),pending=context.waitForEvent('serviceworker');
 const {id}=await cdp.send('Extensions.loadUnpacked',{path:resolve('extension/dist')}); const worker=await pending;
 const page=context.pages()[0],popup=await context.newPage();await popup.goto(`chrome-extension://${id}/popup/popup.html`);
 const profile={id:'manual-fixture',businessName:'Separate title',username:'synthetic-user',password:'synthetic-not-live',email:'fixture@example.test',description,imageUrl:'https://example.test/business.png',website:'https://example.test',contactName:'Synthetic Owner',phone:'1234567890',updatedAt:'2026-10-20'};
 await worker.evaluate(async profile=>{await chrome.storage.local.set({'ba2.activeProfile':{profile,syncedAt:'fixture',source:'local-storage'},'ba2.listingRun':{id:'uncertain-original',domain:'tinyblogging.com',sourceUrl:'https://tinyblogging.com/signup',tabId:99,profileId:profile.id,stage:'MANUAL_GATE',autoRegister:true,autoLogin:true,autoPublish:true,registration:{state:'uncertain',attemptId:'keep-registration'},submissionAttempted:true,publicationSubmission:{attemptId:'keep-publish'},steps:[],manual:[]},'ba2.registrationGuard:immutable':{state:'uncertain'},'ba2.publicationGuard:immutable':{outcome:'uncertain'},'ba2.listingRunArchive:family3':{id:'preserved-family3',nativeDirectory:{phase:'attempted'}},'ba2.directory3.receipt:preserve':{outcome:'uncertain'}});},profile);
 const before=await worker.evaluate(async()=>JSON.stringify(await chrome.storage.local.get(null)));
 const click=async()=>{
  await page.bringToFront();await popup.evaluate(()=>document.getElementById('autofill-button').click());
  await popup.waitForFunction(()=>!document.getElementById('autofill-button').disabled && /filled only|No recognized fields/.test(document.getElementById('result').textContent),null,{timeout:6000});
 };
 const run=async(domain,stage,html,verify)=>{
  const url=`https://${domain}/${stage==='home'?'':stage}`;current={url,html};await page.goto(url);await page.locator('#ba2-floating-autofill').waitFor();
  await popup.reload();await popup.waitForFunction(()=>!document.getElementById('autofill-button').disabled);
  await click();await verify();assert.equal(page.url(),url);
  // CAPTCHA and Terms readiness must never wake old automation.
  await page.evaluate(()=>{for(const el of document.querySelectorAll('[name=captcha]'))el.value='human-entered';for(const el of document.querySelectorAll('[name=terms]'))el.checked=true;document.dispatchEvent(new Event('input',{bubbles:true}));});
  await page.waitForTimeout(25);assert.equal(page.url(),url);
  await page.reload();await page.locator('#ba2-floating-autofill').waitFor();await click();await verify();assert.equal(page.url(),url);
  assert.equal(await worker.evaluate(async()=>JSON.stringify(await chrome.storage.local.get(null))),before);
  assert.equal(nonGets,0);assert.equal(unexpected,0);checks++;console.log(`PASS manual ${domain} ${stage}: repeat/refresh fill, no navigation/submission/storage change`);
 };
 for(const domain of family1) {
  const recorded=evidence.find(s=>s.domain===domain);
  const signup=recorded?.pages.find(p=>p.stage==='signup')?.fixture || form(field('Username','username')+field('Password','password','password')+field('Email','email','email')+field('CAPTCHA','captcha')+'<label><input name="terms" type="checkbox">Terms</label>','Register');
  const login=recorded?.pages.find(p=>p.stage==='login')?.fixture || form(field('Username','username')+field('Password','password','password')+field('CAPTCHA','captcha'),'Sign In');
  for(const [stage,html] of [['signup',signup],['login',login]])await run(domain,stage,html,async()=>{
   await assert.doesNotReject(()=>page.waitForFunction(()=>document.querySelector('[name=username]')?.value==='synthetic-user',null,{timeout:3000}));
   assert.equal(await page.locator('[name=password]').inputValue(),profile.password);
  });
  if(!group1.includes(domain))continue;
  await run(domain,'home','<a href="/signup">Start now</a><a href="/login">Login</a>',async()=>{});
  await run(domain,'posts','<nav>Dashboard <a href="/new">New post</a></nav>',async()=>{});
  await run(domain,'new',form(field('Title','title')+'<textarea name="content" style="display:none"></textarea><iframe title="Rich Text Editor, editor1" srcdoc="<body contenteditable=true class=cke_editable></body>"></iframe><input name="publish" type="submit" value="Publish">','Publish'),async()=>{
   assert.equal(await page.locator('[name=title]').inputValue(),profile.businessName);
   assert.equal(await page.frameLocator('iframe').locator('body').innerHTML(),`<img src="${profile.imageUrl}" alt="">${description}`);
   assert.equal(await page.locator('[name=content]').inputValue(),`<img src="${profile.imageUrl}" alt="">${description}`);
  });
  await run(domain,'success',`<p>The Article was successfully published.</p><a id="successfully_posted" href="https://synthetic.${domain}/published-123">Visit</a>`,async()=>{});
 }
 for(const domain of family2) {
  for(const stage of ['signup','login','profile','listing']) {
   const account=['signup','login'].includes(stage);
   await run(domain,stage,form(account?field('Username','username')+field('Password','password','password')+field('Email','email','email')+field('CAPTCHA','captcha')+'<label><input type="checkbox" name="terms">Terms</label>':field('Business Name','businessName')+field('Website','website')+field('Email','email','email')+'<label>Long Description<textarea name="description"></textarea></label><label>Logo<input type="file" name="logo"></label>',stage==='login'?'Sign In':stage==='signup'?'Register':'Save'),async()=>{
    if(account){assert.equal(await page.locator('[name=username]').inputValue(),profile.username);assert.equal(await page.locator('[name=password]').inputValue(),profile.password);}
    else {assert.equal(await page.locator('[name=businessName]').inputValue(),profile.businessName);assert.equal(await page.locator('[name=logo]').evaluate(e=>e.files.length),0);}
   });
  }
 }
 await page.waitForTimeout(1200);
 assert.equal(nonGets,0);assert.equal(unexpected,0);assert.equal(await worker.evaluate(async()=>JSON.stringify(await chrome.storage.local.get(null))),before);
 console.log(`PASS ${checks} native manual entry cases across ${family1.length} Family1 and ${family2.length} Family2 domains; refresh repeated; unchanged storage; zero non-GET/unexpected requests.`);
}finally{await context.close();}
