// Standalone read-only investigation. Never imports MAHID or writes to Google Sheets.
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright';

// Exact predicate from the previous, subsequently deleted one-off tracker checker.
// Preserved only to reproduce the false negatives; never used for new decisions.
export function previousBroken(o){
 if(o.error||![200,404,410].includes(o.status))return false;
 const s=o.title+'\n'+o.text;
 if(/just a moment|checking your browser|verify.{0,20}human|access denied|security check|attention required|server error or not responding|has not been made public|not public or active|temporarily unavailable/i.test(s))return false;
 if(/account has been (?:disabled|suspended)|blog has been suspended/i.test(s))return false;
 if([404,410].includes(o.status)&&/\b(?:not found|404|410|expired)\b|does not exist|no longer available|removed|deleted|cannot be found/i.test(s))return true;
 return /paste expired or not found|document does not exist, has expired or has been deleted|job posting has been archived and is no longer active|ad is expired on|the (?:listing|ad)(?: or ad)? you have requested is no longer available|(?:this|the) (?:listing|ad|profile) (?:has been|was) (?:removed|deleted)|invalid \[?id\]? passed.{0,20}not found in database|is parked free|domain (?:is )?for sale/i.test(s);
}

const normalize=s=>(s||'').replace(/\s+/g,' ').trim();
const name=/\bjunky[\s._-]*boys\b/i;
const missingLabel=/^(?:(?:sorry|error|oops)[,:!\s-]*)?(?:(?:this|the|requested)\s+)?(?:(?:listing|page|ad|advertisement|classified ad|post|profile|document|paste|map)\s+(?:(?:is|was|has been)\s+)?(?:expired|not found|removed|deleted|no longer available|permanently unavailable|does not exist)|(?:no longer available|listing expired|ad expired|page not found)|404(?:\s*[-:|–—]\s*|\s+)(?:error|not found)|410(?:\s*[-:|–—]\s*|\s+)gone)(?:[.!:]|\s*[-|–—].*)?$/i;
const explicitMissing=/(?:the (?:listing|ad)(?: or ad)? you have requested is no longer available|(?:this|the|requested) (?:listing|page|ad|advertisement|post|profile|document|paste|map) (?:has been|was|is) (?:permanently )?(?:removed|deleted|expired|no longer available|not found)|(?:this|the) (?:listing|page|ad|post|document|paste) (?:does not|doesn't|no longer) exist|document does not exist, has expired or has been deleted|paste expired or not found|ad is expired on|job posting has been archived and is no longer active|invalid \[?id\]? passed\s*[-:]?\s*not found in database|(?:this|the) map cannot be found)/i;

export function classify(o){
 const text=o.text||'',title=o.title||'',headings=o.headings||[];
 const result=(classification,reason,evidence=[])=>({classification,reason,evidence});
 if(o.error)return result('UNCERTAIN','Navigation failed or timed out; no absence inferred.',[o.error]);
 if(o.captureError)return result('UNCERTAIN','Visible content could not be captured reliably.',[o.captureError]);
 if(o.renderIssue)return result('UNCERTAIN','Screenshot does not establish a fully rendered listing.',[o.renderIssue]);
 if(!o.status||[401,403,407,429,451].includes(o.status)||o.status>=500)return result('UNCERTAIN','Access restriction, rate limit or temporary server response.',[String(o.status)]);
 const start=title+'\n'+text.slice(0,3000);
 if(/just a moment|checking your browser|performing security verification|verify (?:that )?you are human|access denied|attention required|security check|unusual traffic|server error or not responding|temporarily unavailable/i.test(start))return result('UNCERTAIN','Security challenge or temporary service failure.');
 if(/has not been made public|not public or active/i.test(text))return result('UNCERTAIN','Profile is private or inactive; permanent deletion is not established.');
 if(/account has been (?:disabled|suspended)|blog has been suspended/i.test(text))return result('UNCERTAIN','Account restriction does not establish permanent deletion.');
 const visibleLines=text.split(/\r?\n/).map(normalize).filter(Boolean);
 // Read visible error notices regardless of HTTP 200, before considering business identity.
 const label=[...headings,...visibleLines].map(normalize).find(s=>missingLabel.test(s));
 const sentence=text.match(explicitMissing)?.[0];
 const titleMissing=missingLabel.test(normalize(title))?title:null;
 if([200,404,410].includes(o.status)&&(label||sentence||titleMissing))return result('CONFIRMED_BROKEN','Explicit rendered missing, removed or expired destination.',[label||sentence||titleMissing,`HTTP ${o.status}`]);
 if([404,410].includes(o.status)&&/^(?:404|410|not found|gone)[.!]?$/im.test(text.trim()))return result('CONFIRMED_BROKEN','HTTP missing/gone response with corresponding visible error.',[text.trim().slice(0,180),`HTTP ${o.status}`]);
 if(!name.test(text)&&/is parked free|domain (?:is )?for sale|this domain (?:is )?parked/i.test(text.slice(0,3000)))return result('CONFIRMED_BROKEN','The directory has been replaced by an explicit parked/domain-sale page.',[text.slice(0,250)]);
 if(o.status<200||o.status>=400)return result('UNCERTAIN','HTTP response alone does not establish a reliable working or missing listing.');
 const windows=[...text.matchAll(new RegExp(name.source,'gi'))].map(m=>text.slice(Math.max(0,m.index-250),m.index+3500));
 const nearby=windows.join('\n');
 const phone=/(?:\+?1[ .()-]*)?510[ .()-]*999[ .()-]*0021/.test(nearby);
 const address=/2557\s+coronation\s+(?:dr(?:ive)?\.?)\b/i.test(nearby)&&/union city|94587/i.test(nearby);
 const site=(o.links||[]).find(l=>{try{return /^(?:www\.)?thejunkyboys\.com$/i.test(new URL(l.href).hostname);}catch{return false;}});
 const description=/junk (?:removal|gets disposed)|hauling.{0,40}junk|dumpster rental/i.test(nearby)&&/san francisco bay area|union city/i.test(nearby);
 const loginWall=/^(?:.*\b)?(?:member login|administration login|my account|home - signin|sign in|log in|login required)(?:\s*[-|].*)?$/i.test(title)&&!description;
 if(loginWall)return result('UNCERTAIN','Login/account page prevents public listing verification.');
 if(name.test(text)&&(phone||address||(site&&description)))return result('CONFIRMED_WORKING','Rendered business name plus corroborating public business details.',['Junky Boys',...(phone?['510-999-0021']:[]),...(address?['2557 Coronation Drive, Union City/94587']:[]),...(site?[site.href]:[])]);
 return result('UNCERTAIN','No explicit permanent error and insufficient visible evidence of the requested listing.');
}

function selfTest(){
 const labels=['Listing Expired','Page Not Found','Ad Expired','Listing Removed','No Longer Available'];
 for(const label of labels){
  const o={status:200,title:label,text:label,headings:[label]};
  assert.equal(previousBroken(o),false,`Historical detector should reproduce miss: ${label}`);
  assert.equal(classify(o).classification,'CONFIRMED_BROKEN',label);
 }
 for(const status of [200,404,410])assert.equal(classify({status,title:'Error',text:'This listing has been removed.'}).classification,'CONFIRMED_BROKEN');
 for(const o of [{status:403,text:'Listing Expired'},{status:503,text:'Page Not Found'},{status:200,title:'Just a moment...',text:'Page Not Found'},{status:404,text:'Could not get paste data: server error or not responding'},{status:410,text:'This profile has not been made public.'},{status:200,text:'Sorry, this Listing is not Public or Active'},{status:200,text:'Account has been disabled due to a violation of Terms of Service.'},{status:200,text:'Page Not Found',error:'Navigation timeout'},{status:200,title:'Member Login - HappyCow',text:'Sign in to continue'},{status:200,text:'Posts expire after 180 days.'}])assert.equal(classify(o).classification,'UNCERTAIN',JSON.stringify(o));
 const live={status:200,title:'Junky Boys',text:'Junky Boys\n2557 Coronation Drive, Union City CA 94587\n510-999-0021\nJunk removal'};
 assert.equal(classify(live).classification,'CONFIRMED_WORKING');
 assert.equal(classify({...live,renderIssue:'Loading overlay covers the listing in the screenshot.'}).classification,'UNCERTAIN');
 assert.equal(previousBroken({status:200,title:'Paste expired or not found – Context',text:'Paste expired or not found. It was a 1-hour link.'}),true,'The real expired page was recognized by the old predicate when acquired');
 assert.equal(classify({...live,text:'Listing Expired\n'+live.text}).classification,'CONFIRMED_BROKEN','Expiry outranks retained business text');
 assert.equal(classify({status:200,title:'Junky Boys',text:'Junky Boys'}).classification,'UNCERTAIN');
 console.log('PASS: historical misses reproduced for all 5 supplied HTTP 200 error labels; corrected labels, error precedence, working corroboration and uncertainty guards.');
}

async function run(){
 if(process.argv.includes('--self-test')){selfTest();return;}
 const input=resolve(process.argv[2]||'research/junky-boys-verification/input.json');
 const out=resolve('research/junky-boys-verification');
 const inventory=JSON.parse(await readFile(input,'utf8'));
 const requested=process.argv.find(a=>a.startsWith('--rows='))?.slice(7).split(',').map(Number);
 const diagnoseDOM=process.argv.includes('--diagnose-dom');
 const settleMs=Number(process.argv.find(a=>a.startsWith('--settle-ms='))?.slice(12)||3500);
 assert(settleMs>=500&&settleMs<=15000,'Bounded render wait required');
 const statePath=join(out,'observations.json');
 let records=[];
 try{records=JSON.parse(await readFile(statePath,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
 const queue=inventory.entries.filter(e=>requested?requested.includes(e.row):!records.some(r=>r.row===e.row&&r.url===e.url));
 await mkdir(join(out,'screenshots'),{recursive:true});
 const browser=await chromium.launch({channel:'chrome',headless:true});
 const context=await browser.newContext({viewport:{width:1365,height:1000}});
 await context.route('**/*',r=>['media','font'].includes(r.request().resourceType())?r.abort():r.continue());
 let writeQueue=Promise.resolve();
 function save(){const payload=JSON.stringify(records,null,2);writeQueue=writeQueue.then(async()=>{await writeFile(statePath+'.tmp',payload);await rename(statePath+'.tmp',statePath);});return writeQueue;}
 async function observe(entry){
  const page=await context.newPage();
  const previous=records.find(r=>r.row===entry.row),attempt=diagnoseDOM?(previous?.diagnostics?.length||0)+1:(previous?.observations.length||0)+1;
  const o={row:entry.row,url:entry.url,attempt,verifiedAt:new Date().toISOString(),waitUntil:diagnoseDOM?'domcontentloaded':'commit'};
  try{
   // Commit first: a slow subresource must not discard an already-rendered error page.
   const response=await page.goto(entry.url,{waitUntil:o.waitUntil,timeout:35000});
   o.status=response?.status();o.redirects=[];
   let request=response?.request();while(request){o.redirects.unshift({url:request.url(),status:(await request.response())?.status()});request=request.redirectedFrom();}
  }catch(e){o.error=e.message.slice(0,800);}
  try{
   await page.waitForTimeout(settleMs);o.finalUrl=page.url();o.title=await page.title();
   o.readyState=await page.evaluate(()=>document.readyState);
   o.text=(await page.locator('body').innerText({timeout:7000})).slice(0,60000);
   o.headings=await page.locator('h1,h2,[role="alert"]').allTextContents();
   o.links=await page.locator('a[href]').evaluateAll(nodes=>nodes.map(a=>({text:(a.innerText||'').trim().slice(0,100),href:a.href})).filter(a=>/thejunkyboys\.com/i.test(a.href)));
   o.screenshot=join('screenshots',`row-${entry.row}-${diagnoseDOM?'diagnostic':'attempt'}-${attempt}.png`);
   await page.screenshot({path:join(out,o.screenshot),fullPage:true,timeout:10000});
  }catch(e){o.captureError=e.message.slice(0,800);}
  finally{await page.close().catch(()=>{});}
  o.previousBroken=previousBroken({...o,title:o.title||'',text:o.text||''});Object.assign(o,classify(o));
  if(diagnoseDOM){assert(previous,'Diagnosis requires an existing observation');(previous.diagnostics??=[]).push(o);}
  else if(!previous){records.push({...entry,observations:[o]});}else previous.observations.push(o);
  await save();console.log(JSON.stringify({checked:records.length,row:entry.row,status:o.status,classification:o.classification,reason:o.reason,error:o.error?.split('\n')[0]}));
 }
 async function worker(){while(queue.length)await observe(queue.shift());}
 console.log(JSON.stringify({inputRows:inventory.entries.length,pending:queue.length}));
 try{await Promise.all(Array.from({length:6},worker));await writeQueue;}finally{await browser.close();}
 const counts={CONFIRMED_WORKING:0,CONFIRMED_BROKEN:0,UNCERTAIN:0};
 for(const e of inventory.entries){const r=records.find(r=>r.row===e.row&&r.url===e.url);if(r)counts[r.observations.at(-1).classification]++;}
 console.log(JSON.stringify({counts,attempted:records.length,total:inventory.entries.length}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await run();
