// Offline fixture: execute the actual extension script with a small DOM/Ui.Vision adapter.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, 'mappings', 'uivision.js'), 'utf8');
const categoryMatcher = fs.readFileSync(require('node:path').join(__dirname, 'mappings', 'category_match.js'), 'utf8');

const contentFitter = fs.readFileSync(require('node:path').join(__dirname, 'mappings', 'content_fit.js'), 'utf8');

function fixture(workflow, reciprocal = false, loadEventMissing = false) {
  const job = {domain: 'fixture.test', workflow, name: 'Example Gym', website: 'https://business.example/',
    description: 'Approved description', category: 'Sports', email: 'public@example.com',
    state_name: 'Missouri', city: 'St. Louis', markdown: '# Example Gym\n\n[Website](https://business.example/)'};
  job.content_parts = {parts: [{key:'name',text:job.name},{key:'website',text:'Website: '+job.website},{key:'description',text:job.description},{key:'keywords',text:'Keywords: approved keyword'}]};
  const elements = {};
  const actions = [];
  const location = {hostname: 'fixture.test', href: 'https://fixture.test/submit.php'};
  const field = selector => elements[selector] || (elements[selector] = {value: '', textContent: ''});
  for (const selector of ['#adtitle', '[name="addesc"]', '#email', '[name="agree"]',
                          '[name="TITLE"]', '[name="URL"]', '[name="DESCRIPTION"]', '[name="OWNER_NAME"]', '[name="OWNER_EMAIL"]']) field(selector);
  const select = (selector, choices) => {
    const options = choices.map(([textContent, value]) => ({textContent, value, closest: () => null}));
    elements[`${selector} option`] = options;
    elements[selector] = {value: options[0].value, selectedOptions: [options[0]]};
  };
  select('[name="arealist"]', [['Choose city', ''], ['st louis', 'stl']]);
  select('[name="CATEGORY_ID"]', [['Choose', ''], ['| |___Animal Sports', 'animals'], ['|___Sports', 'sports']]);
  for (const kind of ['featured', 'extended']) select(`[name="promote[${kind}]"]`, [['Paid', 'paid'], ['None', '0']]);
  if (reciprocal) field('[name="RECPR_URL"]');
  const document = {title: 'Submit', body: {innerText: 'Submit your business'},
    querySelector: selector => elements[selector] || null,
    querySelectorAll: selector => selector === 'a' ? ['Missouri', 'Services', 'Health & Fitness'].map(textContent => ({textContent})) :
      Array.isArray(elements[selector]) ? elements[selector] : []};
  const variables = {};
  let result;
  const uiv = {goto: url => { location.href = url; if (loadEventMissing) throw new Error(loadEventMissing === true ? 'No page load event detected' : loadEventMissing); },
    $: () => ({}), getVar: name => variables[name], log: text => { result = JSON.parse(text.split('BACKLINK_RESULT:')[1]); },
    run(command, target, value) {
      actions.push([command, target, value]);
      if (command === 'executeScript') variables[value] = new Function('document', 'location', 'URL', target)(document, location, URL);
      if (command === 'open') { location.href = target; }
      if (command === 'type') field(target.slice(4)).value = value;
      if (command === 'check') field(target.slice(4)).checked = true;
      if (command === 'select') {
        const selector = target.slice(4);
        const option = elements[`${selector} option`].find(o => o.value === value.slice(6));
        assert.ok(option, 'selected an existing option');
        elements[selector].value = option.value;
        elements[selector].selectedOptions = [option];
      }
      if (command === 'click' && (target.includes('Post Now') || target.includes('[name="submit"]'))) {
        location.href = 'https://fixture.test/posts/42/example-gym';
        document.body.innerText = 'Example Gym';
      }
    }};
  function run(stage) {
    vm.runInNewContext(`const contentFitter=${JSON.stringify(contentFitter)};const categoryMatcher=${JSON.stringify(categoryMatcher)};const job=${JSON.stringify(job)};const stage=${JSON.stringify(stage)};\n${source}`, {uiv});
    if (stage === 'prepare') Object.assign(job, {content_limit: result.content_limit, omitted_fields: result.omitted_fields, content_notes: result.content_notes});
    return result;
  }
  return {run, job, elements, actions, document, location};
}

const classified = fixture('classifieds');
assert.equal(classified.run('prepare').status, 'ready');
assert.equal(classified.elements['[name="arealist"]'].value, 'stl');
for (const kind of ['featured', 'extended']) assert.equal(classified.elements[`[name="promote[${kind}]"]`].value, '0');
assert.equal(classified.elements['[name="addesc"]'].value, classified.job.content_parts.parts.map(p => p.text).join('\n\n'));
assert.equal(classified.run('submit').status, 'candidate');
assert.equal(classified.actions.filter(a => a[0] === 'click' && a[1].includes('Post Now')).length, 1);

const directory = fixture('directory');
assert.equal(directory.run('prepare').status, 'ready');
assert.equal(directory.elements['[name="URL"]'].value, directory.job.website);
assert.equal(directory.elements['[name="CATEGORY_ID"]'].value, 'sports');
assert.equal(directory.run('submit').url, 'https://fixture.test/posts/42/example-gym');
assert.equal(fixture('directory', false, true).run('prepare').status, 'ready');
assert.equal(fixture('directory', false, 'Page load 60 seconds time out').run('prepare').status, 'ready');

const reciprocal = fixture('directory', true);
assert.equal(reciprocal.run('prepare').status, 'needs_attention');
assert.equal(reciprocal.actions.filter(a => a[0] === 'click').length, 0);

const changed = fixture('classifieds');
changed.run('prepare');
changed.elements['[name="promote[featured]"]'].selectedOptions = [{textContent: 'Paid'}];
assert.throws(() => changed.run('submit'), /free options changed/);
assert.equal(changed.actions.filter(a => a[0] === 'click' && a[1].includes('Post Now')).length, 0);

const receipt = fixture('classifieds');
receipt.location.href = 'https://fixture.test/index.php?view=post';
receipt.document.body.innerText = 'Congratulation! Your Ad successfully posted and live.\n' +
  'Private edit: https://fixture.test/index.php?view=edit&token=private\n' +
  'View link: https://fixture.test/475/posts/3/29/2247486.html';
assert.equal(receipt.run('receipt').url, 'https://fixture.test/475/posts/3/29/2247486.html');
receipt.document.body.innerText = 'Invalid Input Data';
assert.equal(receipt.run('receipt').status, 'rejected');
receipt.document.body.innerText = 'URL already exists in the directory.';
assert.equal(receipt.run('receipt').status, 'rejected');
receipt.location.hostname = 'unrelated.test';
receipt.document.body.innerText = 'Your Ad successfully posted';
assert.equal(receipt.run('receipt').status, 'uncertain');
assert.equal(receipt.actions.filter(a => a[0] === 'click').length, 0);
console.log('Offline workflow checks passed: location, free options, result capture, reciprocal links, changed forms.');

const limited = fixture('directory');
limited.elements['[name="DESCRIPTION"]'].maxLength = 84;
const fitted = limited.run('prepare');
assert.equal(fitted.status, 'ready');
assert.ok(fitted.omitted_fields.some(v => v.startsWith('keywords')));
assert.ok(limited.elements['[name="DESCRIPTION"]'].value.length <= 84);
assert.equal(limited.run('submit').status, 'candidate');
const tooSmall = fixture('directory');
tooSmall.elements['[name="DESCRIPTION"]'].maxLength = 10;
assert.equal(tooSmall.run('prepare').status, 'needs_attention');
assert.ok(tooSmall.run('prepare').omitted_fields.some(v => v.startsWith('website')));
assert.equal(tooSmall.actions.filter(a => a[0] === 'click').length, 0);
const changedLimit = fixture('directory');
changedLimit.run('prepare');
changedLimit.elements['[name="DESCRIPTION"]'].maxLength = 10;
assert.throws(() => changedLimit.run('submit'), /limit changed/);
