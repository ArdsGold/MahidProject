import assert from 'node:assert/strict';
import {mkdir,mkdtemp} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium} from 'playwright';

// User-listed native controls reconstructed offline, not screenshots/live captured editors.
await mkdir('extension/test/.tmp',{recursive:true});
const dir=await mkdtemp(resolve('extension/test/.tmp/smart-edit-'));
const context=await chromium.launchPersistentContext(dir,{channel:'chromium',headless:true,ignoreDefaultArgs:['--disable-extensions'],args:['--enable-unsafe-extension-debugging']});
let body='',writes=0,unexpected=0;
const origin='https://locallived.com';
const profile={id:'active-kraken',businessName:'Kraken Junk Removal',firstName:'Kraken',lastName:'Removal',email:'saved@example.test',
 username:'saved-user',password:'synthetic-unbound-password',phone:'555-0199',mobile:'555-0188',address:'100 Saved Street',address2:'Suite 2',
 country:'United States',state:'California',stateCode:'CA',city:'Los Angeles',postalCode:'90001',website:'https://example.test/kraken',
 shortDescription:'  Exact SHORT saved text.\n'+ 'No generated words. '.repeat(12),description:'<p>Exact <strong>LONG</strong> saved text.</p>\n\n<p><a href="https://example.test/service">Saved link</a>.</p>',
 category:'Junk Removal Services',businessHours:['Monday: 8 AM - 5 PM','Tuesday: 9 AM - 4 PM'],latitude:'34.0123',longitude:-118.1234,
 socialLinks:['facebook','linkedin','twitter','instagram'].map(platform=>({platform,url:`https://${platform}.com/saved-business`})),updatedAt:'2026-10-21-edit'};
const witness=`<script>window.actions={submit:0,human:0,locations:[],include:0};document.addEventListener('submit',e=>{e.preventDefault();window.actions.submit++});
for(const type of ['input','change','focus','blur','click'])for(const el of document.querySelectorAll('.captcha,#terms,#photo,#upload,#save'))el.addEventListener(type,()=>window.actions.human++);
document.querySelectorAll('[name=include]').forEach(el=>el.addEventListener('change',()=>window.actions.include++));</script>`;
const input=(label,id,value='')=>`<label>${label}<input id="${id}" value="${value}"></label>`;
const registration=`<h1>Registration</h1><form>${input('First Name','first')}${input('Last Name','last')}<label>Email<input type="email" id="email"></label>
<label>Password<input type="password" id="password"></label><label>Confirm Password<input type="password" id="confirm"></label>
<label>How did you hear about us?<select id="referral"><option value="">Select</option><option value="g">Google</option></select></label>
<div class="captcha"><input id="captcha"></div><input type="checkbox" id="terms"><button id="save">Register</button></form>`;
const edit=`<h1>Edit Directory Listing</h1><form id="listing-form">
<label>Category<select id="category"><option value="old">Glass</option><option value="live-junk">Junk Hauling</option><option value="live-roof">Roofing</option></select></label>
${input('Title','title','Vista Glass Sahuarita')}${input('Attachment Title','attachment-title','Vista Attachment')}
<label>Short Description<textarea id="short">Old short</textarea></label><label>Description<textarea id="long">Old long</textarea></label>
<fieldset><legend>Include Profile With Listing</legend><label><input type="radio" name="include" id="yes" value="site-yes">Yes</label><label><input type="radio" name="include" id="no" value="site-no" checked>No</label></fieldset>
${input('Organization','organization','Vista Glass')}${input('First Name','first','Vista Glass')}${input('Last Name','last','Sahuarita')}
<label>Country<select id="country"><option value="old-country">Canada</option><option value="live-us">United States</option></select></label>
<label>State/Region<select id="state"><option value="old-state">Ontario</option></select></label>
<label>City<select id="city"><option value="old-city">Toronto</option></select></label>
${input('Street Address','address','Old address')}${input('Address Line 2','address2','Old suite')}${input('ZIP','zip','Old ZIP')}
${input('Phone','phone','Old phone')}${input('Mobile Phone','mobile','Old mobile')}${input('Website','website','https://old.example')}${input('Email','email','old@example.test')}
${['facebook','linkedin','twitter','instagram'].map(p=>input(p,p,'https://old.example/'+p)).join('')}
<label>Hours<textarea id="hours">Old hours</textarea></label>${input('Latitude','latitude','1')}${input('Longitude','longitude','2')}
${input('Username','username','unrelated-account')}<label>Password<input id="password" type="password" value="human-password"></label>
<label>Confirm Password<input id="confirm" type="password"></label><input type="file" id="photo"><input type="file" id="upload"><input type="checkbox" id="terms">
<div class="captcha"><input id="captcha"></div><button id="save">Save</button></form>
<script>document.getElementById('country').addEventListener('change',()=>{window.actions.locations.push('country');setTimeout(()=>{document.getElementById('state').innerHTML='<option value="">Select State</option><option value="live-ca">California</option>'},100)});
document.getElementById('state').addEventListener('change',()=>{window.actions.locations.push('state');setTimeout(()=>{document.getElementById('city').innerHTML='<option value="">Select City</option><option value="live-la">Los Angeles</option>'},100)});
document.getElementById('city').addEventListener('change',()=>window.actions.locations.push('city'));</script>`;
try{
 await context.route(/^https?:\/\//,route=>{if(route.request().method()!=='GET'){writes++;return route.abort()}if(route.request().resourceType()!=='document')return route.fulfill({body:''});if(route.request().url().startsWith(origin+'/'))return route.fulfill({contentType:'text/html',body:body+witness});unexpected++;return route.abort()});
 const cdp=await context.browser().newBrowserCDPSession(),pending=context.waitForEvent('serviceworker');const{id}=await cdp.send('Extensions.loadUnpacked',{path:resolve('extension/dist')});
 const worker=await pending,page=context.pages()[0],popup=await context.newPage();await popup.goto(`chrome-extension://${id}/popup/popup.html`);
 const seed=async(active=profile)=>worker.evaluate(async p=>chrome.storage.local.set({'ba2.activeProfile':{profile:p,source:'local-storage',syncedAt:'fixture'},'ba2.listingRun':{id:'preserved',sourceUrl:'https://other.example',stage:'MANUAL_GATE',steps:[],manual:[]},'ba2.directory3.receipt:preserved':{outcome:'keep'}}),active);
 const snapshot=()=>worker.evaluate(async()=>JSON.stringify(await chrome.storage.local.get(null)));
 const fill=async()=>{await page.bringToFront();return popup.evaluate(()=>chrome.runtime.sendMessage({type:'BA2_START_LISTING_AUTOFILL'}))};
 const safe=async()=>{assert.equal(writes,0);assert.equal(unexpected,0);assert.equal(await page.evaluate(()=>window.actions.submit),0);assert.equal(await page.evaluate(()=>window.actions.human),0)};
 await seed();if(!process.argv.includes('--edit-only')){body=registration;await page.goto(origin+'/directory/register.aspx');const before=await snapshot();const registered=await fill();
 assert.equal(await page.locator('#first').inputValue(),profile.firstName);assert.equal(await page.locator('#last').inputValue(),profile.lastName);
 assert.equal(await page.locator('#email').inputValue(),profile.email,'Registration public contact email needs no password proof');
 assert.equal(await page.locator('#password').inputValue(),'');assert.equal(await page.locator('#confirm').inputValue(),'');assert.equal(await page.locator('#referral').inputValue(),'');
 assert.match(registered.message,/Credentials:/);assert.equal(await snapshot(),before);await safe();
 console.log('PASS Registration saved names/email filled without unbound passwords or guessed referral; no profile/history writes');
 }

 for(const heading of ['Edit Directory Listing','Profile Update']){
  body=edit.replace('Edit Directory Listing',heading);await page.goto(origin+'/directory/'+(heading==='Profile Update'?'profileupdate':'listingedit')+'.aspx');
  const data=await snapshot();await fill();
  for(const[field,value]of Object.entries({category:'live-junk',title:profile.businessName,'attachment-title':profile.businessName,organization:profile.businessName,
   first:profile.firstName,last:profile.lastName,short:profile.shortDescription,long:profile.description,country:'live-us',state:'live-ca',city:'live-la',
   address:profile.address,address2:profile.address2,zip:profile.postalCode,phone:profile.phone,mobile:profile.mobile,website:profile.website,email:profile.email,
   hours:profile.businessHours.join('\n'),latitude:profile.latitude,longitude:String(profile.longitude),...Object.fromEntries(profile.socialLinks.map(s=>[s.platform,s.url]))}))assert.equal(await page.locator('#'+field).inputValue(),value,heading+': '+field);
  assert.equal(await page.locator('#yes').isChecked(),true);assert.equal(await page.locator('#username').inputValue(),'unrelated-account');assert.equal(await page.locator('#password').inputValue(),'human-password');assert.equal(await page.locator('#confirm').inputValue(),'');
  assert.deepEqual(await page.evaluate(()=>window.actions.locations),['country','state','city']);const include=await page.evaluate(()=>window.actions.include);
  await fill();assert.equal(await page.evaluate(()=>window.actions.include),include);assert.deepEqual(await page.evaluate(()=>window.actions.locations),['country','state','city']);
  assert.equal(await snapshot(),data);await safe();
 }
 console.log('PASS edit/profile replace outdated business data, distinct exact descriptions, live category, dependent locations, Yes radio, saved optional data; accounts/passwords/uploads/human controls/history protected');

 const missing={...profile,id:'missing',businessName:'Different Saved Business',firstName:'Other',lastName:'Person',category:'Roofing Contractor',
 shortDescription:'',description:'',email:'',phone:'',mobile:'',address:'',address2:'',country:'',state:'',stateCode:'',city:'',postalCode:'',website:'',businessHours:[],latitude:'',longitude:'',socialLinks:[]};
 await seed(missing);body=edit;await page.reload();const data=await snapshot();await fill();
 assert.equal(await page.locator('#category').inputValue(),'live-roof');assert.equal(await page.locator('#title').inputValue(),missing.businessName);
 assert.equal(await page.locator('#first').inputValue(),'Other');assert.equal(await page.locator('#last').inputValue(),'Person');
 for(const[field,value]of Object.entries({short:'Old short',long:'Old long',country:'old-country',state:'old-state',city:'old-city',address:'Old address',address2:'Old suite',zip:'Old ZIP',phone:'Old phone',mobile:'Old mobile',website:'https://old.example',email:'old@example.test',hours:'Old hours',latitude:'1',longitude:'2'}))assert.equal(await page.locator('#'+field).inputValue(),value,field);
 for(const platform of ['facebook','linkedin','twitter','instagram'])assert.equal(await page.locator('#'+platform).inputValue(),'https://old.example/'+platform);
 assert.equal(await snapshot(),data);await safe();console.log('PASS different active profile/live category and missing saved values preserve every corresponding existing field');

 await seed({...profile,listingTitle:'Saved Directory Listing Title',latitude:'91',longitude:'181'});body=edit;await page.reload();await fill();
 assert.equal(await page.locator('#title').inputValue(),'Saved Directory Listing Title');assert.equal(await page.locator('#organization').inputValue(),profile.businessName);
 assert.equal(await page.locator('#attachment-title').inputValue(),profile.businessName);assert.equal(await page.locator('#latitude').inputValue(),'1');assert.equal(await page.locator('#longitude').inputValue(),'2');await safe();
 await seed({...profile,category:'HVAC Services'});body=edit.replace('Include Profile With Listing','Display Organization Details');await page.reload();const unmatched=await fill();
 assert.equal(await page.locator('#category').inputValue(),'old');assert.match(unmatched.message,/Category:/);assert.equal(await page.locator('#no').isChecked(),true);await safe();
 await seed({...missing,businessName:'',firstName:'',lastName:''});body=edit;await page.reload();await fill();
 assert.equal(await page.locator('#title').inputValue(),'Vista Glass Sahuarita');assert.equal(await page.locator('#attachment-title').inputValue(),'Vista Attachment');
 assert.equal(await page.locator('#organization').inputValue(),'Vista Glass');assert.equal(await page.locator('#first').inputValue(),'Vista Glass');assert.equal(await page.locator('#last').inputValue(),'Sahuarita');await safe();
 console.log('PASS saved listing title scoped correctly, invalid coordinates refused, unmatched category/non-profile radio untouched, missing business identity never erases fields');

 body=edit.replace('Edit Directory Listing','Add Business Listing').replace(/<label>Username[\s\S]*?<\/label>|<label>Password[\s\S]*?<\/label>|<label>Confirm Password[\s\S]*?<\/label>/g,'');await seed();await page.goto(origin+'/directory/listing.aspx');await fill();
 assert.equal(await page.locator('#title').inputValue(),'Vista Glass Sahuarita');assert.equal(await page.locator('#phone').inputValue(),'Old phone');await safe();
 console.log('PASS ordinary create-listing forms keep existing-value protection');
}finally{await context.close()}
