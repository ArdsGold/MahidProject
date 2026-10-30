// Loaded by uivision_publish.py with a public-data `job` object and a `stage`.
// Uses the official classic-command bridge, avoiding API differences between V10 builds.
function readPage(code, args = []) {
  uiv.run('executeScript', `return (${code}).apply(null, ${JSON.stringify(args)});`, 'backlink_value');
  return uiv.getVar('backlink_value');
}

function pageState() {
  return readPage(`function () {
    const challengeTitle = /just a moment|bot verification|access denied|attention required/i.test(document.title);
    const widgets = [...document.querySelectorAll('iframe[src*="recaptcha"],iframe[src*="hcaptcha"],iframe[src*="challenges.cloudflare"],.g-recaptcha,.h-captcha,.cf-turnstile')].some(e => e.getClientRects().length && !e.closest(".grecaptcha-badge") && e.getAttribute("data-size") !== "invisible" && getComputedStyle(e).visibility !== "hidden");
    const solved = [...document.querySelectorAll('[name="g-recaptcha-response"],[name="h-captcha-response"],[name="cf-turnstile-response"]')].some(e => e.value.trim());
    return {host: location.hostname.toLowerCase().replace(/^www\\./, ''), challenge: challengeTitle || (!!widgets && !solved)};
  }`);
}

function fields(selector) {
  return readPage(`function (s) {
    return [...document.querySelectorAll(s)].map(e => ({text: e.textContent.trim(), value: e.value,
      disabled: !!e.disabled || !!e.closest('optgroup[disabled]')}));
  }`, [selector]);
}

function choose(selector, option) {
  if (!option) throw new Error('A matching category or location needs mapping');
  uiv.run('select', `css=${selector}`, `value=${option.value}`);
}

function fill(selector, value) {
  uiv.run('type', `css=${selector}`, value || '');
}

function combinedBody(selector, filling) {
  const limit = readPage(`function (s) {
    const e = document.querySelector(s);
    if (!e) throw Error('Combined text field missing');
    return e.maxLength >= 0 ? e.maxLength : null;
  }`, [selector]);
  if (!filling && limit !== job.content_limit) throw new Error('Text field limit changed; no submission made');
  const fitted = readPage(contentFitter, [{...job.content_parts, limit}]);
  Object.assign(job, {content_limit: limit, omitted_fields: fitted.omitted_fields, content_notes: fitted.content_notes});
  if (fitted.blocked) return null;
  if (filling) {
    fill(selector, fitted.text);
    const actual = readPage(`function (s) { return document.querySelector(s).value; }`, [selector]);
    if (actual.replace(/\r\n/g, '\n') !== fitted.text.replace(/\r\n/g, '\n')) throw new Error('Combined text was truncated or changed');
  }
  return fitted.text;
}

function clickLink(text) {
  const locator = `xpath=//a[normalize-space(.)=${JSON.stringify(text)}]`;
  uiv.$(locator, {timeout: 20});
  const count = readPage(`function (label) {
    return [...document.querySelectorAll('a')].filter(a => a.textContent.trim() === label).length;
  }`, [text]);
  if (count !== 1) throw new Error('No unique location/category link');
  uiv.run('click', locator);
}

function categoryLink(label) {
  try { uiv.$(`xpath=//a[normalize-space(.)=${JSON.stringify(label)}]`, {timeout:20}); }
  catch (error) { /* Capture the actual alternatives even when the expected label is missing. */ }
  const inventory = readPage(`function () {
    return [...document.querySelectorAll('a[href]')].filter(a => {
      try { const u=new URL(a.href);return u.origin===location.origin&&u.searchParams.get('view')==='post'&&!!u.searchParams.get('catid')&&[...u.searchParams.keys()].every(k=>['view','postevent','cityid','lang','catid','subcatid','shortcutregion'].includes(k)); }
      catch {return false;}
    }).map(a=>({label:a.textContent.trim(),value:a.href}));
  }`);
  const matches = inventory.filter(o=>o.label===label);
  job.category_navigation = job.category_navigation || [];
  job.category_navigation.push({options:inventory, selected:matches.length===1?matches[0]:null});
  if (matches.length !== 1) return false;
  clickLink(label);
  return true;
}

function normalized(value) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '').replace('saint', 'st');
}

function navigate(url) {
  try { uiv.goto(url); }
  catch (error) {
    // Some sites finish rendering without the load signal. The required finders
    // below still validate the actual form before any values or submission.
    if (!/page load event|page load \d+ seconds time out|DOM failed to be ready|Still same ipc secret|Lost contact to website/i.test(String(error))) throw error;
  }
  if (pageState().host !== job.domain) throw new Error('Unexpected listing domain');
}

function prepare() {
  if (job.workflow === 'classifieds') {
    if (!job.state_name || !job.city || !job.email) {
      throw new Error('This classifieds workflow needs a US location and public business email');
    }
    const currentChooser = pageState().host === job.domain && !pageState().challenge && readPage(`function (state) {
      return [...document.querySelectorAll('a[href]')].filter(a=>{
        try {const u=new URL(a.href);return a.textContent.trim()===state&&u.origin===location.origin&&u.searchParams.get('view')==='post'&&!u.searchParams.get('catid');}
        catch{return false;}
      }).length===1;
    }`, [job.state_name]);
    if (!currentChooser) navigate(`https://${job.domain}/index.php?view=post&cityid=0&lang=en`);
    if (pageState().challenge) return {status: 'access_challenge'};
    clickLink(job.state_name);
    if (!job.classified_route) return {status:'needs_mapping',reason:'Classifieds category route needs mapping for this business type'};
    for (const label of job.classified_route.labels) {
      const found = categoryLink(label);
      if (pageState().challenge && !readPage(`function () {return !!document.querySelector('#adtitle');}`)) return {status:'access_challenge'};
      if (!found) return {status:'category_review',reason:'Classifieds category route changed or is ambiguous; mapping review required'};
    }
    if (pageState().host !== job.domain) throw new Error('Unexpected listing domain');
    fill('#adtitle', job.name);
    if (combinedBody('[name="addesc"]', true) === null) return {status: 'needs_attention', reason: 'Text limit or source damage prevents including the complete business name and website'};
    fill('#email', job.email);
    const cities = fields('[name="arealist"] option');
    const city = cities.find(o => normalized(o.text) === normalized(job.city));
    if (city) choose('[name="arealist"]', city);
    else fill('[name="area"]', job.city);
    for (const kind of ['featured', 'extended']) {
      const selector = `[name="promote[${kind}]"]`;
      choose(selector, fields(`${selector} option`).find(o => o.text === 'None'));
    }
    uiv.run('check', 'css=[name="agree"]');
  } else if (job.workflow === 'directory') {
    navigate(job.submission_url || `https://${job.domain}/submit.php`);
    if (pageState().challenge && !readPage(`function () { return !!document.querySelector('[name="TITLE"]'); }`)) {
      return {status: 'access_challenge'};
    }
    if (pageState().host !== job.domain) throw new Error('Unexpected listing domain');
    if (job.directory) {
      const inspected = readPage(importedDirectoryInspector, [job.directory]);
      if (!inspected.ok) return {status: 'needs_attention', reason: inspected.reason};
      if (job.directory.manualRadio) uiv.run('check', `css=[name="${job.directory.manualRadio.name}"][value="${job.directory.manualRadio.value}"]`);
    }
    if (!(job.directory && job.directory.optionalReciprocal) && readPage(`function () { return !!document.querySelector('[name="RECPR_URL"]'); }`)) {
      return {status: 'needs_attention', reason: 'Directory requests a reciprocal link'};
    }
    if (combinedBody('[name="DESCRIPTION"]', true) === null) return {status: 'needs_attention', reason: 'Text limit or source damage prevents including the complete business name and website'};
    for (const pair of [['TITLE', job.name], ['URL', job.website],
                        ['OWNER_NAME', job.name], ['OWNER_EMAIL', job.email]]) {
      fill(`[name="${pair[0]}"]`, pair[1]);
    }
    const categories = fields('[name="CATEGORY_ID"] option');
    const category = readPage(categoryMatcher, [{options: categories, business: job}]);
    job.category_evidence = {option_count: categories.length, selector: '[name="CATEGORY_ID"] option', selected: category, page: job.submission_url || `https://${job.domain}/submit.php`};
    if (!category) return {status: 'category_review', reason: 'Category mapping review needed; complete available options saved'};
    choose('[name="CATEGORY_ID"]', category);
    if (readPage(`function () { return !!document.querySelector('[name="agree"]'); }`)) {
      uiv.run('check', 'css=[name="agree"]');
    }
  } else throw new Error('No automatic workflow for this site');
  return {status: 'ready', challenge: pageState().challenge};
}

function submit() {
  const state = pageState();
  if (state.host !== job.domain || state.challenge) throw new Error('Complete verification on the filled form first');
  if (job.workflow === 'classifieds') {
    const sameCategory = readPage(`function (j) {
      if (!j.selected_category || !j.selected_category.value) return false;
      const selected=new URL(j.selected_category.value), current=new URL(location.href);
      return selected.origin===current.origin && ['cityid','catid','subcatid'].every(k=>selected.searchParams.get(k)===current.searchParams.get(k));
    }`, [job]);
    if (!sameCategory) throw new Error('Selected classifieds category changed; no submission made');
  }
  if (job.directory) {
    const inspected = readPage(importedDirectoryInspector, [job.directory]);
    if (!inspected.ok || !inspected.freeSelected) throw new Error(inspected.reason || 'Free listing option changed');
  }
  const prepared = combinedBody(job.workflow === 'classifieds' ? '[name="addesc"]' : '[name="DESCRIPTION"]', false);
  if (prepared === null) throw new Error('Combined client details cannot fit; no submission made');
  const valid = readPage(`function (j) {
    const value = selector => (document.querySelector(selector) || {}).value;
    const same = (a, b) => String(a || '').replace(/\\r\\n/g, '\\n') === String(b || '').replace(/\\r\\n/g, '\\n');
    if (j.workflow === 'classifieds') {
      return same(value('#adtitle'), j.name) && same(value('[name="addesc"]'), j.prepared_body) &&
        same(value('#email'), j.email) && document.querySelector('[name="agree"]').checked &&
        ['featured', 'extended'].every(kind => {
          const e = document.querySelector('[name="promote[' + kind + ']"]');
          return e && e.selectedOptions.length === 1 && e.selectedOptions[0].textContent.trim() === 'None';
        });
    }
    const reciprocal = document.querySelector('[name="RECPR_URL"]');
    const reciprocalOK = !reciprocal || (j.directory && j.directory.optionalReciprocal && !reciprocal.value.trim());
    return same(value('[name="TITLE"]'), j.name) && same(value('[name="URL"]'), j.website) &&
      same(value('[name="DESCRIPTION"]'), j.prepared_body) && reciprocalOK;
  }`, [{...job, prepared_body: prepared}]);
  if (!valid) throw new Error('Form contents or free options changed; no submission made');
  if (job.workflow === 'classifieds') {
    uiv.run('click', 'xpath=//button[@type="submit" and normalize-space(.)="Post Now"]');
  } else uiv.run('click', 'css=[name="submit"][type="submit"]');
  // Wait for a receipt/public-page signal rather than reading the old form during navigation.
  try {
    uiv.$('css=body', {textMatches: 'Congratulation|thank you for (posting|submitting)|successfully (posted|submitted)|invalid input data|URL already exists|pending (approval|review)', timeout: 15});
  } catch (error) { /* Unknown response remains uncertain; never repeat the submit click. */ }
  return receipt();
}

function receipt() {
  return readPage(`function (j) {
    if (location.hostname.toLowerCase().replace(/^www\\./, '') !== j.domain) {
      return {status: 'uncertain', reason: 'Current tab is a different website; no receipt inferred'};
    }
    const text = document.body.innerText + '\\n' + [...document.querySelectorAll('input[readonly],textarea[readonly]')].map(e => e.value).join('\\n');
    const publicUrl = value => {
      try {
        const u = new URL(value, location.href);
        const host = u.hostname.toLowerCase().replace(/^www\\./, '');
        return ['http:', 'https:'].includes(u.protocol) && host === j.domain && !u.username && !u.password &&
          !['', '/', '/index.php', '/submit', '/submit.php', '/login'].includes(u.pathname) &&
          !/(^|\\/)edit($|\\/)|[?&](edit|token|password|codemd5)=|[?&]view=(post|edit|selectcity|login)/i.test(u.href) ? u.href : '';
      } catch (error) { return ''; }
    };
    if (/invalid input data|submission (?:failed|rejected)|could not (?:post|submit)/i.test(text)) {
      return {status: 'rejected', reason: 'Site explicitly rejected the submission'};
    }
    if (/URL already exists in the directory/i.test(text)) {
      return {status: 'rejected', reason: 'Directory refuses a duplicate business website URL'};
    }
    const url = publicUrl(location.href) || [...document.querySelectorAll('a[href]')]
      .filter(a => a.textContent.includes(j.name)).map(a => publicUrl(a.href)).find(Boolean) ||
      (text.match(/https?:\\/\\/[^\\s<>"']+/g) || []).map(publicUrl).find(Boolean);
    if (url) return {status: 'candidate', url};
    if (/pending (?:approval|review|moderation)|awaiting (?:approval|review|moderation)|successfully (?:posted|submitted)|ad (?:has been|was) posted|thank you for (?:posting|submitting)/i.test(text)) {
      return {status: 'pending', reason: 'Submission receipt; public listing not available yet'};
    }
    return {status: 'uncertain', reason: 'Submission attempted; no public result URL recovered'};
  }`, [job]);
}

let result;
if (stage === 'prepare') result = prepare();
else if (stage === 'submit') result = submit();
else if (stage === 'check') result = {status: 'ready', challenge: pageState().challenge};
else if (stage === 'receipt') result = receipt();
else throw new Error('Unknown workflow stage');
if (job.category_navigation) result.category_navigation = job.category_navigation;
if (job.category_evidence) result.category_evidence = job.category_evidence;
if (job.omitted_fields) Object.assign(result, {omitted_fields: job.omitted_fields, content_notes: job.content_notes, content_limit: job.content_limit});
if (stage === 'prepare' && typeof templateCollector !== 'undefined') result.template_structure = readPage(templateCollector);
uiv.log(`BACKLINK_RESULT:${JSON.stringify(result)}`, 'green');
