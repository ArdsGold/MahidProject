// Standalone read-only research. No MAHID runtime imports, saved browser sessions or form actions.
import { chromium } from 'playwright';
import { mkdir, readFile, writeFile, appendFile, rename } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';

const python = join(process.env.LOCALAPPDATA, 'Google/Cloud SDK/google-cloud-sdk/platform/bundledpython/python.exe');
const helper = resolve('scripts/junk180-workbook.py');
const source = process.env.JUNK180_SOURCE || 'C:/Users/WolfForge/Downloads/JUNK180 LLC.xlsx';
const out = resolve(process.env.JUNK180_OUTPUT || 'research/junk180-verification');
const pause = ms => new Promise(r => setTimeout(r, ms));
async function bounded(promise, milliseconds, label) {
  let timer;
  try { return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(`${label} exceeded ${milliseconds}ms`)),milliseconds);})]); }
  finally { clearTimeout(timer); }
}
const key = r => `${r.sheet}:${r.row}`;
const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const version = '1';
const session = new Date().toISOString().replace(/[:.]/g,'-');

export function classify(observation, identity, referenceOnly = false) {
  const { text = '', title = '', httpStatus, error, links = [], headings = [] } = observation;
  const namePattern = /\bjunk[\s._-]*180(?:\s+(?:llc|l\.l\.c\.?))?\b/i;
  const name = text.match(namePattern);
  const matched = [];
  const phone = norm(identity['Phone:']).replace(/^1(?=\d{10}$)/, '');
  const address = identity['Address:'] || '';
  const website = new URL(identity.Website).hostname.replace(/^www\./, '');
  // Evidence must occur near the displayed name, not solely in a URL/title/hidden markup.
  const windows = [...text.matchAll(new RegExp(namePattern.source, 'gi'))].map(m => text.slice(Math.max(0,m.index-450),m.index+1800));
  if (name) matched.push(`Visible business name: ${name[0]}`);
  const near = windows.join('\n');
  if (phone && norm(near).includes(phone)) matched.push(`Phone: ${identity['Phone:']}`);
  if (/560\s+(?:first|1st)\s+(?:st(?:reet)?\b)/i.test(near) && /\b(?:benicia|94510)\b/i.test(near)) matched.push(`Street and locality: ${address}`);
  const siteLink = links.find(l => { try { return new URL(l.href).hostname.replace(/^www\./,'') === website; } catch { return false; } });
  if (siteLink && name) matched.push(`Business website link: ${siteLink.href}`);
  if (/\bbenicia\b/i.test(near)) matched.push('Locality: Benicia');
  if (/\b94510\b/.test(near)) matched.push('ZIP: 94510');
  const result = (classification, reason) => ({ classification, reason, matchedDetails: matched });
  if (referenceOnly) return result('NEEDS_REVIEW','Business-reference URL above the listing table; checked as requested, but not a directory listing. Review the captured evidence.');
  const barrier = /just a moment|checking your browser|verify (?:that )?you are human|access denied|request (?:has been )?blocked|security (?:check|verification)|attention required|robot check|unusual traffic|enable javascript and cookies|captcha challenge|privacy error|this site can.t be reached/i;
  if ([401,403,407,429,451,503].includes(httpStatus) || barrier.test(title + '\n' + text.slice(0,2500))) return result('NEEDS_REVIEW','Access restriction, rate limit, security challenge or temporary service response; absence is not established.');
  if (error) return result('NEEDS_REVIEW',`Navigation did not complete reliably: ${error}`);
  if (observation.captureError) return result('NEEDS_REVIEW',`Visible content could not be captured reliably: ${observation.captureError}`);
  if (/sign in to (?:continue|view)|log in to (?:continue|view)|login required|you must (?:be logged|log in)|please (?:log|sign) in to/i.test(text.slice(0,4000))) return result('NEEDS_REVIEW','Login wall prevents public listing verification.');
  if (observation.captchaVisible && !name) return result('NEEDS_REVIEW','Visible CAPTCHA prevents establishing business identity.');
  if (httpStatus === 410 && /\bexpired\b|\b(?:ad|listing) (?:has |is )?(?:expired|removed|deleted)/i.test(text.slice(0,1000))) return result('NOT_LIVE','The server returns HTTP 410 Gone and the rendered ad is explicitly marked EXPIRED/removed. Retained business details are recorded, but the ad is retired.');
  if (!name && /(?:is parked free|domain (?:is )?parked|this domain (?:is )?for sale)/i.test(text.slice(0,1500))) return result('NOT_LIVE','The requested directory URL renders an explicit parked/domain-for-sale page instead of a listing; the original listing destination is unavailable.');
  if (!name && [200,404,410].includes(httpStatus) && /the (?:listing|ad)(?: or ad)? you have requested is no longer available|the ad does not seem to exist anymore|(?:this|the) (?:listing|ad) (?:has been|was) (?:removed|deleted)/i.test(text)) return result('NOT_LIVE','The rendered directory explicitly says the requested listing/ad is no longer available, removed or nonexistent.');
  if (!name && [200,404,410].includes(httpStatus) && /invalid \[?id\]? passed\s*-\s*not found in database/i.test(text)) return result('NOT_LIVE','The directory explicitly reports the requested listing ID is not found in its database.');
  if (!name && httpStatus===404 && /this map cannot be found/i.test(text)) return result('NOT_LIVE','HTTP 404 and the rendered page explicitly state that the requested map cannot be found.');
  const strong = matched.some(x => x.startsWith('Phone:') || x.startsWith('Street and locality:'));
  const supporting = siteLink && /\bbenicia\b/i.test(near) && /\b(?:94510|junk removal|appliance removal)\b/i.test(near);
  if (httpStatus >= 200 && httpStatus < 400 && name && (strong || supporting)) return result('VERIFIED_LIVE','Publicly rendered business name matches, with corroborating phone/address or business website and locality/service evidence.');
  const missing = /\b404\b|\b410\b|(?:page|listing|ad|map) (?:was |is )?not\s?found|listing (?:has been |was )?(?:removed|deleted|not found)|business (?:has been |was )?(?:removed|deleted|not found)|(?:this (?:page|listing)|page you are looking for) (?:does not|doesn.t|no longer) exist/i;
  if (!name && (missing.test([title,...headings].join('\n')) || (httpStatus===404 && headings.some(h=>/^\s*not found[!.]?\s*$/i.test(h)))) && text.trim().length > 15 && (httpStatus === 404 || httpStatus === 410 || httpStatus === 200)) return result('NOT_LIVE','Rendered page title/heading explicitly establishes that the requested page/listing is missing or removed; no matching business identity appears.');
  return result('NEEDS_REVIEW',name ? 'Business name appears, but corroborating identity evidence is insufficient or the response is ambiguous.' : 'No sufficiently supported business listing could be established from visible content. This does not establish absence.');
}

if (process.argv.includes('--self-test')) {
  const identity = {'Phone:':'(707) 536-0740','Address:':'560 First St STE B-205, Benicia, CA 94510',Website:'https://junk180.com/our-services/appliance-removal/'};
  const c = data => classify({httpStatus:200,...data},identity).classification;
  assert.equal(c({text:'JUNK180 LLC in Benicia. Call (707) 536-0740.'}), 'VERIFIED_LIVE');
  assert.equal(c({text:'JUNK180 LLC, 560 First St, Benicia CA 94510.'}), 'VERIFIED_LIVE');
  assert.equal(c({text:'JUNK180 LLC junk removal Benicia',links:[{href:'https://junk180.com/'}]}), 'VERIFIED_LIVE');
  for (const data of [{text:'JUNK180 LLC'}, {httpStatus:404,text:'Server error'}, {error:'Timeout',text:'JUNK180 LLC (707) 536-0740'}, {httpStatus:403,text:'Access denied'}, {title:'Just a moment',text:'JUNK180 LLC (707) 536-0740'}, {text:'No search results'}, {text:'',title:'JUNK180 LLC 7075360740'}]) assert.equal(c(data),'NEEDS_REVIEW');
  assert.equal(c({httpStatus:404,title:'Page not found',text:'The requested page was not found.'}),'NOT_LIVE');
  assert.equal(c({httpStatus:404,headings:['Sorry the page you are looking for does not exist.'],text:'Sorry the page you are looking for does not exist.'}),'NOT_LIVE');
  assert.equal(c({httpStatus:410,text:'EXPIRED JUNK180 LLC (707) 536-0740'}),'NOT_LIVE');
  assert.equal(c({text:'example.com is parked free, courtesy of GoDaddy.com.'}),'NOT_LIVE');
  assert.equal(c({httpStatus:404,text:'The listing or ad you have requested is no longer available on our site.'}),'NOT_LIVE');
  assert.equal(c({httpStatus:404,title:'- Classified Ad is not Found',text:'We could not find that post.'}),'NOT_LIVE');
  assert.equal(c({text:'Invalid [ID] passed - not found in database'}),'NOT_LIVE');
  assert.equal(classify({text:'JUNK180 LLC (707) 536-0740',httpStatus:200},identity,true).classification,'NEEDS_REVIEW');
  console.log('PASS classification checks: corroboration, inaccessible/error pages, missing-page evidence, reference URLs.');
  process.exit(0);
}

await mkdir(out,{recursive:true});
await mkdir(join(out,'evidence'),{recursive:true});
let inventory;
try { inventory = JSON.parse(await readFile(join(out,'inventory.json'),'utf8')); }
catch { execFileSync(python,[helper,'extract',source,join(out,'inventory.json')],{windowsHide:true}); inventory = JSON.parse(await readFile(join(out,'inventory.json'),'utf8')); }
assert.equal(createHash('sha256').update(await readFile(inventory.source)).digest('hex'),inventory.sourceSha256,'Source hash mismatch');
const results = new Map();
try {
  const lines = (await readFile(join(out,'checkpoints.jsonl'),'utf8')).split('\n').filter(Boolean);
  for (let i=0;i<lines.length;i++) {
    try { const record = JSON.parse(lines[i]); assert.equal(record.verifierVersion,version); results.set(key(record),record); }
    catch (error) { if(i !== lines.length-1) throw error; await writeFile(join(out,`incomplete-checkpoint-${session}.txt`),lines[i]); await writeFile(join(out,'checkpoints.jsonl'),lines.slice(0,i).join('\n')+'\n'); console.warn('Incomplete final checkpoint preserved separately; its row will be retried.'); }
  }
} catch(e) { if(e.code !== 'ENOENT') throw e; }
// A local sandbox denial is not a website result; retry it once network execution is authorized.
for (const [id,record] of results) if(record.errors?.some(e=>e.includes('ERR_NETWORK_ACCESS_DENIED')))results.delete(id);
const retryRows = new Set((process.argv.find(a=>a.startsWith('--retry-rows='))?.split('=')[1] || '').split(',').filter(Boolean).map(Number));
for (const [id,record] of results) if(retryRows.has(record.row))results.delete(id);
let stopping = false;
process.on('SIGINT',()=>{stopping=true;});
process.on('SIGTERM',()=>{stopping=true;});

async function saveReports() {
  const records = inventory.entries.map(e => results.get(key(e)) || {...e,classification:'NEEDS_REVIEW',reason:'NOT ATTEMPTED: run interrupted before this row.',attemptCount:0,errors:['Not attempted'],verifierVersion:version});
  const summary = {totalUrls:records.length,uniqueNavigationUrls:new Set(inventory.entries.map(e=>e.navigationUrl||e.originalUrl)).size,listingTableRows:inventory.entries.filter(e=>!e.referenceOnly).length,businessReferenceRows:inventory.entries.filter(e=>e.referenceOnly).length,attempted:records.filter(r=>r.attemptCount>0).length,verifiedLive:records.filter(r=>r.classification==='VERIFIED_LIVE').length,notLive:records.filter(r=>r.classification==='NOT_LIVE').length,needsReview:records.filter(r=>r.classification==='NEEDS_REVIEW').length,errors:records.filter(r=>r.attemptCount>0&&r.errors?.length).length,unattempted:records.filter(r=>!r.attemptCount).length,completed:results.size,sourceUnchanged:true};
  assert.equal(new Set(records.map(key)).size,inventory.entries.length);
  assert.equal(createHash('sha256').update(await readFile(inventory.source)).digest('hex'),inventory.sourceSha256);
  const report = {verifierVersion:version,generatedAt:new Date().toISOString(),policy:{columnCUsed:false,concurrency:3,batchSize:12,maxAttempts:2,navigationTimeoutMs:20000,contentCaptureTimeoutMs:8000,screenshotTimeoutMs:6000,contextCleanupTimeoutMs:8000,anonymousBrowser:true,formsSubmitted:0,nonGetRequestsBlocked:true,relocationSearch:false},summary,inventory,results:records};
  await writeFile(join(out,'report.tmp.json'),JSON.stringify(report,null,2));
  await rename(join(out,'report.tmp.json'),join(out,'report.json'));
  execFileSync(python,[helper,'export',join(out,'report.json'),join(out,'JUNK180 LLC - Verified Listings.xlsx')],{windowsHide:true});
  console.log(JSON.stringify(summary));
}

if(process.argv.includes('--reclassify')) {
  for(const entry of inventory.entries) {
    const old = results.get(key(entry));
    if(!old?.evidencePath)continue;
    const observation = JSON.parse(await readFile(join(old.evidencePath,'observation.json'),'utf8'));
    observation.httpStatus = observation.responses?.findLast(r=>r.url===observation.finalUrl)?.status ?? observation.httpStatus;
    const finalUrl = /^https?:\/\//i.test(observation.finalUrl || '') ? observation.finalUrl : '';
    const updated = {...old,...classify(observation,inventory.identity,entry.referenceOnly),httpStatus:observation.httpStatus,finalUrl};
    if(JSON.stringify(updated)!==JSON.stringify(old)) {
      updated.classificationReviewedAt = new Date().toISOString();
      updated.previousClassification = old.classification;
      results.set(key(entry),updated);
      await appendFile(join(out,'checkpoints.jsonl'),JSON.stringify(updated)+'\n');
    }
  }
  await saveReports();
  process.exit(0);
}
const browser = await chromium.launch({headless:true});
async function check(entry) {
  const observations = [];
  for(let attempt=1;attempt<=2;attempt++) {
    const context = await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block',acceptDownloads:false});
    const page = await context.newPage();
    page.setDefaultTimeout(5000);
    const folder = join(out,'evidence',session,`row-${entry.row}-attempt-${attempt}`);
    await mkdir(folder,{recursive:true});
    const obs = {attempt,startedAt:new Date().toISOString(),responses:[],requestFailures:[],blockedMethods:[],text:'',title:'',links:[],headings:[],httpStatus:null,error:null};
    await context.route('**/*',route => {
      if (!['GET','HEAD'].includes(route.request().method())) { obs.blockedMethods.push({method:route.request().method(),url:route.request().url()}); return route.abort('blockedbyclient'); }
      return route.continue();
    });
    page.on('dialog',d=>d.dismiss().catch(()=>{}));
    page.on('response',r=>{if(r.request().isNavigationRequest())obs.responses.push({url:r.url(),status:r.status(),location:r.headers().location || null});});
    page.on('requestfailed',r=>{if(r.isNavigationRequest())obs.requestFailures.push({url:r.url(),error:r.failure()?.errorText});});
    try {
      const response = await page.goto(entry.navigationUrl || entry.originalUrl,{waitUntil:'domcontentloaded',timeout:20000});
      obs.httpStatus = response?.status() ?? null;
      await page.waitForTimeout(2200);
    } catch(e) {obs.error = e.message.slice(0,1200); obs.httpStatus = obs.responses.at(-1)?.status ?? null;}
    obs.browserUrl = page.url();
    obs.finalUrl = /^https?:\/\//i.test(obs.browserUrl) ? obs.browserUrl : '';
    try {
      const dom = await bounded(page.evaluate(()=>({title:document.title,text:document.body?.innerText || '',headings:[...document.querySelectorAll('h1,h2,[role=heading]')].filter(e=>e.getClientRects().length).map(e=>e.innerText).slice(0,40),links:[...document.querySelectorAll('a[href]')].filter(e=>e.getClientRects().length).map(e=>({text:e.innerText.slice(0,200),href:e.href})).slice(0,2000),captchaVisible:[...document.querySelectorAll('iframe[src*=captcha],iframe[src*=challenge],.g-recaptcha,.h-captcha,.cf-turnstile')].some(e=>e.getBoundingClientRect().height>10)})),8000,'Visible content capture');
      Object.assign(obs,dom);
    }catch(e){obs.captureError=e.message.slice(0,500);}
    obs.browserUrl = page.url();
    obs.finalUrl = /^https?:\/\//i.test(obs.browserUrl) ? obs.browserUrl : '';
    obs.httpStatus = obs.responses.findLast(r=>r.url===obs.finalUrl)?.status ?? obs.httpStatus;
    try {await page.screenshot({path:join(folder,'screenshot.png'),timeout:6000});obs.screenshot=join(folder,'screenshot.png');}catch(e){obs.screenshotError=e.message.slice(0,500);}
    obs.classification = classify(obs,inventory.identity,entry.referenceOnly);
    obs.verifiedAt = new Date().toISOString();
    obs.evidencePath = folder;
    await writeFile(join(folder,'visible-text.txt'),obs.text);
    await writeFile(join(folder,'observation.json'),JSON.stringify(obs,null,2));
    try { await bounded(context.close(),8000,'Browser context cleanup'); } catch(e) { console.warn(e.message); }
    observations.push(obs);
    if(!obs.error && !obs.captureError && ![429,500,502,503,504].includes(obs.httpStatus)) break;
    if(attempt===1)await pause(2500);
  }
  const last = observations.at(-1);
  const result = {...entry,...last.classification,finalUrl:last.finalUrl,httpStatus:last.httpStatus,title:last.title,verifiedAt:last.verifiedAt,evidencePath:last.evidencePath,screenshot:last.screenshot || '',attemptCount:observations.length,errors:observations.flatMap(o=>[o.error,o.captureError,o.screenshotError].filter(Boolean)),redirects:last.responses,verifierVersion:version};
  results.set(key(entry),result);
  await appendFile(join(out,'checkpoints.jsonl'),JSON.stringify(result)+'\n');
  console.log(`Row ${entry.row} ${result.classification} HTTP ${result.httpStatus} (${results.size}/${inventory.entries.length})`);
}

try {
  const pending = inventory.entries.filter(e=>!results.has(key(e)));
  console.log(`Full run: ${inventory.entries.length} rows, ${results.size} completed, ${pending.length} pending.`);
  for(let offset=0;offset<pending.length && !stopping;offset+=12) {
    const batch = pending.slice(offset,offset+12);
    for(let i=0;i<batch.length && !stopping;i+=3) {
      const settled = await Promise.allSettled(batch.slice(i,i+3).map(check));
      for(let j=0;j<settled.length;j++)if(settled[j].status==='rejected') {
        const entry=batch[i+j];
        console.error(`Row ${entry.row} check error: ${settled[j].reason}`);
        const result={...entry,classification:'NEEDS_REVIEW',reason:'Verifier/browser error; evidence incomplete. Retry this row.',attemptCount:1,errors:[String(settled[j].reason)],verifiedAt:new Date().toISOString(),verifierVersion:version};
        results.set(key(entry),result);await appendFile(join(out,'checkpoints.jsonl'),JSON.stringify(result)+'\n');
      }
    }
    await saveReports();
    if(offset+12<pending.length && !stopping)await pause(1500);
  }
} finally { await browser.close(); await saveReports(); }
