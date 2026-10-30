import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { Window } from 'happy-dom';
import { createEmptyProfileInput, STORAGE_KEYS, type BusinessProfile } from '@backlink-autofill/shared';
import { getFamily3Adapter } from '../../src/automation/adapters';
import { createListingRun, LISTING_RUN_KEY } from '../../src/listing-run';
import { runListingAutofillAsync } from '../../src/content/listing-autofill';

export const fixtureFiles: Record<string, string> = {
 'unique-listing.com':'unique-listing.html', 'directory3.org':'directory3.html', 'groovy-directory.com':'groovy-directory.html', 'bizz-directory.com':'bizz-directory.html',
 'reddit-directory.com':'reddit-directory.html', 'familydir.com':'familydir.html', 'expansiondirectory.com':'expansion-directory.html', 'bluebook-directory.com':'bluebook-directory.html',
 'aurora-directory.com':'aurora-directory.html', 'fruity-directory.com':'fruity-directory.html', 'greenydirectory.com':'greeny-directory.html',
 'ad-links.org':'ad-links.org.html', 'backpagedir.com':'backpagedir.com.html', 'addgoodsites.com':'addgoodsites.com.html', 'businessfreedirectory.biz':'businessfreedirectory.biz.html',
 'jet-links.com':'jet-links.com.html', 'adbritedirectory.com':'adbritedirectory.com.html', 'searchdomainhere.com':'search-domain-here.html', 'fire-directory.com':'fire-directory.html',
 'linkedin-directory.com':'linkedin-directory.html', 'relateddirectory.org':'related-directory.html', 'relevantdirectory.biz':'relevant-directory-https.html',
 'relevantdirectories.com':'relevant-directories-https.html', 'efdir.com':'efdir-https.html', 'ifidir.com':'ifidir.html', 'smartdir.org':'smartdir-https.html',
 'toptendir.net':'toptendir-https.html', 'advancedseodirectory.com':'advanced-seo-directory.html',
};
const workerScript = readFileSync(new URL('../../../dist/background.js', import.meta.url), 'utf8');
const popupScript = readFileSync(new URL('../../../dist/popup/popup.js', import.meta.url), 'utf8');
const popupHtml = readFileSync(new URL('../../../dist/popup/popup.html', import.meta.url), 'utf8');
export async function integrationHarness(domain: string, options: { missingReceiver?: boolean; lostFillAck?: boolean; oldDirectory3?: boolean; navigationError?: boolean; unsupported?: boolean; http?: boolean; upgradeHttps?: boolean } = {}) {
 let origin = `${options.http || ['directory3.org','searchdomainhere.com','advancedseodirectory.com','linkedin-directory.com','relateddirectory.org'].includes(domain) ? 'http' : 'https'}://${domain}`;
 const page = new Window({url: origin+'/', settings:{ disableJavaScriptEvaluation:true,disableJavaScriptFileLoading:true,disableCSSFileLoading:true,disableIframePageLoading:true }});
 let tab = {id:42,url:origin+'/',status:'complete'}, receiver: Function = () => {}, onUpdated: Function = () => {};
 let profile: BusinessProfile = {...createEmptyProfileInput(), id:'unified-profile',businessName:'Example Test Business',contactName:'Example Test Owner',email:'owner@example.test',website:'https://example.test/business',description:'Approved safe sample description. No submission.',category:'Web Design',createdAt:'2026-10-20',updatedAt:'2026-10-20'};
 const stored: Record<string, any> = {[STORAGE_KEYS.activeProfile]:{profile,syncedAt:'offline',source:'local-storage'}};
 const commands: string[] = [], navigations: string[] = []; let repairs=0, fills=0;
 function expose(){const g=globalThis as Record<string,unknown>;for(const key of ['window','document','location','HTMLInputElement','HTMLTextAreaElement','HTMLSelectElement','Element','Event','MutationObserver'])g[key]=key==='window'?page:(page as unknown as Record<string,unknown>)[key];g.chrome=chrome;}
 const adapter=getFamily3Adapter(tab.url)!;
 const label=adapter?.config.entryLabels[0] || 'Add Site';
 page.document.body.innerHTML=`<nav id="navigation"><a href="/submit.php">${label}</a></nav>`;
 function form(){
   const html=readFileSync(new URL(`../../family3/fixtures/${fixtureFiles[domain]}`,import.meta.url),'utf8');
   page.happyDOM.setURL(origin+'/submit.php');page.document.body.innerHTML=html;
   Object.defineProperty(page.document,'readyState',{get:()=> 'loading',configurable:true});
   const select=(page.document as unknown as Document).querySelector<HTMLSelectElement>('select[name=CATEGORY_ID]')!;
   const normalize=(s:string)=>s.toLowerCase().replace(/&/g,'and').replace(/[^a-z0-9]+/g,' ').trim();
   const labels=[...select.options].map(o=>normalize(o.textContent||''));
   const match=[...select.options].find(o=>o.value && o.value!=='0' && !o.disabled && labels.filter(x=>x===normalize(o.textContent||'')).length===1 && normalize(o.textContent||'').length>3)!;
   assert(match,'fixture must contain a unique actual category');profile.category=match.textContent!.trim();
   // Retain actual option text/value while keeping transport tests small. Each
   // site's independent selector suite still exercises its original dictionary.
   for(const option of [...select.options])if(option!==match && option.value!=='0')option.remove();
   if(options.unsupported)page.document.querySelector('[name=OWNER_EMAIL]')!.remove();
   tab={...tab,url:origin+'/submit.php',status:'loading'};
 }
 const chrome:any={runtime:{id:'offline',getManifest:()=>({version:'test'}),getURL:(p:string)=>'chrome-extension://offline/'+p,onInstalled:{addListener(){}},onMessage:{addListener(fn:Function){receiver=fn;}}},storage:{local:{get:async(keys:any)=>keys==null?structuredClone(stored):Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(k=>[k,structuredClone(stored[k])])),set:async(values:any)=>{Object.assign(stored,structuredClone(values));},remove:async()=>assert.fail('no removals')},session:{get:async()=>({})}},tabs:{onUpdated:{addListener(fn:Function){onUpdated=fn;}},onRemoved:{addListener(){}},onReplaced:{addListener(){}},query:async()=>[tab],get:async(id:number)=>{if(id!==42)throw Error(`No tab with id: ${id}`);return {...tab};},update:async(id:number,change:any)=>{assert.equal(id,42);navigations.push(change.url);assert.equal(change.url,origin+'/submit.php');if(options.navigationError){tab={...tab,url:'chrome-error://chromewebdata/'};page.happyDOM.setURL(tab.url);}else {if(options.upgradeHttps)origin=origin.replace('http:','https:');form();}return tab;},sendMessage:async(id:number,message:any,target:any)=>{
   commands.push(message.type);assert.equal(id,42);
   if(message.type==='BA2_GET_ACTIVE_PROFILE'){assert.equal(target.frameId,0);if(options.missingReceiver && repairs===0)throw Error('Could not establish connection. Receiving end does not exist.');return {ok:true,profileName:profile.businessName,syncedAt:null};}
   if(message.type==='BA2_LISTING_AUTOFILL'){assert.equal(target.frameId,0);fills++;expose();const report=await runListingAutofillAsync(profile);if(options.lostFillAck && tab.url.endsWith('/submit.php'))return undefined;return {ok:true,report};}
   if(message.type==='BA2_D3_INSPECT')return {ok:false,reason:'Dedicated manual observer is tested in directory3-submission suite'};
   if(message.type==='BA2_BLOG_OBSERVE')return {stage:'UNSUPPORTED',confidence:0,reason:'not a blog'};
   assert.fail('Unexpected command '+message.type);
 }},scripting:{executeScript:async(call:any)=>{assert.equal(call.target.tabId,42);assert.equal(JSON.stringify(call.target.frameIds),'[0]');if(call.files){assert.equal(JSON.stringify(call.files),'["content/content.js"]');repairs++;return [];}expose();return [{result:vm.runInNewContext(`(${call.func.toString()})(...args)`,{document:page.document,location:page.location,args:call.args})}];}}};
 form();page.happyDOM.setURL(origin+'/');page.document.body.innerHTML=`<nav id="navigation"><a href="/submit.php">${label}</a></nav>`;tab={id:42,url:origin+'/',status:'complete'};
 expose();vm.runInNewContext(workerScript,{chrome,console:{log(){}},URL,crypto,TextEncoder,setTimeout,clearTimeout,structuredClone,fetch:()=>assert.fail('No external network/Sheets permitted')});
 await new Promise(resolve=>setTimeout(resolve,15));
 const old=createListingRun('https://pointblog.net/login',profile.id,99);old.stage='ERROR';old.autoLogin=false;old.error='Preserved uncertain login';old.login={url:old.sourceUrl,state:'uncertain',attemptId:'historic-login',reason:'uncertain'};
 if(options.oldDirectory3){old.sourceUrl='http://directory3.org/submit.php';old.domain='directory3.org';(old as any).directory3={phase:'attempted',intentId:'historic-human',outcome:'uncertain',review:{identityKey:'old',profileDigest:'old'}};}
 stored[LISTING_RUN_KEY]=structuredClone(old);stored['ba2.listingRunArchive:'+old.id]={...structuredClone(old),error:'Earlier archive snapshot'};
 stored['ba2.loginGuard:https://pointblog.net:'+profile.id]={runId:old.id,state:'uncertain',marker:'unchanged'};
 stored['ba2.directory3.receipt:historic']={runId:'old-d3',outcome:'uncertain',claimed:true};stored['ba2.cargo.runs']={historical:{outcome:'uncertain'}};
 const baseline=structuredClone(stored);
 const popup=new Window({url:'chrome-extension://offline/popup/popup.html'});popup.document.write(popupHtml.replace(/<script[\s\S]*?<\/script>/g,'').replace(/<link[^>]*>/g,''));
 const dispatch=(message:any,sender:any={id:'offline',url:'chrome-extension://offline/popup/popup.html'})=>new Promise<any>(resolve=>{receiver(message,sender,resolve);});
 let lastStart: Promise<any> | undefined;
 (popup as any).chrome={runtime:{sendMessage:(message:any)=>{const result=dispatch(message);if(message.type==='BA2_START_LISTING_AUTOFILL')lastStart=result;return result;}},tabs:{query:async()=>[tab]},storage:{onChanged:{addListener(){}}}};
 popup.eval(popupScript);await popup.happyDOM.whenAsyncComplete();
 return {page,doc:page.document as unknown as Document,popup,stored,baseline,commands,navigations,profile,old,dispatch,tab:()=>tab,repairs:()=>repairs,fills:()=>fills,onUpdated:()=>onUpdated,click:async()=>{(popup.document.getElementById('autofill-button') as unknown as HTMLButtonElement).click();await lastStart;await popup.happyDOM.whenAsyncComplete();},close:async()=>{await popup.happyDOM.close();await page.happyDOM.close();}};
}
