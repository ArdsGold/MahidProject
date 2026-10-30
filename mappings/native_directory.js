// Adapted from extSource's native-directory.ts. Inspection only; no clicks or writes.
(function (site) {
  const fail = reason => ({ok: false, reason});
  const url = new URL(location.href);
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const submitPage = u => u.pathname === '/submit.php' &&
    [...u.searchParams].every(([key, value]) => key === 'c' && /^\d+$/.test(value));
  if (host !== site.domain || !site.protocols.includes(url.protocol) || url.username || url.password || url.port || !submitPage(url)) {
    return fail('Imported directory origin, protocol or page changed');
  }
  const forms = [...document.querySelectorAll('form')].filter(f => f.querySelector('[name="TITLE"]'));
  if (forms.length !== 1) return fail('Missing or ambiguous native listing form');
  const form = forms[0];
  const action = new URL(form.getAttribute('action') || url.href, url);
  if (form.method.toLowerCase() !== 'post' || action.origin !== url.origin || !submitPage(action) || form.target && form.target !== '_self') {
    return fail('Native listing form action changed');
  }
  const visible = el => {
    for (let node = el; node; node = node.parentElement) {
      if (node.matches('[hidden],[inert],[aria-hidden="true"]')) return false;
      const style = getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
    }
    return true;
  };
  const names = ['TITLE', 'URL', 'DESCRIPTION', 'OWNER_NAME', 'OWNER_EMAIL', 'CATEGORY_ID'];
  for (const name of names) {
    const controls = [...form.elements].filter(el => el.name === name);
    const el = controls[0], tag = name === 'DESCRIPTION' ? 'TEXTAREA' : name === 'CATEGORY_ID' ? 'SELECT' : 'INPUT';
    if (controls.length !== 1 || el.tagName !== tag || el.disabled || el.readOnly || !visible(el) || tag === 'INPUT' && el.type !== 'text') {
      return fail('Native directory field changed or hidden: ' + name);
    }
  }
  const allowed = new Set([...names, 'RECPR_URL', 'RECPR_TEXT', 'g-recaptcha-response']);
  if (site.optionalReciprocal) {
    const controls = [...form.elements].filter(el => el.name === 'RECPR_URL');
    const field = controls[0];
    const row = field && field.closest('tr');
    const label = row && (row.querySelector('td.label') || row.querySelector('td'));
    if (controls.length !== 1 || field.tagName !== 'INPUT' || field.type !== 'text' ||
        field.disabled || field.readOnly || !visible(field) || field.required ||
        field.getAttribute('aria-required') === 'true' || !label || !/reciprocal/i.test(label.textContent) || label.querySelector('.req') ||
        /\*|required|mandatory/i.test(label.textContent) || field.value.trim()) {
      return fail('Optional reciprocal field changed or became required; no reciprocal link supplied');
    }
  }
  if (site.manualRadio) {
    const radios = [...form.elements].filter(el => el.name === site.manualRadio.name);
    const values = [site.manualRadio.value, ...(site.manualRadio.otherValues || [])];
    const radio = radios.find(el => el.value === site.manualRadio.value);
    if (radios.length !== values.length || new Set(radios.map(el => el.value)).size !== values.length ||
        radios.some(el => el.type !== 'radio' || !values.includes(el.value) || el.disabled || !visible(el)) || !radio) return fail('Free listing radio changed');
    const row = radio.closest('tr');
    const cells = row ? [...row.querySelectorAll('td')].map(el => el.textContent.trim().toLowerCase()) : [];
    if (!cells.includes('free') || !cells.some(text => /regular (reviews|links)/.test(text))) return fail('Explicit free listing price missing');
    allowed.add(site.manualRadio.name);
  }
  if (site.manualTerms) {
    const spec = site.manualTerms;
    const checks = [...form.elements].filter(el => el.name === spec.name);
    const el = checks[0];
    const links = el ? [...el.parentElement.querySelectorAll('a[href]')].filter(a => {
      const target = new URL(a.getAttribute('href'), url);
      return a.textContent.trim() === spec.label && target.origin === url.origin && target.pathname === spec.rulesPath && !target.search && !target.hash;
    }) : [];
    if (checks.length !== 1 || el.type !== 'checkbox' || el.value !== spec.value || el.disabled || !visible(el) || links.length !== 1) return fail('Native Terms controls changed');
  }
  for (const el of form.querySelectorAll('input,textarea,select')) {
    if (!['hidden', 'submit', 'checkbox', 'button'].includes(el.type || '') && !allowed.has(el.name)) return fail('Unmapped additional directory control');
  }
  const submits = [...form.querySelectorAll('button:not([type="button"]),input[type="submit"],input[type="image"]')];
  const submit = submits[0];
  if (submits.length !== 1 || submit.tagName !== 'INPUT' || submit.type !== 'submit' || submit.name !== 'submit' || submit.value !== site.submitValue || submit.disabled || !visible(submit) ||
      ['formaction', 'formmethod', 'formtarget'].some(name => submit.hasAttribute(name))) return fail('Native final submission control changed');
  return {ok: true, freeSelected: !site.manualRadio || [...form.elements].find(el => el.name === site.manualRadio.name && el.value === site.manualRadio.value).checked};
})
