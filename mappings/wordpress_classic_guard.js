// Inspected classic editor contract; reads controls only and never submits.
(function ({host, path}) {
  const fail = reason => ({ok: false, reason});
  if (location.protocol !== 'https:' || location.hostname !== host || location.pathname !== path || location.search) return fail('Editor route changed');
  const titles = document.querySelectorAll('[name="post_title"]');
  if (titles.length !== 1) return fail('Missing or ambiguous post title');
  const form = titles[0].form;
  if (!form) return fail('Post form missing');
  // A hidden input named action can shadow form.action in classic editors.
  const action = new URL(form.getAttribute('action') || location.href, location.href);
  if (form.method.toLowerCase() !== 'post' || action.origin !== location.origin || action.pathname !== path || action.search || form.target && form.target !== '_self') return fail('Post action changed');
  const contents = form.querySelectorAll('#content[name="content"]');
  const publishes = form.querySelectorAll('#publish[name="publish"][type="submit"]');
  if (contents.length !== 1 || contents[0].tagName !== 'TEXTAREA' || contents[0].disabled || contents[0].readOnly || publishes.length !== 1 || publishes[0].disabled || publishes[0].value !== 'Publish') return fail('Post editor or Publish control changed');
  if (publishes[0].classList.contains('disabled') || publishes[0].getAttribute('aria-disabled') === 'true' || publishes[0].getAttribute('aria-busy') === 'true') return fail('Publish control is temporarily busy');
  if (typeof form.checkValidity === 'function' && !form.checkValidity()) return fail('Post form contains invalid fields');
  if (['formaction', 'formmethod', 'formtarget'].some(n => publishes[0].hasAttribute(n))) return fail('Publish action override');
  if ((document.querySelector('#post-visibility-display')?.textContent || '').trim() !== 'Public') return fail('Post is not public');
  if ((document.querySelector('#post-status-display')?.textContent || '').trim() !== 'Draft') return fail('Post is no longer a new draft');
  if (form.querySelector('input[name*="payment"],input[name*="credit"],input[name*="billing"]')) return fail('Payment controls present');
  return {ok: true};
})
