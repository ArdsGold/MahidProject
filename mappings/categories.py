"""One category matcher shared by the two browser runners."""
from pathlib import Path
from urllib.parse import urlsplit
from .category_records import saved_rule, observe

CATEGORY_MATCHER = Path(__file__).with_name('category_match.js').read_text(encoding='utf-8')


def category_choice(page, options, business):
    parsed = urlsplit(page.url)
    host = parsed.hostname if parsed.scheme in ('http', 'https') else None
    profile = dict(business)
    if host:
        profile['category_rule'] = saved_rule(host, business)
    selected = page.evaluate(CATEGORY_MATCHER, {'options': options, 'business': profile})
    if host:
        rule = profile.get('category_rule') or {}
        reused = selected and rule.get('selected') and str(selected['value']) == str(rule['selected']['value'])
        observe(host, business, options, page.url, selected=selected,
                reason=rule['reason'] if reused else 'Matched approved categories or clear business evidence' if selected else 'Assistant category review needed',
                source=rule.get('source', 'saved') if reused else 'automatic' if selected else 'needs_review')
    return selected
