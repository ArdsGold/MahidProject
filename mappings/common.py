"""Shared field, editor and verification helpers for site mappings."""
import re
from pathlib import Path
from urllib.parse import urlsplit
from operator_notifications import operator_input


class NeedsAttention(Exception):
    pass


class InspectionRequired(NeedsAttention):
    def __init__(self, host, reason):
        self.host = domain(host)
        super().__init__(self.host + ': ' + reason)


class RefillRequested(Exception):
    pass


def domain(value):
    value = str(value).strip()
    parsed = urlsplit(value if '://' in value else 'https://' + value)
    if parsed.scheme not in ('http', 'https') or parsed.username or parsed.password:
        raise ValueError('Listing sites must be public HTTP(S) domains.')
    host = (parsed.hostname or '').lower().removeprefix('www.')
    if not re.fullmatch(r'[a-z0-9][a-z0-9.-]*\.[a-z]{2,}', host):
        raise ValueError('Invalid listing domain.')
    return host


def publication_domain(platform, record):
    parent = domain(platform)
    public = domain(record.get('publication_host') or parent)
    if public != parent and not (public.endswith('.' + parent) and public.count('.') == parent.count('.') + 1):
        raise ValueError('Publication hostname must match the platform or its recorded direct subdomain')
    return public


CONTENT_FITTER = Path(__file__).with_name('content_fit.js').read_text(encoding='utf-8')
# Explicit public allowlist: never enumerate account/credential fields.
PUBLIC_FIELDS = (('name', ''), ('website', 'Website'), ('address', 'Address'),
                 ('phone', 'Phone'), ('email', 'Email'), ('description', ''),
                 ('short_description', 'Short description'), ('category', 'Category'),
                 ('services', 'Services'), ('hours', 'Hours'), ('timezone', 'Timezone'),
                 ('facebook', 'Facebook'), ('instagram', 'Instagram'), ('linkedin', 'LinkedIn'),
                 ('youtube', 'YouTube'), ('tiktok', 'TikTok'), ('twitter', 'X / Twitter'),
                 ('logo', 'Logo'), ('keywords', 'Keywords'))


def content_parts(business, markdown=False):
    parts, omitted = [], []
    for key, label in PUBLIC_FIELDS:
        value = str(business.get(key) or '').strip()
        if key == 'address' and not value:
            value = ', '.join(str(business[k]).strip() for k in
                              ('street', 'address_line_2', 'city', 'region', 'postal_code', 'country') if business.get(k))
        if not value:
            continue
        if '\ufffd' in value:
            omitted.append(key + ' (damaged source text)')
            continue
        text = label + ': ' + value if label else value
        if markdown and key == 'name':
            text = '# ' + value
        if markdown and key == 'website':
            text = '[Official website](' + value + ')'
        parts.append({'key': key, 'text': text})
    return {'parts': parts, 'omitted_fields': omitted}


def content(business):
    return tuple('\n\n'.join(p['text'] for p in content_parts(business, md)['parts']) for md in (False, True))


def fit_body(page, selector, business, record, markdown=False, rich=False):
    field = page.locator(selector)
    limit = field.evaluate('(e)=>e.maxLength >= 0 ? e.maxLength : null')
    result = page.evaluate(CONTENT_FITTER, {**content_parts(business, markdown), 'limit': limit})
    record.update(omitted_fields=result['omitted_fields'], content_notes=result['content_notes'])
    if result['blocked']:
        raise NeedsAttention('Text limit or source damage prevents including the complete business name and website')
    if rich:
        from .editors import article_html, fill_rich_editor
        value = article_html(business, result['text'])
        if limit is not None and len(value.encode('utf-16-le')) // 2 > limit:
            record['content_notes'] += '; formatted HTML exceeds the backing field limit; submission stopped'
            raise NeedsAttention('Rich editor HTML limit needs a site-specific mapping')
        fill_rich_editor(page, selector, value)
        return result['text']
    fill_text(page, selector, result['text'])
    actual = field.input_value()
    if actual.replace('\r\n', '\n') != result['text'].replace('\r\n', '\n'):
        raise NeedsAttention('Editor changed or truncated the combined client details')
    return result['text']


def go(page, url):
    response = page.goto(url, wait_until='domcontentloaded', timeout=25000)
    if response and response.status >= 400:
        raise NeedsAttention('HTTP ' + str(response.status) + ' at submission page')
    title = page.title().lower()
    if any(t in title for t in ('just a moment', 'bot verification', 'access denied', 'attention required')):
        raise NeedsAttention('Site access challenge')
    return response


def challenge(page):
    selectors = 'iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="challenges.cloudflare"], .g-recaptcha, .h-captcha, .cf-turnstile, #KEY-Captcha, #logo_key_captcha, #captcha_window, .captcha_checkbox'
    return page.locator(selectors).count() > 0


def wait_for_challenge(page, interactive):
    if challenge(page):
        if interactive:
            answer = operator_input('Complete verification, then press Enter. If refreshed, type refill; for your regular browser type manual; to stop type stop: ').strip().lower()
            if answer == 'refill':
                raise RefillRequested
            if answer == 'manual':
                raise NeedsAttention('User requested manual completion because browser verification is blocked')
            if answer == 'stop':
                raise KeyboardInterrupt
            if answer == 'skip':
                raise NeedsAttention('Skipped by operator before submission')
            if answer:
                raise NeedsAttention('Verification needs interactive review')
        else:
            raise NeedsAttention('CAPTCHA/verification requires interaction; no paid solver configured')


def fill_text(page, selector, value):
    field = page.locator(selector)
    if field.is_visible():
        field.fill(value)
    else:
        # Rentry's CodeMirror view hides the backing textarea.
        cm = page.locator('.CodeMirror')
        if cm.count() == 1 and cm.evaluate('(e)=>!!e.CodeMirror'):
            cm.evaluate('(e,value)=>{e.CodeMirror.setValue(value);e.CodeMirror.save();}', value)
            return
        editor = page.locator('.cm-content[contenteditable="true"]')
        if editor.count() == 1:
            editor.fill(value)
        else:
            raise NeedsAttention('Editor changed; field not visible: ' + selector)
