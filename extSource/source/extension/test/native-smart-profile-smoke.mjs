import assert from 'node:assert/strict';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

// User-listed controls reconstructed offline, not captured authenticated LocalPartnered markup.
await mkdir('extension/test/.tmp', { recursive: true });
const dir = await mkdtemp(resolve('extension/test/.tmp/smart-profile-'));
const context = await chromium.launchPersistentContext(dir, { channel: 'chromium', headless: true,
  ignoreDefaultArgs: ['--disable-extensions'], args: ['--enable-unsafe-extension-debugging'] });
const origin = 'https://localpartnered.com', url = origin + '/directory/profileupdate.aspx';
const profile = { id: 'smart-profile-active', businessName: 'Saved Active Organization', firstName: 'Saved', lastName: 'Person',
  email: 'saved@example.test', username: 'saved-user', password: 'synthetic-site-only', phone: '702-800-0506',
  website: 'https://example.test/business', address: '100 Saved Street', address2: 'Suite 205', mobile: '702-555-0199',
  country: 'United States', state: 'Nevada', stateCode: 'NV', city: 'Las Vegas', postalCode: '89101',
  shortDescription: '  Exact short description.  Preserve spacing.\nSecond line with & symbols.\n' + 'Saved words only. '.repeat(15),
  description: '<p>LONG DESCRIPTION MUST NOT APPEAR IN YOUR PROFILE.</p>', category: 'Plumbing Services',
  socialLinks: [{ platform: 'facebook', url: 'https://www.facebook.com/saved-business' },
    { platform: 'linkedin', url: 'https://www.linkedin.com/company/saved-business' },
    { platform: 'twitter', url: 'https://x.com/saved-business' },
    { platform: 'instagram', url: 'https://www.instagram.com/saved-business' }], updatedAt: '2026-10-21-profile-test' };
const fixture = `<h1>Profile Update</h1><form method="post" id="profile-form">
  <label>First Name<input name="ctl00$Main$FirstName" id="first"></label><label>Last Name<input name="lastName" id="last"></label>
  <label>Email<input type="email" id="email"></label><label>Organization<input id="organization"></label>
  <label>City<select id="city" disabled><option value="">Select City</option></select></label>
  <label>State/Region<select id="state" disabled><option value="">Select State</option></select></label>
  <label>Country<select id="country"><option value="">Select Country</option><option value="country-live">United States</option></select></label>
  <label>Street Address<input id="street"></label><label>Address Line 2<input id="address2"></label>
  <label>Postal Code<input id="postal"></label><label>Phone<input id="phone" type="tel"></label>
  <label>Mobile Phone<input id="mobile" type="tel"></label><label>Website<input type="url" id="website"></label>
  <label>Facebook URL<input id="facebook" type="url"></label><label>LinkedIn<input id="linkedin"></label>
  <label>Twitter<input id="twitter"></label><label>Instagram<input id="instagram"></label>
  <label>Your Profile<textarea id="your-profile"></textarea></label>
  <label>Password<input type="password" id="password"></label><label>Re-Enter Password<input type="password" id="confirm-password"></label>
  <label>New Password<input type="password" id="new-password"></label>
  <input type="file" id="photo"><input type="file" id="logo"><input type="checkbox" id="terms">
  <div class="captcha"><input id="captcha"></div><button type="submit" id="save">Save</button>
</form><script>
window.actions={locations:[],human:0,submits:0};
document.addEventListener('submit', e=>{e.preventDefault();window.actions.submits++});
for(const type of ['input','change','click','focus','blur']) for(const el of document.querySelectorAll('.captcha,#captcha,#photo,#logo,#terms,#save')) el.addEventListener(type,()=>window.actions.human++);
document.getElementById('country').addEventListener('change',()=>{
  window.actions.locations.push('country');
  setTimeout(()=>{document.getElementById('state').outerHTML='<select id="state"><option value="">Select State</option><option value="state-live">Nevada</option></select>';
  document.getElementById('state').addEventListener('change',()=>{
    window.actions.locations.push('state');
    setTimeout(()=>{document.getElementById('city').outerHTML='<select id="city"><option value="">Select City</option><option value="city-live">Las Vegas</option></select>';
    document.getElementById('city').addEventListener('change',()=>window.actions.locations.push('city'));},160);
  });},160);
});
</script>`;
let body = fixture, writes = 0, unexpected = 0;
try {
  await context.route(/^https?:\/\//, route => {
    if (route.request().method() !== 'GET') { writes++; return route.abort(); }
    if (route.request().resourceType() !== 'document') return route.fulfill({ body: '' });
    if (route.request().url().startsWith(origin + '/')) return route.fulfill({ contentType: 'text/html', body });
    unexpected++; return route.abort();
  });
  const cdp = await context.browser().newBrowserCDPSession(), pending = context.waitForEvent('serviceworker');
  const { id } = await cdp.send('Extensions.loadUnpacked', { path: resolve('extension/dist') });
  const worker = await pending, page = context.pages()[0], popup = await context.newPage();
  await popup.goto(`chrome-extension://${id}/popup/popup.html`);
  const seed = async (active = profile, siteProof = false) => worker.evaluate(async ({ active, siteProof, origin }) => {
    await chrome.storage.local.remove(['ba2.listingRunArchive:profile-proof', `ba2.loginGuard:${origin}:${active.id}`]);
    await chrome.storage.local.set({ 'ba2.activeProfile': { profile: active, source: 'local-storage', syncedAt: 'fixture' },
      'ba2.listingRun': { id: 'historical-preserved', sourceUrl: origin + '/directory/login.aspx', stage: 'MANUAL_GATE', steps: [], manual: ['SIGN IN / LOGIN'] },
      'ba2.directory3.receipt:preserved': { outcome: 'keep' },
      ...(siteProof ? {
        'ba2.listingRunArchive:profile-proof': { id: 'profile-proof', sourceUrl: origin + '/directory/login.aspx', profileId: active.id, autoLogin: true,
          loginApproval: { profileUpdatedAt: active.updatedAt }, login: { url: origin + '/directory/login.aspx', claimed: true, attemptId: 'one-success', state: 'authenticated' } },
        [`ba2.loginGuard:${origin}:${active.id}`]: { runId: 'profile-proof', state: 'authenticated' },
      } : {}) });
  }, { active, siteProof, origin });
  const fill = async () => { await page.bringToFront(); return popup.evaluate(() => chrome.runtime.sendMessage({ type: 'BA2_START_LISTING_AUTOFILL' })); };
  const snapshot = () => worker.evaluate(async () => JSON.stringify(await chrome.storage.local.get(null)));
  const safe = async (expectedUrl = url) => {
    assert.equal(page.url(), expectedUrl); assert.equal(writes, 0); assert.equal(unexpected, 0);
    assert.equal(await page.evaluate(() => window.actions.human), 0); assert.equal(await page.evaluate(() => window.actions.submits), 0);
    for (const field of ['photo', 'logo', 'captcha']) assert.equal(await page.locator('#' + field).inputValue(), '');
  };
  await seed(); await page.goto(url); const before = await snapshot(); const ack = await fill(); assert.equal(ack.ok, true, JSON.stringify(ack));
  // Run first so the pre-change bundle reproduces the reported missing/misbound purpose.
  assert.equal(await page.locator('#your-profile').inputValue(), profile.shortDescription, 'Your Profile must be exact saved Short Description, over160 chars included');
  for (const [field, expected] of Object.entries({ first: profile.firstName, last: profile.lastName, email: profile.email, organization: profile.businessName,
    country: 'country-live', state: 'state-live', city: 'city-live', street: profile.address, address2: profile.address2,
    postal: profile.postalCode, phone: profile.phone, mobile: profile.mobile, website: profile.website,
    ...Object.fromEntries(profile.socialLinks.map(link => [link.platform, link.url])) })) {
    assert.equal(await page.locator('#' + field).inputValue(), expected, field);
  }
  assert.deepEqual(await page.evaluate(() => window.actions.locations), ['country', 'state', 'city']);
  for (const field of ['password', 'confirm-password', 'new-password']) assert.equal(await page.locator('#' + field).inputValue(), '');
  assert.match(ack.message, /Credentials:/); assert.equal(await snapshot(), before); await safe();
  console.log('PASS representative Profile Update: all requested saved fields/socials, exact Short Description, delayed replaced Country-State-City, unbound passwords/uploads/Save/CAPTCHA manual, no storage writes');

  // Omit explicit password-change field: ordinary existing-site password pair may use proven credentials.
  body = fixture.replace('<label>New Password<input type="password" id="new-password"></label>', '');
  await seed(profile, true); await page.reload(); const provenBefore = await snapshot(); await fill();
  assert.equal(await page.locator('#password').inputValue(), profile.password); assert.equal(await page.locator('#confirm-password').inputValue(), profile.password);
  assert.equal(await snapshot(), provenBefore); await safe();
  await page.evaluate(() => { document.getElementById('phone').value='human-phone'; document.getElementById('your-profile').value='human summary'; document.getElementById('facebook').value='https://facebook.com/human'; });
  await fill(); assert.equal(await page.locator('#phone').inputValue(), profile.phone); assert.equal(await page.locator('#your-profile').inputValue(), profile.shortDescription);
  assert.equal(await page.locator('#facebook').inputValue(), profile.socialLinks.find(s => s.platform === 'facebook').url);
  assert.deepEqual(await page.evaluate(() => window.actions.locations), ['country', 'state', 'city']); await safe();
  console.log('PASS applicable site-specific password pair only; active business values replace existing data and no repeated location events');

  const missing = { ...profile, id: 'different-active', firstName: '', lastName: '', address2: '', mobile: '', shortDescription: '',
    socialLinks: [], facebook: '', linkedin: '', twitter: '', instagram: '' };
  await seed(missing); await page.reload(); const missingBefore = await snapshot(); await fill();
  for (const field of ['first', 'last', 'address2', 'mobile', 'your-profile', 'facebook', 'linkedin', 'twitter', 'instagram', 'password', 'confirm-password'])
    assert.equal(await page.locator('#' + field).inputValue(), '', field);
  assert.equal(await page.locator('#phone').inputValue(), profile.phone); assert.equal(await snapshot(), missingBefore); await safe();
  console.log('PASS missing optional values remain manual; no phone/mobile, long/short, personal-name or previous-profile substitution');

  const legacy = { ...profile, id: 'legacy-optional', mobile: '', mobilePhone: '702-555-0123', socialLinks: [],
    facebook: 'https://facebook.com/legacy', linkedin: 'https://linkedin.com/company/legacy', twitter: 'https://twitter.com/legacy', instagram: 'https://instagram.com/legacy' };
  await seed(legacy); await page.reload(); await fill();
  assert.equal(await page.locator('#mobile').inputValue(), legacy.mobilePhone);
  for (const platform of ['facebook', 'linkedin', 'twitter', 'instagram']) assert.equal(await page.locator('#' + platform).inputValue(), legacy[platform]);
  await safe();

  body = fixture.replace('Facebook URL<input id="facebook" type="url"', 'Facebook Email<input id="facebook" type="email"')
    .replace('id="mobile" type="tel"', 'id="mobile" type="email"')
    .replace('<label>LinkedIn<input id="linkedin"></label>', '<label>Social URL<input id="generic-social" type="url" name="social"></label>');
  await seed(); await page.reload(); await fill();
  assert.equal(await page.locator('#facebook').inputValue(), ''); assert.equal(await page.locator('#mobile').inputValue(), '');
  assert.equal(await page.locator('#generic-social').inputValue(), ''); await safe();
  console.log('PASS legacy optional/mobilePhone and social URLs; conflicting social/email and mobile/email controls refused');

  // A changed active profile while options load must stop without using the stale snapshot.
  body = fixture.replace('},160);', '},800);'); await seed(); await page.reload();
  const pendingFill = fill(); await page.waitForFunction(() => window.actions.locations.includes('country'));
  await worker.evaluate(async active => chrome.storage.local.set({ 'ba2.activeProfile': { profile: { ...active, id: 'switched-while-waiting' }, source: 'local-storage', syncedAt: 'fixture' } }), profile);
  const changed = await pendingFill; assert.equal(changed.ok, true, JSON.stringify(changed));
  assert.equal(await page.locator('#organization').inputValue(), ''); assert.equal(await page.locator('#phone').inputValue(), '');
  assert.equal(await page.locator('#state').inputValue(), ''); await safe();
  console.log('PASS active-profile change during dependent wait stops stale field writes');

  // No choices arriving must terminate and continue ordinary fields without replaying parent changes.
  body = fixture.replace(/setTimeout\(\(\)=>\{document.getElementById\('state'\)[\s\S]*?\},160\);\n\}\);/, '/* no dependent response */\n});');
  await seed(); await page.reload(); const began = Date.now(); await fill();
  assert.ok(Date.now() - began < 10000, 'bounded dependent wait');
  assert.equal(await page.locator('#state').inputValue(), ''); assert.equal(await page.locator('#city').inputValue(), '');
  assert.equal(await page.locator('#organization').inputValue(), profile.businessName);
  assert.deepEqual(await page.evaluate(() => window.actions.locations), ['country']); await safe();
  console.log('PASS missing dependent options remain manual after bounded wait; other fields fill, no repeated location events');

  const names = { ...profile, id: 'kraken-names', businessName: 'Kraken Junk Removal', firstName: 'Kraken', lastName: 'Removal' };
  const nameForm = (kind, first = '', last = '') => `<h1>${kind}</h1><form method="post">
    <label>First Name<input id="first" name="ctl00$PageContent$FirstName" value="${first}"></label>
    <label>Last Name<input id="last" name="ctl00$PageContent$LastName" value="${last}"></label>
    <label>Organization<input id="organization" name="organization"></label>
    <label>Phone<input id="phone" name="phone" value="human-phone"></label>
    <label>Email<input id="email" type="email" value="human@example.test"></label>
    <label>Your Profile<textarea id="your-profile">Existing summary</textarea></label>
    <label>Password<input id="password" type="password" value="human-password"></label>
    <label>Re-Enter Password<input id="confirm-password" type="password"></label>
    <input type="file" id="photo"><input type="file" id="logo"><input type="checkbox" id="terms"><div class="captcha"><input id="captcha"></div><button id="save">Save</button>
    </form><script>window.actions={human:0,submits:0,nameChanges:[]};document.addEventListener('submit',e=>{e.preventDefault();window.actions.submits++});
    for(const type of ['input','change','focus','click','blur'])for(const el of document.querySelectorAll('.captcha,#captcha,#photo,#logo,#terms,#save,#password,#confirm-password'))el.addEventListener(type,()=>window.actions.human++);
    document.addEventListener('change',e=>{if(['first','last'].includes(e.target.id))window.actions.nameChanges.push(e.target.id)});</script>`;
  await seed(names); body = nameForm('Registration'); await page.reload(); const registrationData = await snapshot(); await fill();
  assert.equal(await page.locator('#first').inputValue(), names.firstName); assert.equal(await page.locator('#last').inputValue(), names.lastName);
  assert.equal(await snapshot(), registrationData); await safe();
  console.log('PASS Registration still fills explicit saved Kraken/Removal into empty name fields');

  for (const active of [names, { ...names, id: 'other-names', businessName: 'Different Business', firstName: 'Alice', lastName: 'Bennett' }]) {
    await seed(active); body = nameForm('Profile Update', 'Vista Glass', 'Sahuarita'); await page.reload();
    assert.equal(await page.locator('#first').inputValue(), 'Vista Glass'); assert.equal(await page.locator('#last').inputValue(), 'Sahuarita');
    assert.equal(await page.locator('#first').evaluate(el => el.defaultValue), 'Vista Glass', 'Known prefill fixture');
    const data = await snapshot(); await fill();
    assert.equal(await page.locator('#first').inputValue(), active.firstName); assert.equal(await page.locator('#last').inputValue(), active.lastName);
    assert.equal(await page.locator('#organization').inputValue(), active.businessName);
    assert.equal(await page.locator('#phone').inputValue(), active.phone); assert.equal(await page.locator('#email').inputValue(), active.email);
    assert.equal(await page.locator('#your-profile').inputValue(), active.shortDescription); assert.equal(await page.locator('#password').inputValue(), 'human-password');
    assert.equal(await page.locator('#confirm-password').inputValue(), '');
    const changes = await page.evaluate(() => window.actions.nameChanges); assert.deepEqual(changes, ['first', 'last']);
    await fill(); assert.deepEqual(await page.evaluate(() => window.actions.nameChanges), changes, 'Equal saved names need no replay');
    assert.equal(await snapshot(), data); await safe();
  }
  console.log('PASS Profile Update replaces pre-existing Vista Glass/Sahuarita with active saved data; two profiles, no replay, passwords/history untouched');

  for (const absent of ['', '   ']) {
    await seed({ ...names, firstName: absent, lastName: absent }); body = nameForm('Profile Update', 'Existing First', 'Existing Last'); await page.reload(); await fill();
    assert.equal(await page.locator('#first').inputValue(), 'Existing First'); assert.equal(await page.locator('#last').inputValue(), 'Existing Last'); await safe();
  }
  await seed({ ...names, firstName: 'Kraken', lastName: '' }); await page.reload(); await fill();
  assert.equal(await page.locator('#first').inputValue(), 'Kraken'); assert.equal(await page.locator('#last').inputValue(), 'Existing Last'); await safe();
  await seed(names); body = nameForm('Registration', 'Existing First', 'Existing Last'); await page.reload(); await fill();
  assert.equal(await page.locator('#first').inputValue(), 'Existing First'); assert.equal(await page.locator('#last').inputValue(), 'Existing Last'); await safe();
  body = nameForm('Add Business Listing', 'Existing First', 'Existing Last').replace(/<label>Password[\s\S]*?<\/label>|<label>Re-Enter Password[\s\S]*?<\/label>/g, '');
  const listingUrl = origin + '/directory/listing.aspx'; await page.goto(listingUrl); await fill();
  assert.equal(await page.locator('#first').inputValue(), 'Existing First'); assert.equal(await page.locator('#last').inputValue(), 'Existing Last'); await safe(listingUrl);
  console.log('PASS missing/whitespace/partial saved names never invented; Registration and Business Listing existing-name preservation unchanged');
} finally { await context.close(); }
