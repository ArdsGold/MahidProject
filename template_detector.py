"""Read-only form-family detection. A match never enables a publishing adapter."""
import argparse
import concurrent.futures
import csv
import hashlib
import json
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

from mappings.common import domain
from mappings.directories import DIRECTORY_SITES
from mappings.registry import CLASSIFIEDS, DIRECTORIES, SUPPORTED

ROOT = Path(__file__).resolve().parent
CATALOG = ROOT / 'mappings' / 'template_observations.json'
DIRECTORY_FIELDS = {'TITLE': 'input', 'URL': 'input', 'DESCRIPTION': 'textarea',
                    'OWNER_NAME': 'input', 'OWNER_EMAIL': 'input', 'CATEGORY_ID': 'select'}
CLASSIFIED_FIELDS = {'adtitle': 'input', 'addesc': 'textarea', 'email': 'input'}
FORM_STRUCTURE_JS = '''() => ({host: location.hostname.toLowerCase().replace(/^www\\./,''),
  forms: [...document.forms].map(f => ({method:f.method.toLowerCase(), fields:
    [...f.elements].filter(e=>['INPUT','TEXTAREA','SELECT','BUTTON'].includes(e.tagName) &&
      e.type!=='hidden' && !['g-recaptcha-response','h-captcha-response','cf-turnstile-response'].includes(e.name))
    .map(e=>({name:e.name||e.id||'',tag:e.tagName.toLowerCase(),type:(e.getAttribute('type')||
      (e.tagName==='INPUT'?'text':e.tagName.toLowerCase())).toLowerCase(),required:!!e.required,
      maxlength:e.maxLength>=0?e.maxLength:null}))}))})'''


def now():
    return datetime.now(timezone.utc).isoformat()


class FormStructure(HTMLParser):
    """Retain control structure only, never field values, tokens or page text."""
    def __init__(self):
        super().__init__()
        self.forms = []
        self.current = None

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == 'form':
            self.current = {'method': a.get('method', 'get').lower(), 'fields': []}
            self.forms.append(self.current)
        if self.current is not None and tag in ('input', 'textarea', 'select', 'button'):
            kind = (a.get('type') or ('text' if tag == 'input' else tag)).lower()
            name = a.get('name') or a.get('id') or ''
            if kind == 'hidden' or name in ('g-recaptcha-response', 'h-captcha-response', 'cf-turnstile-response'):
                return
            # Do not save arbitrary site strings. Names are structural identifiers only.
            if len(name) > 256 or not all(c.isalnum() or c in '_-[]$:.' for c in name):
                name = ''
            limit = a.get('maxlength', '')
            self.current['fields'].append({'name': name, 'tag': tag, 'type': kind,
                                           'required': 'required' in a,
                                           'maxlength': int(limit) if limit.isdigit() else None})

    def handle_endtag(self, tag):
        if tag == 'form':
            self.current = None


def detect(html):
    parser = FormStructure()
    parser.feed(html)
    return detect_forms(parser.forms, html)


def detect_forms(forms, html=''):
    lower = html.lower()
    blocked = any(x in lower for x in ('cf-chl-', 'just a moment', 'verify you are human', 'resource limit is reached'))
    candidates = []
    for form in forms:
        if not form['fields']:
            continue
        fields = {f['name']: f['tag'] for f in form['fields']}
        directory = sum(fields.get(k) == v for k, v in DIRECTORY_FIELDS.items())
        classified = sum(fields.get(k) == v for k, v in CLASSIFIED_FIELDS.items())
        inputs_ok = all(f['type'] in ('text', 'url', 'email') for f in form['fields']
                        if f['tag'] == 'input' and f['name'] in DIRECTORY_FIELDS)
        if directory == 6 and inputs_ok and form['method'] == 'post':
            family, kind, confidence = 'php-directory', 'Directory', 100
        elif classified == 3 and any(k in fields for k in ('area', 'arealist')) and form['method'] == 'post':
            family, kind, confidence = 'xzero-classifieds', 'Classifieds', 100
        else:
            family, kind, confidence = 'unmatched-form', 'Unknown', None
        candidates.append((confidence or 0, len(form['fields']), family, kind, form))
    if candidates and (max(x[0] for x in candidates) or not blocked):
        confidence, _, family, kind, form = max(candidates, key=lambda x: x[:2])
        signature = {'method': form['method'], 'fields': sorted(form['fields'], key=lambda x: json.dumps(x, sort_keys=True))}
        fingerprint = hashlib.sha256(json.dumps(signature, sort_keys=True).encode()).hexdigest()[:16]
        return {'family': family, 'website_type': kind, 'match': confidence or None,
                'fingerprint': fingerprint, 'signature': signature,
                'status': 'Matched form' if confidence else 'Unmatched form',
                'reason': 'Required family controls occur together in one POST form' if confidence
                          else 'Form observed; may be login/search. Publishing workflow needs inspection.'}
    return {'family': 'unknown', 'website_type': 'Unknown', 'match': None, 'fingerprint': '',
            'status': 'Blocked / challenge' if blocked else 'No form observed',
            'reason': 'Verification/error page; template cannot be determined' if blocked
                      else 'No form in returned HTML; browser rendering or another route may be needed'}


def configured(host):
    if host in DIRECTORIES:
        return {'family': 'php-directory', 'website_type': 'Directory', 'basis': 'Configured route'}
    if host in CLASSIFIEDS:
        return {'family': 'xzero-classifieds', 'website_type': 'Classifieds', 'basis': 'Configured route'}
    if host in SUPPORTED:
        return {'family': 'platform:' + host, 'website_type': 'Individual platform', 'basis': 'Configured route'}
    with (ROOT / 'mappings' / 'external_sites.csv').open(encoding='utf-8-sig', newline='') as stream:
        reference = next((r for r in csv.DictReader(stream) if r['domain'] == host), None)
    if reference:
        names = {'blog': ('blog-network-reference', 'Blog'),
                 'business_listing': ('business-listing-reference', 'Business listing')}
        family, kind = names.get(reference['family'], ('unknown', 'Unknown'))
        return {'family': family, 'website_type': kind, 'basis': 'Source reference only'}
    return {'family': 'unknown', 'website_type': 'Unknown', 'basis': 'Not inspected'}


def load_catalog(path=CATALOG):
    return json.loads(Path(path).read_text(encoding='utf-8')) if Path(path).exists() else {}


def save_catalog(records, path=CATALOG):
    path = Path(path)
    temp = path.with_suffix('.json.tmp')
    temp.write_text(json.dumps(records, indent=2, sort_keys=True), encoding='utf-8')
    temp.replace(path)


def observe_browser(host, snapshot):
    """Collect structural evidence along mapped runs; never store entered client data."""
    if snapshot.get('host') != host:
        return
    forms = snapshot.get('forms', [])
    result = detect_forms(forms)
    records = load_catalog()
    records[host] = {**result, 'basis': 'Live browser', 'source': 'Rendered form controls', 'checked_utc': now()}
    save_catalog(records)


def pool_labels(host, records, counts):
    hint = configured(host)
    record = records.get(host, {})
    observed = record.get('family') not in (None, 'unknown', 'unmatched-form')
    family = record['family'] if observed or hint['family'] == 'unknown' and record.get('fingerprint') else hint['family']
    fingerprint = record.get('fingerprint', '')
    group = ('Shared structure (' + str(counts[fingerprint]) + ' sites)' if counts[fingerprint] > 1
             else 'Single observed structure') if fingerprint else 'Not fingerprinted'
    basis = record.get('basis', hint['basis']) if observed or hint['family'] == 'unknown' else hint['basis']
    if basis == 'Not inspected' and record.get('status') == 'HTTP / network error':
        basis = 'No structural evidence'
    status = record.get('last_probe_status', record.get('status', 'Not inspected'))
    if observed and hint['basis'] == 'Configured route' and family != hint['family']:
        status = 'Mapping / template mismatch'
    return [record['website_type'] if observed else hint['website_type'], family,
            group, record.get('match') if observed else 'Unrated', basis, status,
            record.get('checked_utc', ''), fingerprint,
            'Mapped; live guards required' if host in SUPPORTED else 'Needs mapping',
            record.get('source', ''), record.get('reason', '')]


def seed_saved_forms(records, hosts):
    """Existing fixtures are evidence of saved structure, never a current live check."""
    for host in hosts:
        if records.get(host, {}).get('fingerprint'):
            continue
        site = DIRECTORY_SITES.get(host, {})
        paths = [ROOT / 'mappings' / 'fixtures' / (host + '.html'),
                 ROOT / '.local' / 'new-directory-contracts' / (host + '.html')]
        fixture_root = ROOT / 'extSource/source/extension/test/family3/fixtures'
        paths += [fixture_root / (host + '.html'), fixture_root / (site.get('id', host) + '.html')]
        path = next((p for p in paths if p.exists()), None)
        if path:
            result = detect(path.read_text(encoding='utf-8', errors='replace'))
            records[host] = {**result, 'basis': 'Saved form', 'source': path.relative_to(ROOT).as_posix(),
                             'checked_utc': now()}


def probe(row, timeout=8):
    host = row['domain']
    if host in DIRECTORY_SITES:
        from mappings.directories import submission_url
        url = submission_url(DIRECTORY_SITES[host])
    elif 'dir' in host:
        url = 'https://' + host + '/submit.php'
    elif host in CLASSIFIEDS:
        url = 'https://' + host + '/index.php?view=post&cityid=0&lang=en'
    else:
        url = row['website'] if '://' in row['website'] else 'https://' + host + '/'
    try:
        request = Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urlopen(request, timeout=timeout) as response:
            if domain(response.url) != host:
                raise ValueError('Redirect outside website')
            if 'html' not in response.headers.get('Content-Type', '').lower():
                raise ValueError('Non-HTML response')
            html = response.read(700_000).decode(response.headers.get_content_charset() or 'utf-8', errors='replace')
            result = detect(html)
            # Queries and fragments are never stored, even on redirected public pages.
            final = urlsplit(response.url)
            return host, {**result, 'basis': 'Live HTTP', 'source': final.scheme + '://' + final.netloc + final.path,
                          'checked_utc': now()}
    except Exception as exc:
        # Error class is sufficient; exception text can include server-controlled URLs.
        return host, {'status': 'HTTP / network error', 'reason': type(exc).__name__, 'checked_utc': now()}


def scan(rows, records, workers=6, timeout=8):
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
        futures = [pool.submit(probe, row, timeout) for row in rows if row['enabled'] == 'Yes']
        for future in concurrent.futures.as_completed(futures):
            host, result = future.result()
            if result.get('family') in (None, 'unknown') and records.get(host, {}).get('fingerprint'):
                # An outage/challenge is not proof that a previously seen form changed.
                records[host].update(last_probe_status=result['status'], last_probe_utc=result['checked_utc'])
            else:
                records[host] = result
            print(host, result['status'], flush=True)


def main():
    from website_pool import DEFAULT_POOL, read_pool, refresh_pool
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pool', type=Path, default=DEFAULT_POOL)
    parser.add_argument('--scan', action='store_true', help='Read-only HTTP GETs; no browser or submission')
    parser.add_argument('--only', nargs='+', help='Limit live probes to pool hostnames')
    args = parser.parse_args()
    rows = read_pool(args.pool)
    records = load_catalog()
    seed_saved_forms(records, {r['domain'] for r in rows})
    if args.only:
        selected = {domain(x) for x in args.only}
        if selected - {r['domain'] for r in rows}:
            parser.error('--only includes a website absent from the pool')
        rows = [r for r in rows if r['domain'] in selected]
    if args.scan:
        scan(rows, records)
    save_catalog(records)
    refresh_pool(args.pool)
    print('Template columns refreshed. Detection does not enable publishing routes.')


if __name__ == '__main__':
    main()
