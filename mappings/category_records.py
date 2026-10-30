"""Public category inventories and validated, topic-scoped selections. No AI dependency."""
import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent
OPTIONS_DIR = ROOT / 'category_options'
RULES = ROOT / 'category_rules.json'


def normalize(value):
    return re.sub(r'[^a-z0-9]+', ' ', str(value or '').lower().replace('&', ' and ')).strip()


def topic(business):
    fallbacks = business.get('category_fallbacks') or []
    if isinstance(fallbacks, str):
        fallbacks = re.split(r'[;\n]', fallbacks)
    return {'category': normalize(business.get('category')),
            'fallbacks': list(dict.fromkeys(normalize(x) for x in fallbacks if normalize(x)))}


def topic_key(business):
    return hashlib.sha256(json.dumps(topic(business), sort_keys=True).encode()).hexdigest()[:16]


def clean_options(options):
    return [{'label': str(o.get('label', o.get('text', ''))), 'value': str(o.get('value', '')),
             'disabled': bool(o.get('disabled'))} for o in options]


def fingerprint(options):
    return hashlib.sha256(json.dumps(clean_options(options), sort_keys=True).encode()).hexdigest()[:16]


def _host(host):
    from .common import domain
    return domain(host)


def _read(path):
    return json.loads(path.read_text(encoding='utf-8')) if path.exists() else {}


def _write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix('.json.tmp')
    temporary.write_text(json.dumps(value, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    temporary.replace(path)


def saved_rule(host, business, path=None):
    return _read(Path(path or RULES)).get(_host(host), {}).get(topic_key(business))


def observe(host, business, options, page_url='', selected=None, reason='', source='automatic', folder=None):
    host = _host(host)
    options = clean_options(options)
    if selected is not None:
        selected = clean_options([selected])[0]
        matches = [o for o in options if o == selected and not o['disabled'] and o['value'] not in ('', '0')]
        if len(matches) != 1:
            raise ValueError('Selected category is absent, disabled, or ambiguous in the saved options.')
    path = Path(folder or OPTIONS_DIR) / (host + '.json')
    record = _read(path)
    version = fingerprint(options)
    now = datetime.now(timezone.utc).isoformat()
    parsed = urlsplit(page_url)
    safe_page = parsed.scheme + '://' + parsed.netloc + parsed.path if parsed.scheme in ('http','https') and not parsed.username and not parsed.password else ''
    record.update(domain=host, latest_fingerprint=version)
    record.setdefault('versions', {})[version] = {'page': safe_page, 'options': options, 'option_count': len(options), 'checked_utc': now}
    decision = {'topic': topic(business), 'selected': selected, 'reason': reason, 'source': source,
                'options_fingerprint': version, 'checked_utc': now}
    record.setdefault('decisions', {})[topic_key(business) + ':' + version] = decision
    _write(path, record)
    return path


def record_rule(host, business, selected_value, reason, source='assistant', folder=None, rules_path=None):
    """Approve exactly one option from a previously captured live inventory."""
    if not topic(business)['category'] or not reason.strip():
        raise ValueError('A business category and explanation are required for a reusable decision.')
    host = _host(host)
    inventory = _read(Path(folder or OPTIONS_DIR) / (host + '.json'))
    options = inventory['versions'][inventory['latest_fingerprint']]['options']
    matches = [o for o in options if o['value'] == str(selected_value) and not o['disabled'] and o['value'] not in ('', '0')]
    if len(matches) != 1:
        raise ValueError('Choose one actual enabled category value from the captured inventory.')
    selected = matches[0]
    rule = {'topic': topic(business), 'selected': selected, 'reason': reason.strip(), 'source': source,
            'options_fingerprint': inventory['latest_fingerprint'], 'checked_utc': datetime.now(timezone.utc).isoformat()}
    path = Path(rules_path or RULES)
    rules = _read(path)
    rules.setdefault(host, {})[topic_key(business)] = rule
    _write(path, rules)
    observe(host, business, options, page_url=inventory['versions'][inventory['latest_fingerprint']]['page'], selected=selected, reason=reason, source=source, folder=folder)
    return rule


def capture_options(client, selector, expected_count):
    """Read the entire public dropdown in short log lines, avoiding bridge truncation."""
    from urllib.parse import unquote
    from uivision import tool_text, BridgeError
    if selector != '[name="CATEGORY_ID"] option':
        raise ValueError('Unsupported category inventory selector.')
    code = 'return encodeURIComponent(JSON.stringify([...document.querySelectorAll(' + json.dumps(selector) + ')].map(e=>({text:e.textContent.trim(),value:e.value,disabled:!!e.disabled||!!e.closest("optgroup[disabled]")}))));'
    chunks = {}
    length = None
    offset = 0
    while length is None or offset * 160 < length:
        script = 'uiv.run("executeScript",' + json.dumps(code) + ',"category_payload");const p=uiv.getVar("category_payload");uiv.log("CATEGORY_LENGTH:"+p.length);'
        script += 'for(let i=' + str(offset) + ';i<Math.min(' + str(offset+10) + ',Math.ceil(p.length/160));i++)uiv.log("CATEGORY_CHUNK:"+i+":"+p.slice(i*160,(i+1)*160));'
        raw = tool_text(client.call('run_macro', {'script':script,'look':'none','log_limit':8000}, timeout=180))
        sizes = re.findall(r'CATEGORY_LENGTH:(\d+)',raw)
        if not sizes or (length is not None and length != int(sizes[-1])):
            raise BridgeError('Category options changed or inventory response was incomplete; no submission.')
        length = int(sizes[-1])
        batch = {int(i):part.rstrip('\r') for i,part in re.findall(r'CATEGORY_CHUNK:(\d+):([^\r\n]*)',raw)}
        expected = set(range(offset,min(offset+10,(length+159)//160)))
        if expected - batch.keys():
            raise BridgeError('Category inventory chunks missing; no submission.')
        chunks.update(batch)
        offset += 10
    options = json.loads(unquote(''.join(chunks[i] for i in range((length+159)//160))))
    if len(options) != expected_count:
        raise BridgeError('Category inventory count changed; no submission.')
    return options


def observe_route(host, business, steps, route=None, folder=None):
    """Keep complete observed category links and selected route, excluding account data."""
    host = _host(host)
    for step in steps:
        if step.get('selected') and step['selected'] not in step['options']:
            raise ValueError('Selected category route was not observed on this page.')
    path = Path(folder or ROOT / 'category_routes') / (host + '.json')
    data = _read(path)
    data.update(domain=host)
    data.setdefault('topics', {})[topic_key(business)] = {
        'topic': topic(business), 'steps': steps, 'route': route,
        'checked_utc': datetime.now(timezone.utc).isoformat()}
    _write(path, data)
    return path
