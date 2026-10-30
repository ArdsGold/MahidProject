import assert from 'node:assert/strict';import vm from 'node:vm';import{readFile}from'node:fs/promises';
const script=await readFile(new URL('../dist/background.js',import.meta.url),'utf8'),source=await readFile(new URL('../src/manual-autofill-policy.ts',import.meta.url),'utf8');
const domains=[...JSON.parse(source.match(/FAMILY1_HOSTS = (.*);/)[1]),...JSON.parse(source.match(/FAMILY2_HOSTS = (.*);/)[1]),'unknown-directory.example'];
for(const domain of domains){
 const run={id:'preserved',sourceUrl:`https://${domain}/new`,domain,tabId:99,profileId:'synthetic',stage:'MANUAL_GATE',autoRegister:true,autoLogin:true,autoPublish:true,submissionAttempted:true,publicationSubmission:{attemptId:'preserved'},publicVerification:{status:'verified'},steps:[],manual:[]};
 const storage={'ba2.listingRun':run,'ba2.publicationGuard:preserve':{runId:run.id,outcome:'uncertain'}},before=JSON.stringify(storage),messages=[],events={};
 const blocked=()=>assert.fail('Dormant manual-family worker must not act');
 const event=name=>({addListener:fn=>{events[name]=fn;}});
 const chrome={runtime:{id:'a'.repeat(32),getManifest:()=>({version:'fixture'}),getURL:path=>'chrome-extension://'+'a'.repeat(32)+'/'+path,onInstalled:event('installed'),onMessage:{addListener:fn=>messages.push(fn)}},storage:{local:{get:async key=>({[key]:storage[key]}),set:blocked,remove:blocked}},tabs:{query:blocked,get:blocked,update:blocked,sendMessage:blocked,onUpdated:event('updated'),onRemoved:event('removed'),onReplaced:event('replaced')},scripting:{executeScript:blocked}};
 vm.runInNewContext(script,{chrome,console,setTimeout,clearTimeout,setInterval,clearInterval,URL,AbortController,fetch:blocked,crypto:globalThis.crypto,TextEncoder});
 await new Promise(resolve=>setTimeout(resolve,0));
 await new Promise(resolve=>messages[0]({type:'BA2_GET_PUBLICATION_TRACE'},{id:chrome.runtime.id,url:chrome.runtime.getURL('popup/popup.html')},resolve));
 events.updated(99,{status:'complete'});events.removed(99);events.replaced(101,99);await new Promise(resolve=>setTimeout(resolve,0));
 assert.equal(JSON.stringify(storage),before);
}
console.log(`PASS production worker policy for ${domains.length} manual/smart domains: saved run startup/tab events dormant, no storage writes/navigation/messages/fetch`);
