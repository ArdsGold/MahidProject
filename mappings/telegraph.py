"""Official Telegraph API: https://telegra.ph/api. No paid service or browser bypass."""
import json
import re
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from .common import NeedsAttention, content_parts


def call(method, **values):
    request = Request('https://api.telegra.ph/' + method,
                      data=urlencode(values).encode('utf-8'), method='POST')
    with urlopen(request, timeout=25) as response:
        result = json.load(response)
    if not result.get('ok'):
        error = str(result.get('error', 'API_ERROR'))
        raise NeedsAttention('Telegraph rejected request: ' + (error if re.fullmatch('[A-Z0-9_]+', error) else 'API_ERROR'))
    return result['result']


def payload(business):
    if not 1 <= len(business['name']) <= 256 or len(business['website']) > 512:
        raise NeedsAttention('Telegraph title/profile URL exceeds its documented limit')
    data = content_parts(business)
    parts = data['parts']
    omitted = list(data['omitted_fields'])
    if not {'name', 'website'} <= {p['key'] for p in parts}:
        raise NeedsAttention('Telegraph requires undamaged business name and website')
    def encode():
        nodes = [{'tag': 'p', 'children': ['Website: ', {'tag': 'a', 'attrs': {'href': business['website']},
                  'children': [business['website']]}]} if p['key'] == 'website'
                 else {'tag': 'p', 'children': [p['text']]} for p in parts]
        return json.dumps(nodes, ensure_ascii=False)
    value = encode()
    while len(value.encode('utf-8')) > 65536:
        # Keep complete contacts/URLs. Shorten only approved prose, then omit optional fields.
        prose = next((p for p in parts if p['key'] == 'description' and len(p['text']) > 100), None)
        if prose:
            excess = len(value.encode('utf-8')) - 65536
            shortened = prose['text'].encode('utf-8')[:max(0, len(prose['text'].encode('utf-8')) - excess - 100)].decode('utf-8', errors='ignore')
            prose['text'] = shortened.rsplit(' ', 1)[0] + '...'
            if 'description (shortened)' not in omitted:
                omitted.append('description (shortened)')
        else:
            removable = [p for p in parts if p['key'] not in ('name', 'website')]
            if not removable:
                raise NeedsAttention('Telegraph content cannot fit its 64 KB limit')
            removed = removable[-1]
            parts.remove(removed)
            omitted.append(removed['key'])
        value = encode()
    return {'title': business['name'], 'author_name': business['name'][:128],
            'author_url': business['website'], 'content': value}, omitted
