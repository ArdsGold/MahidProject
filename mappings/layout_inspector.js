// Read-only rendered-layout inventory. Never return entered values or hidden tokens.
() => {
  const host = location.hostname.toLowerCase().replace(/^www\./, '');
  const safeUrl = value => {
    try {
      const u = new URL(value, location.href);
      const newListing = /\/listingedit\.aspx$/i.test(u.pathname) && !u.search;
      if (!['http:', 'https:'].includes(u.protocol) || u.hostname.toLowerCase().replace(/^www\./, '') !== host ||
          u.username || u.password || (!newListing && /edit|token|password|reset|delete|logout|activate|oauth|session/i.test(u.pathname))) return '';
      const query = new URLSearchParams();
      for (const key of ['view', 'cityid', 'catid', 'subcatid', 'lang', 'c']) {
        const v = u.searchParams.get(key);
        if (v && /^[a-zA-Z0-9_-]{1,25}$/.test(v)) query.set(key, v);
      }
      if (/\/profile\.php$/i.test(u.pathname) && u.searchParams.get('mode') === 'register') {
        query.set('mode', 'register');
        if (u.searchParams.get('agreed') === 'true') query.set('agreed', 'true');
      }
      return u.origin + u.pathname + (query.size ? '?' + query.toString() : '');
    } catch { return ''; }
  };
  const visible = e => !!e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden';
  const forms = [...document.forms].map(f => ({method: f.method.toLowerCase(), action: safeUrl(f.getAttribute('action') || location.href),
    account_family: /Username\s*\(Blog address\)/i.test(f.innerText) && f.innerText.toLowerCase().includes('.' + host)
      ? 'blog-address-signup' : '',
    fields: [...f.elements].filter(e => ['INPUT','TEXTAREA','SELECT','BUTTON'].includes(e.tagName) &&
      e.type !== 'hidden' && !/^(g-recaptcha-response|h-captcha-response|cf-turnstile-response)$/.test(e.name))
      .map(e => {
        const name = e.name || e.id || '';
        const label = [...(e.labels || [])].map(l => l.textContent.trim()).join(' ').replace(/\s+/g, ' ').toLowerCase();
        return {name: /^[\w$:.\[\]-]{1,256}$/.test(name) ? name : '', tag: e.tagName.toLowerCase(),
          label: ['blog name', 'your email', 'password'].includes(label) ? label : '',
          type: (e.getAttribute('type') || (e.tagName === 'INPUT' ? 'text' : e.tagName)).toLowerCase(),
          required: !!e.required, maxlength: e.maxLength >= 0 ? e.maxLength : null,
          selector: /^[\w$:.\[\]-]{1,256}$/.test(name) ? '[' + (e.name ? 'name' : 'id') + '=' + JSON.stringify(name) + ']' : '',
          visible: visible(e),
          choices: e.tagName === 'SELECT' && /^(CATEGORY_ID|category|catid|subcatid|arealist|country|state|city)$/i.test(e.name)
            ? [...e.options].slice(0, 40).map(o => o.textContent.trim().slice(0, 100)) : [],
          choices_truncated: e.tagName === 'SELECT' && e.options.length > 40};
      })}));
  const body = document.body ? document.body.innerText : '';
  const errorTitle = document.title.match(/\b(?:[45]\d\d\s+(?:not found|forbidden|bandwidth limit exceeded|resource limit is reached|internal server error|bad gateway|service unavailable|gateway time.?out)|bandwidth limit exceeded|resource limit is reached|server error|this site can.t be reached)\b/i);
  const pageError = errorTitle ? errorTitle[0] : /^\s*Sorry, you have been blocked/i.test(body) ? 'Sorry, you have been blocked' : '';
  const passwordForm = forms.some(f => f.fields.some(e => e.type === 'password' && e.visible));
  const challenge = /just a moment|bot verification|attention required|access denied/i.test(document.title) ||
    /checking your browser|verify you are human/i.test(body.slice(0, 4000));
  const postingStep = forms.some(f => f.method === 'post' && f.action &&
    ['/submit', '/submit.php'].includes(new URL(f.action, location.href).pathname) &&
    (f.fields.some(e => e.name === 'ok' && e.type === 'button' && e.visible) && /Step One\s+Choose a Category/i.test(body) ||
     f.fields.some(e => e.name === 'LINK_TYPE' && e.type === 'radio' && e.visible) &&
     f.fields.some(e => e.name === 'choicemade' && e.type === 'button' && e.visible)));
  const submissionForm = postingStep || forms.some(f => f.fields.some(e => ['TITLE', 'adtitle', 'addesc', 'DESCRIPTION'].includes(e.name)));
  const controls = [...document.querySelectorAll('a[href],button,[role="button"],input[type="button"],input[type="submit"]')]
    .filter(visible).map(e => {
      const selector = e.id ? '[id=' + JSON.stringify(e.id) + ']' :
        e.name ? '[name=' + JSON.stringify(e.name) + ']' : '';
      return {label: (e.getAttribute('aria-label') || e.textContent || e.value || '').trim().replace(/\s+/g, ' ').slice(0, 80),
        url: e.href ? safeUrl(e.href) : '', selector, tag: e.tagName.toLowerCase(),
        role: e.getAttribute('role') || '', page: safeUrl(location.href),
        navigation_only: e.tagName === 'A' && !!safeUrl(e.href)};
    }).filter(e => /\b(register|sign ?up|log ?in|sign ?in|add (your |a |new )?(sites?|links?|urls?|listings?|business(?:es)?)|submit|post|create|dashboard|my listings|get started|write|publish)\b/i.test(e.label));
  // Only anchors are followed automatically. Buttons are recorded for operator inspection.
  const links = controls.filter(e => e.navigation_only);
  return {host, url: safeUrl(location.href), page_error: pageError, forms, controls: controls.slice(0, 80), links: [...new Map(links.map(a => [a.url, a])).values()].slice(0, 40),
    account_restricted:/\b(?:your|this|the)\s+(?:account|site|blog)\s+(?:(?:has been|is|was)\s+)?(?:(?:permanently|temporarily)\s+)?(?:banned|suspended|disabled)\b|\baccount\s*(?:status\s*:\s*)?(?:(?:permanently|temporarily)\s+)?(?:suspended|banned|disabled)\b|\byou have been banned\b/i.test(body),
    access: challenge ? 'Browser verification' : passwordForm && !submissionForm ? 'Sign-in required' : 'Accessible',
    identity_check: /verify it.s you/i.test(body.slice(0, 5000)),
    captcha: !!document.querySelector('.g-recaptcha,.h-captcha,.cf-turnstile,#KEY-Captcha,#logo_key_captcha,iframe[src*="recaptcha"],iframe[src*="challenges.cloudflare"]'),
    technologies: ['tinymce', 'ckeditor', 'wordpress', 'mighty networks'].filter(x => document.documentElement.innerHTML.toLowerCase().includes(x)),
    unavailable: /resource limit is reached|bad gateway|service unavailable|site can.t be reached|not found|404|server error/i.test(document.title),
    native_present: !!document.querySelector('[name="TITLE"]'),
    reciprocal_present: !!document.querySelector('[name="RECPR_URL"]'),
    submit_label: (document.querySelector('[name="submit"][type="submit"]') || {}).value || ''};
}
