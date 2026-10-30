import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

// Packaged MV3, disposable browser, all HTTP intercepted. No live CAPTCHA or submissions.
await mkdir('extension/test/.tmp', { recursive: true });
const dir = await mkdtemp(resolve('extension/test/.tmp/smart-autofill-'));
const context = await chromium.launchPersistentContext(dir, { channel: 'chromium', headless: true,
  ignoreDefaultArgs: ['--disable-extensions'], args: ['--enable-unsafe-extension-debugging'] });
const origin = 'https://unfamiliar-directory.example';
let body = '', nonGets = 0, unexpected = 0;
const businessForm = `<h1>Add Business Listing</h1><form method="post">
  <label for="opaque">Business Name</label><input id="opaque">
  <input id="contact" aria-label="Contact person"><input id="given" name="firstName"><input id="family" placeholder="Last Name">
  <input id="mail" type="email"><input id="phone" type="tel"><input id="web" type="url">
  <label>Short Description<textarea id="summary"></textarea></label><textarea id="long" aria-label="Long Description"></textarea>
  <span id="streetlabel">Street Address</span><input id="street" aria-labelledby="streetlabel">
  <div class="field"><span>Postal Code</span><input id="postal"></div>
  <input id="city" name="city"><input id="state" name="state"><input id="country" name="country">
  <label>Category<select id="industry"><option value="">--- Select One ---</option><option value="p-live">Plumbing</option><option value="r-live">Roofing</option><option value="j-live">Junk Hauling</option><option value="h-live">HVAC</option></select></label>
  <input id="uncertain" placeholder="Code"><input id="conflicting" aria-label="Email" name="phone">
  <input id="wrongtype" type="email" aria-label="Business Name"><input id="imageurl" type="url" aria-label="Image URL">
  <input id="hidden" name="business_name" hidden><input id="readonly" name="business_name" readonly>
  <div class="captcha"><input id="captcha" aria-label="Business name"><button type="button">CAPTCHA</button></div>
  <textarea name="g-recaptcha-response" hidden></textarea><input id="terms" type="checkbox"><input id="photo" type="file">
  <button type="submit">Continue</button></form>`;
const witness = `<script>window.actions={submit:0,human:0,blur:0,escaped:0};
document.addEventListener('submit',e=>{e.preventDefault();window.actions.submit++});
for(const type of ['input','change','focus','click']) document.querySelectorAll('.captcha,[data-sitekey],#terms,#photo').forEach(el=>el.addEventListener(type,()=>window.actions.human++));
document.addEventListener('blur',()=>window.actions.blur++,true);
document.addEventListener('click',e=>{if(e.target.id==='ba2-floating-autofill')window.actions.escaped++});</script>`;
const base = { id: 'smart-active', businessName: 'Active Plumbing Business', contactName: 'Saved Contact', firstName: 'Saved', lastName: 'Owner',
  email: 'saved@example.test', phone: '702-800-0506', website: 'https://example.test/business', shortDescription: 'Short saved summary.',
  description: '<p>Long saved description.</p>', address: '100 Saved St', city: 'Las Vegas', state: 'Nevada', stateCode: 'NV',
  postalCode: '89101', country: 'United States', category: 'Plumbing Services', password: 'synthetic-do-not-copy', updatedAt: '2026-10-21' };
try {
  await context.route(/^https?:\/\//, route => {
    const req = route.request();
    if (req.method() !== 'GET') { nonGets++; return route.abort(); }
    if (req.resourceType() !== 'document') return route.fulfill({ body: '' });
    if ([origin, 'https://expansiondirectory.com', 'https://businessizze.com'].some(host => req.url().startsWith(host + '/'))) return route.fulfill({ contentType: 'text/html', body: body + witness });
    unexpected++; return route.abort();
  });
  const cdp = await context.browser().newBrowserCDPSession(), pending = context.waitForEvent('serviceworker');
  const { id } = await cdp.send('Extensions.loadUnpacked', { path: resolve('extension/dist') });
  const worker = await pending, page = context.pages()[0], popup = await context.newPage();
  await popup.goto(`chrome-extension://${id}/popup/popup.html`);
  await worker.evaluate(async profile => chrome.storage.local.set({
    'ba2.activeProfile': { profile, source: 'local-storage', syncedAt: 'fixture' },
    'ba2.listingRun': { id: 'preserve', sourceUrl: 'https://unfamiliar-directory.example/login', domain: 'unfamiliar-directory.example', tabId: 999,
      autoLogin: true, autoRegister: true, autoPublish: true, stage: 'MANUAL_GATE', steps: [], manual: ['SIGN IN / LOGIN'] },
    'ba2.loginGuard:preserved': { state: 'uncertain' }, 'ba2.directory3.receipt:preserved': { outcome: 'keep' },
  }), base);
  const fill = async () => {
    await page.bringToFront();
    return popup.evaluate(() => chrome.runtime.sendMessage({ type: 'BA2_START_LISTING_AUTOFILL', continuous: true }));
  };
  const verifySafety = async () => {
    assert.deepEqual(await page.evaluate(() => window.actions), { submit: 0, human: 0, blur: 0, escaped: 0 });
    assert.equal(nonGets, 0); assert.equal(unexpected, 0);
  };
  body = businessForm; await page.goto(origin + '/add'); await page.locator('#ba2-floating-autofill').waitFor();
  assert.match(await page.locator('#ba2-floating-autofill').locator('[role=status]').textContent(), /Fill the current form only/);
  const before = await worker.evaluate(async () => JSON.stringify(await chrome.storage.local.get(null)));
  const ack = await fill(); assert.equal(ack.ok, true, JSON.stringify(ack)); assert.match(ack.message, /filled only/);
  for (const [selector, value] of [['#opaque', base.businessName], ['#contact', base.contactName], ['#given', base.firstName], ['#family', base.lastName],
    ['#mail', base.email], ['#phone', base.phone], ['#web', base.website], ['#summary', base.shortDescription], ['#long', 'Long saved description.'],
    ['#street', base.address], ['#postal', base.postalCode], ['#city', base.city], ['#state', base.state], ['#country', base.country], ['#industry', 'p-live']]) {
    assert.equal(await page.locator(selector).inputValue(), value, selector);
  }
  for (const selector of ['#uncertain', '#conflicting', '#wrongtype', '#imageurl', '#hidden', '#readonly', '#captcha']) assert.equal(await page.locator(selector).inputValue(), '', selector);
  await verifySafety();
  assert.equal(await worker.evaluate(async () => JSON.stringify(await chrome.storage.local.get(null))), before);
  await page.locator('#phone').fill('human-existing'); await page.evaluate(() => { window.actions.blur = 0; });
  await fill(); assert.equal(await page.locator('#phone').inputValue(), 'human-existing');
  assert.equal(page.url(), origin + '/add');
  console.log('PASS unknown form: labels/name/id/placeholder/types/ARIA/nearby context; all business slots, exact active data, conflicts/hidden/read-only untouched, existing values preserved, no actions/storage changes');

  // Fresh forms with fresh live values: active profile, not a remembered category/site ID.
  for (const [category, label] of [['Junk Removal Services', 'Junk Hauling'], ['Roofing Contractor', 'Roofing'], ['HVAC Services', 'HVAC'], ['Plumbing Services', 'Plumbing']]) {
    const profile = { ...base, id: category, businessName: `Active ${category}`, category };
    await worker.evaluate(async profile => chrome.storage.local.set({ 'ba2.activeProfile': { profile, source: 'local-storage', syncedAt: 'fixture' } }), profile);
    body = businessForm.replaceAll('p-live', 'new-plumbing').replaceAll('r-live', 'new-roofing').replaceAll('j-live', 'new-junk').replaceAll('h-live', 'new-hvac');
    await page.reload(); await fill();
    assert.equal(await page.locator('#opaque').inputValue(), profile.businessName);
    assert.equal(await page.locator('#industry option:checked').textContent(), label);
    await verifySafety();
  }
  body = businessForm.replace(/<option value="p-live">Plumbing<\/option>/, ''); await page.reload();
  const none = await fill(); assert.match(none.message, /Category:.*no suitable/i); assert.equal(await page.locator('#industry').inputValue(), '');
  console.log('PASS four active industries, changed live IDs and irrelevant-category refusal');

  // Login/search/payment/contact forms must not be mistaken for directory forms.
  body = `<form role="search"><h2>Business Search</h2><label>Business Name<input id="search"></label><input type=email></form>
    <form><h2>Login</h2><label>Business Name<input id="login"></label><input type=email><input id="password" type=password value="human-password"><button>Sign In</button></form>
    <form><h2>Checkout</h2><label>Business Name<input id="billing"></label><input type=email><input id="cc" autocomplete="cc-number"><button>Pay</button></form>
    <form><h2>Contact Us</h2><label>Business Name<input id="message"></label><input type=email><textarea aria-label="Description"></textarea></form>
    <form><input type=email id="unanchored"><input type=tel></form>`;
  await page.reload(); const unsafe = await fill(); assert.match(unsafe.message, /Credentials:/);
  for (const selector of ['#search', '#login', '#billing', '#cc', '#message', '#unanchored']) assert.equal(await page.locator(selector).inputValue(), '');
  assert.equal(await page.locator('#password').inputValue(), 'human-password'); await verifySafety();
  const unknownTab = await worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url).id, page.url());
  const staleLogin = await popup.evaluate(async ({ tabId, profile, url }) => chrome.tabs.sendMessage(tabId, { type: 'BA2_AUTOFILL',
    loginOnly: { profileId: profile.id, profileUpdatedAt: profile.updatedAt, url } }, { frameId: 0 }), { tabId: unknownTab, profile: base, url: page.url() });
  assert.equal(staleLogin.ok, false); assert.equal(await page.locator('#password').inputValue(), 'human-password');
  body = '<a href="/add">Add Business Listing</a>'; await page.goto(origin + '/'); await fill(); assert.equal(page.url(), origin + '/');
  console.log('PASS login/password/search/payment/contact/unanchored fields untouched; unknown homepage never navigates');

  body = businessForm; await page.goto(origin + '/add');
  await page.locator('#ba2-floating-autofill').locator('button').click();
  await page.waitForFunction(() => document.getElementById('opaque').value === 'Active Plumbing Services');
  await page.waitForTimeout(350); await verifySafety();
  assert.equal(page.url(), origin + '/add');
  console.log('PASS existing floating AUTOFILL on unknown page: trusted gesture isolated, one fill and stop, no navigation or CAPTCHA events');

  body = businessForm.replace('<option value="p-live">Plumbing</option>', '<option value="a">Plumbing</option><option value="b">Plumbing</option>');
  await page.reload(); const ambiguous = await fill(); assert.match(ambiguous.message, /Category:.*ambiguous/i);
  assert.equal(await page.locator('#industry').inputValue(), ''); await verifySafety();
  await worker.evaluate(async profile => chrome.storage.local.set({ 'ba2.activeProfile': { profile: { ...profile, contactName: '', firstName: '', lastName: '' }, source: 'local-storage', syncedAt: 'fixture' } }), base);
  body = businessForm; await page.reload(); await fill(); assert.equal(await page.locator('#contact').inputValue(), '');
  console.log('PASS ambiguous categories and missing contact-person data remain empty; business name is never substituted for a person');
  await worker.evaluate(async profile => chrome.storage.local.set({ 'ba2.activeProfile': { profile: { ...profile, businessName: 'Active Plumbing Services' }, source: 'local-storage', syncedAt: 'fixture' } }), base);

  // Changed Family3 names: native adapter fails; current-page fallback fills safely.
  body = businessForm; await page.goto('https://expansiondirectory.com/submit.php');
  const native = await fill(); assert.equal(native.ok, true, JSON.stringify(native));
  assert.equal(await page.locator('#opaque').inputValue(), 'Active Plumbing Services');
  assert.equal(await page.locator('#industry').inputValue(), 'p-live');
  const run = await worker.evaluate(async () => (await chrome.storage.local.get('ba2.listingRun'))['ba2.listingRun']);
  assert.equal(run.stage, 'MANUAL_GATE', run.error); assert.ok(run.steps.some(step => step.includes('Smart fallback')));
  assert.equal(page.url(), 'https://expansiondirectory.com/submit.php'); await verifySafety();
  console.log('PASS supported Family3 changed selectors reach fallback and stop at manual gate');

  // A recognized Family2 form still uses its established mapping/overwrite behavior.
  body = '<form><label>Business Name<input name="business_name" value="old value"></label><label>Phone<input name="phone"></label></form>';
  await page.goto('https://businessizze.com/profile'); const mapped = await fill(); assert.equal(mapped.ok, true, JSON.stringify(mapped));
  assert.equal(await page.locator('[name=business_name]').inputValue(), 'Active Plumbing Services');
  console.log('PASS working Family2 mapping retains priority and its existing authorized overwrite behavior');

  // Common unlabelled table form, matching the observed FreeWebLink field names.
  // No heading/form id: Title + URL + Description must provide the context.
  body = `<form id="search" action="/gosearch.php"><input name="q"><input type="image"></form><br>
    <form action="" method="post"><table>
    <tr><td>Title:</td><td class="field"><input type="text" name="TITLE"></td></tr>
    <tr><td>URL:</td><td class="field"><input type="text" name="URL"></td></tr>
    <tr><td>Description:</td><td class="field"><textarea name="DESCRIPTION"></textarea></td></tr>
    <tr><td>Your Name:</td><td class="field"><input type="text" name="OWNER_NAME"></td></tr>
    <tr><td>Your Email:</td><td class="field"><input type="text" name="OWNER_EMAIL"></td></tr>
    <tr><td>Category:</td><td class="field"><select name="CATEGORY_ID"><option value="0">[Top]</option><option value="658">|___Trade Services</option><option value="650">|___Removal Services</option></select></td></tr>
    <tr><td colspan="2"><div class="captcha"><input id="captcha" name="captcha"></div><input type="submit" name="submit" value="Continue"></td></tr>
    </table></form>`;
  if (process.argv.includes('--freeweblink-capture')) {
    const captured = await readFile('extension/test/.tmp/freeweblink-live.html', 'utf8');
    const submission = captured.match(/<form method="post" action="">[\s\S]*?<\/form>/)?.[0];
    assert.ok(submission, 'Captured FreeWebLink submission form required');
    body = (captured.match(/<form id="search"[\s\S]*?<\/form>/)?.[0] || '') + submission;
  }
  await page.goto(origin + '/submit.php'); const basic = await fill(); assert.equal(basic.ok, true, JSON.stringify(basic));
  for (const [name, expected] of Object.entries({ TITLE: 'Active Plumbing Services', URL: base.website, DESCRIPTION: 'Long saved description.', OWNER_NAME: base.contactName, OWNER_EMAIL: base.email, CATEGORY_ID: '658' })) {
    assert.equal(await page.locator(`[name="${name}"]`).inputValue(), expected, name);
  }
  assert.equal(await page.locator('[name=q]').inputValue(), ''); await verifySafety();
  body = body.replace('name="OWNER_NAME"', 'name="Name"').replace('name="OWNER_EMAIL"', 'name="Email"');
  await page.reload(); await fill(); assert.equal(await page.locator('[name=Name]').inputValue(), base.contactName);
  assert.equal(await page.locator('[name=Email]').inputValue(), base.email); await verifySafety();
  console.log('PASS headingless FreeWebLink-style Title/URL/Description form; owner/plain Name/Email, live Trade category, search/CAPTCHA/Continue untouched');

  const account = { ...base, id: 'site-account', username: 'saved-site-user', password: 'synthetic-site-password' };
  const loginForm = `<form method="post"><label>Username<input name="ctl00$Main$txtUserName" id="account-user"></label>
    <label>Email<input name="email" type="email"></label><label>Password<input id="account-password" type="password"></label>
    <div class="captcha"><input id="captcha" name="captcha"></div><button type="submit">Login</button></form>`;
  const proof = { id: 'approved-success', sourceUrl: origin + '/directory/login.aspx', profileId: account.id, autoLogin: true,
    loginApproval: { profileUpdatedAt: account.updatedAt, authorizedAt: '2026-10-21' },
    login: { url: origin + '/directory/login.aspx', state: 'authenticated', attemptId: 'successful-attempt', claimed: true } };
  const seedAccount = async (profile = account, record = proof, receipt = true) => {
    await worker.evaluate(async ({ profile, record, receipt, origin }) => {
      await chrome.storage.local.remove(['ba2.listingRunArchive:smart-account-test', `ba2.loginGuard:${origin}:${profile.id}`, `ba2.registrationGuard:${origin}:${profile.id}`]);
      await chrome.storage.local.set({ 'ba2.activeProfile': { profile, source: 'local-storage', syncedAt: 'fixture' },
        ...(record ? { 'ba2.listingRunArchive:smart-account-test': record } : {}),
        ...(receipt ? { [`ba2.loginGuard:${origin}:${profile.id}`]: { runId: record?.id, state: 'authenticated' } } : {}) });
    }, { profile, record, receipt, origin });
  };
  body = loginForm; await seedAccount(account, null, false); await page.goto(origin + '/directory/login.aspx');
  const missingSite = await fill(); assert.match(missingSite.message, /Credentials:.*site-specific/);
  assert.equal(await page.locator('#account-user').inputValue(), ''); assert.equal(await page.locator('#account-password').inputValue(), '');
  for (const record of [{ ...proof, profileId: 'another-profile' }, { ...proof, sourceUrl: 'https://another-site.example/login' },
    { ...proof, loginApproval: { profileUpdatedAt: 'old-revision' } }, { ...proof, login: { ...proof.login, state: 'uncertain' } },
    { ...proof, login: { ...proof.login, claimed: false } }, { ...proof, autoLogin: false }, null]) {
    await seedAccount(account, record); await page.reload(); await fill();
    assert.equal(await page.locator('#account-user').inputValue(), ''); assert.equal(await page.locator('#account-password').inputValue(), ''); await verifySafety();
  }
  await seedAccount(); await page.reload();
  const accountSnapshot = await worker.evaluate(async () => JSON.stringify(await chrome.storage.local.get(null)));
  await fill(); assert.equal(await page.locator('#account-user').inputValue(), account.username);
  assert.equal(await page.locator('[name=email]').inputValue(), account.email); assert.equal(await page.locator('#account-password').inputValue(), account.password);
  assert.equal(await worker.evaluate(async () => JSON.stringify(await chrome.storage.local.get(null))), accountSnapshot); await verifySafety();
  await page.reload(); const accountTab = await worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url).id, page.url());
  const masked = await worker.evaluate(async tab => chrome.tabs.sendMessage(tab, { type: 'BA2_LISTING_AUTOFILL' }, { frameId: 0 }), accountTab);
  assert.ok(masked.report.filled.some(field => field.field === 'password' && field.value === '[masked]'));
  assert.equal(JSON.stringify(masked).includes(account.password), false);
  body = loginForm.replace('id="account-user"', 'id="account-user" value="human-other-account"'); await page.reload(); await fill();
  assert.equal(await page.locator('#account-user').inputValue(), 'human-other-account'); assert.equal(await page.locator('#account-password').inputValue(), '');
  body = loginForm.replace('method="post"', 'method="post" action="https://another-site.example/login"'); await page.reload(); await fill();
  assert.equal(await page.locator('#account-password').inputValue(), '');
  console.log('PASS Login: successful exact-site/current-profile revision proof required; cross-site/profile/stale/uncertain/unclaimed/receipt-only refused, existing mismatches preserved, passwords masked');

  body = `<h1>Registration</h1><form method="post"><label>Name<input name="Name"></label><label>Business Name<input name="business_name"></label>
    <label>Username<input name="username"></label><label>Email<input name="email" type="email"></label>
    <label>Password<input name="password" type="password" autocomplete="new-password"></label><label>Confirm Password<input name="confirm_password" type="password"></label>
    <label>Phone<input name="phone"></label><input type="checkbox" id="terms"><div class="captcha"><input id="captcha" name="captcha"></div><button>Register</button></form>`;
  await page.goto(origin + '/register'); await fill();
  for (const name of ['password', 'confirm_password']) assert.equal(await page.locator(`[name=${name}]`).inputValue(), account.password);
  assert.equal(await page.locator('[name=Name]').inputValue(), account.contactName); assert.equal(await page.locator('[name=business_name]').inputValue(), account.businessName);
  await verifySafety();
  await seedAccount(account, null, false); await page.reload(); await fill();
  assert.equal(await page.locator('[name=password]').inputValue(), ''); assert.equal(await page.locator('[name=confirm_password]').inputValue(), '');
  assert.equal(await page.locator('[name=Name]').inputValue(), account.contactName);
  console.log('PASS Registration: saved password/confirmation only with site proof; unbound credentials manual, ordinary active-profile details filled; Register/Terms/CAPTCHA untouched');

  body = `<h1>Profile Update</h1><form method="post"><label>Name<input name="Name"></label><label>Business Name<input name="business_name"></label>
    <label>Email<input name="email" type="email"></label><label>Phone<input name="phone"></label><label>Address<input name="address"></label>
    <label>City<input name="city"></label><label>State<input name="state"></label><label>Country<input name="country"></label>
    <label>Website<input name="website" type="url"></label><label>Description<textarea name="description"></textarea></label>
    <label>Category<select name="category"><option value="">Select</option><option value="new-plumbing">Plumbing</option></select></label>
    <label>New Password<input name="new_password" type="password"></label><div class="captcha"><input id="captcha" name="captcha"></div><button>Save</button></form>`;
  await page.goto(origin + '/directory/profileupdate.aspx'); await fill();
  for (const [name, expected] of Object.entries({ Name: account.contactName, business_name: account.businessName, email: account.email, phone: account.phone,
    address: account.address, city: account.city, state: account.state, country: account.country, website: account.website, description: account.description, category: 'new-plumbing' })) {
    assert.equal(await page.locator(`[name=${name}]`).inputValue(), expected, name);
  }
  assert.equal(await page.locator('[name=new_password]').inputValue(), ''); await verifySafety();
  console.log('PASS Profile Update: Name/business/contact/address/location/descriptions/live category, no implicit password change or Save/CAPTCHA action');

  const second = { ...account, id: 'second-account', username: 'second-site-user', password: 'different-synthetic-password' };
  await seedAccount(second, proof); body = loginForm; await page.goto(origin + '/directory/login.aspx'); await fill();
  assert.equal(await page.locator('#account-password').inputValue(), '');
  const registered = { id: 'registered-success', sourceUrl: origin + '/register', profileId: second.id, autoRegister: true,
    registrationApproval: { profileUpdatedAt: second.updatedAt }, registration: { url: origin + '/register', claimed: true, attemptId: 'registered-once', state: 'confirmed' } };
  await seedAccount(second, registered, false);
  await worker.evaluate(async ({ origin, profile }) => chrome.storage.local.set({ [`ba2.registrationGuard:${origin}:${profile.id}`]: { runId: 'registered-success', state: 'confirmed' } }), { origin, profile: second });
  await fill(); assert.equal(await page.locator('#account-user').inputValue(), second.username); assert.equal(await page.locator('#account-password').inputValue(), second.password);
  await verifySafety(); assert.equal(page.url(), origin + '/directory/login.aspx');
  console.log('PASS active-account switch never reuses another profile credentials; confirmed same-site registration history also permits saved credentials without navigation/submission');
  body = '<form><h2>Login</h2><label>Username<input name="username"></label><label>One-time password<input type="password" name="code" id="one-time"></label><button>Login</button></form>';
  await page.reload(); await fill(); assert.equal(await page.locator('#one-time').inputValue(), '');
  body = '<form><h2>Login</h2><input type="password" id="typed-conflict" aria-label="Username"><button>Login</button></form>';
  await page.reload(); await fill(); assert.equal(await page.locator('#typed-conflict').inputValue(), '');
  await seedAccount(second, null, false);
  body = '<form><h2>Login</h2><label>Email<input type="email" name="email"></label><label>Password<input type="password" name="password"></label><button>Login</button></form>';
  await page.goto(origin + '/profileupdate.aspx'); await fill(); assert.equal(await page.locator('[name=email]').inputValue(), '');
  await seedAccount(second, { ...proof, profileId: second.id });
  body = '<form><h2>Profile Update</h2><label>New Password<input name="new_password" type="password"></label><label>Confirm Password<input name="confirm_password" type="password"></label><button>Save</button></form>';
  await page.reload(); await fill(); assert.equal(await page.locator('[name=new_password]').inputValue(), ''); assert.equal(await page.locator('[name=confirm_password]').inputValue(), '');
  await verifySafety();
  console.log('PASS one-time codes/type conflicts/password-change pairs untouched; current form takes priority over profile URL');
} finally { await context.close(); }
