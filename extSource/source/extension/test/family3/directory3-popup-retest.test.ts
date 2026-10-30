import { isFamily3Transition } from '../../src/family3-navigation';
﻿import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fixtureFiles,integrationHarness} from './integration-harness';
import {LISTING_RUN_KEY} from '../../src/listing-run';
for(const domain of Object.keys(fixtureFiles).filter(domain=>!process.env.FAMILY3_DOMAIN || domain===process.env.FAMILY3_DOMAIN))test(`ONE AUTOFILL: unrelated historical run → ${domain} homepage → actual native fields, while document is loading`,async t=>{
 const h=await integrationHarness(domain,{oldDirectory3:domain!=='directory3.org',missingReceiver:true});t.after(h.close);
 await h.click();const run=h.stored[LISTING_RUN_KEY];
 assert.equal(run.stage,'MANUAL_GATE',run.error);assert.deepEqual(h.navigations,[h.tab().url]);
 assert.equal(h.fills(),2,'one entry inspection plus one form fill');assert.equal(h.repairs(),1);
 for(const [name,value] of Object.entries({TITLE:h.profile.businessName,URL:h.profile.website,DESCRIPTION:h.profile.description,OWNER_NAME:h.profile.contactName,OWNER_EMAIL:h.profile.email}))assert.equal(h.doc.querySelector<HTMLInputElement>(`[name=${name}]`)!.value,value,name);
 const select=h.doc.querySelector<HTMLSelectElement>('[name=CATEGORY_ID]')!;assert.equal(select.selectedOptions[0].textContent!.trim(),h.profile.category);
 assert.equal(run.autoPublish,false);assert.equal(run.autoRegister,false);assert.equal(run.autoLogin,false);assert.equal(run.publicationApproval,undefined);assert.equal(run.submissionAttempted,undefined);
 for(const [key,value] of Object.entries(h.baseline))if(key!==LISTING_RUN_KEY)assert.deepEqual(h.stored[key],value,key);
 assert(Object.entries(h.stored).some(([key,value])=>key.startsWith('ba2.listingRunArchive:'+h.old.id+':snapshot:')&&JSON.stringify(value)===JSON.stringify(h.old)),'historical snapshot retained alongside earlier archive');
 assert(!h.commands.some(x=>/PUBLISH|SUBMIT_ONCE|ATTACH|SHEETS/.test(x)));
 // Late document/frame completion notifications must not resume an already
 // filled native form. Exercise the same callback used by Chrome repeatedly.
 const fills=h.fills(), navigations=[...h.navigations];
 let businessEvents=0, captchaEvents=0;
 h.doc.addEventListener('input',()=>businessEvents++);
 h.doc.addEventListener('change',()=>businessEvents++);
 for(const element of h.doc.querySelectorAll('[data-sitekey], [id*="captcha" i], iframe'))
   for(const type of ['click','focus','focusin','input','change'])element.addEventListener(type,()=>captchaEvents++);
 for(let i=0;i<12;i++)h.onUpdated()(42,{status:'complete'},h.tab());
 await new Promise(resolve=>setTimeout(resolve,50));
 assert.equal(h.fills(),fills,'late completion must not repeat AUTOFILL');
 assert.deepEqual(h.navigations,navigations,'late completion must not navigate again');
 assert.equal(businessEvents,0,'no field events after the manual gate');
 assert.equal(captchaEvents,0,'no CAPTCHA interaction after the manual gate');
 assert.equal(h.stored[LISTING_RUN_KEY].stage,'MANUAL_GATE');
});
test('uncertain same-directory run and every receipt remain unchanged; no navigation/refill',async t=>{
 const h=await integrationHarness('directory3.org',{oldDirectory3:true});t.after(h.close);await h.click();assert.deepEqual(h.stored,h.baseline);assert.equal(h.fills(),0);assert.equal(h.navigations.length,0);
});
test('lost form acknowledgement never reinjects or replays autofill, including a second click',async t=>{
 const h=await integrationHarness('groovy-directory.com',{lostFillAck:true});t.after(h.close);await h.click();assert.equal(h.stored[LISTING_RUN_KEY].stage,'ERROR');assert.match(h.stored[LISTING_RUN_KEY].error,/no response|acknowledgement/i);await h.click();assert.equal(h.fills(),2);assert.equal(h.navigations.length,1);
});
test('actual chrome-error navigation stops before form autofill; no Reload or navigation retry',async t=>{
 const h=await integrationHarness('advancedseodirectory.com',{navigationError:true});t.after(h.close);await h.click();assert.equal(h.stored[LISTING_RUN_KEY].stage,'ERROR');assert.equal(h.fills(),1);assert.equal(h.navigations.length,1);assert.match(h.stored[LISTING_RUN_KEY].error,/left the approved directory/);
});
test('document with changed required native selectors cannot fall back to blog/generic writes',async t=>{
 const h=await integrationHarness('ad-links.org',{unsupported:true});t.after(h.close);await h.click();assert.equal(h.stored[LISTING_RUN_KEY].stage,'ERROR');assert.equal(h.fills(),1);assert.equal(h.doc.querySelector<HTMLInputElement>('[name=TITLE]')!.value,'');
});
test('untrusted current-tab START cannot reach native navigation or mutate history',async t=>{
 const h=await integrationHarness('relevantdirectory.biz',{oldDirectory3:true});t.after(h.close);const ack=await h.dispatch({type:'BA2_START_LISTING_AUTOFILL',continuous:true},{id:'other',url:h.tab().url,tab:{id:42},frameId:0});assert.equal(ack.ok,false);assert.deepEqual(h.stored,h.baseline);assert.equal(h.fills(),0);
});

test('recorded HTTP submission accepts a same-site browser HTTPS upgrade without downgrade or changed website',async t=>{
 assert.equal(isFamily3Transition('http://relevantdirectory.biz/','https://www.relevantdirectory.biz/submit.php'),true);
 assert.equal(isFamily3Transition('https://relevantdirectory.biz/','http://relevantdirectory.biz/submit.php'),false);
 assert.equal(isFamily3Transition('http://relevantdirectory.biz/','https://groovy-directory.com/submit.php'),false);
 const h=await integrationHarness('relevantdirectory.biz',{http:true,upgradeHttps:true});t.after(h.close);await h.click();const run=h.stored[LISTING_RUN_KEY];assert.equal(run.stage,'MANUAL_GATE',run.error);assert.equal(new URL(run.sourceUrl).protocol,'https:');assert.equal(new URL(run.entryUrl).protocol,'http:');assert.equal(h.doc.querySelector<HTMLInputElement>('[name=TITLE]')!.value,h.profile.businessName);
});
